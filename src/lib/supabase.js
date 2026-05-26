import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const TOKEN_KEY = 'gnc_jwt_v1'

export const isMisconfigured = !url

function buildClient(token) {
  if (!url || !token) return null
  return createClient(url, token, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

function getStoredToken() {
  try { return localStorage.getItem(TOKEN_KEY) } catch { return null }
}

function isExpired(token) {
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
  const { token } = await res.json()
  localStorage.setItem(TOKEN_KEY, token)
  supabase = buildClient(token)
  return true
}

export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY)
  supabase = null
}
