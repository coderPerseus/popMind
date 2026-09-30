import React from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from '@/app/components/ErrorBoundary'
import { FocusOverlay } from '@/app/components/focus-overlay/FocusOverlay'

ReactDOM.createRoot(document.getElementById('focus-overlay-root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <FocusOverlay />
    </ErrorBoundary>
  </React.StrictMode>
)
