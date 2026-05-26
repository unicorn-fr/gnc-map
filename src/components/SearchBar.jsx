import { useState, useMemo, useRef, useEffect } from 'react'
import { Search, X, MapPin, Mic, MicOff } from 'lucide-react'
import { firstName } from '../lib/utils'

const norm = s => (s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim()

const STATUS_NORM = {
  prospect: 'prospect',
  client:   'client',
  en_cours: 'en cours encours',
  termine:  'termine fini',
}

const TYPE_NORM = {
  siege:    'siege social bureau',
  chantier: 'chantier travaux',
}

function scoreSite(site, q, commercialName) {
  if (!q) return -1
  const words = q.split(/\s+/).filter(w => w.length > 0)
  let total = 0

  const fields = [
    [site.name,    12],
    [site.company, 10],
    [site.city,     7],
    [site.postcode, 6],
    [site.address,  4],
    [site.notes,    2],
  ]

  for (const [raw, w] of fields) {
    const v = norm(raw)
    if (!v) continue
    if (v === q)         { total += w * 10; continue }
    if (v.startsWith(q)) { total += w * 6;  continue }
    if (v.includes(q))   { total += w * 3;  continue }
    for (const word of words) if (word.length > 1 && v.includes(word)) total += w
  }

  const cn = norm(commercialName)
  if (cn && (cn.includes(q) || words.some(w => w.length > 1 && cn.includes(w)))) total += 5

  const sl = norm(STATUS_NORM[site.status] ?? '')
  if (sl.includes(q) || words.some(w => w.length > 2 && sl.includes(w))) total += 6

  const tl = norm(TYPE_NORM[site.type] ?? '')
  if (tl.includes(q) || words.some(w => w.length > 3 && tl.includes(w))) total += 4

  return total
}

const STATUS_BADGE = {
  prospect: { label: 'Prospect',  cls: 'bg-gray-100 text-gray-500' },
  client:   { label: 'Client',    cls: 'bg-green-100 text-green-700' },
  en_cours: { label: 'En cours',  cls: 'bg-blue-100 text-blue-700' },
  termine:  { label: 'Terminé',   cls: 'bg-slate-100 text-slate-500' },
}

export default function SearchBar({ sites, allCommercials, getColor, onSelectSite, onClose, autoVoice }) {
  const [query, setQuery] = useState('')
  const [listening, setListening] = useState(false)
  const inputRef = useRef(null)
  const recogRef = useRef(null)

  useEffect(() => {
    if (autoVoice) {
      // Court délai pour laisser le composant s'afficher avant de démarrer
      const t = setTimeout(startVoice, 300)
      return () => clearTimeout(t)
    } else {
      inputRef.current?.focus()
    }
  }, [])

  useEffect(() => {
    const fn = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', fn)
    return () => window.removeEventListener('keydown', fn)
  }, [onClose])

  const startVoice = () => {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) {
      inputRef.current?.focus()
      return
    }
    const recog = new SR()
    recog.lang = 'fr-FR'
    recog.interimResults = false
    recog.maxAlternatives = 3
    recog.onstart = () => setListening(true)
    recog.onresult = (e) => {
      const transcript = e.results[0][0].transcript
      setQuery(transcript)
      setListening(false)
    }
    recog.onerror = () => { setListening(false); inputRef.current?.focus() }
    recog.onend = () => setListening(false)
    recog.start()
    recogRef.current = recog
  }

  const stopVoice = () => {
    recogRef.current?.stop()
    setListening(false)
  }

  const commercialMap = useMemo(() => {
    const m = {}
    allCommercials.forEach(c => { m[c.id] = c })
    return m
  }, [allCommercials])

  const results = useMemo(() => {
    const q = norm(query)
    if (q.length < 1) return []
    return sites
      .filter(s => !s.deleted)
      .map(s => {
        const commercial = commercialMap[s.commercial_id]
        return { site: s, score: scoreSite(s, q, commercial?.name ?? '') }
      })
      .filter(r => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 15)
      .map(r => r.site)
  }, [query, sites, commercialMap])

  const handleSelect = (site) => { onSelectSite(site); onClose() }

  return (
    <div
      className="fixed inset-0 flex flex-col"
      style={{ zIndex: 3000, background: 'rgba(15,23,42,0.7)', backdropFilter: 'blur(4px)' }}
    >
      {/* Barre de recherche */}
      <div className="bg-white shadow-2xl">
        <div className="flex items-center gap-2 px-3 pt-4 pb-3">
          <Search size={19} className="text-blue-600 flex-shrink-0" />
          <input
            ref={inputRef}
            type="search"
            inputMode="search"
            autoComplete="off"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={listening ? 'Je vous écoute…' : 'Entreprise, ville, adresse, commercial…'}
            className={`flex-1 text-gray-900 text-base outline-none bg-transparent ${listening ? 'placeholder-red-400' : 'placeholder-gray-400'}`}
          />

          {/* Bouton micro */}
          <button
            onPointerDown={e => { e.preventDefault(); listening ? stopVoice() : startVoice() }}
            className={`p-2 rounded-xl transition-colors flex-shrink-0 ${
              listening
                ? 'bg-red-500 text-white animate-pulse'
                : 'bg-gray-100 text-gray-500 hover:bg-blue-50 hover:text-blue-600'
            }`}
            title={listening ? 'Arrêter' : 'Dicter'}
          >
            {listening ? <MicOff size={17} /> : <Mic size={17} />}
          </button>

          {query && !listening ? (
            <button onClick={() => setQuery('')} className="p-1.5 hover:bg-gray-100 rounded-lg flex-shrink-0">
              <X size={16} className="text-gray-400" />
            </button>
          ) : null}

          <button
            onClick={onClose}
            className="ml-1 text-sm text-blue-600 hover:text-blue-800 font-semibold flex-shrink-0"
          >
            Annuler
          </button>
        </div>

        {/* Suggestions rapides */}
        {!query && !listening && (
          <div className="flex gap-2 px-4 pb-3 overflow-x-auto no-scrollbar">
            {['Prospect', 'Client', 'En cours', 'Chantier', 'Siège'].map(tag => (
              <button
                key={tag}
                onClick={() => setQuery(tag)}
                className="flex-shrink-0 text-xs bg-gray-100 hover:bg-blue-50 hover:text-blue-700 text-gray-600 font-medium px-3 py-1.5 rounded-full transition-colors"
              >
                {tag}
              </button>
            ))}
            {allCommercials.map(c => (
              <button
                key={c.id}
                onClick={() => setQuery(firstName(c.name))}
                className="flex-shrink-0 flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full transition-colors hover:opacity-80"
                style={{ background: c.color + '22', color: c.color }}
              >
                <span className="w-2 h-2 rounded-full flex-shrink-0" style={{ background: c.color }} />
                {firstName(c.name)}
              </button>
            ))}
          </div>
        )}

        {/* Indicateur d'écoute */}
        {listening && (
          <div className="flex items-center gap-2 px-4 pb-3">
            <span className="inline-block w-2 h-2 rounded-full bg-red-500 animate-pulse" />
            <span className="text-xs text-red-500 font-medium">Parlez maintenant…</span>
          </div>
        )}
      </div>

      {/* Résultats */}
      {results.length > 0 && (
        <div className="overflow-y-auto flex-1 max-h-[70vh]">
          <div className="bg-white shadow-xl mx-0">
            {results.map((site) => {
              const commercial = commercialMap[site.commercial_id]
              const color = getColor(site.commercial_id)
              const badge = STATUS_BADGE[site.status]
              return (
                <button
                  key={site.id}
                  onClick={() => handleSelect(site)}
                  className="w-full flex items-center gap-3 px-4 py-3.5 hover:bg-blue-50 active:bg-blue-100 border-b border-gray-100 last:border-0 text-left transition-colors"
                >
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 text-white font-bold text-sm"
                    style={{ background: color }}
                  >
                    {site.type === 'siege' ? '🏢' : '🏗️'}
                  </div>

                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-gray-900 text-sm truncate leading-tight">{site.name}</p>
                    {site.company && site.company !== site.name && (
                      <p className="text-gray-500 text-xs truncate">{site.company}</p>
                    )}
                    {(site.city || site.address) && (
                      <p className="text-gray-400 text-xs truncate mt-0.5 flex items-center gap-1">
                        <MapPin size={10} className="flex-shrink-0" />
                        {[site.address, site.postcode, site.city].filter(Boolean).join(' ')}
                      </p>
                    )}
                  </div>

                  <div className="flex flex-col items-end gap-1.5 flex-shrink-0">
                    {badge && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${badge.cls}`}>
                        {badge.label}
                      </span>
                    )}
                    {commercial && (
                      <span className="text-[10px] text-gray-400 font-medium">
                        {firstName(commercial.name)}
                      </span>
                    )}
                    {site.lat && (
                      <span className="text-[10px] text-blue-400">📍</span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      )}

      {/* Aucun résultat */}
      {query.trim().length >= 1 && results.length === 0 && !listening && (
        <div className="bg-white mx-4 mt-3 rounded-2xl shadow-lg p-6 text-center">
          <p className="text-2xl mb-2">🔍</p>
          <p className="text-gray-700 font-semibold text-sm">Aucun résultat</p>
          <p className="text-gray-400 text-xs mt-1">Essayez un autre nom, ville ou commercial</p>
        </div>
      )}

      <div className="flex-1" onClick={onClose} />
    </div>
  )
}
