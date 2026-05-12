const CACHE = 'gnc-map-v12'
const TILE_CACHE = 'gnc-tiles-v6'
const STYLE_CACHE = 'gnc-styles-v1'

self.addEventListener('install', e => {
  self.skipWaiting()
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

// Précharge les 8 tuiles voisines (même zoom, toutes directions) d'une tuile vectorielle.
// Quand l'utilisateur se déplace, les tuiles adjacentes sont déjà en cache → zéro blanc.
function prefetchVectorNeighbors(cache, url) {
  const m = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/)
  if (!m) return
  const z = +m[1], x = +m[2], y = +m[3]
  if (z < 5 || z > 15) return
  const basePath = url.pathname.replace(/\/\d+\/\d+\/\d+\.pbf$/, '')
  const neighbors = [
    [z, x-1, y-1], [z, x, y-1], [z, x+1, y-1],
    [z, x-1, y  ],               [z, x+1, y  ],
    [z, x-1, y+1], [z, x, y+1], [z, x+1, y+1],
  ]
  neighbors.forEach(([nz, nx, ny]) => {
    const nUrl = `${url.origin}${basePath}/${nz}/${nx}/${ny}.pbf`
    cache.match(nUrl).then(hit => {
      if (!hit) fetch(nUrl).then(r => { if (r.ok) try { cache.put(nUrl, r) } catch {} }).catch(() => {})
    })
  })
}

// Précharge les 4 tuiles enfants (zoom+1) d'une tuile OSM raster.
function prefetchOsmChildren(cache, url) {
  const m = url.pathname.match(/\/(\d+)\/(\d+)\/(\d+)\.png$/)
  if (!m) return
  const z = +m[1], x = +m[2], y = +m[3]
  if (z < 5 || z > 15) return
  const subs = ['a', 'b', 'c']
  const children = [
    [z+1, 2*x,   2*y  ], [z+1, 2*x+1, 2*y  ],
    [z+1, 2*x,   2*y+1], [z+1, 2*x+1, 2*y+1],
  ]
  children.forEach(([cz, cx, cy], i) => {
    const childUrl = `https://${subs[i % 3]}.tile.openstreetmap.org/${cz}/${cx}/${cy}.png`
    cache.match(childUrl).then(hit => {
      if (!hit) fetch(childUrl).then(r => { if (r.ok) cache.put(childUrl, r) }).catch(() => {})
    })
  })
}

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

  // Style JSON MapLibre (liberty/bright) — stale-while-revalidate :
  // sert depuis le cache immédiatement, met à jour en arrière-plan.
  // Le style fait ~500 Ko ; sans cache, il bloque le premier rendu.
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
            prefetchVectorNeighbors(cache, url)
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
      if (existing) {
        existing.focus()
        existing.postMessage({ type: 'OPEN_URL', url: full })
        return
      }
      return clients.openWindow(full)
    })
  )
})
