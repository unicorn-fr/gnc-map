import { useState, useEffect, useRef } from 'react'
import { X, Camera, Loader2 } from 'lucide-react'
import { supabase } from '../lib/supabase'
import { compressImage } from '../lib/compressImage'
import { sendPushToAll } from '../lib/push'
import { firstName } from '../lib/utils'
import toast from 'react-hot-toast'

export default function AddSiteModal({ position, commercial, onSave, onClose }) {
  const [form, setForm] = useState({
    name: '',
    company: '',
    type: 'chantier',
    status: 'prospect',
    notes: '',
  })
  const [previews, setPreviews] = useState([])
  const [photoFiles, setPhotoFiles] = useState([])
  const [saving, setSaving] = useState(false)

  const [allNames, setAllNames] = useState([])
  const [allCompanies, setAllCompanies] = useState([])
  const [nameSuggestions, setNameSuggestions] = useState([])
  const [companySuggestions, setCompanySuggestions] = useState([])

  const nameRef = useRef(null)
  const companyRef = useRef(null)

  useEffect(() => {
    supabase
      .from('sites')
      .select('name, company')
      .then(({ data }) => {
        if (!data) return
        const names = [...new Set(data.map(r => r.name).filter(Boolean))].sort()
        const companies = [...new Set(data.map(r => r.company).filter(Boolean))].sort()
        setAllNames(names)
        setAllCompanies(companies)
      })
  }, [])

  useEffect(() => {
    const handleClick = (e) => {
      if (nameRef.current && !nameRef.current.contains(e.target)) {
        setNameSuggestions([])
      }
      if (companyRef.current && !companyRef.current.contains(e.target)) {
        setCompanySuggestions([])
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  const set = (key) => (e) => setForm(prev => ({ ...prev, [key]: e.target.value }))

  const handlePhotos = (e) => {
    const files = Array.from(e.target.files)
    setPreviews(prev => [...prev, ...files.map(f => URL.createObjectURL(f))])
    setPhotoFiles(prev => [...prev, ...files])
  }

  const removePhoto = (i) => {
    setPreviews(prev => prev.filter((_, idx) => idx !== i))
    setPhotoFiles(prev => prev.filter((_, idx) => idx !== i))
  }

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!form.name.trim()) return toast.error('Le nom est requis')

    setSaving(true)
    try {
      const { data: site, error: siteErr } = await supabase
        .from('sites')
        .insert({
          commercial_id: commercial.id,
          name: form.name.trim(),
          company: form.company.trim() || null,
          type: form.type,
          status: form.status,
          notes: form.notes.trim() || null,
          lat: position?.lat ?? null,
          lng: position?.lng ?? null,
        })
        .select()
        .single()

      if (siteErr) throw siteErr

      for (const file of photoFiles) {
        try {
          const compressed = await compressImage(file)
          const path = `${commercial.id}/${site.id}/${Date.now()}-${Math.random().toString(36).slice(2)}.jpg`
          const { error: upErr } = await supabase.storage.from('site-photos').upload(path, compressed)
          if (!upErr) {
            const { data: { publicUrl } } = supabase.storage.from('site-photos').getPublicUrl(path)
            await supabase.from('photos').insert({
              site_id: site.id,
              commercial_id: commercial.id,
              url: publicUrl,
            })
          }
        } catch { /* continue if a photo fails */ }
      }

      toast.success('Site ajouté avec succès !')
      sendPushToAll(
        `${firstName(commercial.name)} a ajouté un site`,
        `${form.name.trim()}${form.company.trim() ? ` — ${form.company.trim()}` : ''}`,
        `/?site=${site.id}`,
        commercial.id
      )
      onSave(site)
    } catch (err) {
      console.error(err)
      toast.error("Erreur lors de l'enregistrement")
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 flex items-end sm:items-center justify-center" style={{ zIndex: 2000 }}>
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />

      <div className="relative bg-white w-full sm:max-w-lg rounded-t-3xl sm:rounded-3xl max-h-[92vh] flex flex-col shadow-2xl">
        <div className="flex justify-center pt-3 sm:hidden">
          <div className="w-10 h-1 bg-gray-200 rounded-full" />
        </div>

        <div className="flex items-center justify-between px-5 py-4 border-b">
          <h2 className="font-bold text-gray-900 text-lg">Nouveau point</h2>
          <button onClick={onClose} className="p-2 hover:bg-gray-100 rounded-xl transition-colors">
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="overflow-y-auto flex-1 px-5 py-4 space-y-4">
          {position ? (
            <div className="text-[11px] text-gray-400 bg-gray-50 rounded-xl px-3 py-2 font-mono flex items-center gap-2">
              <div className="w-2 h-2 rounded-full" style={{ background: commercial.color }} />
              {commercial.name} — 📍 {position.lat.toFixed(5)}, {position.lng.toFixed(5)}
            </div>
          ) : (
            <div className="text-[11px] text-gray-400 bg-gray-50 rounded-xl px-3 py-2 flex items-center gap-2">
              <Loader2 size={12} className="animate-spin text-blue-400" />
              Localisation GPS en cours…
            </div>
          )}

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">
              Nom du site <span className="text-red-500">*</span>
            </label>
            <div className="relative" ref={nameRef}>
              <input
                type="text"
                value={form.name}
                onChange={(e) => {
                  const val = e.target.value
                  setForm(prev => ({ ...prev, name: val }))
                  if (val.length >= 2) {
                    const q = val.toLowerCase()
                    setNameSuggestions(
                      allNames.filter(n => n.toLowerCase().includes(q)).slice(0, 6)
                    )
                  } else {
                    setNameSuggestions([])
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setNameSuggestions([]) } }}
                placeholder="Ex : Chantier Tour Lumière"
                required
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
              {nameSuggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {nameSuggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setForm(prev => ({ ...prev, name: s }))
                        setNameSuggestions([])
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Entreprise</label>
            <div className="relative" ref={companyRef}>
              <input
                type="text"
                value={form.company}
                onChange={(e) => {
                  const val = e.target.value
                  setForm(prev => ({ ...prev, company: val }))
                  if (val.length >= 2) {
                    const q = val.toLowerCase()
                    setCompanySuggestions(
                      allCompanies.filter(c => c.toLowerCase().includes(q)).slice(0, 6)
                    )
                  } else {
                    setCompanySuggestions([])
                  }
                }}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setCompanySuggestions([]) } }}
                placeholder="Ex : Bouygues Construction"
                className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 transition"
              />
              {companySuggestions.length > 0 && (
                <div className="absolute z-50 w-full mt-1 bg-white border border-gray-200 rounded-xl shadow-lg overflow-hidden">
                  {companySuggestions.map((s, i) => (
                    <button
                      key={i}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault()
                        setForm(prev => ({ ...prev, company: s }))
                        setCompanySuggestions([])
                      }}
                      className="w-full text-left px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                    >
                      {s}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Type de site</label>
            <div className="grid grid-cols-2 gap-2">
              {[
                { value: 'chantier', label: '🏗️ Chantier' },
                { value: 'siege', label: '🏢 Siège social' },
              ].map(opt => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => setForm(p => ({ ...p, type: opt.value }))}
                  className={`py-3 rounded-xl border-2 text-sm font-semibold transition-all ${
                    form.type === opt.value
                      ? 'border-blue-600 bg-blue-50 text-blue-700'
                      : 'border-gray-200 text-gray-500'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Statut</label>
            <select
              value={form.status}
              onChange={set('status')}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="prospect">🔍 Prospect</option>
              <option value="client">✅ Client</option>
              <option value="en_cours">🔄 En cours</option>
              <option value="termine">✔️ Terminé</option>
            </select>
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-1.5">Notes</label>
            <textarea
              value={form.notes}
              onChange={set('notes')}
              placeholder="Informations utiles, contact, matériel en place..."
              rows={3}
              className="w-full border border-gray-200 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div>
            <label className="block text-sm font-semibold text-gray-700 mb-2">Photos</label>
            <label className="flex flex-col items-center gap-2 w-full border-2 border-dashed border-gray-200 hover:border-blue-400 hover:bg-blue-50 rounded-2xl py-5 cursor-pointer transition-all">
              <Camera size={24} className="text-gray-400" />
              <span className="text-sm text-gray-500 font-medium">Prendre / Choisir des photos</span>
              <input
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                onChange={handlePhotos}
                className="hidden"
              />
            </label>

            {previews.length > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {previews.map((src, i) => (
                  <div key={i} className="relative aspect-square rounded-xl overflow-hidden">
                    <img src={src} alt="" className="w-full h-full object-cover" />
                    <button
                      type="button"
                      onClick={() => removePhoto(i)}
                      className="absolute top-1 right-1 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center text-sm font-bold shadow"
                    >
                      ×
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex gap-3 pt-2 pb-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-3.5 border border-gray-200 text-gray-600 rounded-xl font-semibold text-sm hover:bg-gray-50"
            >
              Annuler
            </button>
            <button
              type="submit"
              disabled={saving}
              className="flex-1 py-3.5 bg-blue-700 text-white rounded-xl font-semibold text-sm flex items-center justify-center gap-2 hover:bg-blue-800 disabled:opacity-60"
            >
              {saving ? (
                <>
                  <Loader2 size={16} className="animate-spin" />
                  Enregistrement...
                </>
              ) : (
                'Sauvegarder'
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
