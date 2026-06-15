import { useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { supabase, isMisconfigured } from './lib/supabase'
import { COMMERCIALS } from './lib/commercials'
import LoginPage from './components/LoginPage'
import MapView from './components/MapView'

const LS_COMMERCIAL = 'atlas_commercial'

function SetupError() {
  return (
    <div className="min-h-full bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
        <div className="text-4xl mb-4 text-center">⚙️</div>
        <h1 className="text-xl font-bold text-gray-900 text-center mb-2">Configuration manquante</h1>
        <p className="text-gray-500 text-sm text-center mb-6">
          Les variables d'environnement Supabase ne sont pas configurées.
        </p>
        <div className="bg-slate-900 rounded-2xl p-4 text-sm font-mono text-green-400 space-y-1 mb-6">
          <p className="text-slate-400 text-xs mb-2"># Variables à ajouter dans Vercel</p>
          <p>VITE_SUPABASE_URL</p>
          <p>VITE_SUPABASE_ANON_KEY</p>
        </div>
      </div>
    </div>
  )
}

function mergeWithLocal(c) {
  const ref = COMMERCIALS.find(k => k.id === c.id)
  return { ...c, color: ref?.color ?? c.color ?? '#6B7280', name: ref?.name ?? c.name }
}

export default function App() {
  const [commercial, setCommercial] = useState(null)
  const [loading, setLoading] = useState(true)
  const [installPrompt, setInstallPrompt] = useState(null)

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)

    if (isMisconfigured) { setLoading(false); return }

    // Vérifier la session Supabase existante
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (session) {
        // Essayer le cache local d'abord pour afficher immédiatement
        try {
          const cached = JSON.parse(localStorage.getItem(LS_COMMERCIAL) || 'null')
          if (cached) { setCommercial(cached); setLoading(false) }
        } catch {}
        // Rafraîchir depuis la DB en arrière-plan
        await fetchCommercial(session.user.id)
      }
      setLoading(false)
    })

    // Écouter les changements d'auth (login / logout)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (event, session) => {
      if (event === 'SIGNED_IN' && session) {
        setLoading(true)
        await fetchCommercial(session.user.id)
        setLoading(false)
      } else if (event === 'SIGNED_OUT') {
        localStorage.removeItem(LS_COMMERCIAL)
        setCommercial(null)
      }
    })

    return () => {
      subscription.unsubscribe()
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const fetchCommercial = async (userId) => {
    const { data } = await supabase
      .from('commercials')
      .select('*')
      .eq('user_id', userId)
      .single()
    if (data) {
      const c = mergeWithLocal(data)
      setCommercial(c)
      try { localStorage.setItem(LS_COMMERCIAL, JSON.stringify(c)) } catch {}
    }
  }

  const handleLogout = async () => {
    await supabase.auth.signOut()
    localStorage.removeItem(LS_COMMERCIAL)
    setCommercial(null)
  }

  if (isMisconfigured) return <SetupError />

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full" style={{ background: '#0f172a' }}>
        <div className="animate-pulse text-5xl mb-5">🗺️</div>
        <div className="text-white text-2xl font-extrabold tracking-tight">Atlas</div>
        <div className="text-blue-400 text-sm mt-1 font-medium">Espace professionnel</div>
        <div className="flex gap-2 mt-10">
          {[0, 150, 300].map(delay => (
            <div key={delay} className="w-2.5 h-2.5 rounded-full bg-blue-500 animate-bounce"
              style={{ animationDelay: `${delay}ms` }} />
          ))}
        </div>
      </div>
    )
  }

  return (
    <>
      <Toaster position="top-center" toastOptions={{ duration: 3000, style: { borderRadius: '12px', fontSize: '14px' } }} />
      {commercial
        ? <MapView commercial={commercial} onSwitch={handleLogout} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)} />
        : <LoginPage installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)} />
      }
    </>
  )
}
