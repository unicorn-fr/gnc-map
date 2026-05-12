// Géocodage multi-stratégies pour adresses françaises
//
// Ordre de priorité :
//   1. BAN batch  (Base Adresse Nationale officielle, très précis, rapide)
//   2. BAN individuel avec fallbacks (adresse seule → CP+ville → ville seule)
//   3. Nominatim (OpenStreetMap) en dernier recours, respecte le rate-limit 1 req/s

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── Helpers CSV ───────────────────────────────────────────────
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

// ── Nettoyage des données ──────────────────────────────────────

// "6000" → "06000", "75001" → "75001", "75 001" → "75001"
function normalizePostcode(cp) {
  const s = String(cp ?? '').trim().replace(/[\s\-\.]/g, '')
  if (!s) return ''
  if (/^\d{1,4}$/.test(s)) return s.padStart(5, '0')
  return s
}

// Supprime les infos de bâtiment/lot/appartement qui gênent le géocodeur
// "Bât A - 12 rue de la Paix" → "12 rue de la Paix"
function cleanAddress(addr) {
  return String(addr ?? '')
    .replace(/\b(bât(iment)?|bat\.?|lot\.?|appt?\.?|appartement|étage|porte|résidence|immeuble|hall|escalier)[^,\d]*/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
}

// ── Score minimum selon le type de résultat BAN ───────────────
function minScore(type) {
  switch ((type ?? '').toLowerCase()) {
    case 'housenumber': return 0.40
    case 'street':      return 0.35
    case 'locality':    return 0.30
    case 'municipality':return 0.20
    default:            return 0.30
  }
}

// ── BAN — requête individuelle ────────────────────────────────
async function geocodeBAN(addr, cp, city) {
  const cpN = normalizePostcode(cp)
  const q = [cleanAddress(addr), cpN, city].filter(Boolean).join(' ').trim()
  if (!q) return null
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`
    if (cpN) {
      // Forcer la recherche dans le département du CP pour éviter les faux positifs
      const dept = cpN.slice(0, 2)
      const urlWithPostcode = `${url}&postcode=${encodeURIComponent(cpN)}`
      const res1 = await fetch(urlWithPostcode)
      if (res1.ok) {
        const data1 = await res1.json()
        if (data1.features?.length) {
          const f = data1.features[0]
          const [lng, lat] = f.geometry.coordinates
          const { score, type } = f.properties
          if (score >= minScore(type)) return { lat, lng, score, type }
        }
      }
    }
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.features?.length) return null
    const f = data.features[0]
    const [lng, lat] = f.geometry.coordinates
    const { score, type } = f.properties
    if (score >= minScore(type)) return { lat, lng, score, type }
    return null
  } catch { return null }
}

// ── Nominatim (OpenStreetMap) — fallback ─────────────────────
let _lastNominatim = 0
async function geocodeNominatim(addr, cp, city) {
  const cpN = normalizePostcode(cp)
  const parts = [cleanAddress(addr), cpN, city, 'France'].filter(Boolean)
  if (!city && !cpN) return null

  const wait = Math.max(0, 1100 - (Date.now() - _lastNominatim))
  if (wait > 0) await sleep(wait)
  _lastNominatim = Date.now()

  try {
    const q = parts.join(', ')
    const res = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&countrycodes=fr`,
      { headers: { 'User-Agent': 'GNC-Map/1.0' } }
    )
    if (!res.ok) return null
    const data = await res.json()
    if (!data.length) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    if (isNaN(lat) || isNaN(lng)) return null
    return { lat, lng, score: 0.6, type: 'nominatim' }
  } catch { return null }
}

// ── Géocodage intelligent multi-stratégies (une adresse) ─────
export async function geocodeSmart(addr, cpRaw, city) {
  const cp = normalizePostcode(cpRaw)

  // 1. BAN : adresse complète
  if (addr && (cp || city)) {
    const r = await geocodeBAN(addr, cp, city)
    if (r) return r
  }

  // 2. BAN : adresse nettoyée + CP + ville (supprime les infos bâtiment)
  const addrClean = cleanAddress(addr)
  if (addrClean !== addr && (cp || city)) {
    const r = await geocodeBAN(addrClean, cp, city)
    if (r) return r
  }

  // 3. BAN : CP + ville (sans adresse)
  if (cp && city) {
    const r = await geocodeBAN('', cp, city)
    if (r) return r
  }

  // 4. Nominatim : adresse complète
  if (city || cp) {
    const r = await geocodeNominatim(addr, cp, city)
    if (r) return r
  }

  // 5. Nominatim : CP + ville (sans adresse)
  if (cp || city) {
    const r = await geocodeNominatim('', cp, city)
    if (r) return r
  }

  // 6. BAN : ville seule (dernier recours, place au centre de la commune)
  if (city) {
    const r = await geocodeBAN('', '', city)
    if (r) return r
  }

  return null
}

// Alias pour compatibilité
export async function geocodeSingle(address, postcode = '', city = '') {
  return geocodeSmart(address, postcode, city)
}

// ── Géocodage batch (BAN CSV + fallback smart par adresse) ────
export async function geocodeBatch(rows, cols, onProgress) {
  const { addressCol, postcodeCol, cityCol } = cols
  const results = new Array(rows.length).fill(null)

  const toGeocode = []
  rows.forEach((row, i) => {
    const addr = addressCol ? String(row[addressCol] ?? '').trim() : ''
    const cp   = normalizePostcode(postcodeCol ? String(row[postcodeCol] ?? '') : '')
    const city = cityCol     ? String(row[cityCol]     ?? '').trim() : ''
    if (addr || city || cp) toGeocode.push({ i, addr, cp, city })
  })

  if (!toGeocode.length) { onProgress(rows.length, rows.length); return results }

  onProgress(0, rows.length)

  // ── Étape 1 : BAN batch CSV ───────────────────────────────────
  const failedBi = [] // indices dans toGeocode à retraiter

  try {
    const csvLines = [
      'adresse,code_postal,ville',
      ...toGeocode.map(r => [csvEscape(cleanAddress(r.addr)), csvEscape(r.cp), csvEscape(r.city)].join(','))
    ]
    const blob = new Blob([csvLines.join('\r\n')], { type: 'text/csv' })
    const fd = new FormData()
    fd.append('data', blob, 'addr.csv')
    fd.append('columns', 'adresse')
    fd.append('columns', 'code_postal')
    fd.append('columns', 'ville')

    const res = await fetch('https://api-adresse.data.gouv.fr/search/csv/', { method: 'POST', body: fd })

    if (res.ok) {
      const text = await res.text()
      const lines = text.trim().split('\n')
      const header = parseCSVRow(lines[0])
      const latI  = header.findIndex(h => h === 'result_latitude'  || h === 'latitude')
      const lngI  = header.findIndex(h => h === 'result_longitude' || h === 'longitude')
      const scI   = header.findIndex(h => h === 'result_score'     || h === 'score')
      const typeI = header.findIndex(h => h === 'result_type'      || h === 'type')

      if (latI >= 0 && lngI >= 0) {
        lines.slice(1).forEach((line, bi) => {
          if (!toGeocode[bi]) return
          const parts = parseCSVRow(line)
          const lat   = parseFloat(parts[latI])
          const lng   = parseFloat(parts[lngI])
          const score = parseFloat(parts[scI] ?? 0)
          const type  = typeI >= 0 ? String(parts[typeI] ?? '').replace(/"/g, '') : ''

          if (!isNaN(lat) && !isNaN(lng) && score >= minScore(type)) {
            results[toGeocode[bi].i] = { lat, lng, score, type }
          } else {
            failedBi.push(bi)
          }
        })
        // Signaler 60 % de progression après le batch
        onProgress(Math.floor(rows.length * 0.6), rows.length)
      } else {
        // Colonnes non trouvées → tout retraiter
        toGeocode.forEach((_, bi) => failedBi.push(bi))
      }
    } else {
      toGeocode.forEach((_, bi) => failedBi.push(bi))
    }
  } catch {
    toGeocode.forEach((_, bi) => failedBi.push(bi))
  }

  // ── Étape 2 : fallback multi-stratégies pour les adresses échouées ──
  for (let fi = 0; fi < failedBi.length; fi++) {
    const bi = failedBi[fi]
    const r = toGeocode[bi]
    results[r.i] = await geocodeSmart(r.addr, r.cp, r.city)
    onProgress(
      Math.floor(rows.length * 0.6) + Math.floor(((fi + 1) / failedBi.length) * rows.length * 0.4),
      rows.length
    )
    // Pause légère pour ne pas surcharger la BAN (Nominatim gère son propre rate-limit)
    await sleep(100)
  }

  onProgress(rows.length, rows.length)
  return results
}
