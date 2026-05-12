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
  if (!('Notification' in window) || !('PushManager' in window)) {
    console.warn('[push] Push API not supported on this browser')
    return
  }
  if (!VAPID_PUBLIC_KEY) {
    console.error('[push] VITE_VAPID_PUBLIC_KEY is not set in .env — push disabled')
    return
  }

  const perm = Notification.permission === 'granted'
    ? 'granted'
    : await Notification.requestPermission()
  if (perm !== 'granted') {
    console.warn('[push] Notification permission denied')
    return
  }

  try {
    const reg = await navigator.serviceWorker.ready
    let sub = await reg.pushManager.getSubscription()
    if (!sub) {
      sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(VAPID_PUBLIC_KEY),
      })
      console.info('[push] New push subscription created')
    } else {
      console.info('[push] Existing push subscription found')
    }
    const { endpoint, keys } = sub.toJSON()
    const { error } = await supabase.from('push_subscriptions').upsert(
      { endpoint, auth: keys.auth, p256dh: keys.p256dh, commercial_id: commercialId },
      { onConflict: 'endpoint' }
    )
    if (error) console.error('[push] Failed to save subscription to DB:', error)
    else console.info('[push] Subscription saved to DB ✓')
  } catch (e) {
    console.error('[push] Subscribe error:', e)
  }
}

export async function sendPushToAll(title, body, url = '/') {
  if (!VAPID_PUBLIC_KEY) return  // push not configured, skip silently
  try {
    const { error, data } = await supabase.functions.invoke('send-push', {
      body: { title, body, url },
    })
    if (error) console.error('[push] Edge function error:', error)
    else console.info('[push] Sent:', data)
  } catch (e) {
    console.error('[push] sendPushToAll error:', e)
  }
}
