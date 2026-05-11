// Geocodage via l'API officielle française (gratuit, illimité, précis)
// https://api-adresse.data.gouv.fr

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

const sleep = (ms) => new Promise(r => setTimeout(r, ms))

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

// Géocode un tableau de lignes via l'API batch CSV (1 requête pour tout le fichier)
export async function geocodeBatch(rows, cols, onProgress) {
  const { addressCol, postcodeCol, cityCol } = cols
  const results = new Array(rows.length).fill(null)

  const toGeocode = []
  rows.forEach((row, i) => {
    const addr = addressCol ? String(row[addressCol] ?? '').trim() : ''
    const cp   = postcodeCol ? String(row[postcodeCol] ?? '').trim() : ''
    const city = cityCol     ? String(row[cityCol]     ?? '').trim() : ''
    if (addr || city) toGeocode.push({ i, addr, cp, city })
  })

  if (!toGeocode.length) { onProgress(rows.length, rows.length); return results }

  onProgress(0, rows.length)

  // ── Tentative batch (1 requête pour tout) ───────────────────
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
      const latI   = header.findIndex(h => h === 'result_latitude')
      const lngI   = header.findIndex(h => h === 'result_longitude')
      const scI    = header.findIndex(h => h === 'result_score')

      if (latI >= 0 && lngI >= 0) {
        lines.slice(1).forEach((line, bi) => {
          if (!toGeocode[bi]) return
          const parts = parseCSVRow(line)
          const lat   = parseFloat(parts[latI])
          const lng   = parseFloat(parts[lngI])
          const score = parseFloat(parts[scI] ?? 0)
          if (!isNaN(lat) && !isNaN(lng) && score >= 0.2) {
            results[toGeocode[bi].i] = { lat, lng, score }
          }
        })
        onProgress(rows.length, rows.length)
        return results
      }
    }
  } catch { /* fallback below */ }

  // ── Fallback : requêtes individuelles ───────────────────────
  for (let bi = 0; bi < toGeocode.length; bi++) {
    const r = toGeocode[bi]
    results[r.i] = await geocodeSingle(r.addr, r.cp, r.city)
    onProgress(bi + 1, toGeocode.length)
    await sleep(200)
  }
  return results
}
