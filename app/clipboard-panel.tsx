import React from 'react'
import ReactDOM from 'react-dom/client'
import '@/app/styles/tokens.css'
import { ErrorBoundary } from '@/app/components/ErrorBoundary'
import { AppI18nProvider } from '@/app/i18n'
import { ClipboardPanelApp } from '@/app/components/clipboard-panel/ClipboardPanelApp'

ReactDOM.createRoot(document.getElementById('clipboard-panel-root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <AppI18nProvider>
        <ClipboardPanelApp />
      </AppI18nProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
