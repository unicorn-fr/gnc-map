import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { ArrowLeft, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Info, Trash2, Clock, ChevronRight } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { geocodeBatch, geocodeSmart } from '../lib/geocode'
import toast from 'react-hot-toast'

// ── Helpers ──────────────────────────────────────────────────
const guessCol = (cols, keywords) => {
  const lc = cols.map(c => c.toLowerCase())
  for (const kw of keywords) {
    const idx = lc.findIndex(c => c.includes(kw))
    if (idx >= 0) return cols[idx]
  }
  const stripped = cols.map(c => c.toLowerCase().replace(/[.\s_\-/]/g, ''))
  for (const kw of keywords) {
    const kwS = kw.replace(/[.\s_\-/]/g, '')
    const idx = stripped.findIndex(c => c.includes(kwS))
    if (idx >= 0) return cols[idx]
  }
  return ''
}

const normalizeType = (v = '') => {
  const s = String(v).toLowerCase().trim()
  if (s === '1') return 'chantier'
  if (s === '0') return 'siege'
  if (s.includes('siège') || s.includes('siege') || s.includes('social') || s.includes('bureau') || s === 'non' || s === 'no') return 'siege'
  return 'chantier'
}

const normalizeStatus = (v = '') => {
  const s = String(v).toLowerCase()
  if (s.includes('client')) return 'client'
  if (s.includes('cours') || s.includes('actif') || s.includes('location')) return 'en_cours'
  if (s.includes('termin') || s.includes('clôt') || s.includes('clot') || s.includes('fini')) return 'termine'
  return 'prospect'
}

const fmt = (iso) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

// Étapes : 0=Commercial+Fichier, 1=Colonnes, 2=Aperçu, 3=Import
const STEPS = ['Fichier', 'Colonnes', 'Aperçu', 'Import']

// ── Composant principal ────────────────────────────────────────
export default function ImportPage({ commercials, onClose, onImported }) {
  const [selectedCommercial, setSelectedCommercial] = useState(null)
  const [step, setStep] = useState(0)
  const [rows, setRows] = useState([])
  const [columns, setColumns] = useState([])
  const [fileName, setFileName] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [mapping, setMapping] = useState({
    name: '', company: '', type: '', status: '',
    address: '', postcode: '', city: '',
    phone: '', email: '', notes: '', external_id: '',
  })
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [results, setResults] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const [importHistory, setImportHistory] = useState([])
  const [deletingId, setDeletingId] = useState(null)
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [confirmResetAll, setConfirmResetAll] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [isRegeocing, setIsRegeocing] = useState(false)
  const [regeoProgress, setRegeoProgress] = useState(null) // { current, total, fixed }
  const fileRef = useRef()

  useEffect(() => {
    loadHistory()
  }, [])

  const loadHistory = async () => {
    const { data } = await supabase
      .from('import_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setImportHistory(data)
  }

  // ── Suppression d'un import et de tous ses sites ──────────────
  const handleDeleteImport = async (log) => {
    setConfirmDelete(null)
    setDeletingId(log.id)
    try {
      await supabase.from('sites').delete().eq('import_log_id', log.id)
      await supabase.from('import_logs').delete().eq('id', log.id)
      toast.success(`Import "${log.filename}" supprimé`)
      await loadHistory()
      onImported()
    } catch (e) {
      toast.error('Erreur lors de la suppression')
    } finally {
      setDeletingId(null)
    }
  }

  // ── Suppression totale ────────────────────────────────────────
  const handleResetAll = async () => {
    setConfirmResetAll(false)
    setIsResetting(true)
    try {
      await supabase.from('sites').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      await supabase.from('import_logs').delete().neq('id', '00000000-0000-0000-0000-000000000000')
      toast.success('Tous les sites ont été supprimés')
      await loadHistory()
      onImported()
    } catch (e) {
      toast.error('Erreur lors de la réinitialisation')
    } finally {
      setIsResetting(false)
    }
  }

  // ── Re-géocodage des sites sans coordonnées ──────────────────
  const handleReGeocode = async () => {
    setIsRegeocing(true)
    setRegeoProgress({ current: 0, total: 0, fixed: 0 })
    try {
      // Récupérer tous les sites sans coordonnées GPS (lat IS NULL)
      const { data: missing } = await supabase
        .from('sites')
        .select('id, address, postcode, city')
        .is('lat', null)
        .eq('deleted', false)

      if (!missing?.length) {
        toast.success('Tous les sites ont déjà des coordonnées GPS !')
        setRegeoProgress(null)
        setIsRegeocing(false)
        return
      }

      setRegeoProgress({ current: 0, total: missing.length, fixed: 0 })
      let fixed = 0

      for (let i = 0; i < missing.length; i++) {
        const site = missing[i]
        const geo = await geocodeSmart(site.address ?? '', site.postcode ?? '', site.city ?? '')
        if (geo) {
          await supabase.from('sites').update({ lat: geo.lat, lng: geo.lng }).eq('id', site.id)
          fixed++
        }
        setRegeoProgress({ current: i + 1, total: missing.length, fixed })
      }

      toast.success(`Re-géocodage terminé : ${fixed} / ${missing.length} site(s) placés sur la carte`)
      onImported()
    } catch (e) {
      toast.error('Erreur lors du re-géocodage')
      console.error(e)
    } finally {
      setIsRegeocing(false)
      setRegeoProgress(null)
    }
  }

  // ── Chargement du fichier ─────────────────────────────────────
  const handleFile = (file) => {
    if (!file) return
    setFileName(file.name)

    const reader = new FileReader()
    reader.onload = (e) => {
      const data = new Uint8Array(e.target.result)
      const wb = XLSX.read(data, { type: 'array', cellDates: true })
      const ws = wb.Sheets[wb.SheetNames[0]]
      const parsed = XLSX.utils.sheet_to_json(ws, { defval: '' })

      if (!parsed.length) return toast.error('Le fichier semble vide')

      const cols = Object.keys(parsed[0])
      setColumns(cols)
      setRows(parsed)

      setMapping({
        name:        guessCol(cols, ['raison sociale', 'raison', 'nom', 'name', 'entreprise', 'société', 'client']),
        company:     guessCol(cols, ['raison sociale', 'société', 'enseigne', 'entreprise']),
        type:        guessCol(cols, ['chantier', 'type']),
        status:      guessCol(cols, ['actif', 'statut', 'status', 'état']),
        address:     guessCol(cols, ['adresse1', 'adresse', 'adress', 'address', 'rue', 'voie', 'street']),
        postcode:    guessCol(cols, ['c.p', 'cp', 'code postal', 'code_postal', 'postal', 'zip', 'codepostal']),
        city:        guessCol(cols, ['ville', 'city', 'commune', 'localité']),
        phone:       guessCol(cols, ['téléphone', 'telephone', 'tel', 'phone', 'mobile']),
        email:       guessCol(cols, ['email', 'mail', 'adresse email', 'courriel', 'e-mail']),
        notes:       guessCol(cols, ['activité', 'activite', 'secteur', 'note', 'obs', 'remarque', 'comment', 'info']),
        external_id: guessCol(cols, ['code client', 'id', 'ref', 'n°', 'numero', 'numéro', 'identifiant']),
      })

      setStep(1)
    }
    reader.readAsArrayBuffer(file)
  }

  const handleDrop = (e) => {
    e.preventDefault()
    setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  // ── Aperçu ────────────────────────────────────────────────────
  const buildPreviewRow = (row) => {
    return {
      name:        mapping.name        ? String(row[mapping.name] ?? '').trim()   : '',
      company:     mapping.company     ? String(row[mapping.company] ?? '').trim() : '',
      type:        mapping.type        ? normalizeType(String(row[mapping.type] ?? '')) : 'chantier',
      status:      mapping.status      ? normalizeStatus(String(row[mapping.status] ?? '')) : 'prospect',
      address:     mapping.address     ? String(row[mapping.address] ?? '').trim() : '',
      postcode:    mapping.postcode    ? String(row[mapping.postcode] ?? '').trim() : '',
      city:        mapping.city        ? String(row[mapping.city] ?? '').trim()    : '',
      phone:       mapping.phone       ? String(row[mapping.phone] ?? '').trim()   : '',
      email:       mapping.email       ? String(row[mapping.email] ?? '').trim()   : '',
      notes:       mapping.notes       ? String(row[mapping.notes] ?? '').trim()   : '',
      external_id: mapping.external_id ? String(row[mapping.external_id] ?? '').trim() : '',
    }
  }

  const allParsed = rows.map(buildPreviewRow)
  const validRows = allParsed.filter(r => r.name.length > 0)
  const ignoredCount = rows.length - validRows.length
  const preview = rows.slice(0, 8).map(buildPreviewRow).filter(r => r.name)

  // ── Import ────────────────────────────────────────────────────
  const runImport = async () => {
    if (!selectedCommercial) return
    setIsRunning(true)
    setStep(3)

    const prepared = validRows
    const needsGeocode = prepared.some(r => r.address || r.city)
    let geoResults = prepared.map(() => null)

    if (needsGeocode) {
      setProgress({ current: 0, total: prepared.length })
      geoResults = await geocodeBatch(
        prepared,
        { addressCol: 'address', postcodeCol: 'postcode', cityCol: 'city' },
        (cur, tot) => setProgress({ current: cur, total: tot })
      )
    }

    const { data: logData } = await supabase
      .from('import_logs')
      .insert({
        filename: fileName,
        total: prepared.length,
        inserted: 0,
        updated: 0,
        skipped: 0,
      })
      .select('id')
      .single()

    const importLogId = logData?.id ?? null
    let inserted = 0, updated = 0, skipped = 0, noCoords = 0

    for (let i = 0; i < prepared.length; i++) {
      const row = prepared[i]
      const geo = geoResults[i]
      if (!geo) noCoords++

      const payload = {
        commercial_id: selectedCommercial.id,
        name:          row.name || 'Sans nom',
        company:       row.company  || null,
        type:          row.type,
        status:        row.status,
        address:       row.address  || null,
        postcode:      row.postcode || null,
        city:          row.city     || null,
        phone:         row.phone    || null,
        email:         row.email    || null,
        notes:         row.notes    || null,
        lat:           geo?.lat  ?? null,
        lng:           geo?.lng  ?? null,
        external_id:   row.external_id || null,
        updated_at:    new Date().toISOString(),
      }

      if (row.external_id) {
        const { data: existing } = await supabase
          .from('sites')
          .select('id, deleted')
          .eq('external_id', row.external_id)
          .single()

        if (existing) {
          if (existing.deleted) { skipped++; continue }
          await supabase.from('sites').update(payload).eq('id', existing.id)
          updated++
          continue
        }
      }

      const { error } = await supabase.from('sites').insert({ ...payload, import_log_id: importLogId })
      error ? skipped++ : inserted++
    }

    if (importLogId) {
      await supabase.from('import_logs').update({ inserted, updated, skipped }).eq('id', importLogId)
    }

    setResults({ inserted, updated, skipped, total: prepared.length, noCoords })
    setIsRunning(false)
  }

  // ── Rendu ─────────────────────────────────────────────────────
  const ColSelect = ({ label, field, required }) => (
    <div className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="w-40 flex-shrink-0">
        <p className="text-sm font-medium text-gray-700">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </p>
      </div>
      <select
        value={mapping[field]}
        onChange={e => setMapping(p => ({ ...p, [field]: e.target.value }))}
        className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
      >
        <option value="">(ignorer)</option>
        {columns.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-gray-50">
      {/* Header */}
      <div className="flex-shrink-0 bg-blue-950 text-white px-4 py-4 flex items-center gap-3">
        <button onClick={onClose} className="p-2 hover:bg-blue-800 rounded-xl transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <p className="font-bold text-base">Import Excel / CSV</p>
          {selectedCommercial && step > 0 ? (
            <div className="flex items-center gap-1.5 mt-0.5">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: selectedCommercial.color }} />
              <p className="text-blue-300 text-xs">{selectedCommercial.name}</p>
            </div>
          ) : (
            <p className="text-blue-300 text-xs">Importer et mettre à jour votre base de données</p>
          )}
        </div>
      </div>

      {/* Steps indicator */}
      <div className="flex-shrink-0 bg-white border-b px-4 py-3">
        <div className="flex items-center gap-2 max-w-lg">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold flex-shrink-0 ${
                i < step ? 'bg-green-500 text-white' :
                i === step ? 'bg-blue-700 text-white' :
                'bg-gray-200 text-gray-400'
              }`}>
                {i < step ? '✓' : i + 1}
              </div>
              <span className={`text-xs font-medium ${i === step ? 'text-blue-700' : 'text-gray-400'}`}>{s}</span>
              {i < STEPS.length - 1 && <div className="flex-1 h-px bg-gray-200 mx-1" />}
            </div>
          ))}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── STEP 0 : Choix du commercial + Upload ── */}
        {step === 0 && (
          <div className="p-6 max-w-xl mx-auto">

            {/* Sélecteur de commercial */}
            <div className="mb-6">
              <p className="text-sm font-bold text-gray-700 mb-3">
                1. Pour quel commercial est ce fichier ?
              </p>
              <div className="grid grid-cols-1 gap-2">
                {commercials.filter(c => c.name !== 'Autres agences').map(c => (
                  <button
                    key={c.id}
                    onClick={() => setSelectedCommercial(c)}
                    className={`flex items-center gap-4 p-4 rounded-2xl border-2 transition-all text-left ${
                      selectedCommercial?.id === c.id
                        ? 'border-blue-500 bg-blue-50 shadow-sm'
                        : 'border-gray-200 bg-white hover:border-gray-300'
                    }`}
                  >
                    <div
                      className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-extrabold text-lg flex-shrink-0"
                      style={{ background: c.color }}
                    >
                      {c.name.charAt(0).toUpperCase()}
                    </div>
                    <div className="flex-1">
                      <p className="font-bold text-gray-800">{c.name}</p>
                      <p className="text-xs text-gray-400 mt-0.5">Tous les sites du fichier seront assignés à ce commercial</p>
                    </div>
                    {selectedCommercial?.id === c.id && (
                      <div className="w-6 h-6 rounded-full bg-blue-500 flex items-center justify-center flex-shrink-0">
                        <span className="text-white text-xs font-bold">✓</span>
                      </div>
                    )}
                  </button>
                ))}
              </div>
            </div>

            {/* Zone upload — apparaît après sélection du commercial */}
            {selectedCommercial && (
              <div className="mb-6">
                <p className="text-sm font-bold text-gray-700 mb-3">
                  2. Glissez le fichier Excel / CSV de <span style={{ color: selectedCommercial.color }}>{selectedCommercial.name}</span>
                </p>
                <div
                  onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
                  onDragLeave={() => setIsDragging(false)}
                  onDrop={handleDrop}
                  onClick={() => fileRef.current?.click()}
                  className={`border-2 border-dashed rounded-3xl p-10 text-center cursor-pointer transition-all ${
                    isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-300 hover:bg-blue-50/50'
                  }`}
                >
                  <FileSpreadsheet size={40} className="mx-auto text-gray-300 mb-3" />
                  <p className="font-bold text-gray-700 mb-1">Glissez votre fichier ici</p>
                  <p className="text-gray-400 text-sm mb-3">ou cliquez pour choisir</p>
                  <p className="text-xs text-gray-300">Formats acceptés : .xlsx · .xls · .csv</p>
                  <input
                    ref={fileRef}
                    type="file"
                    accept=".xlsx,.xls,.csv"
                    className="hidden"
                    onChange={e => handleFile(e.target.files[0])}
                  />
                </div>
              </div>
            )}

            {/* Historique des imports */}
            {importHistory.length > 0 && (
              <div className="mt-2">
                <div className="flex items-center gap-2 mb-3">
                  <Clock size={14} className="text-gray-400" />
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Historique des imports</p>
                </div>
                <div className="space-y-2">
                  {importHistory.map(log => (
                    <div key={log.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm px-4 py-3 flex items-center gap-3">
                      <FileSpreadsheet size={16} className="text-gray-400 flex-shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-gray-800 truncate">{log.filename}</p>
                        <p className="text-xs text-gray-400">
                          {fmt(log.created_at)} · {log.inserted} ajouté{log.inserted !== 1 ? 's' : ''}{log.updated > 0 ? ` · ${log.updated} mis à jour` : ''}
                        </p>
                      </div>
                      {deletingId === log.id ? (
                        <Loader2 size={16} className="text-gray-400 animate-spin flex-shrink-0" />
                      ) : confirmDelete === log.id ? (
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <span className="text-xs text-red-600 font-medium">Supprimer {log.inserted} site{log.inserted !== 1 ? 's' : ''} ?</span>
                          <button onClick={() => handleDeleteImport(log)} className="px-3 py-1 bg-red-600 text-white text-xs font-bold rounded-lg">Oui</button>
                          <button onClick={() => setConfirmDelete(null)} className="px-3 py-1 bg-gray-100 text-gray-600 text-xs font-bold rounded-lg">Non</button>
                        </div>
                      ) : (
                        <button
                          onClick={() => setConfirmDelete(log.id)}
                          className="p-2 hover:bg-red-50 rounded-xl text-gray-300 hover:text-red-500 transition-colors flex-shrink-0"
                        >
                          <Trash2 size={15} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Re-géocodage */}
            <div className="mt-6 border border-blue-100 rounded-2xl p-4 bg-blue-50">
              <p className="text-xs font-bold text-blue-700 uppercase tracking-wider mb-1">Corriger les emplacements</p>
              <p className="text-xs text-blue-600 mb-3">
                Relance le géocodage sur tous les sites <strong>sans coordonnées GPS</strong> (points manquants sur la carte),
                avec 6 stratégies : BAN officielle + Nominatim en fallback.
              </p>
              {isRegeocing && regeoProgress ? (
                <div>
                  <div className="flex justify-between text-xs text-blue-700 font-semibold mb-1">
                    <span>{regeoProgress.current} / {regeoProgress.total} adresses traitées</span>
                    <span>{regeoProgress.fixed} placées ✓</span>
                  </div>
                  <div className="w-full bg-blue-200 rounded-full h-2">
                    <div
                      className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((regeoProgress.current / Math.max(regeoProgress.total, 1)) * 100)}%` }}
                    />
                  </div>
                </div>
              ) : (
                <button
                  onClick={handleReGeocode}
                  disabled={isRegeocing}
                  className="w-full py-2.5 border-2 border-blue-300 text-blue-700 font-semibold text-sm rounded-xl hover:bg-blue-100 transition-colors flex items-center justify-center gap-2"
                >
                  <Loader2 size={15} className={isRegeocing ? 'animate-spin' : 'hidden'} />
                  📍 Replacer les sites manquants sur la carte
                </button>
              )}
            </div>

            {/* Zone danger */}
            <div className="mt-6 border border-red-100 rounded-2xl p-4 bg-red-50">
              <p className="text-xs font-bold text-red-600 uppercase tracking-wider mb-1">Zone danger</p>
              <p className="text-xs text-red-500 mb-3">
                Supprime <strong>tous</strong> les sites de la carte (tous commerciaux confondus).
              </p>
              {confirmResetAll ? (
                <div className="flex gap-2">
                  <span className="text-xs text-red-700 font-semibold flex-1 self-center">Confirmer la suppression totale ?</span>
                  <button onClick={handleResetAll} disabled={isResetting} className="px-4 py-2 bg-red-600 text-white text-xs font-bold rounded-xl">
                    {isResetting ? 'Suppression…' : 'Oui, tout supprimer'}
                  </button>
                  <button onClick={() => setConfirmResetAll(false)} className="px-4 py-2 bg-white border border-gray-200 text-gray-600 text-xs font-bold rounded-xl">
                    Annuler
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirmResetAll(true)}
                  disabled={isResetting}
                  className="w-full py-2.5 border-2 border-red-300 text-red-600 font-semibold text-sm rounded-xl hover:bg-red-100 transition-colors flex items-center justify-center gap-2"
                >
                  <Trash2 size={15} />
                  Vider tous les sites
                </button>
              )}
            </div>
          </div>
        )}

        {/* ── STEP 1 : Mapping des colonnes ── */}
        {step === 1 && (
          <div className="p-4 max-w-2xl mx-auto">
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4">
              <div className="p-4 border-b bg-gray-50 rounded-t-2xl">
                <div className="flex items-center gap-2">
                  <FileSpreadsheet size={16} className="text-gray-500" />
                  <p className="font-semibold text-sm text-gray-700">{fileName}</p>
                  <span className="text-xs text-gray-400 ml-auto">{rows.length} lignes détectées</span>
                </div>
              </div>

              <div className="p-4">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Correspondance des colonnes</p>

                <div className="mb-4">
                  <p className="text-xs font-semibold text-red-500 mb-2">OBLIGATOIRE</p>
                  <ColSelect label="Nom du site" field="name" required />
                </div>

                <div className="mb-4">
                  <p className="text-xs font-semibold text-blue-500 mb-1">ADRESSE (pour placer sur la carte)</p>
                  <div className="bg-blue-50 rounded-xl p-3 mb-2">
                    <p className="text-xs text-blue-600">Les adresses sont converties en coordonnées GPS via l'API gouvernementale française (data.gouv.fr)</p>
                  </div>
                  <ColSelect label="Adresse"     field="address" />
                  <ColSelect label="Code postal" field="postcode" />
                  <ColSelect label="Ville"       field="city" />
                </div>

                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 mb-2">INFORMATIONS</p>
                  <ColSelect label="Entreprise"  field="company" />
                  <ColSelect label="Type"        field="type" />
                  <ColSelect label="Statut"      field="status" />
                  <ColSelect label="Téléphone"   field="phone" />
                  <ColSelect label="Email"       field="email" />
                  <ColSelect label="Notes"       field="notes" />
                </div>

                <div>
                  <p className="text-xs font-semibold text-emerald-600 mb-1">MISE À JOUR (éviter les doublons)</p>
                  <div className="bg-emerald-50 rounded-xl p-3 mb-2">
                    <p className="text-xs text-emerald-700">
                      Si cette colonne est renseignée, les lignes avec le même ID seront <strong>mises à jour</strong> plutôt que dupliquées.
                    </p>
                  </div>
                  <ColSelect label="ID unique (n° client)" field="external_id" />
                </div>
              </div>
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(0)} className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold">
                ← Retour
              </button>
              <button
                onClick={() => setStep(2)}
                disabled={!mapping.name}
                className="flex-1 py-3 bg-blue-700 text-white rounded-xl text-sm font-bold disabled:opacity-40"
              >
                Voir l'aperçu →
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 2 : Aperçu ── */}
        {step === 2 && (
          <div className="p-4 max-w-4xl mx-auto">

            {/* Bandeau commercial */}
            <div className="flex items-center gap-3 bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
              <div
                className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-extrabold flex-shrink-0"
                style={{ background: selectedCommercial?.color }}
              >
                {selectedCommercial?.name.charAt(0).toUpperCase()}
              </div>
              <div>
                <p className="font-semibold text-gray-800">
                  {validRows.length} sites à importer pour <strong>{selectedCommercial?.name}</strong>
                </p>
                {ignoredCount > 0 && (
                  <p className="text-xs text-gray-400 mt-0.5">{ignoredCount} ligne{ignoredCount > 1 ? 's ignorées' : ' ignorée'} — nom manquant</p>
                )}
                {(mapping.address || mapping.city) && (
                  <p className="text-xs text-blue-600 mt-0.5">📍 Les adresses seront converties en coordonnées GPS</p>
                )}
              </div>
            </div>

            {/* Table d'aperçu */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
              <div className="p-3 border-b bg-gray-50">
                <p className="text-xs font-semibold text-gray-500">Aperçu des 8 premières lignes</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      {['Nom', 'Entreprise', 'Type', 'Statut', 'Adresse'].map(h => (
                        <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td className="px-3 py-2.5 font-medium text-gray-800 truncate max-w-32">{row.name}</td>
                        <td className="px-3 py-2.5 text-gray-500 truncate max-w-28">{row.company || '—'}</td>
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full font-medium ${row.type === 'siege' ? 'bg-purple-50 text-purple-700' : 'bg-orange-50 text-orange-700'}`}>
                            {row.type === 'siege' ? '🏢 Siège' : '🏗️ Chantier'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5">
                          <span className="px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">{row.status}</span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 truncate max-w-36">
                          {[row.address, row.postcode, row.city].filter(Boolean).join(' ') || '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {rows.length > 8 && (
                <div className="p-3 border-t bg-gray-50 text-center">
                  <p className="text-xs text-gray-400">… et {rows.length - 8} autres lignes</p>
                </div>
              )}
            </div>

            <div className="flex gap-3">
              <button onClick={() => setStep(1)} className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-xl text-sm font-semibold">
                ← Retour
              </button>
              <button
                onClick={runImport}
                disabled={validRows.length === 0}
                className="flex-1 py-3 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-bold disabled:opacity-40 flex items-center justify-center gap-2"
              >
                <Upload size={16} />
                Lancer l'import
              </button>
            </div>
          </div>
        )}

        {/* ── STEP 3 : Import en cours / Résultats ── */}
        {step === 3 && (
          <div className="p-6 max-w-md mx-auto flex flex-col items-center text-center">
            {isRunning ? (
              <>
                <div className="w-20 h-20 bg-blue-50 rounded-full flex items-center justify-center mb-6">
                  <Loader2 size={36} className="text-blue-600 animate-spin" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 mb-2">Import en cours…</h2>
                {(mapping.address || mapping.city) && (
                  <>
                    <p className="text-gray-500 mb-4 text-sm">
                      {progress.current < progress.total
                        ? `Géocodage des adresses… ${progress.current} / ${progress.total} (BAN + Nominatim en fallback)`
                        : 'Insertion dans la base de données…'}
                    </p>
                    {progress.total > 0 && (
                      <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                        <div
                          className="h-3 rounded-full transition-all duration-500"
                          style={{
                            width: `${Math.round((progress.current / progress.total) * 100)}%`,
                            background: selectedCommercial?.color ?? '#2563eb',
                          }}
                        />
                      </div>
                    )}
                  </>
                )}
                {!mapping.address && !mapping.city && (
                  <p className="text-gray-500 text-sm">Insertion dans la base de données…</p>
                )}
              </>
            ) : results ? (
              <>
                <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6">
                  <CheckCircle2 size={40} className="text-emerald-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 mb-2">Import terminé !</h2>
                <p className="text-sm text-gray-500 mb-6">Pour <strong style={{ color: selectedCommercial?.color }}>{selectedCommercial?.name}</strong></p>

                <div className="w-full grid grid-cols-3 gap-3 mb-4">
                  {[
                    { value: results.inserted, label: 'Ajoutés',    color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                    { value: results.updated,  label: 'Mis à jour', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                    { value: results.skipped,  label: 'Ignorés',    color: 'bg-gray-50 text-gray-500 border-gray-200' },
                  ].map(s => (
                    <div key={s.label} className={`rounded-2xl border p-4 ${s.color}`}>
                      <p className="text-3xl font-extrabold">{s.value}</p>
                      <p className="text-xs font-semibold mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>

                {results.noCoords > 0 && (
                  <div className="w-full bg-amber-50 border border-amber-200 rounded-2xl p-3 mb-4 text-left">
                    <p className="text-xs text-amber-700">
                      ⚠️ <strong>{results.noCoords} site{results.noCoords > 1 ? 's' : ''}</strong> sans coordonnées GPS malgré 6 tentatives (BAN + Nominatim). Ces sites sont enregistrés mais n'apparaissent pas sur la carte. Vérifiez l'adresse dans votre fichier.
                    </p>
                  </div>
                )}

                <div className="flex gap-3 w-full">
                  <button
                    onClick={() => { setStep(0); setSelectedCommercial(null); setRows([]); setResults(null); setFileName(''); loadHistory() }}
                    className="flex-1 py-3 border border-gray-200 text-gray-600 rounded-2xl font-semibold text-sm"
                  >
                    Importer un autre fichier
                  </button>
                  <button
                    onClick={onImported}
                    className="flex-1 py-3 bg-blue-700 hover:bg-blue-800 text-white rounded-2xl font-bold text-sm"
                  >
                    Voir la carte →
                  </button>
                </div>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
