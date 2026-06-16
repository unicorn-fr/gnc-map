import { useState } from 'react'
import { MapPin, Loader2, AlertCircle } from 'lucide-react'
import { COMMERCIALS } from '../lib/commercials'
import { firstName } from '../lib/utils'
import InstallBanner from './InstallBanner'

const ACCESS_CODE = import.meta.env.VITE_ACCESS_CODE

export default function LoginPage({ onSelect, installPrompt, onInstalled, startAtPick }) {
  const [step, setStep] = useState(startAtPick ? 'pick' : 'code')
  const [code, setCode] = useState('')
  const [error, setError] = useState(null)

  const handleCodeSubmit = (e) => {
    e.preventDefault()
    if (code === ACCESS_CODE) {
      setError(null)
      setStep('pick')
    } else {
      setError('Code incorrect')
      setCode('')
    }
  }

  if (step === 'pick') {
    return (
      <div className="min-h-full bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6">
        <div className="text-center mb-10">
          <div className="inline-flex items-center justify-center w-20 h-20 bg-white/10 backdrop-blur rounded-3xl mb-5 shadow-xl">
            <MapPin size={40} className="text-white" />
          </div>
          <h1 className="text-4xl font-extrabold text-white tracking-tight">Carte de prospection</h1>
          <p className="text-blue-300 mt-2">Espace professionnel</p>
        </div>

        <p className="text-white/60 text-sm font-medium uppercase tracking-widest text-center mb-5">
          Qui êtes-vous ?
        </p>

        <div className="flex flex-col gap-4 w-full max-w-sm">
          {COMMERCIALS.map(c => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="group flex items-center gap-4 bg-white/10 hover:bg-white/20 backdrop-blur border border-white/10 hover:border-white/30 rounded-2xl px-6 py-5 transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-extrabold text-xl shadow-md flex-shrink-0"
                style={{ background: c.color }}
              >
                {c.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 text-left">
                <p className="text-white font-bold text-lg leading-tight">{firstName(c.name)}</p>
                <p className="text-white/40 text-sm mt-0.5">Appuyer pour accéder</p>
              </div>
              <div className="text-white/30 group-hover:text-white/70 transition-colors">→</div>
            </button>
          ))}
        </div>

        <InstallBanner installPrompt={installPrompt} onInstalled={onInstalled} />
      </div>
    )
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6">
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-white/10 backdrop-blur rounded-3xl mb-5 shadow-xl">
          <MapPin size={40} className="text-white" />
        </div>
        <h1 className="text-4xl font-extrabold text-white tracking-tight">Carte de prospection</h1>
        <p className="text-blue-300 mt-2">Espace professionnel</p>
      </div>

      {error && (
        <div className="w-full max-w-sm mb-4 bg-red-500/20 border border-red-400/40 rounded-2xl px-4 py-3 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-300 flex-shrink-0 mt-0.5" />
          <p className="text-red-200 text-sm">{error}</p>
        </div>
      )}

      <form onSubmit={handleCodeSubmit} className="w-full max-w-sm space-y-3">
        <input
          type="password"
          inputMode="numeric"
          placeholder="Code d'accès"
          value={code}
          onChange={e => setCode(e.target.value)}
          required
          autoFocus
          autoComplete="current-password"
          className="w-full bg-white/10 border border-white/20 rounded-2xl px-5 py-4 text-white placeholder-white/40 focus:outline-none focus:border-blue-400 text-center text-2xl tracking-widest"
        />
        <button
          type="submit"
          className="w-full bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-bold text-sm rounded-2xl px-6 py-4 transition-colors"
        >
          Accéder
        </button>
      </form>

      <InstallBanner installPrompt={installPrompt} onInstalled={onInstalled} />
    </div>
  )
}
