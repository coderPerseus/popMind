import React from 'react'
import ReactDOM from 'react-dom/client'
import { ErrorBoundary } from '@/app/components/ErrorBoundary'
import { SelectionChatPanel } from '@/app/components/selection-chat/SelectionChatPanel'

ReactDOM.createRoot(document.getElementById('selection-chat-root') as HTMLElement).render(
  <React.StrictMode>
    <ErrorBoundary>
      <SelectionChatPanel />
    </ErrorBoundary>
  </React.StrictMode>,
)
