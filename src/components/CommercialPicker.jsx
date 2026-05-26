import { useState } from 'react'
import { COMMERCIALS } from '../lib/commercials'
import { checkAndClaimSession } from '../lib/session'
import { firstName } from '../lib/utils'
import { MapPin, Loader2, AlertCircle } from 'lucide-react'
import InstallBanner from './InstallBanner'

export default function CommercialPicker({ onSelect, installPrompt, onInstalled }) {
  const [checking, setChecking] = useState(null)
  const [sessionError, setSessionError] = useState(null)

  const handlePick = async (c) => {
    setSessionError(null)
    setChecking(c.id)
    const result = await checkAndClaimSession(c.id)
    setChecking(null)
    if (!result.ok) {
      setSessionError({ name: firstName(c.name), message: result.error })
      return
    }
    onSelect(c)
  }

  return (
    <div className="min-h-full bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900 flex flex-col items-center justify-center p-6">
      {/* Logo */}
      <div className="text-center mb-10">
        <div className="inline-flex items-center justify-center w-20 h-20 bg-white/10 backdrop-blur rounded-3xl mb-5 shadow-xl">
          <MapPin size={40} className="text-white" />
        </div>
        <h1 className="text-4xl font-extrabold text-white tracking-tight">GNC Map</h1>
        <p className="text-blue-300 mt-2">Groupe Nord Coffrage</p>
      </div>

      <div className="mb-6 text-center">
        <p className="text-white/60 text-sm font-medium uppercase tracking-widest">
          Qui êtes-vous ?
        </p>
      </div>

      {sessionError && (
        <div className="w-full max-w-sm mb-4 bg-red-500/20 border border-red-400/40 rounded-2xl px-4 py-3 flex items-start gap-3">
          <AlertCircle size={18} className="text-red-300 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-white font-semibold text-sm">{sessionError.name} est déjà connecté</p>
            <p className="text-red-200 text-xs mt-0.5">{sessionError.message}</p>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-4 w-full max-w-sm">
        {COMMERCIALS.map((c) => (
          <button
            key={c.id}
            onClick={() => handlePick(c)}
            disabled={checking !== null}
            className="group flex items-center gap-4 bg-white/10 hover:bg-white/20 active:scale-98 backdrop-blur border border-white/10 hover:border-white/30 rounded-2xl px-6 py-5 transition-all duration-200 shadow-lg hover:shadow-xl disabled:opacity-60"
          >
            <div
              className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-extrabold text-xl shadow-md flex-shrink-0"
              style={{ background: c.color }}
            >
              {checking === c.id
                ? <Loader2 size={22} className="animate-spin" />
                : c.name.charAt(0).toUpperCase()
              }
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

      <p className="mt-4 text-white/20 text-xs text-center">
        Votre choix est mémorisé — pas de mot de passe requis
      </p>
    </div>
  )
}
