// Géocodage via l'API officielle française + fallback Nominatim (OpenStreetMap)
// https://api-adresse.data.gouv.fr  +  https://nominatim.openstreetmap.org

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

// ── Zone de travail GNC : Lyon / Grenoble / Jura / Suisse ──────────
// Tout résultat hors de cette boîte est rejeté — évite les homonymes lointains.
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

// ── API adresse.data.gouv.fr (adresse française précise) ─────────
// lat/lon bias vers le centre de la région pour lever les ambiguïtés.
export async function geocodeSingle(address, postcode = '', city = '') {
  const q = [address, postcode, city].filter(Boolean).join(' ').trim()
  if (!q) return null
  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1&lat=${CENTER_LAT}&lon=${CENTER_LNG}`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.features?.length) return null
    const [lng, lat] = data.features[0].geometry.coordinates
    const score = data.features[0].properties.score
    if (!inWorkArea(lat, lng)) return null
    return { lat, lng, score }
  } catch { return null }
}

// ── Nominatim (OpenStreetMap) — fallback nom d'entreprise ─────────
// viewbox restreint la recherche à la région, bounded=1 l'impose strictement.
// Si rien n'est trouvé dans la zone, retourne null plutôt qu'un résultat lointain.
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
    if (!data.length) return null
    // Prendre le meilleur résultat dans la zone
    for (const item of data) {
      const lat = parseFloat(item.lat)
      const lng = parseFloat(item.lon)
      if (!isNaN(lat) && !isNaN(lng) && inWorkArea(lat, lng)) {
        return { lat, lng, score: item.importance ?? 0.4, source: 'nominatim' }
      }
    }
    return null
  } catch { return null }
}

// ── Batch complet avec fallback entreprise ─────────────────────────
// cols: { addressCol, postcodeCol, cityCol, companyCol? }
// onProgress(current, total, phase?) — phase: 'batch' | 'nominatim'
export async function geocodeBatch(rows, cols, onProgress) {
  const { addressCol, postcodeCol, cityCol, companyCol } = cols
  const results = new Array(rows.length).fill(null)

  const toGeocode = []
  rows.forEach((row, i) => {
    const addr = addressCol ? String(row[addressCol] ?? '').trim() : ''
    const cp   = postcodeCol ? String(row[postcodeCol] ?? '').trim() : ''
    const city = cityCol     ? String(row[cityCol]     ?? '').trim() : ''
    if (addr || city) toGeocode.push({ i, addr, cp, city })
  })

  if (!toGeocode.length) { onProgress(rows.length, rows.length, 'batch'); return results }

  onProgress(0, rows.length, 'batch')

  // ── Étape 1 : batch API data.gouv.fr (1 seule requête) ──────────
  try {
    const csvLines = [
      'adresse,code_postal,ville',
      ...toGeocode.map(r => [csvEscape(r.addr), csvEscape(r.cp), csvEscape(r.city)].join(','))
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
    if (res.ok) {
      const text = await res.text()
      const lines = text.trim().split('\n')
      const header = parseCSVRow(lines[0])
      const latI  = header.findIndex(h => h === 'result_latitude')
      const lngI  = header.findIndex(h => h === 'result_longitude')
      const scI   = header.findIndex(h => h === 'result_score')

      if (latI >= 0 && lngI >= 0) {
        lines.slice(1).forEach((line, bi) => {
          if (!toGeocode[bi]) return
          const parts = parseCSVRow(line)
          const lat   = parseFloat(parts[latI])
          const lng   = parseFloat(parts[lngI])
          const score = parseFloat(parts[scI] ?? 0)
          // Seuil de score relevé à 0.4 + vérification zone géographique
          if (!isNaN(lat) && !isNaN(lng) && score >= 0.4 && inWorkArea(lat, lng)) {
            results[toGeocode[bi].i] = { lat, lng, score }
          }
        })
      }
    }
  } catch { /* fallback below */ }

  const geocodedCount = results.filter(Boolean).length
  onProgress(geocodedCount, rows.length, 'batch')

  // ── Étape 2 : fallback Nominatim (max 30 lignes) ────────────────
  const failed = toGeocode.filter(r => !results[r.i])
  const nominatimCandidates = failed.slice(0, 30)

  if (nominatimCandidates.length > 0 && companyCol) {
    let done = 0
    for (const r of nominatimCandidates) {
      const company = String(rows[r.i]?.[companyCol] ?? '').trim()

      // Tentative 1 : entreprise + adresse complète
      if (company) {
        const q1 = [company, r.addr, r.cp, r.city].filter(Boolean).join(' ')
        let geo = await geocodeNominatim(q1)

        // Tentative 2 : entreprise + ville seulement
        if (!geo && (r.city || r.cp)) {
          await sleep(1100)
          const q2 = [company, r.cp, r.city].filter(Boolean).join(' ')
          geo = await geocodeNominatim(q2)
        }

        // Tentative 3 : adresse + ville sans nom d'entreprise
        if (!geo && r.addr && r.city) {
          await sleep(1100)
          geo = await geocodeSingle(r.addr, r.cp, r.city)
        }

        // Tentative 4 : ville seule (au moins positionner dans la bonne commune)
        if (!geo && r.city) {
          await sleep(1100)
          geo = await geocodeSingle('', r.cp, r.city)
        }

        if (geo) results[r.i] = geo
        await sleep(1100)
      }
      done++
      onProgress(geocodedCount + done, rows.length, 'nominatim')
    }
  } else if (failed.length > 0) {
    let done = 0
    for (const r of failed) {
      let geo = await geocodeSingle(r.addr, r.cp, r.city)
      // Fallback : ville seule si adresse précise échoue
      if (!geo && r.city) {
        await sleep(200)
        geo = await geocodeSingle('', r.cp, r.city)
      }
      results[r.i] = geo
      await sleep(200)
      done++
      onProgress(geocodedCount + done, rows.length, 'batch')
    }
  }

  onProgress(rows.length, rows.length, 'batch')
  return results
}
