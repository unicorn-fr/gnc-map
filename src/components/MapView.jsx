import { useEffect, useState, useCallback, useRef, useMemo, memo } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Menu, Plus, Navigation, X, Layers } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { requestAndSubscribe } from '../lib/push'
import { firstName } from '../lib/utils'
import Sidebar from './Sidebar'
import AddSiteModal from './AddSiteModal'
import SiteDetailPanel from './SiteDetailPanel'
import ImportPage from './ImportPage'
import ReportsPage from './ReportsPage'
import InstallBanner from './InstallBanner'
import toast from 'react-hot-toast'

delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

const createSiteIcon = (color, type) =>
  L.divIcon({
    className: '',
    html: `<div class="site-pin-wrap" style="background:${color}"><span class="site-pin-emoji">${type === 'siege' ? '🏢' : '🏗️'}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -38],
  })

const createUserIcon = (color) =>
  L.divIcon({
    className: '',
    html: `<div style="width:18px;height:18px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 4px ${color}44;"></div>`,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  })

// Composant marqueur mémoïsé : ne re-render que si le site ou la couleur change.
// Sans memo, createSiteIcon recrée un L.divIcon à chaque render global,
// ce qui force Leaflet à re-peindre TOUS les marqueurs dans le DOM.
const SiteMarker = memo(function SiteMarker({ site, color, onSelect }) {
  const icon = useMemo(() => createSiteIcon(color, site.type), [color, site.type])
  const handlers = useMemo(() => ({
    click: (e) => { L.DomEvent.stopPropagation(e); onSelect(site) },
  }), [site, onSelect])
  return <Marker position={[site.lat, site.lng]} icon={icon} eventHandlers={handlers} />
})

function MapInteraction({ onMapClick, flyTo, onFlyToDone }) {
  const map = useMap()

  useMapEvents({
    click(e) {
      onMapClick({ lat: e.latlng.lat, lng: e.latlng.lng })
    },
  })

  useEffect(() => {
    if (flyTo) {
      map.flyTo([flyTo.lat, flyTo.lng], 15, { duration: 1.2 })
      onFlyToDone()
    }
  }, [flyTo, map, onFlyToDone])

  return null
}

export default function MapView({ commercial, onSwitch, installPrompt, onInstalled }) {
  const [allCommercials, setAllCommercials] = useState([])
  const [sites, setSites] = useState([])
  const [selectedSite, setSelectedSite] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addPosition, setAddPosition] = useState(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [showReports, setShowReports] = useState(false)
  const [showLocationHelp, setShowLocationHelp] = useState(false)
  const [userPosition, setUserPosition] = useState(null)
  const [visibleCommercials, setVisibleCommercials] = useState(new Set())
  const [visibleTypes, setVisibleTypes] = useState(new Set(['siege', 'chantier']))
  const [flyTo, setFlyTo] = useState(null)
  const [mapStyle, setMapStyle] = useState('street')
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
    const timer = setTimeout(startTracking, 1200)
    requestAndSubscribe(commercial.id)

    // Rafraîchir les données quand l'app revient au premier plan
    const handleVisible = () => {
      if (document.visibilityState === 'visible') loadAll()
    }
    document.addEventListener('visibilitychange', handleVisible)

    // Ouvrir le panneau du site quand une notification est cliquée avec l'app déjà ouverte.
    // Le SW envoie { type: 'OPEN_URL', url } au lieu de naviguer, car navigate()
    // ne déclenche pas les useEffect React déjà montés.
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
      if (watchIdRef.current !== null) {
        navigator.geolocation.clearWatch(watchIdRef.current)
      }
    }
  }, [])

  const startTracking = () => {
    if (!navigator.geolocation || watchIdRef.current !== null) return
    let firstFix = true
    watchIdRef.current = navigator.geolocation.watchPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        setUserPosition([lat, lng])
        if (firstFix) {
          setFlyTo({ lat, lng })
          firstFix = false
        }
      },
      () => {}, // silencieux si permission refusée
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
      // Préserver les références d'objets pour les sites inchangés :
      // React.memo sur SiteMarker évite ainsi de re-peindre toute la carte
      // à chaque polling de 15s si aucune donnée n'a changé.
      setSites(prev => {
        const prevMap = new Map(prev.map(s => [s.id, s]))
        return fresh.map(s => {
          const p = prevMap.get(s.id)
          return (p && p.updated_at === s.updated_at) ? p : s
        })
      })
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
          // Reconnexion automatique si la connexion WebSocket tombe
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

    // Polling toutes les 15s : filet de sécurité si un événement Realtime est manqué.
    // loadAll() préserve les références d'objets inchangés → pas de re-render inutile.
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

  // Synchronise le panneau ouvert avec les mises à jour temps réel.
  // Si quelqu'un d'autre modifie le site affiché, le panneau se met à jour automatiquement.
  // Si le site est supprimé à distance, prévient l'utilisateur et ferme le panneau.
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
  const handleFlyToDone = useCallback(() => setFlyTo(null), [])

  const handleLocateMe = async () => {
    if (!navigator.geolocation) return toast.error('Géolocalisation non disponible sur cet appareil')

    // Si la position est déjà connue (watchPosition en cours), centrer simplement la carte
    if (userPosition) {
      setFlyTo({ lat: userPosition[0], lng: userPosition[1] })
      return
    }

    // Vérification de la permission si l'API est disponible (pas sur iOS Safari)
    if (navigator.permissions?.query) {
      try {
        const perm = await navigator.permissions.query({ name: 'geolocation' })
        if (perm.state === 'denied') { setShowLocationHelp(true); return }
      } catch {}
    }

    // Démarrer le tracking continu (watchPosition), il mettra à jour userPosition et fera le flyTo initial
    startTracking()
    toast.success('Localisation activée !', { id: 'locate' })
  }

  const handleAddHere = () => {
    // Ouvrir le modal immédiatement, sans bloquer sur la géolocalisation
    setAddPosition(null)
    setShowAddModal(true)

    // Tenter la géolocalisation en arrière-plan pour pré-remplir la position
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        setUserPosition([lat, lng])
        setAddPosition({ lat, lng })
      },
      () => {}, // ignorer silencieusement si refusée/timeout
      { enableHighAccuracy: true, timeout: 8000 }
    )
  }

  const handleMapClick = (pos) => {
    // Désactiver le clic-carte sur mobile : évite d'ouvrir le modal
    // en voulant simplement naviguer / après avoir tapé un marqueur
    if (window.matchMedia('(max-width: 640px)').matches || 'ontouchstart' in window) return
    setAddPosition(pos)
    setShowAddModal(true)
  }

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
    // h-dvh = hauteur réelle sur mobile (tient compte de la barre d'adresse du navigateur)
    <div style={{ height: '100dvh' }} className="flex flex-col">

      {/* Barre du haut */}
      <div className="flex-shrink-0 bg-blue-950 text-white px-4 py-3 flex items-center gap-3 shadow-xl" style={{ zIndex: 1100 }}>
        <button onClick={() => setShowSidebar(true)} className="p-2 hover:bg-blue-800 rounded-xl transition-colors">
          <Menu size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-base leading-tight tracking-tight">GNC Map</p>
        </div>
        <button
          onClick={onSwitch}
          className="flex items-center gap-2 bg-white/10 hover:bg-white/20 rounded-xl px-3 py-1.5 transition-colors"
          title="Changer de commercial"
        >
          <div
            className="w-6 h-6 rounded-lg flex items-center justify-center text-white font-bold text-xs flex-shrink-0"
            style={{ background: commercial.color }}
          >
            {commercial.name.charAt(0).toUpperCase()}
          </div>
          <span className="text-white text-xs font-semibold truncate max-w-24">
            {firstName(commercial.name)}
          </span>
        </button>
      </div>

      {/* Zone carte */}
      <div className="flex-1 relative" style={{ minHeight: 0 }}>

        {/* Overlay sidebar */}
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

        {/* Modal aide localisation */}
        {showLocationHelp && (
          <div className="absolute inset-0 flex items-end justify-center p-4 pb-8" style={{ zIndex: 2000, background: 'rgba(0,0,0,0.5)' }}>
            <div className="bg-white rounded-3xl shadow-2xl p-5 w-full max-w-sm">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-bold text-gray-900 text-base">Localisation bloquée</h3>
                <button onClick={() => setShowLocationHelp(false)} className="p-1.5 hover:bg-gray-100 rounded-xl">
                  <X size={18} className="text-gray-400" />
                </button>
              </div>
              <p className="text-sm text-gray-600 mb-3">
                Votre navigateur bloque la localisation. Pour l'activer :
              </p>
              <ol className="text-sm text-gray-700 space-y-2 mb-4 list-decimal ml-4">
                <li><strong>iPhone / iPad :</strong> Réglages → Confidentialité → Service de localisation → Safari → Autoriser</li>
                <li><strong>Android Chrome :</strong> Appuyer sur 🔒 dans la barre d'adresse → Autorisation du site → Position</li>
                <li><strong>Ordinateur :</strong> Cliquer sur 🔒 dans la barre d'adresse et autoriser la localisation</li>
              </ol>
              <button
                onClick={() => { setShowLocationHelp(false); setTimeout(handleLocateMe, 200) }}
                className="w-full py-3 bg-blue-700 text-white rounded-2xl font-semibold text-sm mb-2"
              >
                Réessayer
              </button>
              <button onClick={() => setShowLocationHelp(false)} className="w-full py-2 text-gray-400 text-sm">
                Fermer
              </button>
            </div>
          </div>
        )}

        {/* Carte Leaflet */}
        <MapContainer
          center={[48.8566, 2.3522]}
          zoom={6}
          style={{ height: '100%', width: '100%' }}
          zoomControl={false}
          tap={false}
          preferCanvas={true}
        >
          <TileLayer
            key={`base-${mapStyle}`}
            url={mapStyle === 'satellite'
              ? "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
              : "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"}
            attribution={mapStyle === 'satellite'
              ? 'Tiles &copy; Esri &mdash; Source: Esri, DigitalGlobe, GeoEye, Earthstar Geographics'
              : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'}
            subdomains={mapStyle === 'street' ? 'abc' : undefined}
            keepBuffer={8}
            updateWhenIdle={false}
            updateWhenZooming={false}
            maxZoom={19}
          />
          {mapStyle === 'satellite' && (
            <TileLayer
              key="labels"
              url="https://{s}.basemaps.cartocdn.com/rastertiles/voyager_only_labels/{z}/{x}/{y}{r}.png"
              subdomains="abcd"
              opacity={0.9}
              keepBuffer={8}
              updateWhenIdle={false}
              updateWhenZooming={false}
            />
          )}
          <MapInteraction
            onMapClick={handleMapClick}
            flyTo={flyTo}
            onFlyToDone={handleFlyToDone}
          />
          {userPosition && (
            <Marker position={userPosition} icon={createUserIcon(commercial.color)} />
          )}
          {filtered.map(site => (
            <SiteMarker
              key={site.id}
              site={site}
              color={getColor(site.commercial_id)}
              onSelect={handleSelectSite}
            />
          ))}
        </MapContainer>

        {/* Boutons flottants — z-index élevé pour passer au-dessus de Leaflet */}
        <div
          className="absolute bottom-6 right-4 flex flex-col gap-3"
          style={{ zIndex: 1000 }}
        >
          <button
            onClick={() => setMapStyle(s => s === 'street' ? 'satellite' : 'street')}
            className={`w-12 h-12 rounded-full shadow-lg flex items-center justify-center active:scale-95 transition-all ${mapStyle === 'satellite' ? 'bg-blue-700 text-white' : 'bg-white text-blue-800 hover:bg-blue-50'}`}
            aria-label="Changer la vue de la carte"
            title={mapStyle === 'satellite' ? 'Vue plan' : 'Vue satellite'}
          >
            <Layers size={20} />
          </button>
          <button
            onClick={handleLocateMe}
            className="w-12 h-12 bg-white rounded-full shadow-lg flex items-center justify-center text-blue-800 hover:bg-blue-50 active:scale-95 transition-all"
            aria-label="Ma position"
          >
            <Navigation size={20} />
          </button>
          <button
            onClick={handleAddHere}
            className="w-16 h-16 bg-blue-700 rounded-full shadow-xl flex items-center justify-center text-white hover:bg-blue-800 active:scale-95 transition-all"
            aria-label="Ajouter un site à ma position"
          >
            <Plus size={30} />
          </button>
        </div>

        {/* Légende */}
        <div
          className="absolute bottom-6 left-4 bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg p-3 text-xs text-gray-700 space-y-2 max-w-44"
          style={{ zIndex: 1000 }}
        >
          <p className="font-semibold text-gray-400 uppercase tracking-wider text-[10px]">Commerciaux</p>
          {allCommercials.map(c => (
            <div key={c.id} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.color }} />
              <span className="truncate">{c.name}</span>
            </div>
          ))}
          <div className="border-t border-gray-100 pt-2 space-y-1">
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">🏢</span>
              <span className="text-gray-500">Siège social</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-base leading-none">🏗️</span>
              <span className="text-gray-500">Chantier</span>
            </div>
          </div>
          <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-2 hidden sm:block">
            Cliquer sur la carte pour ajouter
          </p>
          <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-2 sm:hidden">
            Bouton + pour ajouter un point
          </p>
        </div>

        {/* Panneau détail site — w-full sur mobile, 384px sur desktop */}
        {selectedSite && (
          <div className="absolute inset-y-0 right-0 w-full sm:w-96" style={{ zIndex: 1050 }}>
            <SiteDetailPanel
              site={selectedSite}
              commercial={allCommercials.find(c => c.id === selectedSite.commercial_id)}
              currentCommercial={commercial}
              currentCommercialId={commercial.id}
              color={getColor(selectedSite.commercial_id)}
              onClose={() => setSelectedSite(null)}
              onUpdated={(deleted) => {
                if (deleted && selectedSite) {
                  setSites(prev => prev.filter(s => s.id !== selectedSite.id))
                  setSelectedSite(null)
                }
              }}
            />
          </div>
        )}
      </div>

      {/* Modal ajout site */}
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
