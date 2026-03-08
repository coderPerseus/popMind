import { useEffect, useState } from 'react'
import { MainSearch } from '@/app/components/home/MainSearch'
import { SettingsPage } from '@/app/components/settings/SettingsPage'
import './styles/app.css'

type AppRoute = 'home' | 'settings'

const getRouteFromHash = (): AppRoute => {
  return window.location.hash === '#/settings' ? 'settings' : 'home'
}

export default function App() {
  const [route, setRoute] = useState<AppRoute>(() => getRouteFromHash())

  useEffect(() => {
    const handleHashChange = () => {
      setRoute(getRouteFromHash())
    }

    window.addEventListener('hashchange', handleHashChange)
    return () => window.removeEventListener('hashchange', handleHashChange)
  }, [])

  return route === 'settings' ? <SettingsPage /> : <MainSearch />
}
