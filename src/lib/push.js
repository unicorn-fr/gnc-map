import { supabase } from './supabase'

const VAPID_PUBLIC_KEY = import.meta.env.VITE_VAPID_PUBLIC_KEY

function urlBase64ToUint8Array(b64) {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const base64 = (b64 + pad).replace(/-/g, '+').replace(/_/g, '/')
  const raw = atob(base64)
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

export async function registerSW() {
  if (!('serviceWorker' in navigator)) return null
  try {
    return await navigator.serviceWorker.register('/sw.js')
  } catch (e) {
    console.error('[push] SW registration failed:', e)
    return null
  }
}

export async function requestAndSubscribe(commercialId) {
  if (!('Notification' in window) || !('PushManager' in window)) return
  if (!VAPID_PUBLIC_KEY) {
    console.error('[push] VITE_VAPID_PUBLIC_KEY manquante')
    return
  }

  const perm = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (perm !== 'granted') return

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()

    // Si la clé VAPID a changé (ex: après une regénération), l'ancien abonnement
    // est invalide → forcer une réinscription avec la nouvelle clé.
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
  if (!VAPID_PUBLIC_KEY) return
  try {
    const { error } = await supabase.functions.invoke('send-push', {
      body: { title, body, url, skipCommercialId },
    })
    if (error) console.error('[push] Edge function error:', error)
  } catch (e) {
    console.error('[push] sendPushToAll error:', e)
  }
}

