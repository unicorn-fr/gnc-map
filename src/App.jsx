import { useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { supabase } from './lib/supabase'
import CommercialPicker from './components/CommercialPicker'
import MapView from './components/MapView'

export default function App() {
  const [commercial, setCommercial] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Restaurer le commercial choisi depuis localStorage
    const saved = localStorage.getItem('gnc_commercial')
    if (saved) {
      try {
        setCommercial(JSON.parse(saved))
      } catch {
        localStorage.removeItem('gnc_commercial')
      }
    }
    setLoading(false)
  }, [])

  const handleSelect = (c) => {
    localStorage.setItem('gnc_commercial', JSON.stringify(c))
    setCommercial(c)
  }

  const handleSwitch = () => {
    localStorage.removeItem('gnc_commercial')
    setCommercial(null)
  }

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-900">
        <div className="text-4xl mb-3">🗺️</div>
        <div className="text-white text-xl font-bold">GNC Map</div>
      </div>
    )
  }

  return (
    <>
      <Toaster
        position="top-center"
        toastOptions={{
          duration: 3000,
          style: { borderRadius: '12px', fontSize: '14px' },
        }}
      />
      {commercial
        ? <MapView commercial={commercial} onSwitch={handleSwitch} />
        : <CommercialPicker onSelect={handleSelect} />
      }
    </>
  )
}
