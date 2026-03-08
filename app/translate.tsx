import React from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from '@/app/components/ErrorBoundary'
import { TranslationPanel } from '@/app/components/translation/TranslationPanel'

ReactDOM.createRoot(document.getElementById('translate-root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <TranslationPanel />
    </ErrorBoundary>
  </React.StrictMode>,
)
