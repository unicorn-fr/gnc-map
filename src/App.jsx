import { useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { supabase, isMisconfigured } from './lib/supabase'
import LoginPage from './components/LoginPage'
import MapView from './components/MapView'

const LS_COMMERCIAL = 'atlas_commercial'
const LS_UNLOCKED = 'atlas_unlocked'

function SetupError() {
  return (
    <div className="min-h-full bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
        <div className="text-4xl mb-4 text-center">⚙️</div>
        <h1 className="text-xl font-bold text-gray-900 text-center mb-2">Configuration manquante</h1>
        <p className="text-gray-500 text-sm text-center mb-6">
          Les variables d'environnement Supabase ne sont pas configurées.
        </p>
        <div className="bg-slate-900 rounded-2xl p-4 text-sm font-mono text-green-400 space-y-1">
          <p className="text-slate-400 text-xs mb-2"># Variables à ajouter dans Vercel</p>
          <p>VITE_SUPABASE_URL</p>
          <p>VITE_SUPABASE_ANON_KEY</p>
          <p>VITE_ACCESS_CODE</p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [commercial, setCommercial] = useState(null)
  const [unlocked, setUnlocked] = useState(false)
  const [loading, setLoading] = useState(true)
  const [installPrompt, setInstallPrompt] = useState(null)

  useEffect(() => {
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)

    if (isMisconfigured) { setLoading(false); return }

    // Vérifier si déjà déverrouillé et si un commercial est mémorisé
    const isUnlocked = localStorage.getItem(LS_UNLOCKED) === '1'
    if (isUnlocked) {
      setUnlocked(true)
      try {
        const saved = JSON.parse(localStorage.getItem(LS_COMMERCIAL) || 'null')
        if (saved) setCommercial(saved)
      } catch {}
    }
    setLoading(false)

    return () => window.removeEventListener('beforeinstallprompt', handler)
  }, [])

  const handleSelect = (c) => {
    localStorage.setItem(LS_COMMERCIAL, JSON.stringify(c))
    setCommercial(c)
  }

  const handleCodeValid = () => {
    localStorage.setItem(LS_UNLOCKED, '1')
    setUnlocked(true)
  }

  const handleLogout = () => {
    localStorage.removeItem(LS_COMMERCIAL)
    localStorage.removeItem(LS_UNLOCKED)
    setCommercial(null)
    setUnlocked(false)
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
        : <LoginPage
            onSelect={(c) => { handleCodeValid(); handleSelect(c) }}
            onCodeValid={handleCodeValid}
            installPrompt={installPrompt}
            onInstalled={() => setInstallPrompt(null)}
            startAtPick={unlocked}
          />
      }
    </>
  )
}
