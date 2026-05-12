import { supabase } from './supabase'

// Clé publique VAPID — non sensible, peut être hardcodée
const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY
  || 'BEixI07sbksFoFs1ecKbToWKoOo9wX55r1NIM1ABY4YVy_8b89-A6gSQuO4ei8d-U37zv9c9LeujGl7n5ttJ9CE'

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null
  try {
    const reg = await navigator.serviceWorker.register('/sw.js')

    // Recharge automatiquement quand un nouveau service worker prend le contrôle.
    // Combiné à skipWaiting() dans le SW, cela garantit que chaque déploiement
    // est appliqué immédiatement sans action manuelle de l'utilisateur.
    let refreshing = false
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!refreshing) {
        refreshing = true
        window.location.reload()
      }
    })

    return reg
  } catch (e) {
    console.error('[push] SW registration failed:', e)
    return null
  }
}

export async function requestAndSubscribe(commercialId) {
  if (!('Notification' in window) || !('PushManager' in window)) return

  const perm = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (perm !== 'granted') return

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()

    // Si la clé VAPID a changé, l'ancien abonnement est invalide → réinscription
    if (sub) {
      const currentKey = urlBase64ToUint8Array(VAPID_PUBLIC_KEY)
      const existingKey = sub.options?.applicationServerKey
        ? new Uint8Array(sub.options.applicationServerKey)
        : null
      const stale = !existingKey || currentKey.length !== existingKey.length ||
        currentKey.some((b, i) => b !== existingKey[i])
      if (stale) {
        await sub.unsubscribe()
        sub = null
        console.info('[push] Ancienne clé VAPID détectée → réinscription')
      }
    }

    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
      console.info('[push] Nouvel abonnement push créé')
    }

    const { endpoint, keys } = sub.toJSON()
    const { error } = await supabase.from('push_subscriptions').upsert(
      { endpoint, auth: keys.auth, p256dh: keys.p256dh, commercial_id: commercialId },
      { onConflict: 'endpoint' }
    )
    if (error) console.error('[push] Erreur sauvegarde abonnement:', error)
    else console.info('[push] Abonnement sauvegardé ✓')
  } catch (e) {
    console.error('[push] Subscribe error:', e)
  }
}

// skipCommercialId : ne pas notifier le commercial qui fait l'action
export async function sendPushToAll(title, body, url = '/', skipCommercialId = null) {
  try {
    const { error } = await supabase.functions.invoke('send-push', {
      body: { title, body, url, skipCommercialId },
    })
    if (error) console.error('[push] Edge function error:', error)
  } catch (e) {
    console.error('[push] sendPushToAll error:', e)
  }
}
