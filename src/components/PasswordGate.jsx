import { useState } from 'react'
import { Lock } from 'lucide-react'
import { authenticate } from '../lib/supabase'

export { hasValidToken as validToken } from '../lib/supabase'

export default function PasswordGate({ onUnlock }) {
  const [input, setInput] = useState('')
  const [error, setError] = useState(false)
  const [loading, setLoading] = useState(false)
  const [shake, setShake] = useState(false)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setLoading(true)
    const ok = await authenticate(input)
    setLoading(false)
    if (ok) {
      onUnlock()
    } else {
      setError(true)
      setShake(true)
      setInput('')
      setTimeout(() => setShake(false), 500)
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: '#0f172a',
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: 24,
    }}>
      <div style={{ marginBottom: 32, textAlign: 'center' }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🗺️</div>
        <p style={{ fontSize: 22, fontWeight: 800, color: 'white', margin: 0 }}>GNC Map</p>
        <p style={{ fontSize: 13, color: '#64748b', margin: '4px 0 0' }}>Groupe Nord Coffrage</p>
      </div>

      <form
        onSubmit={handleSubmit}
        style={{
          width: '100%', maxWidth: 340,
          animation: shake ? 'shake 0.4s ease' : 'none',
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          background: '#1e293b', borderRadius: 16,
          padding: '14px 16px', marginBottom: 12,
          border: error ? '1.5px solid #ef4444' : '1.5px solid transparent',
        }}>
          <Lock size={18} style={{ color: '#64748b', flexShrink: 0 }} />
          <input
            type="password"
            value={input}
            onChange={e => { setInput(e.target.value); setError(false) }}
            placeholder="Mot de passe"
            autoFocus
            autoComplete="current-password"
            disabled={loading}
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: 'white', fontSize: 16, fontWeight: 500,
            }}
          />
        </div>

        {error && (
          <p style={{ color: '#f87171', fontSize: 13, textAlign: 'center', marginBottom: 10 }}>
            Mot de passe incorrect
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          style={{
            width: '100%', padding: '15px', borderRadius: 16,
            background: loading ? '#1e3a8a' : '#1D4ED8', border: 'none', cursor: loading ? 'default' : 'pointer',
            color: 'white', fontSize: 16, fontWeight: 700,
            opacity: loading ? 0.8 : 1,
          }}
        >
          {loading ? 'Vérification…' : 'Accéder à la carte'}
        </button>
      </form>

      <style>{`
        @keyframes shake {
          0%,100% { transform: translateX(0); }
          20%      { transform: translateX(-8px); }
          40%      { transform: translateX(8px); }
          60%      { transform: translateX(-6px); }
          80%      { transform: translateX(6px); }
        }
      `}</style>
    </div>
  )
}
