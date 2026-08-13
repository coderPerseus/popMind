import React from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from '@/app/components/ErrorBoundary'
import { InputTranslationPanel } from '@/app/components/input-translation/InputTranslationPanel'

ReactDOM.createRoot(document.getElementById('input-translation-root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <InputTranslationPanel />
    </ErrorBoundary>
  </React.StrictMode>
)
