import { useState, useRef } from 'react'
import * as XLSX from 'xlsx'
import { ArrowLeft, Upload, FileSpreadsheet, AlertCircle, CheckCircle2, Loader2, Info } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { geocodeBatch } from '../lib/geocode'
import toast from 'react-hot-toast'

// ── Helpers ──────────────────────────────────────────────────
const guessCol = (cols, keywords) => {
  const lc = cols.map(c => c.toLowerCase())
  // Passe 1 : correspondance directe (insensible à la casse)
  for (const kw of keywords) {
    const idx = lc.findIndex(c => c.includes(kw))
    if (idx >= 0) return cols[idx]
  }
  // Passe 2 : après suppression de la ponctuation (gère "C.P." → "cp", "Adresse1" → "adresse1")
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
  // Valeur numérique : 1 = chantier, 0 = siège social
  if (s === '1') return 'chantier'
  if (s === '0') return 'siege'
  // Valeur texte
  if (s.includes('siège') || s.includes('siege') || s.includes('social') || s.includes('bureau') || s === 'non' || s === 'no') return 'siege'
  return 'chantier'
}

const normalizeStatus = (v = '') => {
  const s = v.toLowerCase()
  if (s.includes('client')) return 'client'
  if (s.includes('cours') || s.includes('actif') || s.includes('location')) return 'en_cours'
  if (s.includes('termin') || s.includes('clôt') || s.includes('clot') || s.includes('fini')) return 'termine'
  return 'prospect'
}

// Calcule les initiales d'un nom : "Enzo Mercier" → "EM"
const getInitials = (name) =>
  name.trim().split(/\s+/).map(p => p.charAt(0).toUpperCase()).join('')

const matchCommercial = (value, commercials) => {
  if (!value) return null
  const v = String(value).toLowerCase().trim()
  const vUp = String(value).toUpperCase().trim().replace(/\s+/g, '')
  return (
    // Correspondance exacte du nom complet
    commercials.find(c => c.name.toLowerCase() === v) ??
    // Initiales : "EM" → "Enzo Mercier", "em" → idem
    commercials.find(c => getInitials(c.name) === vUp) ??
    // Contient le prénom ou le nom de famille
    commercials.find(c => {
      const parts = c.name.toLowerCase().split(/\s+/)
      return parts.some(p => p === v || v.includes(p) || p.includes(v))
    }) ??
    null
  )
}

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
    address: '', postcode: '', city: '',
    phone: '', email: '', notes: '', external_id: '',
    commercial: '',
  })
  const [progress, setProgress] = useState({ current: 0, total: 0 })
  const [results, setResults] = useState(null)
  const [isRunning, setIsRunning] = useState(false)
  const fileRef = useRef()

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

      // Auto-détection des colonnes (adaptée au format GNC)
      setMapping({
        name:        guessCol(cols, ['raison sociale', 'raison', 'nom', 'name', 'entreprise', 'société', 'client']),
        company:     guessCol(cols, ['raison sociale', 'société', 'enseigne', 'entreprise']),
        // "Chantier" (1/0) prioritaire sur "Type" générique
        type:        guessCol(cols, ['chantier', 'type']),
        status:      guessCol(cols, ['actif', 'statut', 'status', 'état']),
        // "Adresse1" prioritaire sur "Adresse" générique
        address:     guessCol(cols, ['adresse1', 'adresse', 'adress', 'address', 'rue', 'voie', 'street']),
        // "C.P." → la passe 2 (stripped) le détecte via "cp"
        postcode:    guessCol(cols, ['c.p', 'cp', 'code postal', 'code_postal', 'postal', 'zip', 'codepostal']),
        city:        guessCol(cols, ['ville', 'city', 'commune', 'localité']),
        phone:       guessCol(cols, ['téléphone', 'telephone', 'tel', 'phone', 'mobile']),
        email:       guessCol(cols, ['email', 'mail', 'adresse email', 'courriel', 'e-mail']),
        // "Activité" ou "Secteur" → notes
        notes:       guessCol(cols, ['activité', 'activite', 'secteur', 'note', 'obs', 'remarque', 'comment', 'info']),
        // "Code client" → ID unique pour déduplication
        external_id: guessCol(cols, ['code client', 'id', 'ref', 'n°', 'numero', 'numéro', 'identifiant']),
        // "Code Représentant" (LJ / CT / EM)
        commercial:  guessCol(cols, ['représentant', 'representant', 'commercial', 'vendeur', 'chargé', 'responsable']),
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

  // ── Étape 3 : aperçu des données ─────────────────────────────
  // Retourne null si la ligne doit être ignorée (commercial inconnu)
  const buildPreviewRow = (row) => {
    const commercialValue = mapping.commercial ? String(row[mapping.commercial] ?? '').trim() : ''
    const matched = matchCommercial(commercialValue, commercials)

    // Colonne commercial mappée mais valeur inconnue → ignorer la ligne
    if (mapping.commercial && !matched) return null

    // Pas de colonne commercial → premier commercial par défaut
    const comm = matched ?? commercials[0]
    if (!comm) return null

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
      commercial_id:   comm.id,
      commercial_name: comm.name,
    }
  }

  // Lignes valides : nom non vide ET commercial reconnu (buildPreviewRow != null)
  const allParsed = rows.map(buildPreviewRow)
  const ignoredCount = allParsed.filter(r => r === null).length
  const validRows = allParsed.filter(r => r !== null && r.name.length > 0)
  const preview = rows.slice(0, 8).map(buildPreviewRow).filter(Boolean)

  // ── Étape 4 : import ─────────────────────────────────────────
  const runImport = async () => {
    setIsRunning(true)
    setStep(3)

    const prepared = validRows
    const needsGeocode = prepared.some(r => r.address || r.city)
    let geoResults = prepared.map(() => null)

    // Géocodage si des adresses sont présentes
    if (needsGeocode) {
      setProgress({ current: 0, total: prepared.length })
      geoResults = await geocodeBatch(
        prepared,
        { addressCol: 'address', postcodeCol: 'postcode', cityCol: 'city' },
        (cur, tot) => setProgress({ current: cur, total: tot })
      )
    }

    // Insertion / mise à jour dans Supabase
    let inserted = 0, updated = 0, skipped = 0

    for (let i = 0; i < prepared.length; i++) {
      const row = prepared[i]
      const geo = geoResults[i]

      const payload = {
        commercial_id: row.commercial_id,
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

      // Chercher un doublon par external_id
      if (row.external_id) {
        const { data: existing } = await supabase
          .from('sites')
          .select('id, deleted')
          .eq('external_id', row.external_id)
          .single()

        if (existing) {
          if (existing.deleted) { skipped++; continue } // Site supprimé → ne pas réimporter
          await supabase.from('sites').update(payload).eq('id', existing.id)
          updated++
          continue
        }
      }

      const { error } = await supabase.from('sites').insert(payload)
      error ? skipped++ : inserted++
    }

    // Enregistrer le journal d'import
    await supabase.from('import_logs').insert({
      filename: fileName,
      total: prepared.length,
      inserted,
      updated,
      skipped,
    })

    setResults({ inserted, updated, skipped, total: prepared.length })
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
          <p className="text-blue-300 text-xs">Importer et mettre à jour votre base de données</p>
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
        {/* ── STEP 0 : Upload ── */}
        {step === 0 && (
          <div className="p-6 max-w-xl mx-auto">
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
              <p className="font-bold text-gray-700 text-lg mb-1">
                Glissez votre fichier ici
              </p>
              <p className="text-gray-400 text-sm mb-4">ou cliquez pour choisir</p>
              <p className="text-xs text-gray-300">Formats acceptés : .xlsx · .xls · .csv</p>
              <input
                ref={fileRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                className="hidden"
                onChange={e => handleFile(e.target.files[0])}
              />
            </div>

            {/* Info box */}
            <div className="mt-6 bg-blue-50 border border-blue-100 rounded-2xl p-4">
              <div className="flex gap-2 mb-2">
                <Info size={16} className="text-blue-500 flex-shrink-0 mt-0.5" />
                <p className="text-sm font-semibold text-blue-800">Comment ça marche</p>
              </div>
              <ul className="text-sm text-blue-700 space-y-1.5 ml-5 list-disc">
                <li>Exportez votre liste clients/chantiers depuis votre logiciel (Excel ou CSV)</li>
                <li>Les adresses sont géocodées automatiquement — les points apparaissent sur la carte</li>
                <li>Pour les mises à jour régulières : ajoutez une colonne <strong>ID unique</strong> (n° client). Les enregistrements existants sont mis à jour au lieu d'être dupliqués</li>
                <li>La première ligne doit être les en-têtes de colonnes</li>
              </ul>
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

                {/* Required */}
                <div className="mb-4">
                  <p className="text-xs font-semibold text-red-500 mb-2">OBLIGATOIRE</p>
                  <ColSelect label="Nom du site" field="name" required />
                </div>

                {/* Adresse (géocodage) */}
                <div className="mb-4">
                  <p className="text-xs font-semibold text-blue-500 mb-1">ADRESSE (pour placer sur la carte)</p>
                  <div className="bg-blue-50 rounded-xl p-3 mb-2">
                    <p className="text-xs text-blue-600">Les adresses sont converties en coordonnées GPS via l'API gouvernementale française (data.gouv.fr)</p>
                  </div>
                  <ColSelect label="Adresse"     field="address" />
                  <ColSelect label="Code postal" field="postcode" />
                  <ColSelect label="Ville"       field="city" />
                </div>

                {/* Infos */}
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

                {/* Deduplication */}
                <div>
                  <p className="text-xs font-semibold text-emerald-600 mb-1">MISE À JOUR (éviter les doublons)</p>
                  <div className="bg-emerald-50 rounded-xl p-3 mb-2">
                    <p className="text-xs text-emerald-700">
                      Si cette colonne est renseignée, les lignes avec le même ID seront <strong>mises à jour</strong> plutôt que dupliquées. Idéal pour les exports réguliers.
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
            {/* Summary */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4 mb-4">
              <div className="flex items-start gap-3">
                <AlertCircle size={18} className="text-amber-500 flex-shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold text-gray-800">
                    {validRows.length} sites à importer sur {rows.length} lignes
                  </p>
                  {ignoredCount > 0 && (
                    <p className="text-sm text-amber-600 mt-0.5">
                      ⚠️ {ignoredCount} ligne{ignoredCount > 1 ? 's ignorées' : ' ignorée'} — commercial non reconnu (autres commerciaux de votre entreprise)
                    </p>
                  )}
                  {(rows.length - validRows.length - ignoredCount) > 0 && (
                    <p className="text-sm text-gray-400 mt-0.5">
                      {rows.length - validRows.length - ignoredCount} ligne{rows.length - validRows.length - ignoredCount > 1 ? 's ignorées' : ' ignorée'} — nom manquant
                    </p>
                  )}
                  {(mapping.address || mapping.city) && (
                    <p className="text-sm text-blue-600 mt-1">
                      📍 Les adresses seront converties en coordonnées GPS (quelques secondes)
                    </p>
                  )}
                </div>
              </div>
            </div>

            {/* Preview table */}
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden mb-4">
              <div className="p-3 border-b bg-gray-50">
                <p className="text-xs font-semibold text-gray-500">Aperçu des 8 premières lignes</p>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="border-b bg-gray-50">
                      {['Nom', 'Entreprise', 'Type', 'Statut', 'Adresse', 'Commercial'].map(h => (
                        <th key={h} className="text-left px-3 py-2.5 text-gray-400 font-semibold uppercase tracking-wider text-[10px] whitespace-nowrap">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {preview.map((row, i) => (
                      <tr key={i} className={i % 2 === 0 ? 'bg-white' : 'bg-gray-50/50'}>
                        <td className="px-3 py-2.5 font-medium text-gray-800 truncate max-w-32">{row.name || <span className="text-red-400 italic">manquant</span>}</td>
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
                        ? `Géocodage des adresses… ${progress.current} / ${progress.total}`
                        : 'Insertion dans la base de données…'}
                    </p>
                    {progress.total > 0 && (
                      <div className="w-full bg-gray-200 rounded-full h-3 mb-2">
                        <div
                          className="bg-blue-600 h-3 rounded-full transition-all duration-500"
                          style={{ width: `${Math.round((progress.current / progress.total) * 100)}%` }}
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
                <h2 className="text-xl font-bold text-gray-800 mb-6">Import terminé !</h2>

                <div className="w-full grid grid-cols-3 gap-3 mb-8">
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

                <p className="text-sm text-gray-500 mb-6">
                  {results.inserted} nouveau{results.inserted !== 1 ? 'x' : ''} site{results.inserted !== 1 ? 's' : ''} ajouté{results.inserted !== 1 ? 's' : ''} sur la carte.
                  {results.updated > 0 && ` ${results.updated} site${results.updated !== 1 ? 's' : ''} mis à jour.`}
                </p>

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
