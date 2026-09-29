import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/app/styles/globals.css'
import { ErrorBoundary } from '@/app/components/ErrorBoundary'
import { AppI18nProvider } from '@/app/i18n'
import { ClipboardPanelApp } from '@/app/components/clipboard-panel/ClipboardPanelApp'

async function bootstrap() {
  // Dev-only browser preview with fake data (`/clipboard-panel.html?mock`). Removed from production builds.
  if (import.meta.env.DEV && location.search.includes('mock')) {
    const { installMockConveyor } = await import('@/app/components/clipboard-panel/mock/install-mock')
    installMockConveyor()
  }

  ReactDOM.createRoot(document.getElementById('clipboard-panel-root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary>
        <AppI18nProvider>
          <ClipboardPanelApp />
        </AppI18nProvider>
      </ErrorBoundary>
    </React.StrictMode>
  )
}

void bootstrap()
