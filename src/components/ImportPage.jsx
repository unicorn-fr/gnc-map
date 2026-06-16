import { useState, useRef, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { ArrowLeft, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Info, Trash2, History, MapPin, Pencil, RotateCcw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { COMMERCIAL_ALIASES } from '../lib/commercials'
import { geocodeBatch, geocodeSingle } from '../lib/geocode'
import toast from 'react-hot-toast'

// ── Helpers ──────────────────────────────────────────────────
// Normalise une chaîne : minuscules + sans accents + sans ponctuation
const flatStr = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[.\s_\-/]/g, '')

const guessCol = (cols, keywords) => {
  // 1er passage : toLowerCase simple (accents conservés)
  const lc = cols.map(c => c.toLowerCase())
  for (const kw of keywords) {
    const idx = lc.findIndex(c => c.includes(kw))
    if (idx >= 0) return cols[idx]
  }
  // 2e passage : sans accents + sans ponctuation (gère NFD/NFC et caractères spéciaux)
  const flat = cols.map(flatStr)
  for (const kw of keywords) {
    const kwF = flatStr(kw)
    const idx = flat.findIndex(c => c.includes(kwF))
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

const normStr = s => String(s).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

const matchCommercial = (value, commercials) => {
  if (!value) return null
  const v    = normStr(value)
  const vUp  = String(value).toUpperCase().trim().replace(/[\s.]/g, '')
  // Alias Excel (EM → Enzo, CT → Cédric, LJ → Laëtitia) — comparaison par nom normalisé
  if (COMMERCIAL_ALIASES[vUp]) {
    const target = COMMERCIAL_ALIASES[vUp]
    const found = commercials.find(c => normStr(c.name).startsWith(target))
    if (found) return found
  }
  return (
    commercials.find(c => normStr(c.name) === v) ??
    commercials.find(c => getInitials(c.name) === vUp) ??
    commercials.find(c => {
      const parts = normStr(c.name).split(/\s+/)
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
  const [fixableRows, setFixableRows] = useState([])
  const [importBatchId, setImportBatchId] = useState(null)
  const [editOverrides, setEditOverrides] = useState({})
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
      setEditOverrides({})
      setColumns(cols)
      setRows(parsed)
      setMapping({
        name:        guessCol(cols, ['raison sociale', 'raison', 'denomination', 'nom du site', 'nom', 'name', 'entreprise', 'société', 'client']),
        company:     guessCol(cols, ['raison sociale', 'denomination', 'société', 'enseigne', 'entreprise']),
        type:        guessCol(cols, ['chantier', 'type chantier', 'type site', 'type_chantier']),
        status:      guessCol(cols, ['statut', 'status', 'état', 'type', 'actif']),
        address:     guessCol(cols, ['adresse', 'address', 'adresse1', 'address1', 'rue', 'voie', 'street']),
        address2:    guessCol(cols, ['adresse_1', 'adresse 1', 'adresse2', 'adresse 2', 'address2', 'complément', 'complement', 'suite', 'lieu dit']),
        postcode:    guessCol(cols, ['c.p', 'c.p.', 'cp', 'code postal', 'code_postal', 'codepostal', 'postal', 'zip']),
        city:        guessCol(cols, ['ville', 'city', 'commune', 'localité']),
        phone:       guessCol(cols, ['téléphone', 'telephone', 'tel', 'tél', 'phone', 'mobile']),
        email:       guessCol(cols, ['adresse email', 'email', 'e-mail', 'mail', 'courriel']),
        notes:       guessCol(cols, ['activité', 'activite', 'secteur', 'note', 'obs', 'remarque', 'comment', 'info']),
        external_id: guessCol(cols, ['code client', 'codeclient', 'identifiant de client', 'id client', 'ref client', 'n° client', 'id', 'ref']),
        commercial:  guessCol(cols, ['code représentant', 'code representant', 'code rep', 'représentant', 'representant', 'commercial', 'vendeur', 'chargé', 'responsable']),
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
  const buildPreviewRow = (row, ovr = {}) => {
    const commercialValue = mapping.commercial ? str(row[mapping.commercial]) : ''
    const matched = matchCommercial(commercialValue, commercials)
    const comm = ovr.commercial_id
      ? (commercials.find(c => c.id === ovr.commercial_id) ?? commercials[0])
      : (matched ?? commercials[0])
    if (!comm) return null

    const addr1 = mapping.address  ? str(row[mapping.address])  : ''
    const addr2 = mapping.address2 ? str(row[mapping.address2]) : ''
    const colBase = mapping.address ? mapping.address.replace(/_\d+$/, '') : ''
    const addr3 = colBase ? str(row[colBase + '_2'] ?? '') : ''
    const addr4 = colBase ? str(row[colBase + '_3'] ?? '') : ''
    const fullAddress = [addr1, addr2, addr3, addr4].filter(Boolean).join(' ')

    const rawName = mapping.name ? str(row[mapping.name]) : ''
    const rawCompany = mapping.company ? str(row[mapping.company]) : ''
    const rawExtId = mapping.external_id ? str(row[mapping.external_id]) : ''
    // Fallbacks : nom → company → code client (si raison sociale vide dans l'ERP)
    const resolvedName = (rawName && rawName !== '0') ? rawName : (rawCompany || rawExtId)

    return {
      name:        ovr.name     !== undefined ? ovr.name     : resolvedName,
      company:     rawCompany,
      type:        mapping.type        ? normalizeType(str(row[mapping.type]))     : 'chantier',
      status:      mapping.status      ? normalizeStatus(str(row[mapping.status])) : 'prospect',
      address:     ovr.address  !== undefined ? ovr.address  : fullAddress,
      postcode:    ovr.postcode !== undefined ? ovr.postcode : (mapping.postcode ? str(row[mapping.postcode]) : ''),
      city:        ovr.city     !== undefined ? ovr.city     : (mapping.city     ? str(row[mapping.city])     : ''),
      phone:       mapping.phone       ? str(row[mapping.phone])       : '',
      email:       mapping.email       ? str(row[mapping.email])       : '',
      notes:       mapping.notes       ? str(row[mapping.notes])       : '',
      external_id: mapping.external_id ? str(row[mapping.external_id]) : '',
      commercial_id:   comm.id,
      commercial_name: comm.name,
    }
  }

  const setOverride = (i, field, value) =>
    setEditOverrides(prev => ({ ...prev, [i]: { ...prev[i], [field]: value } }))

  const allParsed    = rows.map((row, i) => buildPreviewRow(row, editOverrides[i] || {}))
  const ignoredCount = allParsed.filter(r => r === null).length
  const validRows    = allParsed.filter(r => r !== null && r.name.length > 0)
  const preview      = rows.slice(0, 8).map((row, i) => buildPreviewRow(row, editOverrides[i] || {})).filter(Boolean)

  // Lignes avec problème (nom vide) — éditables avant import
  const problemRowIndices = rows.map((row, i) => {
    const parsed = buildPreviewRow(row, editOverrides[i] || {})
    return (parsed === null || parsed.name.length === 0) ? i : -1
  }).filter(i => i >= 0)

  // Valeurs de la colonne commercial non reconnues (pour diagnostic)
  const unknownCommercialSamples = mapping.commercial
    ? [...new Set(rows.map(r => str(r[mapping.commercial])).filter(v => v && !matchCommercial(v, commercials)))].slice(0, 6)
    : []

  // ── Étape 4 : import (optimisé batch) ─────────────────────────
  const runImport = async () => {
    setIsRunning(true)
    setStep(3)

    const batchId = crypto.randomUUID()
    setImportBatchId(batchId)
    const prepared = validRows

    // 1. Géocodage batch
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

    // 2. Récupérer tous les external_ids existants
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
        toUpdate.push({ id: ex.id, payload, hasGeo: !!geoResults[i] })
      } else {
        toInsert.push({ payload, hasGeo: !!geoResults[i] })
      }
    })

    // 4. Batch insert (par blocs de 500)
    let inserted = 0
    const dbErrors = []
    const CHUNK = 500
    for (let i = 0; i < toInsert.length; i += CHUNK) {
      const chunk = toInsert.slice(i, i + CHUNK)
      const { error } = await supabase.from('sites').insert(chunk.map(r => r.payload))
      if (error) {
        // Retry individuellement pour isoler les erreurs
        for (const item of chunk) {
          const { error: e2 } = await supabase.from('sites').insert(item.payload)
          if (e2) {
            dbErrors.push({ payload: item.payload, issue: 'dberror', dbError: e2.message, editName: item.payload.name, editAddress: item.payload.address || '', editPostcode: item.payload.postcode || '', editCity: item.payload.city || '', saving: false, saved: false })
            skipped++
          } else {
            inserted++
          }
        }
      } else {
        inserted += chunk.length
      }
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

    // Collecter les lignes sans géolocalisation (insérées mais sans coordonnées)
    const noGeoRows = []
    toInsert.forEach(({ payload, hasGeo }) => {
      if (!hasGeo && !dbErrors.find(e => e.payload.name === payload.name && e.payload.external_id === payload.external_id)) {
        noGeoRows.push({ payload, issue: 'nogeo', editName: payload.name, editAddress: payload.address || '', editPostcode: payload.postcode || '', editCity: payload.city || '', saving: false, saved: false })
      }
    })
    toUpdate.forEach(({ id, payload, hasGeo }) => {
      if (!hasGeo) {
        noGeoRows.push({ payload: { ...payload, _dbId: id }, issue: 'nogeo', editName: payload.name, editAddress: payload.address || '', editPostcode: payload.postcode || '', editCity: payload.city || '', saving: false, saved: false })
      }
    })

    const noGeo = geoResults.filter(g => g === null).length
    setFixableRows([...dbErrors, ...noGeoRows])
    setResults({ inserted, updated, skipped, noGeo, total: prepared.length })
    setIsRunning(false)
  }

  const saveFixedRow = async (idx) => {
    const row = fixableRows[idx]
    setFixableRows(prev => prev.map((r, i) => i === idx ? { ...r, saving: true } : r))
    try {
      const geo = await geocodeSingle(row.editAddress, row.editPostcode, row.editCity)
      const update = {
        name:    row.editName    || row.payload.name,
        address: row.editAddress || null,
        postcode:row.editPostcode|| null,
        city:    row.editCity    || null,
        lat:     geo?.lat ?? null,
        lng:     geo?.lng ?? null,
        updated_at: new Date().toISOString(),
      }
      let err
      if (row.issue === 'dberror') {
        const { error } = await supabase.from('sites').insert({ ...row.payload, ...update })
        err = error
      } else if (row.payload._dbId) {
        const { error } = await supabase.from('sites').update(update).eq('id', row.payload._dbId)
        err = error
      } else if (row.payload.external_id) {
        const { error } = await supabase.from('sites').update(update).eq('external_id', row.payload.external_id)
        err = error
      } else {
        const { error } = await supabase.from('sites').update(update)
          .eq('import_batch_id', importBatchId).eq('name', row.payload.name)
        err = error
      }
      if (err) {
        toast.error('Erreur : ' + err.message)
        setFixableRows(prev => prev.map((r, i) => i === idx ? { ...r, saving: false } : r))
      } else {
        setFixableRows(prev => prev.map((r, i) => i === idx ? { ...r, saving: false, saved: true, hasGeo: !!geo } : r))
        toast.success(geo ? 'Site localisé et corrigé ✓' : 'Corrigé (adresse non localisée)')
      }
    } catch {
      toast.error('Erreur réseau')
      setFixableRows(prev => prev.map((r, i) => i === idx ? { ...r, saving: false } : r))
    }
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
                  {unknownCommercialSamples.length > 0 && (
                    <p className="text-sm text-amber-600 mt-0.5">
                      ⚠️ Commercial non reconnu pour certaines lignes (assigné au 1er commercial) — valeurs lues : <strong>{unknownCommercialSamples.join(', ')}</strong>
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

            {/* Lignes à corriger avant import */}
            {problemRowIndices.length > 0 && (
              <div className="bg-amber-50 border border-amber-200 rounded-2xl overflow-hidden mb-4">
                <div className="flex items-center gap-2 px-4 py-3 border-b border-amber-200 bg-amber-100">
                  <AlertCircle size={15} className="text-amber-600" />
                  <p className="text-sm font-bold text-amber-800">
                    {problemRowIndices.length} ligne{problemRowIndices.length > 1 ? 's' : ''} ignorée{problemRowIndices.length > 1 ? 's' : ''} — nom manquant
                  </p>
                  <span className="ml-auto text-xs text-amber-600">Corrigez-les pour les inclure</span>
                </div>
                <div className="divide-y divide-amber-100">
                  {problemRowIndices.map(i => {
                    const ovr = editOverrides[i] || {}
                    const rawRow = rows[i]
                    const autoAddress = (() => {
                      const a1 = mapping.address ? str(rawRow[mapping.address]) : ''
                      const a2 = mapping.address2 ? str(rawRow[mapping.address2]) : ''
                      return [a1, a2].filter(Boolean).join(' ')
                    })()
                    const autoPostcode = mapping.postcode ? str(rawRow[mapping.postcode]) : ''
                    const autoCity = mapping.city ? str(rawRow[mapping.city]) : ''
                    return (
                      <div key={i} className="p-3 space-y-2">
                        <p className="text-xs text-amber-700 font-semibold">Ligne {i + 2}</p>
                        <input
                          value={ovr.name ?? ''}
                          onChange={e => setOverride(i, 'name', e.target.value)}
                          placeholder="Nom du site (obligatoire)"
                          className="w-full border border-amber-300 bg-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                        />
                        <input
                          value={ovr.address ?? autoAddress}
                          onChange={e => setOverride(i, 'address', e.target.value)}
                          placeholder="Adresse"
                          className="w-full border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                        />
                        <div className="flex gap-2">
                          <input
                            value={ovr.postcode ?? autoPostcode}
                            onChange={e => setOverride(i, 'postcode', e.target.value)}
                            placeholder="Code postal"
                            className="w-28 border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                          <input
                            value={ovr.city ?? autoCity}
                            onChange={e => setOverride(i, 'city', e.target.value)}
                            placeholder="Ville"
                            className="flex-1 border border-gray-200 bg-white rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                          />
                          <select
                            value={ovr.commercial_id ?? (commercials[0]?.id ?? '')}
                            onChange={e => setOverride(i, 'commercial_id', e.target.value)}
                            className="border border-gray-200 bg-white rounded-xl px-2 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-400"
                          >
                            {commercials.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}

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
          <div className="p-6 max-w-lg mx-auto flex flex-col items-center text-center">
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
                <h2 className="text-xl font-bold text-gray-800 mb-4">Import terminé !</h2>
                <div className="w-full grid grid-cols-2 gap-3 mb-6">
                  {[
                    { value: results.inserted, label: 'Ajoutés',    color: 'bg-emerald-50 text-emerald-700 border-emerald-200' },
                    { value: results.updated,  label: 'Mis à jour', color: 'bg-blue-50 text-blue-700 border-blue-200' },
                    { value: results.skipped,  label: 'Erreurs DB', color: results.skipped > 0 ? 'bg-red-50 text-red-700 border-red-200' : 'bg-gray-50 text-gray-400 border-gray-200' },
                    { value: results.noGeo,    label: 'Non localisés', color: results.noGeo > 0 ? 'bg-amber-50 text-amber-700 border-amber-200' : 'bg-gray-50 text-gray-400 border-gray-200' },
                  ].map(s => (
                    <div key={s.label} className={`rounded-2xl border p-4 ${s.color}`}>
                      <p className="text-3xl font-extrabold">{s.value}</p>
                      <p className="text-xs font-semibold mt-1">{s.label}</p>
                    </div>
                  ))}
                </div>

                {/* Sites à corriger */}
                {fixableRows.filter(r => !r.saved).length > 0 && (
                  <div className="w-full mb-6 text-left">
                    <div className="flex items-center gap-2 mb-3">
                      <AlertCircle size={16} className="text-amber-500" />
                      <p className="font-semibold text-sm text-gray-800">
                        {fixableRows.filter(r => !r.saved).length} site{fixableRows.filter(r => !r.saved).length > 1 ? 's' : ''} à corriger
                      </p>
                    </div>
                    <div className="space-y-3">
                      {fixableRows.map((row, idx) => (
                        <div key={idx} className={`rounded-2xl border p-4 text-sm transition-all ${
                          row.saved ? 'bg-emerald-50 border-emerald-200 opacity-60' :
                          row.issue === 'dberror' ? 'bg-red-50 border-red-200' : 'bg-amber-50 border-amber-200'
                        }`}>
                          <div className="flex items-start justify-between gap-2 mb-2">
                            <div className="flex items-center gap-2">
                              {row.saved
                                ? <CheckCircle2 size={14} className="text-emerald-500 flex-shrink-0" />
                                : row.issue === 'dberror'
                                  ? <AlertCircle size={14} className="text-red-500 flex-shrink-0" />
                                  : <MapPin size={14} className="text-amber-500 flex-shrink-0" />
                              }
                              <span className="font-semibold text-gray-800 truncate">{row.editName || row.payload.name}</span>
                            </div>
                            {row.saved && (
                              <span className="text-xs text-emerald-600 font-semibold flex-shrink-0">
                                {row.hasGeo ? '✓ Localisé' : '✓ Corrigé'}
                              </span>
                            )}
                          </div>
                          {row.issue === 'dberror' && !row.saved && (
                            <p className="text-xs text-red-600 mb-2 bg-red-100 rounded-lg px-2 py-1">{row.dbError}</p>
                          )}
                          {!row.saved && (
                            <div className="space-y-2">
                              <input
                                value={row.editName}
                                onChange={e => setFixableRows(prev => prev.map((r, i) => i === idx ? { ...r, editName: e.target.value } : r))}
                                placeholder="Nom du site"
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                              />
                              <input
                                value={row.editAddress}
                                onChange={e => setFixableRows(prev => prev.map((r, i) => i === idx ? { ...r, editAddress: e.target.value } : r))}
                                placeholder="Adresse (numéro + rue)"
                                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                              />
                              <div className="flex gap-2">
                                <input
                                  value={row.editPostcode}
                                  onChange={e => setFixableRows(prev => prev.map((r, i) => i === idx ? { ...r, editPostcode: e.target.value } : r))}
                                  placeholder="Code postal"
                                  className="w-28 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                                <input
                                  value={row.editCity}
                                  onChange={e => setFixableRows(prev => prev.map((r, i) => i === idx ? { ...r, editCity: e.target.value } : r))}
                                  placeholder="Ville"
                                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-400"
                                />
                              </div>
                              <button
                                onClick={() => saveFixedRow(idx)}
                                disabled={row.saving}
                                className="w-full py-2.5 bg-blue-700 hover:bg-blue-800 disabled:opacity-50 text-white rounded-xl text-sm font-bold flex items-center justify-center gap-2"
                              >
                                {row.saving
                                  ? <><Loader2 size={14} className="animate-spin" /> Correction…</>
                                  : <><RotateCcw size={14} /> Corriger et localiser</>
                                }
                              </button>
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
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
