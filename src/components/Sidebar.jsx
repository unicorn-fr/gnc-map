import { X } from 'lucide-react'
import { COLORS } from './MapView'

const TYPE_OPTS = [
  { value: 'chantier', emoji: '🏗️', label: 'Chantiers' },
  { value: 'siege', emoji: '🏢', label: 'Sièges sociaux' },
]

const STATUS_LABELS = {
  prospect: 'Prospect',
  client: 'Client',
  en_cours: 'En cours',
  termine: 'Terminé',
}

export default function Sidebar({
  profiles,
  sites,
  visibleUsers,
  setVisibleUsers,
  visibleTypes,
  setVisibleTypes,
  getColor,
  onClose,
  onSelectSite,
}) {
  const toggleUser = (id) => {
    setVisibleUsers(prev => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }

  const toggleType = (type) => {
    setVisibleTypes(prev => {
      const next = new Set(prev)
      next.has(type) ? next.delete(type) : next.add(type)
      return next
    })
  }

  const totalSites = sites.length
  const totalClients = sites.filter(s => s.status === 'client' || s.status === 'en_cours').length

  return (
    <div className="w-80 bg-white h-full shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-blue-950 text-white px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="font-bold text-base">GNC Map</p>
          <p className="text-blue-300 text-xs">Filtres & Statistiques</p>
        </div>
        <button
          onClick={onClose}
          className="p-2 hover:bg-blue-800 rounded-xl transition-colors"
        >
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Global stats */}
        <div className="p-4 border-b bg-gray-50">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
            Vue d'ensemble
          </p>
          <div className="grid grid-cols-2 gap-2">
            {[
              { icon: '📍', value: totalSites, label: 'Sites total' },
              { icon: '✅', value: totalClients, label: 'Clients actifs' },
              { icon: '🏗️', value: sites.filter(s => s.type === 'chantier').length, label: 'Chantiers' },
              { icon: '🏢', value: sites.filter(s => s.type === 'siege').length, label: 'Sièges' },
            ].map(stat => (
              <div key={stat.label} className="bg-white rounded-2xl p-3 border border-gray-100">
                <p className="text-lg mb-0.5">{stat.icon}</p>
                <p className="text-2xl font-extrabold text-gray-800">{stat.value}</p>
                <p className="text-[11px] text-gray-400">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Commerciaux filter */}
        <div className="p-4 border-b">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
            Commerciaux
          </p>
          {profiles.map((p, i) => {
            const color = COLORS[i % COLORS.length]
            const userSites = sites.filter(s => s.user_id === p.id)
            const siege = userSites.filter(s => s.type === 'siege').length
            const chantier = userSites.filter(s => s.type === 'chantier').length
            const active = visibleUsers.has(p.id)

            return (
              <button
                key={p.id}
                onClick={() => toggleUser(p.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl mb-2 transition-all border-2 ${
                  active
                    ? 'border-transparent bg-gray-50'
                    : 'border-transparent bg-white opacity-50'
                }`}
              >
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-extrabold text-base flex-shrink-0 shadow-sm"
                  style={{ background: color }}
                >
                  {p.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="font-semibold text-sm text-gray-800 truncate">{p.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {siege} siège{siege !== 1 ? 's' : ''} · {chantier} chantier{chantier !== 1 ? 's' : ''}
                  </p>
                </div>
                <div
                  className={`w-5 h-5 rounded-full border-2 flex-shrink-0 transition-all ${
                    active
                      ? 'border-transparent'
                      : 'border-gray-300 bg-white'
                  }`}
                  style={active ? { background: color } : {}}
                />
              </button>
            )
          })}
        </div>

        {/* Type filter */}
        <div className="p-4 border-b">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
            Type de site
          </p>
          {TYPE_OPTS.map(opt => {
            const count = sites.filter(s => s.type === opt.value).length
            const active = visibleTypes.has(opt.value)
            return (
              <button
                key={opt.value}
                onClick={() => toggleType(opt.value)}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl mb-2 border-2 transition-all ${
                  active
                    ? 'border-blue-200 bg-blue-50'
                    : 'border-gray-100 bg-white opacity-50'
                }`}
              >
                <span className="text-xl">{opt.emoji}</span>
                <span className={`flex-1 text-sm font-semibold text-left ${active ? 'text-blue-700' : 'text-gray-400'}`}>
                  {opt.label}
                </span>
                <span className={`text-sm font-bold ${active ? 'text-blue-600' : 'text-gray-300'}`}>
                  {count}
                </span>
              </button>
            )
          })}
        </div>

        {/* Recent sites list */}
        <div className="p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
            Sites récents
          </p>
          {sites.slice(0, 15).map(site => {
            const prof = profiles.find(p => p.id === site.user_id)
            const profIdx = profiles.findIndex(p => p.id === site.user_id)
            const siteColor = COLORS[profIdx % COLORS.length] ?? '#6B7280'
            return (
              <button
                key={site.id}
                onClick={() => onSelectSite(site)}
                className="w-full flex items-start gap-3 p-2.5 hover:bg-gray-50 rounded-xl mb-1 text-left transition-colors group"
              >
                <div
                  className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-bold text-xs mt-0.5 shadow-sm"
                  style={{ background: siteColor }}
                >
                  {site.type === 'siege' ? 'S' : 'C'}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-blue-700 transition-colors">
                    {site.name}
                  </p>
                  <p className="text-xs text-gray-400 truncate">
                    {prof?.name ?? ''}{site.company ? ` · ${site.company}` : ''}
                  </p>
                </div>
              </button>
            )
          })}
          {sites.length === 0 && (
            <p className="text-sm text-gray-400 text-center py-6">
              Aucun site enregistré
            </p>
          )}
        </div>
      </div>
    </div>
  )
}
