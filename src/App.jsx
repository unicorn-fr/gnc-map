import { useEffect, useState } from 'react'
import { Toaster } from 'react-hot-toast'
import { supabase } from './lib/supabase'
import Auth from './components/Auth'
import MapView from './components/MapView'

export default function App() {
  const [session, setSession] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setLoading(false)
    })

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setSession(session)
    })

    return () => subscription.unsubscribe()
  }, [])

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-slate-900">
        <div className="text-4xl mb-3">🗺️</div>
        <div className="text-white text-xl font-bold">GNC Map</div>
        <div className="text-slate-400 text-sm mt-1">Chargement...</div>
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
      {session ? <MapView session={session} /> : <Auth />}
    </>
  )
}
