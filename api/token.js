import { SignJWT } from 'jose'

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end()

  const body = typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const { password } = body

  if (!password || password !== process.env.APP_PASSWORD) {
    return res.status(401).json({ error: 'Mot de passe incorrect' })
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
