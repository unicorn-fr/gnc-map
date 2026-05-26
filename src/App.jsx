import { useEffect, useState, useRef } from 'react'
import { Toaster } from 'react-hot-toast'
import { supabase, isMisconfigured } from './lib/supabase'
import { checkAndClaimSession, heartbeat, endSession, clearLocalToken } from './lib/session'
import CommercialPicker from './components/CommercialPicker'
import MapView from './components/MapView'
import PasswordGate, { validToken } from './components/PasswordGate'

// Écran affiché si les variables d'environnement Supabase sont absentes
function SetupError() {
  return (
    <div className="min-h-full bg-slate-900 flex items-center justify-center p-6">
      <div className="bg-white rounded-3xl shadow-2xl max-w-md w-full p-8">
        <div className="text-4xl mb-4 text-center">⚙️</div>
        <h1 className="text-xl font-bold text-gray-900 text-center mb-2">
          Configuration manquante
        </h1>
        <p className="text-gray-500 text-sm text-center mb-6">
          Les variables d'environnement Supabase ne sont pas configurées dans Vercel.
        </p>

        <div className="bg-slate-900 rounded-2xl p-4 text-sm font-mono text-green-400 space-y-1 mb-6">
          <p className="text-slate-400 text-xs mb-2"># Variables à ajouter dans Vercel</p>
          <p>VITE_SUPABASE_URL</p>
          <p>SUPABASE_ANON_KEY</p>
          <p>SUPABASE_JWT_SECRET</p>
          <p>APP_PASSWORD</p>
        </div>

        <ol className="text-sm text-gray-600 space-y-3">
          <li className="flex gap-2">
            <span className="bg-blue-100 text-blue-700 font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs">1</span>
            <span>Allez sur <strong>vercel.com</strong> → votre projet <strong>gnc-map</strong></span>
          </li>
          <li className="flex gap-2">
            <span className="bg-blue-100 text-blue-700 font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs">2</span>
            <span>Onglet <strong>Settings</strong> → <strong>Environment Variables</strong></span>
          </li>
          <li className="flex gap-2">
            <span className="bg-blue-100 text-blue-700 font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs">3</span>
            <span>Ajoutez les deux variables avec vos valeurs Supabase</span>
          </li>
          <li className="flex gap-2">
            <span className="bg-blue-100 text-blue-700 font-bold w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0 text-xs">4</span>
            <span>Onglet <strong>Deployments</strong> → <strong>Redeploy</strong></span>
          </li>
        </ol>

        <div className="mt-6 bg-amber-50 border border-amber-200 rounded-xl p-3">
          <p className="text-xs text-amber-700">
            ⚠️ <code>SUPABASE_JWT_SECRET</code> se trouve dans Supabase → Settings → API → JWT Settings.
          </p>
        </div>
      </div>
    </div>
  )
}

export default function App() {
  const [unlocked, setUnlocked] = useState(() => validToken())
  const [commercial, setCommercial] = useState(null)
  const [loading, setLoading] = useState(true)
  const [installPrompt, setInstallPrompt] = useState(null)
  const heartbeatRef = useRef(null)

  useEffect(() => {
    // Capturer l'événement d'installation PWA avant qu'il ne soit auto-masqué
    const handler = (e) => { e.preventDefault(); setInstallPrompt(e) }
    window.addEventListener('beforeinstallprompt', handler)

    if (isMisconfigured) { setLoading(false); return }

    const saved = localStorage.getItem('gnc_commercial')
    if (saved) {
      try {
        const c = JSON.parse(saved)
        // Afficher la carte immédiatement — ne pas attendre Supabase (cold start = 30 s)
        setCommercial(c)
        setLoading(false)
        // Réclamer la session en arrière-plan sans bloquer l'affichage
        checkAndClaimSession(c.id)
          .then(() => startHeartbeat(c.id))
          .catch(() => {})
      } catch {
        localStorage.removeItem('gnc_commercial')
        setLoading(false)
      }
    } else {
      setLoading(false)
    }

    return () => {
      stopHeartbeat()
      window.removeEventListener('beforeinstallprompt', handler)
    }
  }, [])

  const startHeartbeat = (commercialId) => {
    stopHeartbeat()
    heartbeatRef.current = setInterval(() => heartbeat(commercialId), 60_000)
  }

  const stopHeartbeat = () => {
    if (heartbeatRef.current) clearInterval(heartbeatRef.current)
  }

  if (!unlocked) return <PasswordGate onUnlock={() => setUnlocked(true)} />

  if (isMisconfigured) return <SetupError />

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-900">
        <div className="text-4xl mb-3">🗺️</div>
        <div className="text-white text-xl font-bold">GNC Map</div>
      </div>
    )
  }

  const handleSelect = (c) => {
    localStorage.setItem('gnc_commercial', JSON.stringify(c))
    setCommercial(c)
    startHeartbeat(c.id)
  }

  const handleSwitch = async () => {
    if (commercial) await endSession(commercial.id)
    stopHeartbeat()
    localStorage.removeItem('gnc_commercial')
    setCommercial(null)
  }

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{ duration: 3000, style: { borderRadius: '12px', fontSize: '14px' } }}
      />
      {commercial
        ? <MapView commercial={commercial} onSwitch={handleSwitch} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)} />
        : <CommercialPicker onSelect={handleSelect} installPrompt={installPrompt} onInstalled={() => setInstallPrompt(null)} />
      }
    </>
  )
}
