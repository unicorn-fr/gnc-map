import { useEffect, useRef, useMemo } from 'react'
import SpeechRecognition, { useSpeechRecognition } from 'react-speech-recognition'
import { X, Mic, MicOff, MapPin } from 'lucide-react'
import { firstName } from '../lib/utils'

const norm = s => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

function scoreVoice(site, q, commName) {
  if (!q) return 0
  const words = q.split(/\s+/).filter(w => w.length > 1)
  let total = 0
  for (const [raw, w] of [
    [site.name, 12], [site.company, 10], [site.city, 7], [site.address, 4], [site.notes, 2],
  ]) {
    const v = norm(raw)
    if (!v) continue
    if (v === q) { total += w * 10; continue }
    if (v.startsWith(q)) { total += w * 6; continue }
    if (v.includes(q)) { total += w * 3; continue }
    for (const word of words) if (v.includes(word)) total += w
  }
  const cn = norm(commName)
  if (cn && words.some(w => cn.includes(w))) total += 5
  return total
}

const BADGE = {
  prospect: { label: 'Prospect', bg: '#F3F4F6', color: '#6B7280' },
  client:   { label: 'Client',   bg: '#D1FAE5', color: '#065F46' },
  en_cours: { label: 'En cours', bg: '#DBEAFE', color: '#1D4ED8' },
  termine:  { label: 'Terminé',  bg: '#F1F5F9', color: '#64748B' },
}

export default function VoiceSearchModal({ sites, allCommercials, getColor, onSelectSite, onClose }) {
  const {
    transcript,
    listening,
    resetTranscript,
    browserSupportsSpeechRecognition,
  } = useSpeechRecognition()

  const commercialMap = useMemo(() => {
    const m = {}
    allCommercials.forEach(c => { m[c.id] = c })
    return m
  }, [allCommercials])

  const silenceTimer = useRef(null)
  const canAutoStop  = useRef(false)

  // Démarrer l'écoute dès l'ouverture — continuous:true pour rester ouvert
  useEffect(() => {
    resetTranscript()
    canAutoStop.current = false
    SpeechRecognition.startListening({ language: 'fr-FR', continuous: true })
    // 2 s minimum avant de pouvoir auto-stopper (temps pour commencer à parler)
    const minTimer = setTimeout(() => { canAutoStop.current = true }, 2000)
    return () => {
      clearTimeout(minTimer)
      clearTimeout(silenceTimer.current)
      SpeechRecognition.stopListening()
    }
  }, [])

  // Auto-stopper 1,5 s après que le transcript arrête de changer
  useEffect(() => {
    if (!transcript || !listening) return
    clearTimeout(silenceTimer.current)
    silenceTimer.current = setTimeout(() => {
      if (canAutoStop.current) SpeechRecognition.stopListening()
    }, 1500)
  }, [transcript, listening])

  const results = useMemo(() => {
    const q = norm(transcript)
    if (!q || q.length < 2) return []
    return sites
      .filter(s => !s.deleted)
      .map(s => ({ site: s, sc: scoreVoice(s, q, commercialMap[s.commercial_id]?.name ?? '') }))
      .filter(r => r.sc > 0)
      .sort((a, b) => b.sc - a.sc)
      .slice(0, 8)
      .map(r => r.site)
  }, [transcript, sites, commercialMap])

  const handleSelect = (site) => {
    SpeechRecognition.stopListening()
    onSelectSite(site)
    onClose()
  }

  const handleRetry = () => {
    resetTranscript()
    canAutoStop.current = false
    clearTimeout(silenceTimer.current)
    SpeechRecognition.startListening({ language: 'fr-FR', continuous: true })
    setTimeout(() => { canAutoStop.current = true }, 2000)
  }

  const hasTranscript = transcript.trim().length > 0
  const showResults  = hasTranscript && !listening

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 3500,
        background: 'rgba(15,23,42,0.88)', backdropFilter: 'blur(6px)',
        display: 'flex', flexDirection: 'column',
      }}
      onClick={onClose}
    >
      {/* Panneau haut */}
      <div
        style={{ background: 'white', borderRadius: '0 0 28px 28px', paddingBottom: 20 }}
        onClick={e => e.stopPropagation()}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 16px 0' }}>
          <p style={{ fontWeight: 700, fontSize: 16, color: '#111827', margin: 0 }}>Recherche vocale</p>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 6 }}>
            <X size={20} color="#9CA3AF" />
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '24px 16px 12px' }}>

          {!browserSupportsSpeechRecognition ? (
            <p style={{ color: '#EF4444', fontSize: 14, textAlign: 'center' }}>
              Votre navigateur ne supporte pas la reconnaissance vocale.<br />
              Utilisez Chrome (Android) ou Safari (iPhone).
            </p>
          ) : (
            <>
              {/* Bouton micro — tap pour démarrer / arrêter */}
              <button
                onClick={listening
                  ? () => SpeechRecognition.stopListening()
                  : handleRetry
                }
                style={{
                  width: 80, height: 80, borderRadius: '50%',
                  border: 'none', cursor: 'pointer',
                  background: listening ? '#EF4444' : '#1D4ED8',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  boxShadow: listening ? 'none' : '0 6px 24px rgba(29,78,216,0.4)',
                  animation: listening ? 'micPulse 1s ease-in-out infinite' : 'none',
                  transition: 'background 0.2s',
                }}
              >
                {listening
                  ? <MicOff size={34} color="white" strokeWidth={2} />
                  : <Mic    size={34} color="white" strokeWidth={2} />
                }
              </button>

              <p style={{
                marginTop: 16, fontSize: 15, fontWeight: 600, textAlign: 'center', minHeight: 24,
                color: listening ? '#EF4444' : hasTranscript ? '#111827' : '#6B7280',
              }}>
                {listening && !transcript && 'Je vous écoute…'}
                {listening && transcript  && transcript}
                {!listening && !hasTranscript && 'Appuyez pour parler'}
                {!listening && hasTranscript && transcript}
              </p>

              {showResults && (
                <button
                  onClick={handleRetry}
                  style={{
                    marginTop: 4, padding: '5px 16px', background: '#F3F4F6',
                    border: 'none', borderRadius: 20, cursor: 'pointer',
                    fontSize: 12, color: '#374151', fontWeight: 500,
                  }}
                >
                  🔄 Réessayer
                </button>
              )}
            </>
          )}
        </div>
      </div>

      {/* Résultats */}
      {showResults && results.length > 0 && (
        <div style={{ overflowY: 'auto', flex: 1, marginTop: 10 }} onClick={e => e.stopPropagation()}>
          <p style={{ textAlign: 'center', color: '#93C5FD', fontSize: 13, fontWeight: 600, marginBottom: 6 }}>
            {results.length === 1 ? '1 résultat' : `${results.length} résultats — choisissez :`}
          </p>
          <div style={{ background: 'white', borderRadius: 20, overflow: 'hidden' }}>
            {results.map((site, idx) => {
              const comm  = commercialMap[site.commercial_id]
              const color = getColor(site.commercial_id)
              const badge = BADGE[site.status]
              return (
                <button
                  key={site.id}
                  onClick={() => handleSelect(site)}
                  style={{
                    width: '100%', display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 16px', background: 'none', border: 'none', cursor: 'pointer',
                    borderBottom: idx < results.length - 1 ? '1px solid #F3F4F6' : 'none',
                    textAlign: 'left',
                  }}
                >
                  <div style={{
                    width: 44, height: 44, borderRadius: 13, background: color,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    flexShrink: 0, fontSize: 22,
                  }}>
                    {site.type === 'siege' ? '🏢' : '🏗️'}
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <p style={{ fontWeight: 700, fontSize: 14, color: '#111827', margin: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {site.name}
                    </p>
                    {site.company && site.company !== site.name && (
                      <p style={{ fontSize: 12, color: '#6B7280', margin: 0 }}>{site.company}</p>
                    )}
                    {site.city && (
                      <p style={{ fontSize: 11, color: '#9CA3AF', margin: '2px 0 0', display: 'flex', alignItems: 'center', gap: 3 }}>
                        <MapPin size={10} />{[site.postcode, site.city].filter(Boolean).join(' ')}
                      </p>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4, flexShrink: 0 }}>
                    {badge && (
                      <span style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 99, background: badge.bg, color: badge.color }}>
                        {badge.label}
                      </span>
                    )}
                    {comm && <span style={{ fontSize: 10, color: '#9CA3AF' }}>{firstName(comm.name)}</span>}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {showResults && hasTranscript && results.length === 0 && (
        <div
          style={{ background: 'white', margin: '10px 16px', borderRadius: 20, padding: '24px 16px', textAlign: 'center' }}
          onClick={e => e.stopPropagation()}
        >
          <p style={{ fontSize: 28, margin: '0 0 8px' }}>🔍</p>
          <p style={{ fontWeight: 700, color: '#374151', margin: 0 }}>Aucun résultat pour « {transcript} »</p>
          <button onClick={handleRetry} style={{ marginTop: 14, padding: '10px 24px', background: '#1D4ED8', color: 'white', border: 'none', borderRadius: 14, cursor: 'pointer', fontWeight: 600, fontSize: 14 }}>
            Réessayer
          </button>
        </div>
      )}

      <style>{`
        @keyframes micPulse {
          0%   { box-shadow: 0 0 0 0   rgba(239,68,68,0.5); }
          70%  { box-shadow: 0 0 0 20px rgba(239,68,68,0);  }
          100% { box-shadow: 0 0 0 0   rgba(239,68,68,0);   }
        }
      `}</style>
    </div>
  )
}
