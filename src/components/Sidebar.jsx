import { X, Upload, FileText } from 'lucide-react'
import { firstName } from '../lib/utils'

const TYPE_OPTS = [
  { value: 'chantier', emoji: '🏗️', label: 'Chantiers' },
  { value: 'siege',    emoji: '🏢', label: 'Sièges sociaux' },
]

const relTime = (iso) => {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso)
  if (diff < 60_000)       return 'à l\'instant'
  if (diff < 3_600_000)    return `il y a ${Math.floor(diff / 60_000)} min`
  if (diff < 86_400_000)   return `il y a ${Math.floor(diff / 3_600_000)} h`
  if (diff < 7 * 86_400_000) return `il y a ${Math.floor(diff / 86_400_000)} j`
  return new Date(iso).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })
}

export default function Sidebar({
  commercials, sites, currentCommercialId,
  visibleCommercials, setVisibleCommercials,
  visibleTypes, setVisibleTypes,
  getColor, onClose, onSelectSite, onOpenImport, onOpenReports,
}) {
  const toggleCommercial = (id) => {
    setVisibleCommercials(prev => {
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

  // Activité récente des AUTRES commerciaux (les 10 dernières)
  const recentByOthers = [...sites]
    .filter(s => s.commercial_id !== currentCommercialId && !s.import_log_id)
    .sort((a, b) => new Date(b.updated_at ?? b.created_at) - new Date(a.updated_at ?? a.created_at))
    .slice(0, 10)

  return (
    <div className="w-80 bg-white h-full shadow-2xl flex flex-col overflow-hidden">
      {/* Header */}
      <div className="bg-blue-950 text-white px-5 py-4 flex items-center justify-between flex-shrink-0">
        <div>
          <p className="font-bold text-base">Menu</p>
          <p className="text-blue-300 text-xs">Filtres & Activité</p>
        </div>
        <button onClick={onClose} className="p-2 hover:bg-blue-800 rounded-xl transition-colors">
          <X size={20} />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Action buttons */}
        <div className="p-4 border-b space-y-2">
          <button
            onClick={onOpenImport}
            className="w-full flex items-center gap-3 bg-emerald-50 hover:bg-emerald-100 border-2 border-emerald-200 hover:border-emerald-300 text-emerald-700 rounded-2xl px-4 py-3.5 transition-all font-semibold text-sm"
          >
            <Upload size={18} />
            <div className="text-left">
              <p className="font-bold">Importer / Mettre à jour</p>
              <p className="text-emerald-500 text-xs font-normal">Excel ou CSV depuis votre logiciel</p>
            </div>
          </button>
          <button
            onClick={onOpenReports}
            className="w-full flex items-center gap-3 bg-blue-50 hover:bg-blue-100 border-2 border-blue-100 hover:border-blue-200 text-blue-700 rounded-2xl px-4 py-3.5 transition-all font-semibold text-sm"
          >
            <FileText size={18} />
            <div className="text-left">
              <p className="font-bold">Mes rapports</p>
              <p className="text-blue-400 text-xs font-normal">Comptes rendus par date</p>
            </div>
          </button>
        </div>

        {/* Activité récente des autres */}
        {recentByOthers.length > 0 && (
          <div className="p-4 border-b">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">
              Activité récente des collègues
            </p>
            {recentByOthers.map(site => {
              const comm = commercials.find(c => c.id === site.commercial_id)
              const color = getColor(site.commercial_id)
              const ts = site.updated_at ?? site.created_at
              return (
                <button
                  key={site.id}
                  onClick={() => onSelectSite(site)}
                  className="w-full flex items-start gap-3 p-2.5 hover:bg-gray-50 rounded-xl mb-1 text-left transition-colors group"
                >
                  <div
                    className="w-8 h-8 rounded-xl flex-shrink-0 flex items-center justify-center text-white font-bold text-xs mt-0.5"
                    style={{ background: color }}
                  >
                    {firstName(comm?.name ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate group-hover:text-blue-700">
                      {site.name}
                    </p>
                    <p className="text-xs text-gray-400 truncate">
                      {firstName(comm?.name ?? '')}
                      {site.city ? ` · ${site.city}` : ''}
                      <span className="ml-1 text-gray-300">· {relTime(ts)}</span>
                    </p>
                  </div>
                  <span className="text-[10px] text-gray-300 mt-1 flex-shrink-0">
                    {site.type === 'siege' ? '🏢' : '🏗️'}
                  </span>
                </button>
              )
            })}
          </div>
        )}

        {/* Commercials filter */}
        <div className="p-4 border-b">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Commerciaux</p>
          {commercials.map((c) => {
            const color = getColor(c.id)
            const cs = sites.filter(s => s.commercial_id === c.id)
            const active = visibleCommercials.has(c.id)
            return (
              <button
                key={c.id}
                onClick={() => toggleCommercial(c.id)}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl mb-2 transition-all ${
                  active ? 'bg-gray-50' : 'bg-white opacity-50'
                }`}
              >
                <div
                  className="w-11 h-11 rounded-2xl flex items-center justify-center text-white font-extrabold text-base flex-shrink-0"
                  style={{ background: color }}
                >
                  {c.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <p className="font-semibold text-sm text-gray-800 truncate">{firstName(c.name)}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {cs.filter(s => s.type === 'siege').length} siège ·{' '}
                    {cs.filter(s => s.type === 'chantier').length} chantier
                  </p>
                </div>
                <div
                  className={`w-5 h-5 rounded-full flex-shrink-0 transition-all ${
                    active ? '' : 'border-2 border-gray-300'
                  }`}
                  style={active ? { background: color } : {}}
                />
              </button>
            )
          })}
        </div>

        {/* Type filter */}
        <div className="p-4">
          <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest mb-3">Type de site</p>
          {TYPE_OPTS.map(opt => {
            const count = sites.filter(s => s.type === opt.value).length
            const active = visibleTypes.has(opt.value)
            return (
              <button
                key={opt.value}
                onClick={() => toggleType(opt.value)}
                className={`w-full flex items-center gap-3 p-3 rounded-2xl mb-2 border-2 transition-all ${
                  active ? 'border-blue-200 bg-blue-50' : 'border-gray-100 opacity-50'
                }`}
              >
                <span className="text-xl">{opt.emoji}</span>
                <span className={`flex-1 text-sm font-semibold text-left ${active ? 'text-blue-700' : 'text-gray-400'}`}>
                  {opt.label}
                </span>
                <span className={`text-sm font-bold ${active ? 'text-blue-600' : 'text-gray-300'}`}>{count}</span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
