// Geocodage via l'API officielle française (gratuit, illimité, précis)
// https://api-adresse.data.gouv.fr

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

export async function geocodeSingle(address, postcode = '', city = '') {
  const parts = [address, postcode, city].filter(Boolean).join(' ').trim()
  if (!parts) return null

  try {
    const url = `https://api-adresse.data.gouv.fr/search/?q=${encodeURIComponent(parts)}&limit=1`
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    if (!data.features?.length) return null

    const feature = data.features[0]
    const [lng, lat] = feature.geometry.coordinates
    return {
      lat,
      lng,
      label: feature.properties.label,
      score: feature.properties.score,
    }
  } catch {
    return null
  }
}

// Géocode un tableau de lignes avec gestion de la progression
// Retourne un tableau de résultats (null si échec)
export async function geocodeBatch(rows, cols, onProgress) {
  const { addressCol, postcodeCol, cityCol } = cols
  const results = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    const address = addressCol ? String(row[addressCol] ?? '') : ''
    const postcode = postcodeCol ? String(row[postcodeCol] ?? '') : ''
    const city = cityCol ? String(row[cityCol] ?? '') : ''

    if (!address && !city) {
      results.push(null)
    } else {
      const result = await geocodeSingle(address, postcode, city)
      results.push(result)
      // ~3 req/sec — respectueux de l'API
      await sleep(340)
    }

    onProgress(i + 1, rows.length)
  }

  return results
}
