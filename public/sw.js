const CACHE = 'gnc-map-v17'
const TILE_CACHE = 'gnc-tiles-v11'
const STYLE_CACHE = 'gnc-styles-v1'

const STYLE_URL = 'https://tiles.openfreemap.org/styles/bright'

self.addEventListener('install', e => {
  self.skipWaiting()
  // Pré-cache le style JSON dès l'installation pour un premier rendu instantané
  e.waitUntil(
    caches.open(STYLE_CACHE).then(cache =>
      fetch(STYLE_URL).then(r => { if (r.ok) try { cache.put(STYLE_URL, r) } catch {} }).catch(() => {})
    )
  )
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== TILE_CACHE && k !== STYLE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => clients.claim())
  )
})

function fetchAndCache(cache, url) {
  return cache.match(url).then(hit => {
    if (hit) return
    fetch(url).then(r => { if (r.ok) try { cache.put(url, r) } catch {} }).catch(() => {})
  })
}

// 2 anneaux de voisins au même zoom — couvre un déplacement rapide.
// Anneau 1 (8 tuiles) + anneau 2 (16 tuiles) = 24 tuiles au total.
function prefetchVectorNeighbors(cache, url) {
  const m = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/)
  if (!m) return
  const z = +m[1], x = +m[2], y = +m[3]
  if (z < 5 || z > 15) return
  const base = url.pathname.replace(/\/\d+\/\d+\/\d+\.pbf$/, '')
  const radius = z <= 13 ? 2 : 1   // 2 anneaux au zoom normal, 1 au zoom max
  for (let dx = -radius; dx <= radius; dx++) {
    for (let dy = -radius; dy <= radius; dy++) {
      if (dx === 0 && dy === 0) continue
      fetchAndCache(cache, `${url.origin}${base}/${z}/${x+dx}/${y+dy}.pbf`)
    }
  }
}

// 2 niveaux de parents — couche de repli pour le zoom arrière.
// MapLibre les affiche instantanément pendant que les tuiles détaillées chargent.
function prefetchParentTiles(cache, url) {
  const m = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/)
  if (!m) return
  const z = +m[1], x = +m[2], y = +m[3]
  if (z < 2) return
  const base = url.pathname.replace(/\/\d+\/\d+\/\d+\.pbf$/, '')
  ;[
    [z-1, x>>1,  y>>1 ],
    [z-2, x>>2,  y>>2 ],
  ].filter(([pz]) => pz >= 0)
   .forEach(([pz, px, py]) => fetchAndCache(cache, `${url.origin}${base}/${pz}/${px}/${py}.pbf`))
}

// 4 tuiles enfants (zoom+1) — couche de zoom avant.
// Quand l'utilisateur zoome, les tuiles filles sont déjà en cache → zéro blanc.
function prefetchVectorChildren(cache, url) {
  const m = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/)
  if (!m) return
  const z = +m[1], x = +m[2], y = +m[3]
  if (z < 5 || z > 13) return   // inutile de précharger au-delà de z14
  const base = url.pathname.replace(/\/\d+\/\d+\/\d+\.pbf$/, '')
  const cz = z + 1, cx = x * 2, cy = y * 2
  ;[
    [cx,   cy  ], [cx+1, cy  ],
    [cx,   cy+1], [cx+1, cy+1],
  ].forEach(([nx, ny]) => fetchAndCache(cache, `${url.origin}${base}/${cz}/${nx}/${ny}.pbf`))
}

// Tuiles enfants OSM raster (zoom+1).
function prefetchOsmChildren(cache, url) {
  const m = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/)
  if (!m) return
  const z = +m[1], x = +m[2], y = +m[3]
  if (z < 5 || z > 15) return
  const subs = ['a', 'b', 'c']
  ;[
    [2*x,   2*y  ], [2*x+1, 2*y  ],
    [2*x,   2*y+1], [2*x+1, 2*y+1],
  ].forEach(([cx, cy], i) => {
    const u = `https://${subs[i%3]}.tile.openstreetmap.org/${z+1}/${cx}/${cy}.png`
    fetchAndCache(cache, u)
  })
}

// ── Préchauffage ──────────────────────────────────────────────

function latLngToTile(lat, lng, z) {
  const x = Math.floor((lng + 180) / 360 * (1 << z))
  const latRad = lat * Math.PI / 180
  const y = Math.floor((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * (1 << z))
  return { x, y }
}

// Télécharge une boîte de tuiles en parallèle — saute les tuiles déjà en cache.
async function prewarmBox(cache, north, south, west, east, origin, path, zMin, zMax, batchSize = 6) {
  for (let z = zMin; z <= zMax; z++) {
    const tl = latLngToTile(north, west, z)
    const br = latLngToTile(south, east, z)
    const x0 = Math.min(tl.x, br.x), x1 = Math.max(tl.x, br.x)
    const y0 = Math.min(tl.y, br.y), y1 = Math.max(tl.y, br.y)

    const tiles = []
    for (let tx = x0; tx <= x1; tx++)
      for (let ty = y0; ty <= y1; ty++)
        tiles.push(`${origin}${path}/${z}/${tx}/${ty}.pbf`)

    for (let i = 0; i < tiles.length; i += batchSize) {
      await Promise.all(
        tiles.slice(i, i + batchSize).map(url =>
          cache.match(url).then(hit => {
            if (!hit) return fetch(url).then(r => { if (r.ok) try { cache.put(url, r) } catch {} }).catch(() => {})
          })
        )
      )
      await new Promise(r => setTimeout(r, 50))
    }
  }
}

// Préchauffage GPS : couvre tous les zooms utiles autour de la position.
async function prewarmRegion(cache, lat, lng, origin, path) {
  const levels = [
    { z: 10, deg: 1.2  },
    { z: 11, deg: 0.7  },
    { z: 12, deg: 0.4  },
    { z: 13, deg: 0.2  },
    { z: 14, deg: 0.08 },   // zoom de détail de chantier
  ]
  for (const { z, deg } of levels) {
    await prewarmBox(cache, lat + deg, lat - deg, lng - deg, lng + deg, origin, path, z, z, 6)
  }
}

function storeTileTemplate(cache, url) {
  const basePath = url.pathname.replace(/\/\d+\/\d+\/\d+\.pbf$/, '')
  cache.match('__gnc_tile_template__').then(hit => {
    if (!hit) {
      cache.put('__gnc_tile_template__', new Response(JSON.stringify({ origin: url.origin, path: basePath }), {
        headers: { 'Content-Type': 'application/json' },
      }))
    }
  })
}

async function getTileTemplate(cache) {
  try {
    const res = await cache.match('__gnc_tile_template__')
    if (res) return await res.json()
  } catch {}
  return { origin: 'https://tiles.openfreemap.org', path: '/planet' }
}

self.addEventListener('message', e => {
  // Préchauffage statique : zone Jura / Lyon / côté Suisse
  if (e.data?.type === 'PREWARM_STATIC') {
    caches.open(TILE_CACHE).then(async cache => {
      const { origin, path } = await getTileTemplate(cache)
      // Vue large
      await prewarmBox(cache, 48.0, 45.0, 4.0, 7.5, origin, path, 7, 9, 8)
      // Zone principale
      await prewarmBox(cache, 47.5, 45.5, 4.5, 7.0, origin, path, 10, 11, 6)
      // Détail Jura / Suisse
      await prewarmBox(cache, 47.2, 45.8, 5.0, 6.7, origin, path, 12, 12, 6)
      // Très détaillé : cœur Jura
      await prewarmBox(cache, 47.0, 46.2, 5.4, 6.3, origin, path, 13, 13, 6)
    })
    return
  }

  // Préchauffage GPS : autour de la position réelle de l'utilisateur
  if (e.data?.type === 'PREWARM_MAP') {
    const { lat, lng } = e.data
    if (!lat || !lng) return
    caches.open(TILE_CACHE).then(async cache => {
      const { origin, path } = await getTileTemplate(cache)
      prewarmRegion(cache, lat, lng, origin, path)
    })
  }
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)

  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  if (url.hostname.includes('openfreemap.org') && url.pathname.endsWith('.json')) {
    e.respondWith(
      caches.open(STYLE_CACHE).then(async cache => {
        const cached = await cache.match(e.request)
        const fetchPromise = fetch(e.request).then(res => {
          if (res.ok) try { cache.put(e.request, res.clone()) } catch {}
          return res
        }).catch(() => cached)
        return cached || fetchPromise
      })
    )
    return
  }

  if (
    url.hostname.includes('tile.openstreetmap.org') ||
    url.hostname.includes('arcgisonline.com') ||
    url.hostname.includes('basemaps.cartocdn.com') ||
    url.hostname.includes('openfreemap.org')
  ) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(e.request)
        if (cached) return cached
        const res = await fetch(e.request)
        if (res.ok) {
          try { cache.put(e.request, res.clone()) } catch {}
          if (url.hostname.includes('tile.openstreetmap.org')) {
            prefetchOsmChildren(cache, url)
          } else if (url.hostname.includes('openfreemap.org') && url.pathname.endsWith('.pbf')) {
            storeTileTemplate(cache, url)
            prefetchVectorNeighbors(cache, url)
            prefetchParentTiles(cache, url)
            prefetchVectorChildren(cache, url)   // ← zoom avant instantané
          }
        }
        return res
      }).catch(() => new Response('', { status: 408 }))
    )
    return
  }

  e.respondWith(
    fetch(e.request)
      .then(res => {
        if (res.ok && url.pathname.match(/\.(js|css|png|svg|ico|woff2?)$/)) {
          caches.open(CACHE).then(c => c.put(e.request, res.clone()))
        }
        return res
      })
      .catch(() => caches.match(e.request))
  )
})

// ── Notifications push ────────────────────────────────────────────
self.addEventListener('push', e => {
  if (!e.data) return
  let data = {}
  try { data = e.data.json() } catch { data = { title: 'GNC Map', body: e.data.text() } }
  const tag = `gnc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`
  e.waitUntil(
    self.registration.showNotification(data.title ?? 'GNC Map', {
      body: data.body ?? '',
      icon: '/icon-192.png',
      badge: '/icon-192.png',
      data: { url: data.url ?? '/' },
      tag,
      vibrate: [200, 100, 200],
    })
  )
})

self.addEventListener('notificationclick', e => {
  e.notification.close()
  const url = e.notification.data?.url ?? '/'
  const full = url.startsWith('http') ? url : self.location.origin + url
  e.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(wins => {
      const existing = wins.find(w => w.url.includes(self.location.origin))
      if (existing) { existing.focus(); existing.postMessage({ type: 'OPEN_URL', url: full }); return }
      return clients.openWindow(full)
    })
  )
})
