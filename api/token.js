import { SignJWT } from 'jose'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const { password } = body

  // Accepte APP_PASSWORD (nouvelle var) ou VITE_APP_PASSWORD (ancienne var, transition)
  const expected = process.env.APP_PASSWORD || process.env.VITE_APP_PASSWORD
  if (!expected) return res.status(500).json({ error: 'APP_PASSWORD non configuré' })

  if (!password || password !== expected) {
    return res.status(401).json({ error: 'Mot de passe incorrect' })
  }

  // Si SUPABASE_JWT_SECRET pas encore configuré → retourne un marqueur simple
  // (le frontend utilisera la clé anon en attendant)
  if (!process.env.SUPABASE_JWT_SECRET) {
    return res.json({ token: null, legacy: true })
  }

  const secret = new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET)
  const token = await new SignJWT({ role: 'authenticated' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setIssuer('supabase')
    .setExpirationTime('30d')
    .sign(secret)

  res.json({ token })
}
