import { useEffect, useState, useCallback, useRef } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Menu, Plus, Navigation, X } from 'lucide-react'
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
  const watchIdRef = useRef(null)

  useEffect(() => {
    loadAll()
    const cleanup = setupRealtime()
    const timer = setTimeout(startTracking, 1200)
    requestAndSubscribe(commercial.id)

    // Rafraîchir les données quand l'app revient au premier plan (h24)
    const handleVisible = () => {
      if (document.visibilityState === 'visible') loadAll()
    }
    document.addEventListener('visibilitychange', handleVisible)

    return () => {
      cleanup()
      clearTimeout(timer)
      document.removeEventListener('visibilitychange', handleVisible)
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

  const loadAll = async () => {
    const [{ data: comms }, { data: sitesData }] = await Promise.all([
      supabase.from('commercials').select('*').order('created_at'),
      supabase.from('sites').select('*, photos(id, url)').order('created_at', { ascending: false }),
    ])
    if (comms) {
      setAllCommercials(comms)
      setVisibleCommercials(prev => {
        if (prev.size === 0) return new Set(comms.map(c => c.id))
        // Rechargements suivants : ajouter les nouveaux commerciaux sans réinitialiser
        const next = new Set(prev)
        comms.forEach(c => { if (!prev.has(c.id)) next.add(c.id) })
        return next
      })
    }
    if (sitesData) setSites(sitesData.filter(s => !s.deleted))
  }

  const setupRealtime = () => {
    const ch = supabase
      .channel('gnc-realtime-v2')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sites' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, loadAll)
      .subscribe()
    return () => supabase.removeChannel(ch)
  }

  const getColor = (commercialId) => {
    const c = allCommercials.find(x => x.id === commercialId)
    return c?.color ?? '#6B7280'
  }

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

  const filtered = sites.filter(
    s => s.lat && s.lng && visibleCommercials.has(s.commercial_id) && visibleTypes.has(s.type)
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
        >
          <TileLayer
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          />
          <MapInteraction
            onMapClick={handleMapClick}
            flyTo={flyTo}
            onFlyToDone={() => setFlyTo(null)}
          />
          {userPosition && (
            <Marker position={userPosition} icon={createUserIcon(commercial.color)} />
          )}
          {filtered.map(site => (
            <Marker
              key={site.id}
              position={[site.lat, site.lng]}
              icon={createSiteIcon(getColor(site.commercial_id), site.type)}
              eventHandlers={{
                click: (e) => {
                  // Empêche le clic de se propager à la carte (évite d'ouvrir AddSiteModal en même temps)
                  L.DomEvent.stopPropagation(e)
                  setSelectedSite(site)
                },
              }}
            />
          ))}
        </MapContainer>

        {/* Boutons flottants — z-index élevé pour passer au-dessus de Leaflet */}
        <div
          className="absolute bottom-6 right-4 flex flex-col gap-3"
          style={{ zIndex: 1000 }}
        >
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
              currentCommercialId={commercial.id}
              color={getColor(selectedSite.commercial_id)}
              onClose={() => setSelectedSite(null)}
              onUpdated={() => { loadAll(); setSelectedSite(null) }}
            />
          </div>
        )}
      </div>

      {/* Modal ajout site */}
      {showAddModal && (
        <AddSiteModal
          position={addPosition}
          commercial={commercial}
          onSave={() => { loadAll(); setShowAddModal(false) }}
          onClose={() => setShowAddModal(false)}
        />
      )}

    </div>
  )
}
