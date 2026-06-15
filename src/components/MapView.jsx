import { useEffect, useState, useCallback, useRef, useMemo } from 'react'
import ReactMap, { Marker } from 'react-map-gl/maplibre'
import { Menu, Plus, Navigation, X, Search, Layers } from 'lucide-react'
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
const APP_CACHE_KEY = 'gnc_app_data_v2'
const NAV_PREF_KEY = 'gnc_nav_pref'

// Hauteurs fixes des barres (px, hors safe-area)
const TOP_H = 56   // barre du haut
const NAV_H = 64   // barre de navigation bas

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

const TYPE_ICON = { chantier: '🏗️', siege: '🏢' }

export default function MapView({ commercial, onSwitch, installPrompt, onInstalled }) {
  const [allCommercials, setAllCommercials] = useState(() => { const c = getCachedAppData()?.comms; return c?.length ? c : COMMERCIALS })
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
  const [showSearch, setShowSearch] = useState(false)
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
    mapRef.current.jumpTo({ center: [flyTo.lng, flyTo.lat], zoom: 15 })
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
    const [{ data: comms, error: commsErr }, { data: sitesData, error: sitesErr }] = await Promise.all([
      supabase.from('commercials').select('*').order('created_at'),
      supabase.from('sites').select('*').order('created_at', { ascending: false }),
    ])
    if (commsErr) toast.error('Erreur DB commerciaux : ' + commsErr.message, { id: 'db-comms-err', duration: 8000 })
    if (sitesErr) toast.error('Erreur DB sites : ' + sitesErr.message, { id: 'db-sites-err', duration: 8000 })
    // Toujours utiliser les couleurs et noms affichables de COMMERCIALS (source de vérité)
    const merged = comms?.length
      ? comms.map(c => { const ref = COMMERCIALS.find(k => k.id === c.id); return { ...c, color: ref?.color ?? c.color ?? '#6B7280', name: ref?.name ?? c.name } })
      : null
    if (merged) {
      setAllCommercials(merged)
      setVisibleCommercials(prev => {
        if (prev.size === 0) return new Set(merged.map(c => c.id))
        const next = new Set(prev)
        merged.forEach(c => { if (!prev.has(c.id)) next.add(c.id) })
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
      if (!sitesData.length && !sitesErr) {
        toast('⚠️ Aucun site en base — vérifiez les droits Supabase', { id: 'db-empty', duration: 10000 })
      }
    }
    if (merged && sitesData) {
      try { localStorage.setItem(APP_CACHE_KEY, JSON.stringify({ comms: merged, sites: sitesData })) } catch {}
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
    if (!('ontouchstart' in window) && !window.matchMedia('(max-width: 640px)').matches) {
      setAddPosition({ lat: e.lngLat.lat, lng: e.lngLat.lng })
      setShowAddModal(true)
    }
  }, [])

  const handleMarkerClick = useCallback((e, site) => {
    e.originalEvent?.stopPropagation()
    setSelectedSite(site)
    setFlyTo({ lat: site.lat, lng: site.lng })
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

  // Style commun des boutons flottants sur la carte
  const FAB = {
    display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    gap: 3, width: 52, height: 52,
    background: 'white', border: 'none', borderRadius: 14,
    boxShadow: '0 2px 10px rgba(0,0,0,0.18)', cursor: 'pointer', color: '#374151',
  }
  const FAB_LBL = { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: '#6B7280' }

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Overlays ────────────────────────────────────────────── */}
      {showSearch && (
        <SearchBar
          sites={sites}
          allCommercials={allCommercials}
          getColor={getColor}
          onSelectSite={(site) => {
            setSelectedSite(site)
            if (site.lat && site.lng) setFlyTo({ lat: site.lat, lng: site.lng })
          }}
          onClose={() => setShowSearch(false)}
        />
      )}
{voiceNavSite && (
        <VoiceNavModal site={voiceNavSite} onClose={() => setVoiceNavSite(null)} />
      )}

      {/* ── Header bleu ─────────────────────────────────────────── */}
      <div style={{
        flexShrink: 0, background: '#172554',
        display: 'flex', alignItems: 'center', gap: 12,
        padding: '10px 16px',
        paddingTop: 'max(10px, calc(10px + env(safe-area-inset-top)))',
      }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p style={{ fontWeight: 800, fontSize: 15, color: 'white', lineHeight: 1.2, margin: 0 }}>GNC Map</p>
          <p style={{ fontSize: 11, color: '#93C5FD', margin: 0 }}>Groupe Nord Coffrage</p>
        </div>
        <button onClick={onSwitch} style={{
          display: 'flex', alignItems: 'center', gap: 8,
          background: 'rgba(255,255,255,0.12)', borderRadius: 12,
          padding: '6px 12px', border: 'none', cursor: 'pointer',
        }}>
          <div style={{
            width: 24, height: 24, borderRadius: 8, background: commercial.color,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'white', fontWeight: 700, fontSize: 12,
          }}>{commercial.name.charAt(0).toUpperCase()}</div>
          <span style={{ color: 'white', fontSize: 12, fontWeight: 600 }}>{firstName(commercial.name)}</span>
        </button>
      </div>

      {/* ── Carte ───────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative', minHeight: 0 }}>

        {showSidebar && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', zIndex: 1200 }}>
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
            <div style={{ flex: 1, background: 'rgba(0,0,0,0.5)' }} onClick={() => setShowSidebar(false)} />
          </div>
        )}

        {showLocationHelp && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 2000,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 16, background: 'rgba(0,0,0,0.5)',
          }}>
            <div className="bg-white rounded-3xl shadow-2xl p-5 w-full max-w-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900 text-base">Localisation bloquée</h3>
                <button onClick={() => setShowLocationHelp(false)} className="p-1.5 hover:bg-gray-100 rounded-xl">
                  <X size={18} className="text-gray-400" />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-3">Pour l'activer :</p>
              <ol className="text-sm text-gray-700 space-y-2 mb-4 list-decimal ml-4">
                <li><strong>iPhone :</strong> Réglages → Confidentialité → Service de localisation → Safari → Autoriser</li>
                <li><strong>Android :</strong> Appuyer sur 🔒 dans la barre d'adresse → Position</li>
              </ol>
              <button onClick={() => { setShowLocationHelp(false); setTimeout(handleLocateMe, 200) }}
                className="w-full py-3 bg-blue-700 text-white rounded-2xl font-semibold text-sm mb-2">
                Réessayer
              </button>
              <button onClick={() => setShowLocationHelp(false)} className="w-full py-2 text-gray-400 text-sm">Fermer</button>
            </div>
          </div>
        )}

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
          {/* Position utilisateur */}
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

          {/* Sites — marqueurs DOM individuels (couleur par commercial + emoji par type) */}
          {filtered.map(site => {
            const color = getColor(site.commercial_id)
            const isSelected = selectedSite?.id === site.id
            return (
              <Marker key={site.id} longitude={site.lng} latitude={site.lat} anchor="center" onClick={(e) => handleMarkerClick(e, site)}>
                <div style={{
                  width: isSelected ? 44 : 36, height: isSelected ? 44 : 36,
                  borderRadius: '50%', background: 'white',
                  border: `4px solid ${color}`,
                  boxShadow: isSelected ? `0 0 0 3px ${color}66, 0 4px 12px rgba(0,0,0,0.35)` : '0 2px 8px rgba(0,0,0,0.25)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: isSelected ? 20 : 16, cursor: 'pointer',
                }}>
                  {TYPE_ICON[site.type] ?? '📍'}
                </div>
              </Marker>
            )
          })}
        </ReactMap>

        {/* ── Barre de recherche flottante ── */}
        <div
          onClick={() => setShowSearch(true)}
          style={{
            position: 'absolute', top: 10, left: 12, right: 12, zIndex: 500,
            display: 'flex', alignItems: 'center', gap: 10,
            background: 'white', borderRadius: 16, padding: '11px 14px',
            boxShadow: '0 4px 20px rgba(0,0,0,0.3)', cursor: 'pointer',
          }}
        >
          <Search size={19} strokeWidth={2.5} style={{ color: '#1D4ED8', flexShrink: 0 }} />
          <span style={{ flex: 1, fontSize: 14, color: '#9CA3AF', fontWeight: 500, userSelect: 'none' }}>Rechercher un site…</span>
        </div>

        {/* Légende commerciaux — sous la barre de recherche */}
        <div style={{
          position: 'absolute', top: 72, left: 10, zIndex: 500,
          background: 'rgba(255,255,255,0.95)', borderRadius: 14,
          padding: '6px 10px', display: 'flex', flexDirection: 'column', gap: 4,
          boxShadow: '0 2px 8px rgba(0,0,0,0.12)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {allCommercials.map(c => {
              const cnt = sites.filter(s => s.commercial_id === c.id).length
              return (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                  <div style={{ width: 9, height: 9, borderRadius: '50%', background: c.color }} />
                  <span style={{ fontSize: 11, fontWeight: 600, color: '#374151' }}>{firstName(c.name)}<span style={{ fontWeight: 400, color: '#9CA3AF' }}> {cnt}</span></span>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            {[
              { label: 'Tous', types: ['chantier', 'siege'] },
              { label: '⚒ Chantiers', types: ['chantier'] },
              { label: '🏢 Sièges', types: ['siege'] },
            ].map(({ label, types }) => {
              const active = visibleTypes.size === types.length && types.every(t => visibleTypes.has(t))
              return (
                <button key={label} onClick={() => setVisibleTypes(new Set(types))} style={{
                  fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 8, border: 'none',
                  cursor: 'pointer',
                  background: active ? '#1D4ED8' : '#F3F4F6',
                  color: active ? 'white' : '#6B7280',
                }}>{label}</button>
              )
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, fontSize: 10, color: '#9CA3AF', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#374151' }} />
              <span>chantier</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'white', border: '2px solid #374151' }} />
              <span>siège</span>
            </div>
          </div>
        </div>

        {/* ── Boutons flottants — bas droite ──────────────────── */}
        <div style={{
          position: 'absolute', bottom: 'max(16px, calc(16px + env(safe-area-inset-bottom)))', right: 12, zIndex: 500,
          display: 'flex', flexDirection: 'column', gap: 8,
        }}>
          <button onClick={handleAddHere} style={{ ...FAB, color: '#1D4ED8' }}>
            <Plus size={22} strokeWidth={2.5} />
            <span style={FAB_LBL}>Ajouter</span>
          </button>
          <button onClick={() => setMapStyle(s => s === 'street' ? 'satellite' : 'street')} style={{ ...FAB, color: mapStyle === 'satellite' ? '#1D4ED8' : '#374151' }}>
            <Layers size={20} strokeWidth={2} />
            <span style={FAB_LBL}>{mapStyle === 'satellite' ? 'Plan' : 'Sat.'}</span>
          </button>
          <button onClick={handleLocateMe} style={{ ...FAB, color: userPosition ? '#1D4ED8' : '#374151' }}>
            <Navigation size={20} strokeWidth={2} />
            <span style={FAB_LBL}>Localiser</span>
          </button>
          <button onClick={() => setShowSidebar(true)} style={FAB}>
            <Menu size={20} strokeWidth={2} />
            <span style={FAB_LBL}>Menu</span>
          </button>
        </div>

        {selectedSite && (
          <div style={{ position: 'absolute', inset: 0, right: 0, width: '100%', maxWidth: 420, zIndex: 1050 }}>
            <SiteDetailPanel
              site={selectedSite}
              commercial={allCommercials.find(c => c.id === selectedSite.commercial_id)}
              currentCommercial={commercial}
              currentCommercialId={commercial.id}
              color={getColor(selectedSite.commercial_id)}
              onClose={() => setSelectedSite(null)}
              onUpdated={(result) => {
                if (!result || result === true) {
                  setSites(prev => prev.filter(s => s.id !== selectedSite.id))
                  setSelectedSite(null)
                } else if (typeof result === 'object' && result.id) {
                  setSites(prev => prev.map(s => s.id === result.id ? result : s))
                  setSelectedSite(result)
                }
              }}
            />
          </div>
        )}
      </div>

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
