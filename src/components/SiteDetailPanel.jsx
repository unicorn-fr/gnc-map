import { useState, useEffect } from 'react'
import { X, Edit2, Trash2, Camera, Loader2, Phone, Mail, MapPin } from 'lucide-react'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'

const STATUS = {
  prospect: { label: 'Prospect', cls: 'bg-amber-100 text-amber-800' },
  client:   { label: 'Client',   cls: 'bg-green-100 text-green-800' },
  en_cours: { label: 'En cours', cls: 'bg-blue-100 text-blue-800' },
  termine:  { label: 'Terminé',  cls: 'bg-gray-100 text-gray-600' },
}

const compressImage = (file) =>
  new Promise((resolve) => {
    const canvas = document.createElement('canvas')
    const ctx = canvas.getContext('2d')
    const img = new Image()
    img.onload = () => {
      const ratio = Math.min(1400 / img.width, 1400 / img.height, 1)
      canvas.width = Math.round(img.width * ratio)
      canvas.height = Math.round(img.height * ratio)
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
      canvas.toBlob(
        (blob) => resolve(new File([blob], file.name, { type: 'image/jpeg' })),
        'image/jpeg', 0.82
      )
    }
    img.src = URL.createObjectURL(file)
  })

const fmt = (iso) =>
  new Date(iso).toLocaleString('fr-FR', {
    day: '2-digit', month: '2-digit', year: '2-digit',
    hour: '2-digit', minute: '2-digit',
  })

export default function SiteDetailPanel({ site, commercial, currentCommercialId, color, onClose, onUpdated }) {
  const [photos, setPhotos] = useState([])
  const [reports, setReports] = useState([])
  const [newReport, setNewReport] = useState('')
  const [editMode, setEditMode] = useState(false)
  const [editForm, setEditForm] = useState({
    name: site.name,
    company: site.company || '',
    status: site.status,
    notes: site.notes || '',
    phone: site.phone || '',
    email: site.email || '',
  })
  const [saving, setSaving] = useState(false)
  const [lightbox, setLightbox] = useState(null)

  const isOwner = currentCommercialId === site.commercial_id
  const statusInfo = STATUS[site.status] ?? STATUS.prospect

  useEffect(() => {
    loadPhotos()
    loadReports()
  }, [site.id])

  const loadPhotos = async () => {
    const { data } = await supabase.from('photos').select('*').eq('site_id', site.id).order('created_at', { ascending: false })
    if (data) setPhotos(data)
  }

  const loadReports = async () => {
    const { data } = await supabase.from('reports').select('*, commercials(id, name)').eq('site_id', site.id).order('created_at', { ascending: false })
    if (data) setReports(data)
  }

  const handleAddPhoto = async (e) => {
    const files = Array.from(e.target.files)
    for (const file of files) {
      try {
        const compressed = await compressImage(file)
        const path = `${currentCommercialId}/${site.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
        const { error } = await supabase.storage.from('site-photos').upload(path, compressed)
        if (!error) {
          const { data: { publicUrl } } = supabase.storage.from('site-photos').getPublicUrl(path)
          const { data: photo } = await supabase.from('photos')
            .insert({ site_id: site.id, commercial_id: currentCommercialId, url: publicUrl })
            .select().single()
          if (photo) setPhotos(prev => [photo, ...prev])
        }
      } catch { /* ignore */ }
    }
    toast.success('Photo ajoutée')
  }

  const handleDeletePhoto = async (photo) => {
    if (!window.confirm('Supprimer cette photo ?')) return
    await supabase.from('photos').delete().eq('id', photo.id)
    setPhotos(prev => prev.filter(p => p.id !== photo.id))
  }

  const handleAddReport = async () => {
    if (!newReport.trim()) return
    const { data } = await supabase.from('reports')
      .insert({ site_id: site.id, commercial_id: currentCommercialId, content: newReport.trim() })
      .select('*, commercials(id, name)').single()
    if (data) { setReports(prev => [data, ...prev]); setNewReport(''); toast.success('Rapport ajouté') }
  }

  const handleDeleteReport = async (id) => {
    if (!window.confirm('Supprimer ce rapport ?')) return
    await supabase.from('reports').delete().eq('id', id)
    setReports(prev => prev.filter(r => r.id !== id))
  }

  const handleSaveEdit = async () => {
    if (!editForm.name.trim()) return toast.error('Le nom est requis')
    setSaving(true)
    const { error } = await supabase.from('sites').update({
      name: editForm.name.trim(),
      company: editForm.company.trim() || null,
      status: editForm.status,
      notes: editForm.notes.trim() || null,
      phone: editForm.phone.trim() || null,
      email: editForm.email.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq('id', site.id)
    setSaving(false)
    if (error) return toast.error('Erreur lors de la mise à jour')
    toast.success('Site mis à jour')
    setEditMode(false)
    onUpdated()
  }

  const handleDelete = async () => {
    if (!window.confirm(`Supprimer "${site.name}" ?\n\nSi ce site a un Code client, il ne sera pas réimporté lors des prochaines importations Excel.`)) return
    await supabase.from('sites').update({ deleted: true, updated_at: new Date().toISOString() }).eq('id', site.id)
    toast.success('Site supprimé')
    onUpdated()
  }

  return (
    <>
      <div className="absolute inset-0 bg-white shadow-2xl flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b px-4 py-3">
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-1 flex-wrap">
                <div className="flex items-center gap-1.5">
                  <div className="w-2.5 h-2.5 rounded-full" style={{ background: color }} />
                  <span className="text-xs text-gray-500 font-medium">{commercial?.name ?? 'Commercial'}</span>
                </div>
                <span className={`text-[11px] px-2 py-0.5 rounded-full font-semibold ${statusInfo.cls}`}>
                  {statusInfo.label}
                </span>
                <span className="text-[11px] px-2 py-0.5 rounded-full bg-gray-100 text-gray-600 font-medium">
                  {site.type === 'siege' ? '🏢 Siège' : '🏗️ Chantier'}
                </span>
              </div>
              {!editMode && (
                <>
                  <h2 className="font-bold text-gray-900 text-base leading-tight">{site.name}</h2>
                  {site.company && <p className="text-sm text-gray-500 mt-0.5">{site.company}</p>}
                </>
              )}
            </div>
            <div className="flex items-center gap-1 flex-shrink-0">
              {isOwner && !editMode && (
                <>
                  <button onClick={() => setEditMode(true)} className="p-2 hover:bg-gray-100 rounded-xl">
                    <Edit2 size={15} className="text-gray-500" />
                  </button>
                  <button onClick={handleDelete} className="p-2 hover:bg-red-50 rounded-xl">
                    <Trash2 size={15} className="text-red-400" />
                  </button>
                </>
              )}
              <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl ml-1">
                <X size={18} className="text-gray-500" />
              </button>
            </div>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          {/* Edit form */}
          {editMode && isOwner && (
            <div className="p-4 border-b bg-blue-50/50 space-y-3">
              {[
                { key: 'name', label: 'Nom', placeholder: 'Nom du site' },
                { key: 'company', label: 'Entreprise', placeholder: 'Raison sociale' },
                { key: 'phone', label: 'Téléphone', placeholder: '01 23 45 67 89' },
                { key: 'email', label: 'Email', placeholder: 'contact@entreprise.fr' },
              ].map(f => (
                <div key={f.key}>
                  <label className="text-xs font-semibold text-gray-600 mb-1 block">{f.label}</label>
                  <input
                    value={editForm[f.key]}
                    onChange={e => setEditForm(p => ({ ...p, [f.key]: e.target.value }))}
                    placeholder={f.placeholder}
                    className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              ))}
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">Statut</label>
                <select
                  value={editForm.status}
                  onChange={e => setEditForm(p => ({ ...p, status: e.target.value }))}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                >
                  <option value="prospect">🔍 Prospect</option>
                  <option value="client">✅ Client</option>
                  <option value="en_cours">🔄 En cours</option>
                  <option value="termine">✔️ Terminé</option>
                </select>
              </div>
              <div>
                <label className="text-xs font-semibold text-gray-600 mb-1 block">Notes</label>
                <textarea
                  value={editForm.notes}
                  onChange={e => setEditForm(p => ({ ...p, notes: e.target.value }))}
                  rows={3}
                  className="w-full border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                />
              </div>
              <div className="flex gap-2">
                <button onClick={() => setEditMode(false)} className="flex-1 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600">
                  Annuler
                </button>
                <button
                  onClick={handleSaveEdit}
                  disabled={saving}
                  className="flex-1 py-2.5 bg-blue-700 text-white rounded-xl text-sm font-semibold flex items-center justify-center gap-1.5 disabled:opacity-60"
                >
                  {saving && <Loader2 size={14} className="animate-spin" />}
                  Sauvegarder
                </button>
              </div>
            </div>
          )}

          {/* Contact info */}
          {!editMode && (site.phone || site.email || site.address) && (
            <div className="px-4 py-3 border-b space-y-1.5">
              {site.address && (
                <div className="flex items-center gap-2 text-sm text-gray-600">
                  <MapPin size={14} className="text-gray-400 flex-shrink-0" />
                  <span>{[site.address, site.postcode, site.city].filter(Boolean).join(', ')}</span>
                </div>
              )}
              {site.phone && (
                <a href={`tel:${site.phone}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                  <Phone size={14} className="flex-shrink-0" />
                  {site.phone}
                </a>
              )}
              {site.email && (
                <a href={`mailto:${site.email}`} className="flex items-center gap-2 text-sm text-blue-600 hover:underline">
                  <Mail size={14} className="flex-shrink-0" />
                  {site.email}
                </a>
              )}
            </div>
          )}

          {/* Notes */}
          {!editMode && site.notes && (
            <div className="px-4 py-3 border-b">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Notes</p>
              <p className="text-sm text-gray-700 whitespace-pre-wrap leading-relaxed">{site.notes}</p>
            </div>
          )}

          {/* Coordinates */}
          {site.lat && (
            <div className="px-4 py-2 border-b bg-gray-50">
              <p className="text-[11px] text-gray-400 font-mono">
                📍 {site.lat.toFixed(5)}, {site.lng.toFixed(5)}
              </p>
            </div>
          )}

          {/* Photos */}
          <div className="p-4 border-b">
            <div className="flex items-center justify-between mb-3">
              <h3 className="font-semibold text-sm text-gray-800">
                Photos <span className="text-gray-400 font-normal">({photos.length})</span>
              </h3>
              <label className="flex items-center gap-1.5 text-xs text-blue-600 font-semibold cursor-pointer hover:text-blue-800">
                <Camera size={14} />
                Ajouter
                <input type="file" accept="image/*" capture="environment" multiple onChange={handleAddPhoto} className="hidden" />
              </label>
            </div>
            {photos.length === 0 ? (
              <div className="text-center py-6">
                <Camera size={28} className="mx-auto text-gray-200 mb-2" />
                <p className="text-sm text-gray-400">Aucune photo</p>
              </div>
            ) : (
              <div className="grid grid-cols-3 gap-1.5">
                {photos.map(photo => (
                  <div
                    key={photo.id}
                    className="relative aspect-square rounded-xl overflow-hidden group cursor-pointer"
                    onClick={() => setLightbox(photo.url)}
                  >
                    <img src={photo.url} alt="" className="w-full h-full object-cover" loading="lazy" />
                    {isOwner && (
                      <button
                        onClick={(e) => { e.stopPropagation(); handleDeletePhoto(photo) }}
                        className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full items-center justify-center text-sm font-bold hidden group-hover:flex shadow"
                      >
                        ×
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Reports */}
          <div className="p-4">
            <h3 className="font-semibold text-sm text-gray-800 mb-3">
              Rapports <span className="text-gray-400 font-normal">({reports.length})</span>
            </h3>
            <div className="mb-4">
              <textarea
                value={newReport}
                onChange={e => setNewReport(e.target.value)}
                placeholder="Compte rendu de visite, observations..."
                rows={3}
                className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              />
              <button
                onClick={handleAddReport}
                disabled={!newReport.trim()}
                className="mt-2 w-full py-2.5 bg-blue-700 hover:bg-blue-800 text-white rounded-xl text-sm font-semibold disabled:opacity-40"
              >
                Ajouter le rapport
              </button>
            </div>
            <div className="space-y-3">
              {reports.map(report => (
                <div key={report.id} className="bg-gray-50 rounded-2xl p-3.5">
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-xs font-semibold text-gray-700">{report.commercials?.name}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-gray-400">{fmt(report.created_at)}</span>
                      {report.commercial_id === currentCommercialId && (
                        <button onClick={() => handleDeleteReport(report.id)} className="text-red-400 hover:text-red-600 font-bold text-sm">×</button>
                      )}
                    </div>
                  </div>
                  <p className="text-sm text-gray-800 whitespace-pre-wrap leading-relaxed">{report.content}</p>
                </div>
              ))}
              {reports.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-4">Aucun rapport</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {lightbox && (
        <div className="fixed inset-0 bg-black/95 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <img src={lightbox} alt="" className="max-w-full max-h-full object-contain rounded-xl" />
          <button onClick={() => setLightbox(null)} className="absolute top-5 right-5 text-white bg-black/50 rounded-full p-2">
            <X size={22} />
          </button>
        </div>
      )}
    </>
  )
}
