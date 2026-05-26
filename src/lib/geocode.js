// Géocodage multi-sources : data.gouv.fr → Photon (Komoot/OSM) → Nominatim → ville seule
//
// Pipeline :
//   1. api-adresse.data.gouv.fr  — batch CSV, 1 requête, instantané, France uniquement
//   2. Photon (photon.komoot.io)  — parallèle 5/batch, 200 ms entre batches,
//                                   Europe + Suisse, pas de clé API, basé OSM
//   3. api-adresse ville seule   — batch CSV, 1 requête, position approximative
//   4. Nominatim                 — séquentiel, dernier recours, 1,1 s entre req.

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── Zone de travail GNC : Lyon / Grenoble / Jura / Suisse ──────────
const WORK = { latMin: 44.0, latMax: 48.5, lngMin: 3.0, lngMax: 9.5 }
const CENTER_LAT = 46.2
const CENTER_LNG = 5.9

function inWorkArea(lat, lng) {
  return lat >= WORK.latMin && lat <= WORK.latMax &&
         lng >= WORK.lngMin && lng <= WORK.lngMax
}

function csvEscape(s) {
  return `"${String(s ?? '').replace(/"/g, '""')}"`
}

function parseCSVRow(line) {
  const result = []
  let cell = '', inQ = false
  for (let i = 0; i <= line.length; i++) {
    const c = line[i]
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cell += '"'; i++ }
      else inQ = !inQ
    } else if ((c === ',' || c === undefined) && !inQ) {
      result.push(cell.trim()); cell = ''
    } else {
      cell += (c ?? '')
    }
  }
  return result
}

// ── Normalise une adresse brute avant envoi ────────────────────────
// Supprime les abbréviations courantes et les artefacts fréquents dans les ERP.
const ABBR = [
  [/\bBD\b/gi, 'Boulevard'], [/\bAV\b\.?/gi, 'Avenue'],
  [/\bRTE\b/gi, 'Route'],    [/\bIMP\b\.?/gi, 'Impasse'],
  [/\bZI\b/gi, 'Zone Industrielle'], [/\bZA\b/gi, 'Zone Artisanale'],
  [/\bZAC\b/gi, 'Zone Aménagement'], [/\bLT\b\.?/gi, 'Lieu-dit'],
  [/\bSQL\b\.?/gi, ''],
]

function normalizeAddress(s) {
  if (!s) return ''
  let r = s.trim()
  for (const [re, rep] of ABBR) r = r.replace(re, rep)
  return r.replace(/\s{2,}/g, ' ').trim()
}

// ── 1. api-adresse.data.gouv.fr (batch CSV) ───────────────────────
async function govBatch(items, scoreThreshold = 0.4) {
  const results = new Array(items.length).fill(null)
  if (!items.length) return results
  try {
    const csvLines = [
      'adresse,code_postal,ville',
      ...items.map(r => [csvEscape(normalizeAddress(r.addr)), csvEscape(r.cp), csvEscape(r.city)].join(','))
    ]
    const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('data', blob, 'addr.csv')
    fd.append('columns', 'adresse')
    fd.append('columns', 'code_postal')
    fd.append('columns', 'ville')
    fd.append('lat', String(CENTER_LAT))
    fd.append('lon', String(CENTER_LNG))
    const res = await fetch('https://api-adresse.data.gouv.fr/search/csv/', { method: 'POST', body: fd })
    if (!res.ok) return results
    const text = await res.text()
    const lines = text.trim().split('\n')
    const header = parseCSVRow(lines[0])
    const latI = header.findIndex(h => h === 'result_latitude')
    const lngI = header.findIndex(h => h === 'result_longitude')
    const scI  = header.findIndex(h => h === 'result_score')
    if (latI < 0 || lngI < 0) return results
    lines.slice(1).forEach((line, bi) => {
      const parts = parseCSVRow(line)
      const lat   = parseFloat(parts[latI])
      const lng   = parseFloat(parts[lngI])
      const score = parseFloat(parts[scI] ?? 0)
      if (!isNaN(lat) && !isNaN(lng) && score >= scoreThreshold && inWorkArea(lat, lng)) {
        results[bi] = { lat, lng, score, source: 'gouv' }
      }
    })
  } catch { /* ignore */ }
  return results
}

// ── 2. Photon (Komoot/OSM) — Europe + Suisse, pas de clé API ──────
const PHOTON_BBOX = `${WORK.lngMin},${WORK.latMin},${WORK.lngMax},${WORK.latMax}`

async function geocodePhoton(query) {
  if (!query?.trim()) return null
  try {
    const url = [
      'https://photon.komoot.io/api/',
      `?q=${encodeURIComponent(query)}`,
      `&limit=1&lat=${CENTER_LAT}&lon=${CENTER_LNG}`,
      `&bbox=${PHOTON_BBOX}`,
    ].join('')
    const res = await fetch(url, { headers: { 'User-Agent': 'GNCMap/1.0' } })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.features?.length) return null
    const [lng, lat] = data.features[0].geometry.coordinates
    if (!inWorkArea(lat, lng)) return null
    return { lat, lng, score: 0.6, source: 'photon' }
  } catch { return null }
}

// Requêtes Photon en parallèle (5 simultanées, 150 ms entre batches)
async function photonBatch(items, onDone) {
  const CONCURRENCY = 5
  const results = new Array(items.length).fill(null)
  for (let i = 0; i < items.length; i += CONCURRENCY) {
    const chunk = items.slice(i, i + CONCURRENCY)
    const geos = await Promise.all(chunk.map(async (r) => {
      // Essai 1 : adresse complète
      const q1 = [normalizeAddress(r.addr), r.cp, r.city].filter(Boolean).join(' ')
      let geo = await geocodePhoton(q1)
      // Essai 2 : ville + CP seulement si adresse a échoué
      if (!geo && (r.city || r.cp)) {
        geo = await geocodePhoton([r.cp, r.city].filter(Boolean).join(' '))
      }
      return geo
    }))
    geos.forEach((geo, bi) => { results[i + bi] = geo })
    onDone(Math.min(i + CONCURRENCY, items.length))
    if (i + CONCURRENCY < items.length) await sleep(150)
  }
  return results
}

// ── 3. Nominatim — dernier recours, rate-limited ──────────────────
async function geocodeNominatim(query) {
  if (!query?.trim()) return null
  try {
    const viewbox = `${WORK.lngMin},${WORK.latMax},${WORK.lngMax},${WORK.latMin}`
    const url = [
      'https://nominatim.openstreetmap.org/search',
      `?q=${encodeURIComponent(query)}`,
      '&format=json&limit=3',
      '&countrycodes=fr,ch',
      `&viewbox=${viewbox}&bounded=1`,
    ].join('')
    const res = await fetch(url, { headers: { 'User-Agent': 'GNCMap/1.0' } })
    if (!res.ok) return null
    const data = await res.json()
    for (const item of data) {
      const lat = parseFloat(item.lat)
      const lng = parseFloat(item.lon)
      if (!isNaN(lat) && !isNaN(lng) && inWorkArea(lat, lng)) {
        return { lat, lng, score: item.importance ?? 0.4, source: 'nominatim' }
      }
    }
  } catch { /* ignore */ }
  return null
}

// ── API publique : géocodage d'une seule adresse ──────────────────
export async function geocodeSingle(address, postcode = '', city = '') {
  const addr = normalizeAddress(address)
  const q = [addr, postcode, city].filter(Boolean).join(' ').trim()
  if (!q) return null

  // 1. api-adresse.data.gouv.fr
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1&lat=${CENTER_LAT}&lon=${CENTER_LNG}`
    const res = await fetch(url)
    if (res.ok) {
      const data = await res.json()
      if (data.features?.length) {
        const [lng, lat] = data.features[0].geometry.coordinates
        const score = data.features[0].properties.score
        if (!isNaN(lat) && score >= 0.4 && inWorkArea(lat, lng)) return { lat, lng, score }
      }
    }
  } catch { /* ignore */ }

  // 2. Photon
  const geo = await geocodePhoton(q)
  if (geo) return geo

  return null
}

// ── API publique : géocodage batch ────────────────────────────────
// cols: { addressCol, postcodeCol, cityCol, companyCol? }
// onProgress(current, total, phase)
export async function geocodeBatch(rows, cols, onProgress) {
  const { addressCol, postcodeCol, cityCol, companyCol } = cols
  const results = new Array(rows.length).fill(null)

  // Construire la liste des lignes à géocoder
  const toGeo = []
  rows.forEach((row, i) => {
    const addr = addressCol ? String(row[addressCol] ?? '').trim() : ''
    const cp   = postcodeCol ? String(row[postcodeCol] ?? '').trim() : ''
    const city = cityCol     ? String(row[cityCol]     ?? '').trim() : ''
    const company = companyCol ? String(row[companyCol] ?? '').trim() : ''
    if (addr || city || cp) toGeo.push({ i, addr, cp, city, company })
  })

  if (!toGeo.length) { onProgress(rows.length, rows.length, 'batch'); return results }

  onProgress(0, rows.length, 'batch')
  const total = rows.length

  // ── Phase 1 : api-adresse.data.gouv.fr batch ──────────────────
  const govResults = await govBatch(toGeo, 0.4)
  govResults.forEach((geo, bi) => { if (geo) results[toGeo[bi].i] = geo })

  let geocodedCount = results.filter(Boolean).length
  onProgress(geocodedCount, total, 'batch')

  // ── Phase 2 : Photon pour les lignes encore sans résultat ─────
  const failedAfterGov = toGeo.filter(r => !results[r.i])
  if (failedAfterGov.length > 0) {
    // Pour Photon, essayer aussi avec le nom de l'entreprise
    const photonItems = failedAfterGov.map(r => ({
      ...r,
      addr: r.addr || r.company,  // fallback sur le nom d'entreprise comme adresse
    }))

    const photonResults = await photonBatch(photonItems, (done) => {
      onProgress(geocodedCount + done, total, 'photon')
    })
    photonResults.forEach((geo, bi) => {
      if (geo) results[failedAfterGov[bi].i] = geo
    })

    geocodedCount = results.filter(Boolean).length
    onProgress(geocodedCount, total, 'photon')
  }

  // ── Phase 3 : api-adresse avec score abaissé (0.25) ───────────
  // Capture les adresses un peu ambiguës que le seuil 0.4 rejetait.
  const failedAfterPhoton = toGeo.filter(r => !results[r.i] && (r.addr || r.city))
  if (failedAfterPhoton.length > 0) {
    const lowScoreResults = await govBatch(failedAfterPhoton, 0.25)
    lowScoreResults.forEach((geo, bi) => {
      if (geo) results[failedAfterPhoton[bi].i] = { ...geo, approximate: true }
    })
    geocodedCount = results.filter(Boolean).length
    onProgress(geocodedCount, total, 'batch')
  }

  // ── Phase 4 : ville seule pour les restants ───────────────────
  // Positionne au centre de la commune — imprécis mais visible sur la carte.
  const failedAfterLow = toGeo.filter(r => !results[r.i] && (r.city || r.cp))
  if (failedAfterLow.length > 0) {
    const cityItems = failedAfterLow.map(r => ({ ...r, addr: '' }))
    const cityResults = await govBatch(cityItems, 0.0)
    cityResults.forEach((geo, bi) => {
      if (geo) results[failedAfterLow[bi].i] = { ...geo, approximate: true, cityOnly: true }
    })
    geocodedCount = results.filter(Boolean).length
    onProgress(geocodedCount, total, 'batch')
  }

  // ── Phase 5 : Nominatim — dernier recours (max 20 restants) ──
  const stillFailed = toGeo.filter(r => !results[r.i])
  const nominatimCandidates = stillFailed.slice(0, 20)
  if (nominatimCandidates.length > 0) {
    let done = 0
    for (const r of nominatimCandidates) {
      const q = [r.company || r.addr, r.cp, r.city].filter(Boolean).join(' ')
      const geo = await geocodeNominatim(q)
      if (geo) results[r.i] = geo
      done++
      onProgress(geocodedCount + done, total, 'nominatim')
      await sleep(1100)
    }
  }

  onProgress(total, total, 'batch')
  return results
}
