import { useEffect, useState } from 'react'
import { MainSearch } from '@/app/components/home/MainSearch'
import { SettingsPage } from '@/app/components/settings/SettingsPage'
import { AppI18nProvider } from '@/app/i18n'
import { syncDocumentThemeWithSystemPreference } from '@/app/theme'
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

  // Sync route to body for CSS targeting
  useEffect(() => {
    document.body.setAttribute('data-route', route)
  }, [route])

  useEffect(() => {
    return syncDocumentThemeWithSystemPreference()
  }, [])

  return <AppI18nProvider>{route === 'settings' ? <SettingsPage /> : <MainSearch />}</AppI18nProvider>
}
