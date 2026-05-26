import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react'
import ReactMap, { Marker } from 'react-map-gl/maplibre'
import { Menu, Plus, Navigation, X, Search, Layers, Mic } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { requestAndSubscribe } from '../lib/push'
import { firstName } from '../lib/utils'
import { COMMERCIALS } from '../lib/commercials'
import Sidebar from './Sidebar'
import SearchBar from './SearchBar'
import AddSiteModal from './AddSiteModal'
import SiteDetailPanel from './SiteDetailPanel'
import VoiceNavModal from './VoiceNavModal'
import ImportPage from './ImportPage'
import ReportsPage from './ReportsPage'
import InstallBanner from './InstallBanner'
import toast from 'react-hot-toast'

const STREET_STYLE = 'https://tiles.openfreemap.org/styles/bright'
const APP_CACHE_KEY = 'gnc_app_data_v1'
const NAV_PREF_KEY = 'gnc_nav_pref'

// Hauteur de la nav bar (px, hors safe-area). Doit correspondre au CSS.
const NAV_H = 64

function getCachedAppData() {
  try { return JSON.parse(localStorage.getItem(APP_CACHE_KEY) || 'null') } catch { return null }
}

function getSavedView() {
  try {
    const v = JSON.parse(localStorage.getItem('gnc_map_view') || 'null')
    if (v?.longitude && v?.latitude) return v
  } catch {}
  return null
}

const SATELLITE_STYLE = {
  version: 8,
  sources: {
    sat: {
      type: 'raster',
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      attribution: 'Tiles © Esri',
    },
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#e8e0d5' } },
    { id: 'sat', type: 'raster', source: 'sat' },
  ],
}

const SiteMarker = memo(function SiteMarker({ site, color, onSelect }) {
  return (
    <Marker
      longitude={site.lng}
      latitude={site.lat}
      anchor="bottom"
      onClick={(e) => { e.originalEvent.stopPropagation(); onSelect(site) }}
    >
      <div className="site-pin-wrap" style={{ background: color }}>
        <span className="site-pin-emoji">{site.type === 'siege' ? '🏢' : '🏗️'}</span>
      </div>
    </Marker>
  )
})

export default function MapView({ commercial, onSwitch, installPrompt, onInstalled }) {
  const [allCommercials, setAllCommercials] = useState(() => getCachedAppData()?.comms ?? COMMERCIALS)
  const [sites, setSites] = useState(() => (getCachedAppData()?.sites ?? []).filter(s => !s.deleted))
  const [selectedSite, setSelectedSite] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addPosition, setAddPosition] = useState(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showReports, setShowReports] = useState(false)
  const [showLocationHelp, setShowLocationHelp] = useState(false)
  const [userPosition, setUserPosition] = useState(null)
  const [visibleCommercials, setVisibleCommercials] = useState(() => {
    const cached = getCachedAppData()
    const comms = cached?.comms?.length ? cached.comms : COMMERCIALS
    return new Set(comms.map(c => c.id))
  })
  const [visibleTypes, setVisibleTypes] = useState(new Set(['siege', 'chantier']))
  const [flyTo, setFlyTo] = useState(null)
  const [mapStyle, setMapStyle] = useState('street')
  // showSearch: false | 'text' | 'voice'
  const [showSearch, setShowSearch] = useState(false)
  // voiceNavSite: site object when voice nav modal is needed
  const [voiceNavSite, setVoiceNavSite] = useState(null)

  const mapRef = useRef(null)
  const watchIdRef = useRef(null)
  const pendingSiteIdRef = useRef(null)
  const selectedSiteRef = useRef(null)
  selectedSiteRef.current = selectedSite
  const sitesRef = useRef([])
  sitesRef.current = sites

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const siteId = params.get('site')
    if (siteId) {
      pendingSiteIdRef.current = siteId
      window.history.replaceState({}, '', '/')
    }

    loadAll()
    const cleanup = setupRealtime()
    const timer = setTimeout(startTracking, 100)
    requestAndSubscribe(commercial.id)

    if (navigator.serviceWorker?.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'PREWARM_STATIC' })
    } else {
      navigator.serviceWorker?.ready.then(reg => {
        reg.active?.postMessage({ type: 'PREWARM_STATIC' })
      })
    }

    const handleVisible = () => {
      if (document.visibilityState === 'visible') loadAll()
    }
    document.addEventListener('visibilitychange', handleVisible)

    const handleSWMessage = (event) => {
      if (event.data?.type !== 'OPEN_URL') return
      try {
        const siteId = new URLSearchParams(new URL(event.data.url).search).get('site')
        if (!siteId) return
        const target = sitesRef.current.find(s => s.id === siteId)
        if (target) {
          setSelectedSite(target)
          if (target.lat && target.lng) setFlyTo({ lat: target.lat, lng: target.lng })
        } else {
          pendingSiteIdRef.current = siteId
        }
      } catch {}
    }
    navigator.serviceWorker?.addEventListener('message', handleSWMessage)

    return () => {
      cleanup()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisible)
      navigator.serviceWorker?.removeEventListener('message', handleSWMessage)
      if (watchIdRef.current !== null) navigator.geolocation.clearWatch(watchIdRef.current)
    }
  }, [])

  useEffect(() => {
    if (!flyTo || !mapRef.current) return
    mapRef.current.flyTo({ center: [flyTo.lng, flyTo.lat], zoom: 15, duration: 1200 })
    setFlyTo(null)
  }, [flyTo])

  const startTracking = () => {
    if (!navigator.geolocation || watchIdRef.current !== null) return
    const hasSavedView = !!getSavedView()
    let firstFix = true
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        setUserPosition([lat, lng])
        localStorage.setItem('gnc_map_view', JSON.stringify({ latitude: lat, longitude: lng, zoom: 14 }))
        if (firstFix) {
          firstFix = false
          if (!hasSavedView) setFlyTo({ lat, lng })
          if (navigator.serviceWorker?.controller) {
            navigator.serviceWorker.controller.postMessage({ type: 'PREWARM_MAP', lat, lng })
          }
        }
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    )
  }

  const loadAll = useCallback(async () => {
    const [{ data: comms }, { data: sitesData }] = await Promise.all([
      supabase.from('commercials').select('*').order('created_at'),
      supabase.from('sites').select('*').order('created_at', { ascending: false }),
    ])
    if (comms) {
      setAllCommercials(comms)
      setVisibleCommercials(prev => {
        if (prev.size === 0) return new Set(comms.map(c => c.id))
        const next = new Set(prev)
        comms.forEach(c => { if (!prev.has(c.id)) next.add(c.id) })
        return next
      })
    }
    if (sitesData) {
      const fresh = sitesData.filter(s => !s.deleted)
      setSites(prev => {
        const prevMap = new Map(prev.map(s => [s.id, s]))
        return fresh.map(s => {
          const p = prevMap.get(s.id)
          return (p && p.updated_at === s.updated_at) ? p : s
        })
      })
    }
    if (comms && sitesData) {
      try { localStorage.setItem(APP_CACHE_KEY, JSON.stringify({ comms, sites: sitesData })) } catch {}
    }
  }, [])

  const setupRealtime = useCallback(() => {
    let channel = null
    let reconnectTimer = null

    const connect = () => {
      channel = supabase
        .channel('gnc-realtime-v3')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'sites' }, ({ eventType, new: newRow, old: oldRow }) => {
          if (eventType === 'INSERT') {
            if (!newRow.deleted) setSites(prev => prev.some(s => s.id === newRow.id) ? prev : [newRow, ...prev])
          } else if (eventType === 'UPDATE') {
            setSites(prev => newRow.deleted
              ? prev.filter(s => s.id !== newRow.id)
              : prev.map(s => s.id === newRow.id ? { ...s, ...newRow } : s)
            )
          } else if (eventType === 'DELETE') {
            setSites(prev => prev.filter(s => s.id !== oldRow?.id))
          }
        })
        .subscribe((status) => {
          if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
            clearTimeout(reconnectTimer)
            reconnectTimer = setTimeout(() => {
              if (channel) supabase.removeChannel(channel)
              connect()
            }, 3000)
          }
        })
    }

    connect()
    const poll = setInterval(loadAll, 15_000)
    return () => {
      clearTimeout(reconnectTimer)
      clearInterval(poll)
      if (channel) supabase.removeChannel(channel)
    }
  }, [loadAll])

  useEffect(() => {
    if (!pendingSiteIdRef.current || sites.length === 0) return
    const target = sites.find(s => s.id === pendingSiteIdRef.current)
    if (target) {
      pendingSiteIdRef.current = null
      setSelectedSite(target)
      if (target.lat && target.lng) setFlyTo({ lat: target.lat, lng: target.lng })
    }
  }, [sites])

  useEffect(() => {
    const cur = selectedSiteRef.current
    if (!cur) return
    const updated = sites.find(s => s.id === cur.id)
    if (!updated) {
      toast.error('Ce site a été supprimé par un autre utilisateur', { id: 'site-deleted' })
      setSelectedSite(null)
    } else if (updated !== cur) {
      setSelectedSite(updated)
    }
  }, [sites])

  const colorMap = useMemo(() => {
    const m = {}
    allCommercials.forEach(c => { m[c.id] = c.color })
    return m
  }, [allCommercials])

  const getColor = useCallback((id) => colorMap[id] ?? '#6B7280', [colorMap])
  const handleSelectSite = useCallback((site) => setSelectedSite(site), [])

  // Navigation vocale : ouvre directement si préférence mémorisée, sinon modal
  const handleVoiceNav = useCallback((site) => {
    if (!site?.lat) return
    const pref = localStorage.getItem(NAV_PREF_KEY)
    if (pref === 'waze') {
      window.open(`https://waze.com/ul?ll=${site.lat},${site.lng}&navigate=yes`, '_blank', 'noopener')
      return
    }
    if (pref === 'gmaps') {
      window.open(`https://www.google.com/maps/dir/?api=1&destination=${site.lat},${site.lng}`, '_blank', 'noopener')
      return
    }
    setVoiceNavSite(site)
  }, [])

  // Sélection depuis recherche vocale → ouvre directement le modal de navigation
  const handleVoiceSelectSite = useCallback((site) => {
    setSelectedSite(site)
    if (site.lat && site.lng) {
      setFlyTo({ lat: site.lat, lng: site.lng })
      handleVoiceNav(site)
    }
  }, [handleVoiceNav])

  const handleLocateMe = async () => {
    if (!navigator.geolocation) return toast.error('Géolocalisation non disponible sur cet appareil')
    if (userPosition) { setFlyTo({ lat: userPosition[0], lng: userPosition[1] }); return }
    if (navigator.permissions?.query) {
      try {
        const perm = await navigator.permissions.query({ name: 'geolocation' })
        if (perm.state === 'denied') { setShowLocationHelp(true); return }
      } catch {}
    }
    startTracking()
    toast.success('Localisation activée !', { id: 'locate' })
  }

  const handleAddHere = () => {
    setAddPosition(null)
    setShowAddModal(true)
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        setUserPosition([lat, lng])
        setAddPosition({ lat, lng })
      },
      () => {},
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const handleMapClick = useCallback((e) => {
    if (window.matchMedia('(max-width: 640px)').matches || 'ontouchstart' in window) return
    setAddPosition({ lat: e.lngLat.lat, lng: e.lngLat.lng })
    setShowAddModal(true)
  }, [])

  const filtered = useMemo(() =>
    sites.filter(s => s.lat && s.lng && visibleCommercials.has(s.commercial_id) && visibleTypes.has(s.type)),
    [sites, visibleCommercials, visibleTypes]
  )

  if (showImport) {
    return (
      <ImportPage
        commercials={allCommercials}
        onClose={() => setShowImport(false)}
        onImported={() => { loadAll(); setShowImport(false) }}
      />
    )
  }

  if (showReports) {
    return (
      <ReportsPage
        commercial={commercial}
        allCommercials={allCommercials}
        onClose={() => setShowReports(false)}
      />
    )
  }

  return (
    <div style={{ height: '100dvh' }} className="flex flex-col overflow-hidden">

      {/* Overlay recherche (text ou vocal) */}
      {showSearch && (
        <SearchBar
          sites={sites}
          allCommercials={allCommercials}
          getColor={getColor}
          autoVoice={showSearch === 'voice'}
          onSelectSite={(site) => {
            if (showSearch === 'voice') {
              handleVoiceSelectSite(site)
            } else {
              setSelectedSite(site)
              if (site.lat && site.lng) setFlyTo({ lat: site.lat, lng: site.lng })
            }
          }}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* Modal navigation vocale */}
      {voiceNavSite && (
        <VoiceNavModal
          site={voiceNavSite}
          onClose={() => setVoiceNavSite(null)}
        />
      )}

      {/* Barre du haut */}
      <div className="flex-shrink-0 bg-blue-950 text-white px-4 py-3 flex items-center gap-3 shadow-xl" style={{ zIndex: 1100 }}>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-base leading-tight tracking-tight">GNC Map</p>
          <p className="text-blue-300 text-xs">Groupe Nord Coffrage</p>
        </div>
        <button
          onClick={onSwitch}
          className="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-xl px-3 py-1.5 transition-colors flex-shrink-0"
        >
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
            style={{ background: commercial.color }}
          >
            {commercial.name.charAt(0).toUpperCase()}
          </div>
          <span className="text-white text-xs font-semibold">{firstName(commercial.name)}</span>
        </button>
      </div>

      {/* Zone carte — padding-bottom pour compenser la nav bar fixe */}
      <div
        className="flex-1 relative"
        style={{ minHeight: 0, paddingBottom: `calc(${NAV_H}px + env(safe-area-inset-bottom, 0px))` }}
      >

        {showSidebar && (
          <div className="absolute inset-0 flex" style={{ zIndex: 1200 }}>
            <Sidebar
              commercials={allCommercials}
              sites={sites}
              currentCommercialId={commercial.id}
              visibleCommercials={visibleCommercials}
              setVisibleCommercials={setVisibleCommercials}
              visibleTypes={visibleTypes}
              setVisibleTypes={setVisibleTypes}
              getColor={getColor}
              onClose={() => setShowSidebar(false)}
              onSelectSite={(site) => {
                setSelectedSite(site)
                if (site.lat && site.lng) setFlyTo({ lat: site.lat, lng: site.lng })
                setShowSidebar(false)
              }}
              onOpenImport={() => { setShowSidebar(false); setShowImport(true) }}
              onOpenReports={() => { setShowSidebar(false); setShowReports(true) }}
            />
            <div className="flex-1 bg-black/50 backdrop-blur-sm" onClick={() => setShowSidebar(false)} />
          </div>
        )}

        {showLocationHelp && (
          <div className="absolute inset-0 flex items-center justify-center p-4" style={{ zIndex: 2000, background: 'rgba(0,0,0,0.5)' }}>
            <div className="bg-white rounded-3xl shadow-2xl p-5 w-full max-w-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900 text-base">Localisation bloquée</h3>
                <button onClick={() => setShowLocationHelp(false)} className="p-1.5 hover:bg-gray-100 rounded-xl">
                  <X size={18} className="text-gray-400" />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-3">Votre navigateur bloque la localisation. Pour l'activer :</p>
              <ol className="text-sm text-gray-700 space-y-2 mb-4 list-decimal ml-4">
                <li><strong>iPhone / iPad :</strong> Réglages → Confidentialité → Service de localisation → Safari → Autoriser</li>
                <li><strong>Android Chrome :</strong> Appuyer sur 🔒 dans la barre d'adresse → Autorisation du site → Position</li>
              </ol>
              <button
                onClick={() => { setShowLocationHelp(false); setTimeout(handleLocateMe, 200) }}
                className="w-full py-3 bg-blue-700 text-white rounded-2xl font-semibold text-sm mb-2"
              >
                Réessayer
              </button>
              <button onClick={() => setShowLocationHelp(false)} className="w-full py-2 text-gray-400 text-sm">Fermer</button>
            </div>
          </div>
        )}

        {/* Carte MapLibre GL */}
        <ReactMap
          ref={mapRef}
          initialViewState={getSavedView() ?? { longitude: 5.9, latitude: 46.5, zoom: 9 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={mapStyle === 'satellite' ? SATELLITE_STYLE : STREET_STYLE}
          onClick={handleMapClick}
          attributionControl={false}
          pitchWithRotate={false}
          dragRotate={false}
          fadeDuration={0}
          localIdeographFontFamily="sans-serif"
          renderWorldCopies={false}
          maxTileCacheSize={500}
        >
          {userPosition && (
            <Marker longitude={userPosition[1]} latitude={userPosition[0]} anchor="center">
              <div style={{
                width: 18, height: 18, borderRadius: '50%',
                background: commercial.color,
                border: '3px solid white',
                boxShadow: `0 0 0 4px ${commercial.color}44`,
              }} />
            </Marker>
          )}
          {filtered.map(site => (
            <SiteMarker
              key={site.id}
              site={site}
              color={getColor(site.commercial_id)}
              onSelect={handleSelectSite}
            />
          ))}
        </ReactMap>

        {/* Légende commerciaux — haut gauche */}
        <div
          className="absolute top-3 left-3 bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg px-3 py-2 flex items-center gap-3"
          style={{ zIndex: 1000 }}
        >
          {allCommercials.map(c => (
            <div key={c.id} className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: c.color }} />
              <span className="text-[11px] font-semibold text-gray-700">{firstName(c.name)}</span>
            </div>
          ))}
        </div>

        {/* Panneau détail site */}
        {selectedSite && (
          <div
            className="absolute inset-y-0 right-0 w-full sm:w-96"
            style={{ zIndex: 1050 }}
          >
            <SiteDetailPanel
              site={selectedSite}
              commercial={allCommercials.find(c => c.id === selectedSite.commercial_id)}
              currentCommercial={commercial}
              currentCommercialId={commercial.id}
              color={getColor(selectedSite.commercial_id)}
              onClose={() => setSelectedSite(null)}
              onUpdated={(result) => {
                if (!result || result === true) {
                  // Site supprimé
                  setSites(prev => prev.filter(s => s.id !== selectedSite.id))
                  setSelectedSite(null)
                } else if (typeof result === 'object' && result.id) {
                  // Site mis à jour (ex: nouvelle position GPS)
                  setSites(prev => prev.map(s => s.id === result.id ? result : s))
                  setSelectedSite(result)
                }
              }}
            />
          </div>
        )}
      </div>

      {/* ── Barre de navigation fixe — toujours visible ─────────── */}
      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          zIndex: 2000,
          background: 'white',
          borderTop: '1px solid #e5e7eb',
          boxShadow: '0 -4px 24px rgba(0,0,0,0.10)',
          paddingBottom: 'env(safe-area-inset-bottom, 0px)',
        }}
      >
        <div className="flex items-end" style={{ height: `${NAV_H}px` }}>

          {/* Rechercher (texte) */}
          <button
            onClick={() => setShowSearch('text')}
            className="flex-1 flex flex-col items-center justify-center gap-1 h-full text-blue-700 active:bg-blue-50 transition-colors"
          >
            <Search size={22} strokeWidth={2} />
            <span className="text-[10px] font-bold uppercase tracking-wide">Rechercher</span>
          </button>

          {/* Dicter (vocal) */}
          <button
            onClick={() => setShowSearch('voice')}
            className="flex-1 flex flex-col items-center justify-center gap-1 h-full text-gray-500 active:bg-gray-50 transition-colors"
          >
            <Mic size={22} strokeWidth={2} />
            <span className="text-[10px] font-semibold uppercase tracking-wide">Dicter</span>
          </button>

          {/* Ajouter — bouton central saillant */}
          <div className="flex flex-col items-center justify-end pb-2 px-2" style={{ height: `${NAV_H}px` }}>
            <button
              onClick={handleAddHere}
              style={{ marginTop: -28 }}
              className="w-16 h-16 bg-blue-700 rounded-full flex items-center justify-center text-white shadow-2xl active:scale-95 transition-transform border-4 border-white"
            >
              <Plus size={30} strokeWidth={2.5} />
            </button>
            <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-wide mt-1">Ajouter</span>
          </div>

          {/* Satellite / Plan */}
          <button
            onClick={() => setMapStyle(s => s === 'street' ? 'satellite' : 'street')}
            className={`flex-1 flex flex-col items-center justify-center gap-1 h-full transition-colors active:bg-gray-50 ${mapStyle === 'satellite' ? 'text-blue-700' : 'text-gray-500'}`}
          >
            <Layers size={22} strokeWidth={2} />
            <span className="text-[10px] font-semibold uppercase tracking-wide">
              {mapStyle === 'satellite' ? 'Plan' : 'Satellite'}
            </span>
          </button>

          {/* Menu / Localiser */}
          <button
            onClick={handleLocateMe}
            className="flex-1 flex flex-col items-center justify-center gap-1 h-full text-gray-500 active:bg-gray-50 transition-colors"
          >
            <Navigation size={22} strokeWidth={2} />
            <span className="text-[10px] font-semibold uppercase tracking-wide">Localiser</span>
          </button>

        </div>
      </div>

      {/* Bouton menu flottant (accessible même avec le panneau ouvert) */}
      <button
        onClick={() => setShowSidebar(true)}
        style={{
          position: 'fixed',
          bottom: `calc(${NAV_H}px + env(safe-area-inset-bottom, 0px) + 12px)`,
          right: 16,
          zIndex: 1900,
          background: 'white',
          border: '1px solid #e5e7eb',
          borderRadius: '50%',
          width: 44,
          height: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          boxShadow: '0 2px 12px rgba(0,0,0,0.15)',
        }}
      >
        <Menu size={20} strokeWidth={2} className="text-gray-600" />
      </button>

      {showAddModal && (
        <AddSiteModal
          position={addPosition}
          commercial={commercial}
          onSave={(site) => {
            setSites(prev => prev.some(s => s.id === site.id) ? prev : [site, ...prev])
            setShowAddModal(false)
          }}
          onClose={() => setShowAddModal(false)}
        />
      )}

    </div>
  )
}
