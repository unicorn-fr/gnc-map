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
  } catch {
    return null
  }
}

export async function requestAndSubscribe(commercialId) {
  if (!('Notification' in window) || !('PushManager' in window)) return
  if (!VAPID_PUBLIC_KEY) return

  const perm = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (perm !== 'granted') return

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
    }
    const { endpoint, keys } = sub.toJSON()
    await supabase.from('push_subscriptions').upsert(
      { endpoint, auth: keys.auth, p256dh: keys.p256dh, commercial_id: commercialId },
      { onConflict: 'endpoint' }
    )
  } catch { /* silencieux si bloqué */ }
}

export async function sendPushToAll(title, body, url = '/') {
  try {
    await supabase.functions.invoke('send-push', { body: { title, body, url } })
  } catch { /* non bloquant */ }
}
