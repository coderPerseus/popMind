import React from 'react'
import ReactDOM from 'react-dom/client'
import icon from '@/resources/build/icon.png?asset'
import { WindowContextProvider, buildTitlebarMenus } from '@/app/components/window'
import { AppI18nProvider, useI18n } from '@/app/i18n'
import { ErrorBoundary } from './components/ErrorBoundary'
import App from './app'

const RendererRoot = () => {
  const { language } = useI18n()

  return (
    <WindowContextProvider titlebar={{ title: 'popMind', icon, menuItems: buildTitlebarMenus(language) }}>
      <App />
    </WindowContextProvider>
  )
}

ReactDOM.createRoot(document.getElementById('app') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppI18nProvider>
        <RendererRoot />
      </AppI18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
