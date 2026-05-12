import { useState, useEffect } from 'react'
import { ArrowLeft, FileText, BookOpen, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'

const fmt = (iso) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })

const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

const capitalize = (str) => str.charAt(0).toUpperCase() + str.slice(1)

const dayLabel = (dateStr) =>
  capitalize(
    new Date(dateStr).toLocaleDateString('fr-FR', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  )

export default function ReportsPage({ commercial, allCommercials, onClose }) {
  const [reports, setReports] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterCommercial, setFilterCommercial] = useState(commercial.id)
  const [activeTab, setActiveTab] = useState('reports')
  const [journalEntries, setJournalEntries] = useState([]) // grouped: [{ dayLabel, dateStr, entries }]
  const [journalLoading, setJournalLoading] = useState(false)

  useEffect(() => {
    if (activeTab === 'reports') {
      loadReports()
    } else {
      loadJournal()
    }
  }, [activeTab, filterCommercial])

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

  const loadJournal = async () => {
    setJournalLoading(true)

    // Build filter helper
    const applyFilter = (q) =>
      filterCommercial !== 'all' ? q.eq('commercial_id', filterCommercial) : q

    const [sitesRes, photosRes, reportsRes] = await Promise.all([
      applyFilter(
        supabase
          .from('sites')
          .select('id, name, company, type, commercial_id, created_at, commercials(name, color)')
          .order('created_at', { ascending: false })
      ),
      applyFilter(
        supabase
          .from('photos')
          .select('id, created_at, commercial_id, site_id, sites(name), commercials(name, color)')
          .order('created_at', { ascending: false })
      ),
      applyFilter(
        supabase
          .from('reports')
          .select('id, created_at, content, commercial_id, site_id, sites(name), commercials(name, color)')
          .order('created_at', { ascending: false })
      ),
    ])

    const tagged = [
      ...(sitesRes.data ?? []).map((item) => ({ ...item, type: 'site', date: new Date(item.created_at) })),
      ...(photosRes.data ?? []).map((item) => ({ ...item, type: 'photo', date: new Date(item.created_at) })),
      ...(reportsRes.data ?? []).map((item) => ({ ...item, type: 'report', date: new Date(item.created_at) })),
    ]

    tagged.sort((a, b) => b.date - a.date)

    // Group by calendar day (YYYY-MM-DD)
    const groups = []
    const seen = {}
    for (const entry of tagged) {
      const key = entry.created_at.slice(0, 10)
      if (!seen[key]) {
        seen[key] = { dayLabel: dayLabel(key + 'T12:00:00'), dateStr: key, entries: [] }
        groups.push(seen[key])
      }
      seen[key].entries.push(entry)
    }

    setJournalEntries(groups)
    setJournalLoading(false)
  }

  const commColor = (id) => allCommercials.find(c => c.id === id)?.color ?? '#6B7280'

  const entryLabel = (entry) => {
    if (entry.type === 'site') {
      const parts = ['📍 Nouveau site ajouté —', entry.name]
      if (entry.company) parts.push(`(${entry.company})`)
      return parts.join(' ')
    }
    if (entry.type === 'photo') {
      return `📷 Photo ajoutée sur ${entry.sites?.name ?? 'site inconnu'}`
    }
    // report
    const siteName = entry.sites?.name ?? 'site inconnu'
    const preview = entry.content?.slice(0, 80) ?? ''
    const suffix = (entry.content?.length ?? 0) > 80 ? '…' : ''
    return `📝 Note sur ${siteName} : ${preview}${suffix}`
  }

  return (
    <div className="flex flex-col bg-gray-50" style={{ height: '100dvh' }}>
      {/* Header */}
      <div className="flex-shrink-0 bg-blue-950 text-white px-4 py-4 flex items-center gap-3" style={{ zIndex: 10 }}>
        <button onClick={onClose} className="p-2 hover:bg-blue-800 rounded-xl transition-colors">
          <ArrowLeft size={20} />
        </button>
        <div className="flex-1">
          <p className="font-bold text-base">
            {activeTab === 'reports' ? 'Rapports de visite' : "Journal d'activité"}
          </p>
          <p className="text-blue-300 text-xs">
            {activeTab === 'reports'
              ? 'Par date — du plus récent au plus ancien'
              : 'Sites, photos et notes par jour'}
          </p>
        </div>
        {activeTab === 'reports' && !loading && (
          <span className="text-blue-300 text-xs font-medium">
            {reports.length} rapport{reports.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Tab switcher */}
      <div className="flex-shrink-0 bg-blue-950 px-4 pb-3 flex gap-2">
        <button
          onClick={() => setActiveTab('reports')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'reports'
              ? 'bg-white text-blue-950'
              : 'bg-blue-900 text-blue-300 hover:bg-blue-800'
          }`}
        >
          <FileText size={13} />
          Rapports de visite
        </button>
        <button
          onClick={() => setActiveTab('journal')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
            activeTab === 'journal'
              ? 'bg-white text-blue-950'
              : 'bg-blue-900 text-blue-300 hover:bg-blue-800'
          }`}
        >
          <BookOpen size={13} />
          Journal d'activité
        </button>
      </div>

      {/* Commercial filter tabs */}
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

      {/* ── REPORTS TAB ── */}
      {activeTab === 'reports' && (
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
      )}

      {/* ── JOURNAL TAB ── */}
      {activeTab === 'journal' && (
        <div className="flex-1 overflow-y-auto p-4">
          {journalLoading ? (
            <div className="flex items-center justify-center py-16 gap-2 text-gray-400">
              <Loader2 size={20} className="animate-spin" />
              <span className="text-sm">Chargement…</span>
            </div>
          ) : journalEntries.length === 0 ? (
            <div className="text-center py-16">
              <BookOpen size={44} className="mx-auto text-gray-200 mb-3" />
              <p className="text-gray-400 font-medium">Aucune activité</p>
              <p className="text-gray-300 text-sm mt-1">
                Les actions apparaissent ici au fil du temps
              </p>
            </div>
          ) : (
            <div className="space-y-6">
              {journalEntries.map(({ dayLabel: label, dateStr, entries }) => (
                <div key={dateStr}>
                  {/* Day header */}
                  <div className="sticky top-0 z-10 mb-3">
                    <span className="inline-block bg-gray-200 text-gray-600 text-xs font-semibold px-3 py-1 rounded-full">
                      {label}
                    </span>
                  </div>

                  {/* Timeline entries */}
                  <div className="space-y-2 pl-2">
                    {entries.map((entry, idx) => {
                      const color = entry.commercials?.color ?? '#6B7280'
                      const commName = entry.commercials?.name ?? '—'
                      return (
                        <div
                          key={`${entry.type}-${entry.id}-${idx}`}
                          className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden flex"
                        >
                          {/* Left color border */}
                          <div className="w-1 flex-shrink-0" style={{ background: color }} />

                          <div className="flex-1 px-3 py-2.5">
                            {/* Entry label */}
                            <p className="text-sm text-gray-800 leading-snug">{entryLabel(entry)}</p>

                            {/* Commercial + time */}
                            <div className="flex items-center gap-1.5 mt-1.5">
                              <div
                                className="w-3.5 h-3.5 rounded-full flex-shrink-0"
                                style={{ background: color }}
                              />
                              <span className="text-[11px] text-gray-500 font-medium">{commName}</span>
                              <span className="text-[11px] text-gray-300">·</span>
                              <span className="text-[11px] text-gray-400">{fmtTime(entry.created_at)}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
