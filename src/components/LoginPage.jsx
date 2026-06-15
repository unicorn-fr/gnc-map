import { useState } from 'react'
import { MapPin, Loader2, AlertCircle, Eye, EyeOff } from 'lucide-react'
import { supabase } from '../lib/supabase'
import InstallBanner from './InstallBanner'

export default function LoginPage({ installPrompt, onInstalled }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({ email, password })
    if (authError) {
      setError('Identifiants incorrects')
      setLoading(false)
    }
    // Si succès, onAuthStateChange dans App.jsx prend le relais
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-white/10 backdrop-blur rounded-3xl mb-5 shadow-xl">
          <MapPin size={40} className="text-white" />
        </div>
        <h1 className="text-4xl font-extrabold text-white tracking-tight">Atlas</h1>
        <p className="text-blue-300 mt-2">Espace professionnel</p>
      </div>

      {error && (
        <div className="w-full max-w-sm mb-4 bg-red-500/20 border border-red-400/40 rounded-2xl px-4 py-3 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-300 flex-shrink-0 mt-0.5" />
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      )}

      <form onSubmit={handleSubmit} className="w-full max-w-sm space-y-3">
        <input
          type="email"
          placeholder="Adresse e-mail"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          autoComplete="email"
          className="w-full bg-white/10 border border-white/20 rounded-2xl px-5 py-4 text-white placeholder-white/40 focus:outline-none focus:border-blue-400 text-sm"
        />
        <div className="relative">
          <input
            type={showPassword ? 'text' : 'password'}
            placeholder="Mot de passe"
            value={password}
            onChange={e => setPassword(e.target.value)}
            required
            autoComplete="current-password"
            className="w-full bg-white/10 border border-white/20 rounded-2xl px-5 py-4 text-white placeholder-white/40 focus:outline-none focus:border-blue-400 text-sm pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword(v => !v)}
            className="absolute right-4 top-1/2 -translate-y-1/2 text-white/40 hover:text-white/70"
          >
            {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
          </button>
        </div>
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-60 text-white font-bold text-sm rounded-2xl px-6 py-4 flex items-center justify-center gap-2 transition-colors mt-2"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : 'Se connecter'}
        </button>
      </form>

      <InstallBanner installPrompt={installPrompt} onInstalled={onInstalled} />
    </div>
  )
}
