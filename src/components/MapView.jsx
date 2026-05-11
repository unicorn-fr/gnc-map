import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Menu, Plus, Navigation, RefreshCw } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Sidebar from './Sidebar'
import AddSiteModal from './AddSiteModal'
import SiteDetailPanel from './SiteDetailPanel'
import ImportPage from './ImportPage'
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
    html: `<div class="site-pin-wrap" style="background:${color}"><span class="site-pin-letter">${type === 'siege' ? 'S' : 'C'}</span></div>`,
    iconSize: [34, 34],
    iconAnchor: [17, 34],
    popupAnchor: [0, -38],
  })

const createUserIcon = (color) =>
  L.divIcon({
    className: '',
    html: `<div style="width:16px;height:16px;border-radius:50%;background:${color};border:3px solid white;box-shadow:0 0 0 3px ${color}55;"></div>`,
    iconSize: [16, 16],
    iconAnchor: [8, 8],
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

export default function MapView({ commercial, onSwitch }) {
  const [allCommercials, setAllCommercials] = useState([])
  const [sites, setSites] = useState([])
  const [selectedSite, setSelectedSite] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addPosition, setAddPosition] = useState(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [showImport, setShowImport] = useState(false)
  const [userPosition, setUserPosition] = useState(null)
  const [visibleCommercials, setVisibleCommercials] = useState(new Set())
  const [visibleTypes, setVisibleTypes] = useState(new Set(['siege', 'chantier']))
  const [flyTo, setFlyTo] = useState(null)

  useEffect(() => {
    loadAll()
    const cleanup = setupRealtime()
    return cleanup
  }, [])

  const loadAll = async () => {
    const [{ data: comms }, { data: sitesData }] = await Promise.all([
      supabase.from('commercials').select('*').order('created_at'),
      supabase.from('sites').select('*, photos(id, url)').order('created_at', { ascending: false }),
    ])
    if (comms) {
      setAllCommercials(comms)
      setVisibleCommercials(new Set(comms.map(c => c.id)))
    }
    if (sitesData) setSites(sitesData)
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

  const handleLocateMe = () => {
    if (!navigator.geolocation) return toast.error('Géolocalisation non disponible')
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        setUserPosition([lat, lng])
        setFlyTo({ lat, lng })
      },
      () => toast.error("Impossible d'obtenir votre position.\nVérifiez les autorisations."),
      { enableHighAccuracy: true }
    )
  }

  const handleAddHere = () => {
    if (!navigator.geolocation) return toast.error('Géolocalisation non disponible')
    navigator.geolocation.getCurrentPosition(
      ({ coords: { latitude: lat, longitude: lng } }) => {
        setUserPosition([lat, lng])
        setAddPosition({ lat, lng })
        setShowAddModal(true)
      },
      () => toast.error("Impossible d'obtenir votre position"),
      { enableHighAccuracy: true }
    )
  }

  const handleMapClick = (pos) => {
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

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="flex-shrink-0 bg-blue-950 text-white px-4 py-3 flex items-center gap-3 shadow-xl z-10">
        <button
          onClick={() => setShowSidebar(true)}
          className="p-2 hover:bg-blue-800 rounded-xl transition-colors"
        >
          <Menu size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-base leading-tight tracking-tight">GNC Map</p>
        </div>
        {/* Current commercial badge — cliquer pour changer */}
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
            {commercial.name}
          </span>
        </button>
      </div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Sidebar overlay */}
        {showSidebar && (
          <div className="absolute inset-0 z-30 flex">
            <Sidebar
              commercials={allCommercials}
              sites={sites}
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
            />
            <div
              className="flex-1 bg-black/50 backdrop-blur-sm"
              onClick={() => setShowSidebar(false)}
            />
          </div>
        )}

        {/* Leaflet map */}
        <MapContainer
          center={[48.8566, 2.3522]}
          zoom={10}
          className="h-full w-full"
          zoomControl={false}
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
              eventHandlers={{ click: () => setSelectedSite(site) }}
            />
          ))}
        </MapContainer>

        {/* FABs */}
        <div className="absolute bottom-6 right-4 flex flex-col gap-3 z-20">
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

        {/* Legend */}
        <div className="absolute bottom-6 left-4 z-20 bg-white/95 backdrop-blur-sm rounded-2xl shadow-lg p-3 text-xs text-gray-700 space-y-2 max-w-44">
          <p className="font-semibold text-gray-400 uppercase tracking-wider text-[10px]">Commerciaux</p>
          {allCommercials.map(c => (
            <div key={c.id} className="flex items-center gap-2">
              <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ background: c.color }} />
              <span className="truncate">{c.name}</span>
            </div>
          ))}
          <div className="border-t border-gray-100 pt-2 space-y-1">
            <div className="flex items-center gap-2">
              <span className="font-bold text-blue-700 w-3 text-center text-[11px]">S</span>
              <span className="text-gray-500">Siège social</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="font-bold text-blue-700 w-3 text-center text-[11px]">C</span>
              <span className="text-gray-500">Chantier</span>
            </div>
          </div>
        </div>

        {/* Site detail panel */}
        {selectedSite && (
          <SiteDetailPanel
            site={selectedSite}
            commercial={allCommercials.find(c => c.id === selectedSite.commercial_id)}
            currentCommercialId={commercial.id}
            color={getColor(selectedSite.commercial_id)}
            onClose={() => setSelectedSite(null)}
            onUpdated={() => { loadAll(); setSelectedSite(null) }}
          />
        )}
      </div>

      {/* Add site modal */}
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
