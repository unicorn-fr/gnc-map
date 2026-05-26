import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { ArrowLeft, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Info, Trash2, History } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { COMMERCIAL_ALIASES } from '../lib/commercials'
import { geocodeBatch } from '../lib/geocode'
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
  const s = String(v).toLowerCase().trim()
  if (s.includes('client')) return 'client'
  if (s.includes('cours') || s.includes('actif') || s.includes('location') || s === 'oui' || s === 'o' || s === '1') return 'en_cours'
  if (s.includes('termin') || s.includes('clôt') || s.includes('clot') || s.includes('fini') || s === 'non' || s === 'n' || s === '0') return 'termine'
  return 'prospect'
}

const getInitials = (name) =>
  name.trim().split(/\s+/).map(p => p.charAt(0).toUpperCase()).join('')

const matchCommercial = (value, commercials) => {
  if (!value) return null
  const v = String(value).toLowerCase().trim()
  const vUp = String(value).toUpperCase().trim().replace(/\s+/g, '')
  // Alias Excel (ex : EM → Enzo, CT → Cédric, LJ → Laëtitia)
  if (COMMERCIAL_ALIASES[vUp]) {
    const found = commercials.find(c => c.id === COMMERCIAL_ALIASES[vUp])
    if (found) return found
  }
  return (
    commercials.find(c => c.name.toLowerCase() === v) ??
    commercials.find(c => getInitials(c.name) === vUp) ??
    commercials.find(c => {
      const parts = c.name.toLowerCase().split(/\s+/)
      return parts.some(p => p === v || v.includes(p) || p.includes(v))
    }) ??
    null
  )
}

const str = (v) => String(v ?? '').trim()

const fmtDate = (iso) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })

const STEPS = ['Fichier', 'Colonnes', 'Aperçu', 'Import']

// ── Composant principal ────────────────────────────────────────
export default function ImportPage({ commercials, onClose, onImported }) {
  const [step, setStep] = useState(0)
  const [rows, setRows] = useState([])
  const [columns, setColumns] = useState([])
  const [fileName, setFileName] = useState('')
  const [isDragging, setIsDragging] = useState(false)
  const [mapping, setMapping] = useState({
    name: '', company: '', type: '', status: '',
    address: '', address2: '', postcode: '', city: '',
    phone: '', email: '', notes: '', external_id: '',
    commercial: '',
  })
  const [progress, setProgress] = useState({ current: 0, total: 0, phase: '' })
  const [results, setResults] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const [importHistory, setImportHistory] = useState([])
  const [historyLoading, setHistoryLoading] = useState(false)
  const [deletingBatch, setDeletingBatch] = useState(null)
  const fileRef = useRef()

  useEffect(() => {
    if (step === 0) loadHistory()
  }, [step])

  const loadHistory = async () => {
    setHistoryLoading(true)
    const { data } = await supabase
      .from('import_logs')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(20)
    if (data) setImportHistory(data)
    setHistoryLoading(false)
  }

  const handleDeleteBatch = async (log) => {
    if (!window.confirm(`Supprimer l'import "${log.filename}" du ${fmtDate(log.created_at)} ?\n\nCela supprimera définitivement les ${log.inserted} sites importés (ils pourront être réimportés).`)) return
    setDeletingBatch(log.id)
    try {
      if (log.batch_id) {
        await supabase.from('sites').delete().eq('import_batch_id', log.batch_id)
      }
      await supabase.from('import_logs').delete().eq('id', log.id)
      setImportHistory(prev => prev.filter(l => l.id !== log.id))
      toast.success('Import supprimé')
    } catch {
      toast.error('Erreur lors de la suppression')
    } finally {
      setDeletingBatch(null)
    }
  }

  // ── Étape 1 : chargement du fichier ──────────────────────────
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
        name:        guessCol(cols, ['chantier', 'raison sociale', 'raison', 'nom', 'name', 'entreprise', 'société', 'client']),
        company:     guessCol(cols, ['raison sociale', 'société', 'enseigne', 'entreprise']),
        type:        guessCol(cols, ['type']),
        status:      guessCol(cols, ['actif', 'statut', 'status', 'état']),
        address:     guessCol(cols, ['adresse1', 'address1', 'adresse', 'adress', 'address', 'rue', 'voie', 'street']),
        address2:    guessCol(cols, ['adresse_1', 'adresse2', 'address2', 'complément', 'complement', 'suite', 'lieu dit']),
        postcode:    guessCol(cols, ['c.p', 'cp', 'code postal', 'code_postal', 'postal', 'zip', 'codepostal']),
        city:        guessCol(cols, ['ville', 'city', 'commune', 'localité']),
        phone:       guessCol(cols, ['téléphone', 'telephone', 'tel', 'phone', 'mobile']),
        email:       guessCol(cols, ['email', 'mail', 'adresse email', 'courriel', 'e-mail']),
        notes:       guessCol(cols, ['activité', 'activite', 'secteur', 'note', 'obs', 'remarque', 'comment', 'info']),
        external_id: guessCol(cols, ['code client', 'id', 'ref', 'n°', 'numero', 'numéro', 'identifiant']),
        commercial:  guessCol(cols, ['représentant', 'representant', 'commercial', 'vendeur', 'chargé', 'responsable']),
      })
      setStep(1)
    }
    reader.readAsArrayBuffer(file)
  }

  const handleDrop = (e) => {
    e.preventDefault(); setIsDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  // ── Étape 3 : aperçu ──────────────────────────────────────────
  const buildPreviewRow = (row) => {
    const commercialValue = mapping.commercial ? str(row[mapping.commercial]) : ''
    const matched = matchCommercial(commercialValue, commercials)
    if (mapping.commercial && !matched) return null
    const comm = matched ?? commercials[0]
    if (!comm) return null

    const addr1 = mapping.address  ? str(row[mapping.address])  : ''
    const addr2 = mapping.address2 ? str(row[mapping.address2]) : ''
    // Adresses supplémentaires (colonnes dupliquées renommées _2, _3 par xlsx)
    const colBase = mapping.address ? mapping.address.replace(/_\d+$/, '') : ''
    const addr3 = colBase ? str(row[colBase + '_2'] ?? '') : ''
    const addr4 = colBase ? str(row[colBase + '_3'] ?? '') : ''
    const fullAddress = [addr1, addr2, addr3, addr4].filter(Boolean).join(' ')

    return {
      name:        mapping.name        ? str(row[mapping.name])        : '',
      company:     mapping.company     ? str(row[mapping.company])     : '',
      type:        mapping.type        ? normalizeType(str(row[mapping.type]))   : 'chantier',
      status:      mapping.status      ? normalizeStatus(str(row[mapping.status])) : 'prospect',
      address:     fullAddress,
      postcode:    mapping.postcode    ? str(row[mapping.postcode])    : '',
      city:        mapping.city        ? str(row[mapping.city])        : '',
      phone:       mapping.phone       ? str(row[mapping.phone])       : '',
      email:       mapping.email       ? str(row[mapping.email])       : '',
      notes:       mapping.notes       ? str(row[mapping.notes])       : '',
      external_id: mapping.external_id ? str(row[mapping.external_id]) : '',
      commercial_id:   comm.id,
      commercial_name: comm.name,
    }
  }

  const allParsed    = rows.map(buildPreviewRow)
  const ignoredCount = allParsed.filter(r => r === null).length
  const validRows    = allParsed.filter(r => r !== null && r.name.length > 0)
  const preview      = rows.slice(0, 8).map(buildPreviewRow).filter(Boolean)

  // ── Étape 4 : import (optimisé batch) ─────────────────────────
  const runImport = async () => {
    setIsRunning(true)
    setStep(3)

    const batchId = crypto.randomUUID()
    const prepared = validRows

    // 1. Géocodage batch (1 seule requête HTTP pour tout le fichier)
    let geoResults = prepared.map(() => null)
    if (prepared.some(r => r.address || r.city)) {
      setProgress({ current: 0, total: prepared.length, phase: 'geo' })
      geoResults = await geocodeBatch(
        prepared,
        { addressCol: 'address', postcodeCol: 'postcode', cityCol: 'city', companyCol: 'company' },
        (cur, tot, phase) => setProgress({ current: cur, total: tot, phase: phase === 'nominatim' ? 'nominatim' : 'geo' })
      )
    }

    setProgress({ current: 0, total: prepared.length, phase: 'db' })

    // 2. Récupérer tous les external_ids existants en une seule requête
    const extIds = prepared.map(r => r.external_id).filter(Boolean)
    let existingMap = new Map()
    if (extIds.length > 0) {
      const { data: existing } = await supabase
        .from('sites').select('id, external_id, deleted').in('external_id', extIds)
      existing?.forEach(s => existingMap.set(s.external_id, s))
    }

    // 3. Séparer nouvelles lignes / mises à jour / ignorées
    const toInsert = []
    const toUpdate = []
    let skipped = 0

    prepared.forEach((row, i) => {
      const payload = {
        commercial_id: row.commercial_id,
        name:    row.name    || 'Sans nom',
        company: row.company || null,
        type:    row.type,
        status:  row.status,
        address: row.address  || null,
        postcode:row.postcode || null,
        city:    row.city     || null,
        phone:   row.phone    || null,
        email:   row.email    || null,
        notes:   row.notes    || null,
        lat:     geoResults[i]?.lat ?? null,
        lng:     geoResults[i]?.lng ?? null,
        external_id:    row.external_id || null,
        import_batch_id: batchId,
        updated_at:      new Date().toISOString(),
      }
      if (row.external_id && existingMap.has(row.external_id)) {
        const ex = existingMap.get(row.external_id)
        if (ex.deleted) { skipped++; return }
        toUpdate.push({ id: ex.id, payload })
      } else {
        toInsert.push(payload)
      }
    })

    // 4. Batch insert (par blocs de 500)
    let inserted = 0
    const CHUNK = 500
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK)
      const { error } = await supabase.from('sites').insert(chunk)
      if (error) skipped += chunk.length
      else inserted += chunk.length
    }

    // 5. Updates individuels
    let updated = 0
    for (const { id, payload } of toUpdate) {
      const { error } = await supabase.from('sites').update(payload).eq('id', id)
      error ? skipped++ : updated++
    }

    await supabase.from('import_logs').insert({
      filename: fileName, total: prepared.length, inserted, updated, skipped,
      batch_id: batchId,
    })

    const noGeo = geoResults.filter(g => g === null).length
    setResults({ inserted, updated, skipped, noGeo, total: prepared.length })
    setIsRunning(false)
  }

  // ── Rendu ─────────────────────────────────────────────────────
  const ColSelect = ({ label, field, required, hint }) => (
    <div className="flex items-start gap-3 py-2.5 border-b border-gray-50 last:border-0">
      <div className="w-40 flex-shrink-0 pt-0.5">
        <p className="text-sm font-medium text-gray-700">
          {label}{required && <span className="text-red-500 ml-0.5">*</span>}
        </p>
        {hint && <p className="text-[10px] text-gray-400 mt-0.5">{hint}</p>}
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
          <p className="text-blue-300 text-xs">Importer et mettre à jour votre base de données</p>
        </div>
      </div>

      {/* Steps */}
      <div className="flex-shrink-0 bg-white border-b px-4 py-3">
        <div className="flex items-center gap-2 max-w-lg">
          {STEPS.map((s, i) => (
            <div key={s} className="flex items-center gap-2 flex-1">
              <div className={`flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold flex-shrink-0 ${
                i < step ? 'bg-green-500 text-white' : i === step ? 'bg-blue-700 text-white' : 'bg-gray-200 text-gray-400'
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

        {/* ── STEP 0 : Upload + Historique ── */}
        {step === 0 && (
          <div className="p-6 max-w-xl mx-auto space-y-6">
            <div
              onDragOver={e => { e.preventDefault(); setIsDragging(true) }}
              onDragLeave={() => setIsDragging(false)}
              onDrop={handleDrop}
              onClick={() => fileRef.current?.click()}
              className={`border-3 border-dashed rounded-3xl p-12 text-center cursor-pointer transition-all ${
                isDragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-blue-300 hover:bg-blue-50/50'
              }`}
            >
              <FileSpreadsheet size={48} className="mx-auto text-gray-300 mb-4" />
              <p className="font-bold text-gray-700 text-lg mb-1">Glissez votre fichier ici</p>
              <p className="text-gray-400 text-sm mb-4">ou cliquez pour choisir</p>
              <p className="text-xs text-gray-300">Formats acceptés : .xlsx · .xls · .csv</p>
              <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden"
                onChange={e => handleFile(e.target.files[0])} />
            </div>

            <div className="bg-blue-50 border border-blue-100 rounded-2xl p-4">
              <div className="flex gap-2 mb-2">
                <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm font-semibold text-blue-800">Comment ça marche</p>
              </div>
              <ul className="text-sm text-blue-700 space-y-1.5 ml-5 list-disc">
                <li>Exportez votre liste clients/chantiers depuis votre logiciel (Excel ou CSV)</li>
                <li>Les colonnes Adresse 1 + Adresse 2 sont <strong>combinées</strong> pour un géocodage précis</li>
                <li>Si l'adresse échoue, le nom de l'entreprise est utilisé comme recherche de secours</li>
                <li>Ajoutez une colonne <strong>Code client</strong> pour éviter les doublons lors des mises à jour</li>
              </ul>
            </div>

            {/* Historique des imports */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
              <div className="flex items-center gap-2 px-4 py-3 border-b">
                <History size={15} className="text-gray-400" />
                <p className="font-semibold text-sm text-gray-700">Historique des imports</p>
              </div>
              {historyLoading ? (
                <div className="p-6 flex justify-center">
                  <Loader2 size={20} className="text-gray-300 animate-spin" />
                </div>
              ) : importHistory.length === 0 ? (
                <div className="p-6 text-center">
                  <p className="text-sm text-gray-400">Aucun import précédent</p>
                </div>
              ) : (
                <ul className="divide-y divide-gray-50">
                  {importHistory.map(log => (
                    <li key={log.id} className="flex items-center gap-3 px-4 py-3">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-gray-800 truncate">{log.filename}</p>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {fmtDate(log.created_at)} — {log.inserted} ajouté{log.inserted > 1 ? 's' : ''}
                          {log.updated > 0 && `, ${log.updated} mis à jour`}
                          {log.skipped > 0 && `, ${log.skipped} ignoré${log.skipped > 1 ? 's' : ''}`}
                        </p>
                      </div>
                      <button
                        onClick={() => handleDeleteBatch(log)}
                        disabled={deletingBatch === log.id}
                        className="flex-shrink-0 p-2 text-red-400 hover:text-red-600 hover:bg-red-50 rounded-xl transition-colors disabled:opacity-40"
                        title="Supprimer cet import"
                      >
                        {deletingBatch === log.id
                          ? <Loader2 size={15} className="animate-spin" />
                          : <Trash2 size={15} />}
                      </button>
                    </li>
                  ))}
                </ul>
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
                    <p className="text-xs text-blue-600">
                      Adresse 1 + Adresse 2 sont <strong>combinées</strong> automatiquement. Si l'adresse est introuvable, le nom d'entreprise est utilisé comme secours.
                    </p>
                  </div>
                  <ColSelect label="Adresse 1"   field="address"  hint="Numéro + rue" />
                  <ColSelect label="Adresse 2"   field="address2" hint="Suite si trop longue" />
                  <ColSelect label="Code postal" field="postcode" />
                  <ColSelect label="Ville"       field="city" />
                </div>

                <div className="mb-4">
                  <p className="text-xs font-semibold text-gray-400 mb-2">INFORMATIONS</p>
                  <ColSelect label="Entreprise"  field="company" />
                  <ColSelect label="Commercial"  field="commercial" />
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
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-gray-800">
                    {validRows.length} sites à importer sur {rows.length} lignes
                  </p>
                  {ignoredCount > 0 && (
                    <p className="text-sm text-amber-600 mt-0.5">
                      ⚠️ {ignoredCount} ligne{ignoredCount > 1 ? 's ignorées' : ' ignorée'} — commercial non reconnu
                    </p>
                  )}
                  {(rows.length - validRows.length - ignoredCount) > 0 && (
                    <p className="text-sm text-gray-400 mt-0.5">
                      {rows.length - validRows.length - ignoredCount} ligne{rows.length - validRows.length - ignoredCount > 1 ? 's ignorées' : ' ignorée'} — nom manquant
                    </p>
                  )}
                  {(mapping.address || mapping.address2 || mapping.city) && (
                    <p className="text-sm text-blue-600 mt-1">
                      📍 Géocodage automatique des adresses (quelques secondes)
                    </p>
                  )}
                  {mapping.company && (
                    <p className="text-sm text-purple-600 mt-0.5">
                      🏢 Fallback entreprise activé pour les adresses introuvables
                    </p>
                  )}
                </div>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
              <div className="p-3 border-b bg-gray-50">
                <p className="text-xs font-semibold text-gray-500">Aperçu des 8 premières lignes</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      {['Nom', 'Type', 'Adresse complète', 'Commercial'].map(h => (
                        <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td className="px-3 py-2.5 font-medium text-gray-800 truncate max-w-40">
                          {row.name || <span className="text-red-400 italic">manquant</span>}
                        </td>
                        <td className="px-3 py-2.5">
                          <span className={`px-2 py-0.5 rounded-full font-medium text-[11px] ${row.type === 'siege' ? 'bg-purple-50 text-purple-700' : 'bg-orange-50 text-orange-700'}`}>
                            {row.type === 'siege' ? '🏢 Siège' : '🏗️ Chantier'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-gray-500 truncate max-w-48">
                          {[row.address, row.postcode, row.city].filter(Boolean).join(' ') || <span className="text-gray-300 italic">—</span>}
                        </td>
                        <td className="px-3 py-2.5 text-gray-600 font-medium whitespace-nowrap">{row.commercial_name}</td>
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
                Lancer l'import ({validRows.length} sites)
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
                <p className="text-gray-500 mb-4 text-sm">
                  {progress.phase === 'geo' || progress.phase === 'nominatim'
                    ? progress.current < progress.total
                      ? progress.phase === 'nominatim'
                        ? `Recherche entreprises (Nominatim)… ${progress.current} / ${progress.total}`
                        : `Géocodage des adresses… ${progress.current} / ${progress.total}`
                      : 'Géocodage terminé ✓'
                    : 'Enregistrement dans la base de données…'}
                </p>
                {(progress.phase === 'geo' || progress.phase === 'nominatim') && progress.total > 0 && (
                  <div className="w-full bg-gray-200 rounded-full h-3">
                    <div
                      className="bg-blue-600 h-3 rounded-full transition-all duration-300"
                      style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
                    />
                  </div>
                )}
              </>
            ) : results ? (
              <>
                <div className="w-20 h-20 bg-emerald-50 rounded-full flex items-center justify-center mb-6">
                  <CheckCircle2 size={40} className="text-emerald-500" />
                </div>
                <h2 className="text-xl font-bold text-gray-800 mb-6">Import terminé !</h2>
                <div className="w-full grid grid-cols-2 gap-3 mb-4">
                  {[
                    { value: results.inserted, label: 'Ajoutés',    color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                    { value: results.updated,  label: 'Mis à jour', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                    { value: results.skipped,  label: 'Ignorés',    color: 'bg-gray-50 text-gray-500 border-gray-200' },
                    { value: results.noGeo,    label: 'Non localisés', color: results.noGeo > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-400 border-gray-200' },
                  ].map(s => (
                    <div key={s.label} className={`rounded-2xl border p-4 ${s.color}`}>
                      <p className="text-3xl font-extrabold">{s.value}</p>
                      <p className="text-xs font-semibold mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>
                {results.noGeo > 0 && (
                  <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-xl px-3 py-2 mb-6 text-left">
                    ⚠️ {results.noGeo} site{results.noGeo > 1 ? 's' : ''} sans coordonnées GPS — adresse non reconnue ou hors zone (Lyon / Grenoble / Jura / Suisse). Vérifiez l'adresse depuis la fiche site.
                  </p>
                )}
                <button
                  onClick={onImported}
                  className="w-full py-4 bg-blue-700 hover:bg-blue-800 text-white rounded-2xl font-bold text-base"
                >
                  Voir la carte →
                </button>
              </>
            ) : null}
          </div>
        )}
      </div>
    </div>
  )
}
