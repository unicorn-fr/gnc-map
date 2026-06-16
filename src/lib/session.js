import { supabase } from './supabase'

const LS_TOKEN_KEY = 'gnc_session_token'

export const getLocalToken = () => localStorage.getItem(LS_TOKEN_KEY)
const saveLocalToken = (t) => localStorage.setItem(LS_TOKEN_KEY, t)
export const clearLocalToken = () => localStorage.removeItem(LS_TOKEN_KEY)

// Enregistre la session sans aucune restriction d'appareil unique.
// Plusieurs appareils peuvent être connectés avec le même compte simultanément.
export async function checkAndClaimSession(commercialId) {
  const token = getLocalToken() ?? crypto.randomUUID()
  await supabase.from('sessions').upsert(
    { commercial_id: commercialId, token, last_seen: new Date().toISOString() },
    { onConflict: 'commercial_id' }
  )
  saveLocalToken(token)
  return { ok: true }
}

export async function heartbeat(commercialId) {
  const token = getLocalToken()
  if (!token) return
  await supabase.from('sessions')
    .upsert(
      { commercial_id: commercialId, token, last_seen: new Date().toISOString() },
      { onConflict: 'commercial_id' }
    )
}

export async function endSession(commercialId) {
  const token = getLocalToken()
  if (!token) return
  await supabase.from('sessions').delete()
    .eq('commercial_id', commercialId)
    .eq('token', token)
  clearLocalToken()
}
