import { useState, useEffect } from 'react'
import { ArrowLeft, FileText, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const fmt = (iso) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

export default function ReportsPage({ commercial, allCommercials, onClose }) {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterCommercial, setFilterCommercial] = useState(commercial.id)

  useEffect(() => {
    loadReports()
  }, [filterCommercial])

  const loadReports = async () => {
    setLoading(true)
    let query = supabase
      .from('reports')
      .select('*, commercials(name, color), sites(name, company, type)')
      .order('created_at', { ascending: false })

    if (filterCommercial !== 'all') {
      query = query.eq('commercial_id', filterCommercial)
    }

    const { data } = await query
    if (data) setReports(data)
    setLoading(false)
  }

  const commColor = (id) => allCommercials.find(c => c.id === id)?.color ?? '#6B7280'

  return (
    <div className="flex flex-col bg-gray-50" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex-shrink-0 bg-blue-950 text-white px-4 py-4 flex items-center gap-3" style={{ zIndex: 10 }}>
        <button onClick={onClose} className="p-2 hover:bg-blue-800 rounded-xl transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <p className="font-bold text-base">Rapports de visite</p>
          <p className="text-blue-300 text-xs">Par date — du plus récent au plus ancien</p>
        </div>
        {!loading && (
          <span className="text-blue-300 text-xs font-medium">{reports.length} rapport{reports.length !== 1 ? 's' : ''}</span>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex-shrink-0 bg-white border-b px-4 py-2.5 flex gap-2 overflow-x-auto">
        <button
          onClick={() => setFilterCommercial('all')}
          className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
            filterCommercial === 'all' ? 'bg-blue-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Tous
        </button>
        {allCommercials.map(c => (
          <button
            key={c.id}
            onClick={() => setFilterCommercial(c.id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap transition-colors ${
              filterCommercial === c.id ? 'text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
            style={filterCommercial === c.id ? { background: c.color } : {}}
          >
            <div
              className="w-2 h-2 rounded-full flex-shrink-0"
              style={{ background: filterCommercial === c.id ? 'rgba(255,255,255,0.7)' : c.color }}
            />
            {c.name}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
            <Loader2 size={20} className="animate-spin" />
            <span className="text-sm">Chargement…</span>
          </div>
        ) : reports.length === 0 ? (
          <div className="text-center py-16">
            <FileText size={44} className="mx-auto text-gray-200 mb-3" />
            <p className="text-gray-400 font-medium">Aucun rapport</p>
            <p className="text-gray-300 text-sm mt-1">
              Les rapports s'ajoutent depuis la fiche d'un site
            </p>
          </div>
        ) : (
          reports.map(report => {
            const siteType = report.sites?.type
            return (
              <div key={report.id} className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
                {/* Card header */}
                <div className="px-4 pt-3.5 pb-2.5 border-b border-gray-50 flex items-start gap-2 justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <span className="font-bold text-gray-900 text-sm truncate">{report.sites?.name ?? 'Site inconnu'}</span>
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold flex-shrink-0 ${
                        siteType === 'siege' ? 'bg-purple-50 text-purple-700' : 'bg-orange-50 text-orange-700'
                      }`}>
                        {siteType === 'siege' ? '🏢 Siège' : '🏗️ Chantier'}
                      </span>
                    </div>
                    {report.sites?.company && (
                      <p className="text-xs text-gray-400 truncate">{report.sites.company}</p>
                    )}
                  </div>
                  <span className="text-[11px] text-gray-400 flex-shrink-0 mt-0.5">{fmt(report.created_at)}</span>
                </div>

                {/* Report content */}
                <div className="px-4 py-3">
                  <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{report.content}</p>
                </div>

                {/* Footer */}
                <div className="px-4 pb-3 flex items-center gap-2">
                  <div className="w-5 h-5 rounded-lg flex items-center justify-center text-white text-[10px] font-bold flex-shrink-0" style={{ background: commColor(report.commercial_id) }}>
                    {(report.commercials?.name ?? '?').charAt(0).toUpperCase()}
                  </div>
                  <span className="text-xs text-gray-500 font-medium">{report.commercials?.name ?? '—'}</span>
                </div>
              </div>
            )
          })
        )}
      </div>
    </div>
  )
}
