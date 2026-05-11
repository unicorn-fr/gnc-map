import { useState } from 'react'
import { Loader2, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

export default function Auth() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)

  const handleLogin = async (e) => {
    e.preventDefault()
    setLoading(true)
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    if (error) {
      toast.error('Email ou mot de passe incorrect')
    }
    setLoading(false)
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-900 to-blue-950 flex items-center justify-center p-5">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-sm overflow-hidden">
        {/* Header */}
        <div className="bg-gradient-to-br from-blue-800 to-blue-950 px-8 py-10 text-center">
          <div className="inline-flex items-center justify-center w-18 h-18 bg-white/10 rounded-2xl p-4 mb-4">
            <MapPin size={36} className="text-white" />
          </div>
          <h1 className="text-3xl font-extrabold text-white tracking-tight">GNC Map</h1>
          <p className="text-blue-300 text-sm mt-1">Groupe Nord Coffrage</p>
        </div>

        {/* Form */}
        <form onSubmit={handleLogin} className="px-8 py-8 space-y-4">
          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Email
            </label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="votre@email.com"
              required
              autoComplete="email"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={e => setPassword(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
            />
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full py-3.5 bg-blue-800 hover:bg-blue-900 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 disabled:opacity-60 transition-colors mt-2"
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Connexion en cours...
              </>
            ) : (
              'Se connecter'
            )}
          </button>

          <p className="text-center text-xs text-gray-400 pt-2">
            Contactez l'administrateur pour créer votre compte
          </p>
        </form>
      </div>
    </div>
  )
}
