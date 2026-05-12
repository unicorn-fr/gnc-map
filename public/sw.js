const CACHE = 'gnc-map-v6'
const TILE_CACHE = 'gnc-tiles-v1'

self.addEventListener('install', e => {
  self.skipWaiting()
})

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => k !== CACHE && k !== TILE_CACHE).map(k => caches.delete(k))
      ))
      .then(() => clients.claim())
  )
})

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return
  const url = new URL(e.request.url)

  // index.html : toujours depuis le réseau — garantit la dernière version après déploiement
  if (url.pathname === '/' || url.pathname === '/index.html') {
    e.respondWith(
      fetch(e.request, { cache: 'no-store' })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // Tuiles OpenStreetMap : cache-first pour une navigation fluide.
  // Les tuiles ne changent quasiment jamais — les servir depuis le cache
  // élimine la latence réseau lors du défilement et du zoom.
  if (url.hostname.includes('tile.openstreetmap.org')) {
    e.respondWith(
      caches.open(TILE_CACHE).then(async cache => {
        const cached = await cache.match(e.request)
        if (cached) return cached
        const res = await fetch(e.request)
        if (res.ok) cache.put(e.request, res.clone())
        return res
      }).catch(() => new Response('', { status: 408 }))
    )
    return
  }

  // Fichiers JS/CSS/images : réseau d'abord (Vite génère des noms hachés, pas de conflit)
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
        // Envoyer un message plutôt que navigate() : React ne relit pas les
        // paramètres URL sur une navigation dans un onglet déjà monté.
        existing.postMessage({ type: 'OPEN_URL', url: full })
        return
      }
      return clients.openWindow(full)
    })
  )
})
