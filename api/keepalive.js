import { createClient } from '@supabase/supabase-js'

export default async function handler(req, res) {
  const url = process.env.SUPABASE_URL
  const key = process.env.SUPABASE_ANON_KEY
  if (!url || !key) return res.status(500).json({ error: 'missing env' })

  const supabase = createClient(url, key)
  const { error } = await supabase.from('commercials').select('id').limit(1)
  res.json({ ok: !error, time: new Date().toISOString(), error: error?.message })
}
