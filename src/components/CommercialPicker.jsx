import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { firstName } from '../lib/utils'
import { MapPin, Loader2 } from 'lucide-react'

export default function CommercialPicker({ onSelect }) {
  const [commercials, setCommercials] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase
      .from('commercials')
      .select('*')
      .order('created_at')
      .then(({ data }) => {
        if (data) setCommercials(data)
        setLoading(false)
      })
  }, [])

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

      {/* Prompt */}
      <div className="mb-6 text-center">
        <p className="text-white/60 text-sm font-medium uppercase tracking-widest">
          Qui êtes-vous ?
        </p>
      </div>

      {/* Commercial cards */}
      {loading ? (
        <div className="flex items-center gap-2 text-white/50">
          <Loader2 size={18} className="animate-spin" />
          Chargement...
        </div>
      ) : (
        <div className="flex flex-col gap-4 w-full max-w-sm">
          {commercials.map((c) => (
            <button
              key={c.id}
              onClick={() => onSelect(c)}
              className="group flex items-center gap-4 bg-white/10 hover:bg-white/20 active:scale-98 backdrop-blur border border-white/10 hover:border-white/30 rounded-2xl px-6 py-5 transition-all duration-200 shadow-lg hover:shadow-xl"
            >
              {/* Avatar */}
              <div
                className="w-14 h-14 rounded-2xl flex items-center justify-center text-white font-extrabold text-xl shadow-md flex-shrink-0"
                style={{ background: c.color }}
              >
                {c.name.charAt(0).toUpperCase()}
              </div>

              {/* Name */}
              <div className="flex-1 text-left">
                <p className="text-white font-bold text-lg leading-tight">{firstName(c.name)}</p>
                <p className="text-white/40 text-sm mt-0.5">Appuyer pour accéder</p>
              </div>

              {/* Arrow */}
              <div className="text-white/30 group-hover:text-white/70 transition-colors">
                →
              </div>
            </button>
          ))}
        </div>
      )}

      {commercials.length === 0 && !loading && (
        <div className="text-center text-white/50 max-w-xs">
          <p className="text-lg mb-2">⚠️ Aucun commercial trouvé</p>
          <p className="text-sm">
            Exécutez le script SQL dans Supabase pour initialiser la base de données.
          </p>
        </div>
      )}

      <p className="mt-12 text-white/20 text-xs text-center">
        Votre choix est mémorisé — pas de mot de passe requis
      </p>
    </div>
  )
}
