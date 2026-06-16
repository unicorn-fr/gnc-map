import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function b64urlToBytes(b64: string): Uint8Array {
  const pad = '='.repeat((4 - (b64.length % 4)) % 4)
  const raw = atob((b64 + pad).replace(/-/g, '+').replace(/_/g, '/'))
  return Uint8Array.from([...raw].map(c => c.charCodeAt(0)))
}

function bytesToB64url(buf: ArrayBuffer | Uint8Array): string {
  return btoa(String.fromCharCode(...new Uint8Array(buf)))
    .replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')
}

function concat(...arrays: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0))
  let off = 0
  for (const a of arrays) { out.set(a, off); off += a.length }
  return out
}

// ── VAPID JWT ─────────────────────────────────────────────────────────────────
// Le Web Crypto API n'accepte PAS l'import d'une clé privée EC en format 'raw'.
// On reconstitue un JWK à partir du scalaire privé (32 octets) + des coordonnées
// x,y extraites de la clé publique VAPID (65 octets non-compressée).

async function makeVapidJWT(audience: string, vapidPublic: string, vapidPrivate: string): Promise<string> {
  const pubBytes = b64urlToBytes(vapidPublic)
  // pubBytes = 0x04 || x(32) || y(32)
  const x = bytesToB64url(pubBytes.slice(1, 33))
  const y = bytesToB64url(pubBytes.slice(33, 65))

  const key = await crypto.subtle.importKey(
    'jwk',
    { crv: 'P-256', d: vapidPrivate, ext: true, key_ops: ['sign'], kty: 'EC', x, y },
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  )

  const enc = (obj: object) =>
    btoa(JSON.stringify(obj)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_')

  const now = Math.floor(Date.now() / 1000)
  const header  = enc({ alg: 'ES256', typ: 'JWT' })
  const payload = enc({ aud: audience, exp: now + 43200, sub: 'mailto:admin@gnc.fr' })
  const signing = `${header}.${payload}`

  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    key,
    new TextEncoder().encode(signing),
  )
  return `${signing}.${bytesToB64url(sig)}`
}

// ── Chiffrement RFC 8291 (aes128gcm) ─────────────────────────────────────────

async function encryptPayload(
  p256dh: string,
  auth: string,
  payload: string,
): Promise<{ salt: Uint8Array; serverPub: Uint8Array; ciphertext: Uint8Array }> {
  // 1. Paire éphémère côté serveur
  const serverECDH = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'],
  )
  const serverPub     = new Uint8Array(await crypto.subtle.exportKey('raw', serverECDH.publicKey))
  const clientPubRaw  = b64urlToBytes(p256dh)
  const clientPubKey  = await crypto.subtle.importKey(
    'raw', clientPubRaw, { name: 'ECDH', namedCurve: 'P-256' }, false, [],
  )

  // 2. Secret ECDH partagé
  const sharedBits = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: clientPubKey }, serverECDH.privateKey, 256,
  )

  const salt       = crypto.getRandomValues(new Uint8Array(16))
  const authSecret = b64urlToBytes(auth)

  // 3. PRK_key = HKDF-SHA256(IKM=sharedBits, salt=authSecret, info="WebPush: info\0" || ua_pub || as_pub)
  const sharedKey = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveBits'])
  const prkInfo = concat(
    new TextEncoder().encode('WebPush: info\0'),
    clientPubRaw,
    serverPub,
  )
  const ikm = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: authSecret, info: prkInfo },
    sharedKey, 256,
  )

  // 4. Dérivation CEK (128 bits) et nonce (96 bits) avec le sel aléatoire
  const ikmKey = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits'])
  const [cekBits, nonceBits] = await Promise.all([
    crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: aes128gcm\0') },
      ikmKey, 128,
    ),
    crypto.subtle.deriveBits(
      { name: 'HKDF', hash: 'SHA-256', salt, info: new TextEncoder().encode('Content-Encoding: nonce\0') },
      ikmKey, 96,
    ),
  ])

  // 5. Chiffrement AES-128-GCM : payload || 0x02 (délimiteur de fin de bloc)
  const cek = await crypto.subtle.importKey('raw', cekBits, 'AES-GCM', false, ['encrypt'])
  const plaintext = new TextEncoder().encode(payload)
  const padded = new Uint8Array(plaintext.length + 1)
  padded.set(plaintext)
  padded[plaintext.length] = 2

  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonceBits }, cek, padded)

  return { salt, serverPub, ciphertext: new Uint8Array(encrypted) }
}

// ── Envoi d'une notification ──────────────────────────────────────────────────

async function sendPush(
  sub: { endpoint: string; auth: string; p256dh: string },
  payloadStr: string,
  vapidPublic: string,
  vapidPrivate: string,
): Promise<{ expired: boolean }> {
  const { salt, serverPub, ciphertext } = await encryptPayload(sub.p256dh, sub.auth, payloadStr)

  // Corps aes128gcm : salt(16) | rs(4, BE) | idlen(1) | serverPub | ciphertext
  const body = new Uint8Array(16 + 4 + 1 + serverPub.length + ciphertext.length)
  let off = 0
  body.set(salt, off);                                       off += 16
  new DataView(body.buffer).setUint32(off, 4096, false);     off += 4
  body[off] = serverPub.length;                              off += 1
  body.set(serverPub, off);                                  off += serverPub.length
  body.set(ciphertext, off)

  const url      = new URL(sub.endpoint)
  const audience = `${url.protocol}//${url.host}`
  const jwt      = await makeVapidJWT(audience, vapidPublic, vapidPrivate)

  const res = await fetch(sub.endpoint, {
    method: 'POST',
    headers: {
      'Content-Type':     'application/octet-stream',
      'Content-Encoding': 'aes128gcm',
      'TTL':              '86400',
      'Authorization':    `vapid t=${jwt},k=${vapidPublic}`,
    },
    body,
  })

  return { expired: res.status === 410 || res.status === 404 }
}

// ── Entrée principale ─────────────────────────────────────────────────────────

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })

  try {
    const vapidPublic  = Deno.env.get('VAPID_PUBLIC_KEY')  ?? ''
    const vapidPrivate = Deno.env.get('VAPID_PRIVATE_KEY') ?? ''
    if (!vapidPublic || !vapidPrivate) {
      return new Response('VAPID keys missing', { status: 500, headers: corsHeaders })
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const { title, body: bodyText, url = '/', skipCommercialId = null } = await req.json()
    const payloadStr = JSON.stringify({ title, body: bodyText, url })

    let query = admin.from('push_subscriptions').select('endpoint, auth, p256dh')
    if (skipCommercialId) query = query.neq('commercial_id', skipCommercialId)
    const { data: subs } = await query
    if (!subs?.length) return new Response('no subscribers', { headers: corsHeaders })

    const expired: string[] = []
    await Promise.allSettled(
      subs.map(async (sub) => {
        const result = await sendPush(sub, payloadStr, vapidPublic, vapidPrivate)
        if (result.expired) expired.push(sub.endpoint)
      }),
    )

    // Supprimer les abonnements expirés
    if (expired.length) {
      await admin.from('push_subscriptions').delete().in('endpoint', expired)
    }

    return new Response(
      JSON.stringify({ sent: subs.length - expired.length, expired: expired.length }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (e) {
    console.error('send-push error:', e)
    return new Response(String(e), { status: 500, headers: corsHeaders })
  }
})
