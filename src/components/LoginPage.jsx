import { useState } from 'react'
import { MapPin, Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { COMMERCIALS } from '../lib/commercials'
import { firstName } from '../lib/utils'
import InstallBanner from './InstallBanner'

export default function LoginPage({ installPrompt, onInstalled }) {
  const [selected, setSelected] = useState(null)
  const [code, setCode] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!selected) { setError('Choisissez votre nom'); return }
    setError(null)
    setLoading(true)
    const { error: authError } = await supabase.auth.signInWithPassword({
      email: selected.email,
      password: code,
    })
    if (authError) {
      setError('Code incorrect')
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

      <form onSubmit={handleSubmit} className="w-full max-w-sm">
        <p className="text-white/60 text-sm font-medium uppercase tracking-widest text-center mb-4">
          Qui êtes-vous ?
        </p>

        <div className="flex flex-col gap-3 mb-5">
          {COMMERCIALS.map(c => (
            <button
              key={c.id}
              type="button"
              onClick={() => { setSelected(c); setError(null) }}
              className={`flex items-center gap-4 backdrop-blur border rounded-2xl px-5 py-4 transition-all duration-200 text-left ${
                selected?.id === c.id
                  ? 'bg-white/20 border-white/50 shadow-lg'
                  : 'bg-white/8 hover:bg-white/15 border-white/10'
              }`}
            >
              <div
                className="w-12 h-12 rounded-2xl flex items-center justify-center text-white font-extrabold text-lg shadow-md flex-shrink-0"
                style={{ background: c.color, opacity: selected && selected.id !== c.id ? 0.5 : 1 }}
              >
                {c.name.charAt(0).toUpperCase()}
              </div>
              <span className={`text-white font-bold text-base ${selected && selected.id !== c.id ? 'opacity-40' : ''}`}>
                {firstName(c.name)}
              </span>
              {selected?.id === c.id && (
                <div className="ml-auto w-5 h-5 rounded-full border-2 border-white flex items-center justify-center">
                  <div className="w-2.5 h-2.5 rounded-full bg-white" />
                </div>
              )}
            </button>
          ))}
        </div>

        <input
          type="password"
          inputMode="numeric"
          placeholder="Code d'accès"
          value={code}
          onChange={e => setCode(e.target.value)}
          required
          autoComplete="current-password"
          className="w-full bg-white/10 border border-white/20 rounded-2xl px-5 py-4 text-white placeholder-white/40 focus:outline-none focus:border-blue-400 text-sm text-center tracking-widest mb-3"
        />

        <button
          type="submit"
          disabled={loading || !selected}
          className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm rounded-2xl px-6 py-4 flex items-center justify-center gap-2 transition-colors"
        >
          {loading ? <Loader2 size={18} className="animate-spin" /> : 'Accéder'}
        </button>
      </form>

      <InstallBanner installPrompt={installPrompt} onInstalled={onInstalled} />
    </div>
  )
}
