import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'

const PREF_KEY = 'gnc_nav_pref'

export default function VoiceNavModal({ site, onClose }) {
  const [phase, setPhase] = useState('idle') // idle | speaking | listening
  const recogRef = useRef(null)

  const openWaze = () => {
    localStorage.setItem(PREF_KEY, 'waze')
    window.open(`https://waze.com/ul?ll=${site.lat},${site.lng}&navigate=yes`, '_blank', 'noopener')
    onClose()
  }

  const openGMaps = () => {
    localStorage.setItem(PREF_KEY, 'gmaps')
    window.open(`https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lng}`, '_blank', 'noopener')
    onClose()
  }

  const startListening = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    const recog = new SR()
    recog.lang = 'fr-FR'
    recog.maxAlternatives = 5
    recog.onstart = () => setPhase('listening')
    recog.onresult = (e) => {
      const texts = Array.from(e.results[0]).map(r => r.transcript.toLowerCase())
      if (texts.some(t => t.includes('waze'))) { openWaze(); return }
      if (texts.some(t => t.includes('google') || t.includes('maps'))) { openGMaps(); return }
      setPhase('idle')
    }
    recog.onerror = () => setPhase('idle')
    recog.onend = () => setPhase(p => p === 'listening' ? 'idle' : p)
    recog.start()
    recogRef.current = recog
  }

  useEffect(() => {
    const hasSpeech = 'speechSynthesis' in window
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition

    if (!hasSpeech || !SR) return

    setPhase('speaking')
    const utt = new SpeechSynthesisUtterance('Waze ou Google Maps ?')
    utt.lang = 'fr-FR'
    utt.rate = 1.1
    utt.onend = () => startListening()
    window.speechSynthesis.speak(utt)

    return () => {
      window.speechSynthesis.cancel()
      recogRef.current?.abort()
    }
  }, [])

  return (
    <div
      className="fixed inset-0 flex items-end justify-center"
      style={{ zIndex: 3500, background: 'rgba(0,0,0,0.55)' }}
      onClick={onClose}
    >
      <div
        className="bg-white rounded-t-3xl w-full max-w-sm p-6 pb-10"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-1">
          <p className="font-bold text-gray-900 text-base flex-1 pr-2 leading-snug">{site.name}</p>
          <button onClick={onClose} className="p-1.5 hover:bg-gray-100 rounded-xl -mr-1">
            <X size={17} className="text-gray-400" />
          </button>
        </div>

        <p className="text-sm mb-6 flex items-center gap-2" style={{ color: phase === 'listening' ? '#DC2626' : '#6B7280' }}>
          {phase === 'speaking' && '🔊 Écoute…'}
          {phase === 'listening' && (
            <><span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />Je vous écoute — dites Waze ou Google Maps</>
          )}
          {phase === 'idle' && 'Ouvrir avec…'}
        </p>

        <div className="flex gap-3">
          <button
            onClick={openWaze}
            className="flex-1 py-5 bg-[#05C8F7] hover:bg-[#00b4de] active:scale-95 text-white rounded-2xl font-extrabold text-lg transition-all shadow-lg"
          >
            🚗 Waze
          </button>
          <button
            onClick={openGMaps}
            className="flex-1 py-5 bg-[#4285F4] hover:bg-[#3574e2] active:scale-95 text-white rounded-2xl font-extrabold text-lg transition-all shadow-lg"
          >
            🗺️ Maps
          </button>
        </div>

        {localStorage.getItem(PREF_KEY) && (
          <button
            onClick={() => { localStorage.removeItem(PREF_KEY) }}
            className="w-full mt-4 text-xs text-gray-300 hover:text-gray-500 py-1"
          >
            Réinitialiser la préférence de navigation
          </button>
        )}
      </div>
    </div>
  )
}
