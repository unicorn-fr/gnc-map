import { useState, useEffect } from 'react'
import { Download, Share, X } from 'lucide-react'

// Détecte si l'app tourne déjà en mode installé
const isStandalone = () =>
  window.matchMedia('(display-mode: standalone)').matches ||
  window.navigator.standalone === true

// Détecte iOS Safari
const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) && !window.MSStream

export default function InstallBanner({ installPrompt, onInstalled }) {
  const [show, setShow] = useState(false)
  const [showIOSGuide, setShowIOSGuide] = useState(false)
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (isStandalone()) return  // déjà installée
    if (dismissed) return
    if (isIOS() || installPrompt) setShow(true)
  }, [installPrompt, dismissed])

  if (!show || isStandalone()) return null

  const handleInstall = async () => {
    if (isIOS()) {
      setShowIOSGuide(true)
      return
    }
    if (!installPrompt) return
    installPrompt.prompt()
    const { outcome } = await installPrompt.userChoice
    if (outcome === 'accepted') {
      onInstalled?.()
      setShow(false)
    }
  }

  return (
    <>
      {/* Bannière d'installation */}
      <div className="w-full max-w-sm mt-6 bg-white/10 border border-white/20 rounded-2xl px-4 py-3.5 flex items-center gap-3">
        <div className="flex-1">
          <p className="text-white font-semibold text-sm">Installer l'application</p>
          <p className="text-white/50 text-xs mt-0.5">
            {isIOS()
              ? 'Ajoutez Atlas à votre écran d\'accueil'
              : 'Accès direct depuis votre téléphone'}
          </p>
        </div>
        <button
          onClick={handleInstall}
          className="flex items-center gap-1.5 bg-white text-blue-950 font-bold text-xs rounded-xl px-3 py-2 hover:bg-blue-50 transition-colors flex-shrink-0"
        >
          {isIOS() ? <Share size={13} /> : <Download size={13} />}
          {isIOS() ? 'Voir comment' : 'Installer'}
        </button>
        <button
          onClick={() => { setShow(false); setDismissed(true) }}
          className="text-white/30 hover:text-white/60 transition-colors flex-shrink-0"
        >
          <X size={16} />
        </button>
      </div>

      {/* Guide iOS */}
      {showIOSGuide && (
        <div className="fixed inset-0 flex items-end justify-center p-4 pb-8" style={{ zIndex: 3000, background: 'rgba(0,0,0,0.7)' }}>
          <div className="bg-white rounded-3xl shadow-2xl p-6 w-full max-w-sm">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-gray-900 text-lg">Installer sur iPhone / iPad</h3>
              <button onClick={() => setShowIOSGuide(false)} className="p-1.5 hover:bg-gray-100 rounded-xl">
                <X size={18} className="text-gray-400" />
              </button>
            </div>
            <ol className="space-y-4">
              <li className="flex gap-3 items-start">
                <span className="bg-blue-100 text-blue-700 font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-sm">1</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Appuyez sur le bouton Partager</p>
                  <p className="text-xs text-gray-500 mt-0.5">L'icône <strong>⬆</strong> dans la barre du bas de Safari</p>
                </div>
              </li>
              <li className="flex gap-3 items-start">
                <span className="bg-blue-100 text-blue-700 font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-sm">2</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Faites défiler et appuyez sur</p>
                  <p className="text-sm font-bold text-blue-700 mt-0.5">« Sur l'écran d'accueil »</p>
                </div>
              </li>
              <li className="flex gap-3 items-start">
                <span className="bg-blue-100 text-blue-700 font-bold w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 text-sm">3</span>
                <div>
                  <p className="text-sm font-semibold text-gray-800">Confirmez avec « Ajouter »</p>
                  <p className="text-xs text-gray-500 mt-0.5">Atlas apparaîtra comme une vraie app</p>
                </div>
              </li>
            </ol>
            <button
              onClick={() => setShowIOSGuide(false)}
              className="w-full mt-5 py-3 bg-blue-700 text-white rounded-2xl font-semibold text-sm"
            >
              Compris !
            </button>
          </div>
        </div>
      )}
    </>
  )
}
