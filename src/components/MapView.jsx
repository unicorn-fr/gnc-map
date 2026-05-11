import { useEffect, useState } from 'react'
import { MapContainer, TileLayer, Marker, useMapEvents, useMap } from 'react-leaflet'
import L from 'leaflet'
import { Menu, Plus, Navigation, LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase'
import Sidebar from './Sidebar'
import AddSiteModal from './AddSiteModal'
import SiteDetailPanel from './SiteDetailPanel'
import toast from 'react-hot-toast'

// Fix Leaflet icon path issue with Vite bundler
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
})

export const COLORS = ['#2563EB', '#16A34A', '#D97706']

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

export default function MapView({ session }) {
  const [profile, setProfile] = useState(null)
  const [allProfiles, setAllProfiles] = useState([])
  const [sites, setSites] = useState([])
  const [selectedSite, setSelectedSite] = useState(null)
  const [showAddModal, setShowAddModal] = useState(false)
  const [addPosition, setAddPosition] = useState(null)
  const [showSidebar, setShowSidebar] = useState(false)
  const [userPosition, setUserPosition] = useState(null)
  const [visibleUsers, setVisibleUsers] = useState(new Set())
  const [visibleTypes, setVisibleTypes] = useState(new Set(['siege', 'chantier']))
  const [flyTo, setFlyTo] = useState(null)

  useEffect(() => {
    loadAll()
    const cleanup = setupRealtime()
    return cleanup
  }, [])

  const loadAll = async () => {
    const [{ data: prof }, { data: profs }, { data: sitesData }] = await Promise.all([
      supabase.from('profiles').select('*').eq('id', session.user.id).single(),
      supabase.from('profiles').select('*').order('created_at'),
      supabase.from('sites').select('*, photos(id, url)').order('created_at', { ascending: false }),
    ])

    if (prof) setProfile(prof)
    if (profs) {
      setAllProfiles(profs)
      setVisibleUsers(new Set(profs.map(p => p.id)))
    }
    if (sitesData) setSites(sitesData)
  }

  const setupRealtime = () => {
    const channel = supabase
      .channel('gnc-realtime')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'sites' }, loadAll)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'photos' }, loadAll)
      .subscribe()
    return () => supabase.removeChannel(channel)
  }

  const getColor = (userId) => {
    const idx = allProfiles.findIndex(p => p.id === userId)
    return COLORS[idx % COLORS.length] ?? '#6B7280'
  }

  const handleLocateMe = () => {
    if (!navigator.geolocation) return toast.error('Géolocalisation non disponible sur cet appareil')
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

  const filtered = sites.filter(s => visibleUsers.has(s.user_id) && visibleTypes.has(s.type))

  const myColor = profile ? getColor(profile.id) : '#3B82F6'

  return (
    <div className="h-full flex flex-col">
      {/* Top bar */}
      <div className="flex-shrink-0 bg-blue-950 text-white px-4 py-3 flex items-center gap-3 shadow-xl z-10">
        <button
          onClick={() => setShowSidebar(true)}
          className="p-2 hover:bg-blue-800 rounded-xl transition-colors"
          aria-label="Menu"
        >
          <Menu size={20} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="font-extrabold text-base leading-tight tracking-tight">GNC Map</p>
          {profile && (
            <p className="text-blue-300 text-xs truncate">{profile.name}</p>
          )}
        </div>
        <div
          className="w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center text-white font-bold text-sm border-2 border-white/30"
          style={{ background: myColor }}
        >
          {profile?.name?.charAt(0)?.toUpperCase() ?? '?'}
        </div>
        <button
          onClick={() => supabase.auth.signOut()}
          className="p-2 hover:bg-blue-800 rounded-xl transition-colors"
          aria-label="Déconnexion"
        >
          <LogOut size={18} />
        </button>
      </div>

      {/* Map area */}
      <div className="flex-1 relative overflow-hidden">
        {/* Sidebar overlay */}
        {showSidebar && (
          <div className="absolute inset-0 z-30 flex">
            <Sidebar
              profiles={allProfiles}
              sites={sites}
              visibleUsers={visibleUsers}
              setVisibleUsers={setVisibleUsers}
              visibleTypes={visibleTypes}
              setVisibleTypes={setVisibleTypes}
              getColor={getColor}
              onClose={() => setShowSidebar(false)}
              onSelectSite={(site) => {
                setSelectedSite(site)
                setFlyTo({ lat: site.lat, lng: site.lng })
                setShowSidebar(false)
              }}
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

          {/* My position dot */}
          {userPosition && (
            <Marker position={userPosition} icon={createUserIcon(myColor)} />
          )}

          {/* Site markers */}
          {filtered.map(site => (
            <Marker
              key={site.id}
              position={[site.lat, site.lng]}
              icon={createSiteIcon(getColor(site.user_id), site.type)}
              eventHandlers={{ click: () => setSelectedSite(site) }}
            />
          ))}
        </MapContainer>

        {/* Floating action buttons */}
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
          <p className="font-semibold text-gray-500 uppercase tracking-wider text-[10px]">Commerciaux</p>
          {allProfiles.map((p, i) => (
            <div key={p.id} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ background: COLORS[i % COLORS.length] }}
              />
              <span className="truncate">{p.name}</span>
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
          <p className="text-[10px] text-gray-400 border-t border-gray-100 pt-2">
            Cliquer sur la carte pour ajouter un point
          </p>
        </div>

        {/* Site detail panel */}
        {selectedSite && (
          <SiteDetailPanel
            site={selectedSite}
            profile={allProfiles.find(p => p.id === selectedSite.user_id)}
            currentUserId={session.user.id}
            color={getColor(selectedSite.user_id)}
            onClose={() => setSelectedSite(null)}
            onUpdated={() => { loadAll(); setSelectedSite(null) }}
          />
        )}
      </div>

      {/* Add site modal */}
      {showAddModal && (
        <AddSiteModal
          position={addPosition}
          userId={session.user.id}
          onSave={() => { loadAll(); setShowAddModal(false) }}
          onClose={() => setShowAddModal(false)}
        />
      )}
    </div>
  )
}
