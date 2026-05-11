// Géocodage via l'API officielle française + fallback Nominatim (OpenStreetMap)
// https://api-adresse.data.gouv.fr  +  https://nominatim.openstreetmap.org

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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
export async function geocodeSingle(address, postcode = '', city = '') {
  const q = [address, postcode, city].filter(Boolean).join(' ').trim()
  if (!q) return null
  try {
    const res = await fetch(`https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(q)}&limit=1`)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.features?.length) return null
    const [lng, lat] = data.features[0].geometry.coordinates
    return { lat, lng, score: data.features[0].properties.score }
  } catch { return null }
}

// ── Nominatim (OpenStreetMap) — fallback nom d'entreprise ─────────
async function geocodeNominatim(query) {
  if (!query?.trim()) return null
  try {
    const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(query)}&format=json&limit=1&countrycodes=fr`
    const res = await fetch(url, { headers: { 'User-Agent': 'GNCMap/1.0' } })
    if (!res.ok) return null
    const data = await res.json()
    if (!data.length) return null
    const lat = parseFloat(data[0].lat)
    const lng = parseFloat(data[0].lon)
    if (isNaN(lat) || isNaN(lng)) return null
    return { lat, lng, score: data[0].importance ?? 0.4, source: 'nominatim' }
  } catch { return null }
}

// ── Batch complet avec fallback entreprise ─────────────────────────
// cols: { addressCol, postcodeCol, cityCol, companyCol? }
export async function geocodeBatch(rows, cols, onProgress) {
  const { addressCol, postcodeCol, cityCol, companyCol } = cols
  const results = new Array(rows.length).fill(null)

  // Index des lignes qui ont une adresse ou une ville
  const toGeocode = []
  rows.forEach((row, i) => {
    const addr = addressCol ? String(row[addressCol] ?? '').trim() : ''
    const cp   = postcodeCol ? String(row[postcodeCol] ?? '').trim() : ''
    const city = cityCol     ? String(row[cityCol]     ?? '').trim() : ''
    if (addr || city) toGeocode.push({ i, addr, cp, city })
  })

  if (!toGeocode.length) { onProgress(rows.length, rows.length); return results }

  onProgress(0, rows.length)

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
          if (!isNaN(lat) && !isNaN(lng) && score >= 0.3) {
            results[toGeocode[bi].i] = { lat, lng, score }
          }
        })
      }
    }
  } catch { /* fallback below */ }

  // ── Étape 2 : fallback Nominatim pour les lignes sans résultat ──
  // Utilise le nom d'entreprise pour trouver l'adresse précise
  const failed = toGeocode.filter(r => !results[r.i])

  if (failed.length > 0 && companyCol) {
    for (const r of failed) {
      const company = companyCol ? String(rows[r.i]?.[companyCol] ?? '').trim() : ''
      if (!company) continue

      // Tentative 1 : entreprise + adresse complète
      const q1 = [company, r.addr, r.cp, r.city].filter(Boolean).join(' ')
      let geo = await geocodeNominatim(q1)

      // Tentative 2 : entreprise + ville seulement
      if (!geo && (r.city || r.cp)) {
        const q2 = [company, r.cp, r.city, 'France'].filter(Boolean).join(' ')
        geo = await geocodeNominatim(q2)
        if (geo) await sleep(1100) // respect Nominatim rate limit
      }

      if (geo) results[r.i] = geo
      await sleep(1100) // Nominatim : max 1 req/sec
    }
  } else if (failed.length > 0) {
    // Pas de colonne entreprise → fallback série sur data.gouv.fr
    for (const r of failed) {
      results[r.i] = await geocodeSingle(r.addr, r.cp, r.city)
      await sleep(200)
    }
  }

  onProgress(rows.length, rows.length)
  return results
}
