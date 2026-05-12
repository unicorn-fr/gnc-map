import { supabase } from './supabase'

const LS_TOKEN_KEY = 'gnc_session_token'
const EXPIRY_MS = 3 * 60 * 1000 // 3 minutes sans heartbeat = session expirée

export const getLocalToken = () => localStorage.getItem(LS_TOKEN_KEY)
const saveLocalToken = (t) => localStorage.setItem(LS_TOKEN_KEY, t)
export const clearLocalToken = () => localStorage.removeItem(LS_TOKEN_KEY)

// Vérifie si un autre appareil est actif et tente de prendre la session.
// Retourne { ok: true } ou { ok: false, error: string }
export async function checkAndClaimSession(commercialId) {
  const myToken = getLocalToken()
  const threshold = new Date(Date.now() - EXPIRY_MS).toISOString()

  const { data: existing } = await supabase
    .from('sessions')
    .select('token, last_seen')
    .eq('commercial_id', commercialId)
    .maybeSingle()

  if (existing && existing.last_seen > threshold && existing.token !== myToken) {
    return { ok: false, error: 'Ce compte est déjà connecté sur un autre appareil.' }
  }

  // Prendre ou renouveler la session (upsert sur commercial_id unique)
  const token = myToken ?? crypto.randomUUID()
  const { error } = await supabase.from('sessions').upsert(
    { commercial_id: commercialId, token, last_seen: new Date().toISOString() },
    { onConflict: 'commercial_id' }
  )

  if (error) return { ok: false, error: 'Erreur de connexion.' }
  saveLocalToken(token)
  return { ok: true }
}

// À appeler régulièrement (toutes les 60 s) pour garder la session vivante
export async function heartbeat(commercialId) {
  const token = getLocalToken()
  if (!token) return
  await supabase.from('sessions')
    .update({ last_seen: new Date().toISOString() })
    .eq('commercial_id', commercialId)
    .eq('token', token)
}

// À appeler lors de la déconnexion
export async function endSession(commercialId) {
  const token = getLocalToken()
  if (!token) return
  await supabase.from('sessions').delete()
    .eq('commercial_id', commercialId)
    .eq('token', token)
  clearLocalToken()
}
