import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Encode base64url → Uint8Array
function b64urlToUint8(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const b = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...b].map(c => c.charCodeAt(0)))
}

// Signer JWT VAPID
async function makeVapidJWT(audience: string, subject: string, privateKeyB64: string): Promise<string> {
  const header = btoa(JSON.stringify({ alg: 'ES256', typ: 'JWT' })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const now = Math.floor(Date.now() / 1000)
  const payload = btoa(JSON.stringify({ aud: audience, exp: now + 43200, sub: subject })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  const signing = `${header}.${payload}`
  const keyData = b64urlToUint8(privateKeyB64)
  const cryptoKey = await crypto.subtle.importKey(
    'raw', keyData,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false, ['sign']
  )
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, cryptoKey, new TextEncoder().encode(signing))
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
  return `${signing}.${sigB64}`
}

async function sendWebPush(sub: { endpoint: string; auth: string; p256dh: string }, payload: string, vapidPublic: string, vapidPrivate: string) {
  const url = new URL(sub.endpoint)
  const audience = `${url.protocol}//${url.host}`
  const jwt = await makeVapidJWT(audience, 'mailto:admin@gnc.fr', vapidPrivate)

  // Encrypt payload (AES-GCM with ECDH)
  const serverKeyPair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveKey'])
  const clientPubKey = await crypto.subtle.importKey('raw', b64urlToUint8(sub.p256dh), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const sharedKey = await crypto.subtle.deriveKey(
    { name: 'ECDH', public: clientPubKey },
    serverKeyPair.privateKey,
    { name: 'HKDF' }, false, ['deriveKey']
  )
  const serverPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', serverKeyPair.publicKey))
  const authSecret = b64urlToUint8(sub.auth)
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // HKDF for content encryption key
  const hkdfInfo = (label: string, context: Uint8Array) => {
    const enc = new TextEncoder()
    const labelBytes = enc.encode(`Content-Encoding: ${label}\0`)
    const info = new Uint8Array(labelBytes.length + 1 + context.length)
    info.set(labelBytes); info[labelBytes.length] = context.length; info.set(context, labelBytes.length + 1)
    return info
  }
  const authInfo = new TextEncoder().encode('Content-Encoding: auth\0')
  const prk = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: authInfo },
    sharedKey, { name: 'AES-GCM', length: 128 }, false, ['encrypt']
  )

  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: salt.slice(0, 12) },
    prk,
    new TextEncoder().encode(payload)
  )

  const body = new Uint8Array(21 + serverPubRaw.length + encrypted.byteLength)
  body.set(salt, 0)
  new DataView(body.buffer).setUint32(16, 4096, false) // rs
  body[20] = serverPubRaw.length
  body.set(serverPubRaw, 21)
  body.set(new Uint8Array(encrypted), 21 + serverPubRaw.length)

  return fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL': '86400',
      'Authorization': `vapid t=${jwt},k=${vapidPublic}`,
    },
    body,
  })
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const { title, body, url } = await req.json()
    const vapidPublic = Deno.env.get('VAPID_PUBLIC_KEY')!
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY')!

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const { data: subs } = await admin.from('push_subscriptions').select('endpoint, auth, p256dh')
    if (!subs?.length) return new Response('no subscribers', { headers: corsHeaders })

    const payload = JSON.stringify({ title, body, url, tag: 'gnc-update' })
    await Promise.allSettled(subs.map(s => sendWebPush(s, payload, vapidPublic, vapidPrivate)))

    return new Response('ok', { headers: corsHeaders })
  } catch (e) {
    return new Response(String(e), { status: 500, headers: corsHeaders })
  }
})
