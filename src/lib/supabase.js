import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY // fallback pendant la transition
const TOKEN_KEY = 'gnc_jwt_v1'
const LEGACY_MARKER = 'legacy-auth'

export const isMisconfigured = !url

function buildClient(token) {
  if (!url) return null
  // Mode legacy (SUPABASE_JWT_SECRET pas encore configuré côté Vercel) → clé anon
  const key = (!token || token === LEGACY_MARKER) ? anonKey : token
  if (!key) return null
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

function isExpired(token) {
  if (!token || token === LEGACY_MARKER) return false // legacy n'expire pas
  try {
    const payload = JSON.parse(atob(token.split('.')[1]))
    return payload.exp < Date.now() / 1000
  } catch { return true }
}

export function hasValidToken() {
  const token = getStoredToken()
  return !!token && !isExpired(token)
}

// Client Supabase — réassigné après authentification (live binding ES module)
export let supabase = buildClient(getStoredToken())

export async function authenticate(password) {
  const res = await fetch('/api/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ password }),
  })
  if (!res.ok) return false
  const { token, legacy } = await res.json()
  const stored = legacy ? LEGACY_MARKER : token
  localStorage.setItem(TOKEN_KEY, stored)
  supabase = buildClient(stored)
  return true
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  supabase = null
}
