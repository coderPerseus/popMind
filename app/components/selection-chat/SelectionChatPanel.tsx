import { Check, Copy, LoaderCircle, Pin, SendHorizontal, Square, X } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/app/components/ui/button'
import { Input } from '@/app/components/ui/input'
import { syncDocumentThemeWithSystemPreference } from '@/app/theme'
import type { SelectionChatMessage, SelectionChatWindowState } from '@/lib/selection-chat/types'
import '@/app/components/translation/styles.css'
import './styles.css'

const emptyState: SelectionChatWindowState = {
  session: null,
}

export function SelectionChatPanel() {
  const [state, setState] = useState<SelectionChatWindowState>(emptyState)
  const [draft, setDraft] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const dragState = useRef<{ pointerId: number | null; x: number; y: number }>({ pointerId: null, x: 0, y: 0 })

  useEffect(() => {
    return syncDocumentThemeWithSystemPreference()
  }, [])

  useEffect(() => {
    let mounted = true
    const syncState = (nextState: SelectionChatWindowState) => {
      if (mounted) {
        setState(nextState)
      }
    }

    const unsubscribe = window.selectionChatWindow.onState(syncState)
    void window.selectionChatWindow.getState().then(syncState)

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ block: 'end' })
  }, [state.session?.messages, state.session?.status])

  useEffect(() => {
    if (!copiedMessageId) {
      return
    }

    const timer = window.setTimeout(() => setCopiedMessageId(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copiedMessageId])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault()
        void window.selectionChatWindow.dismissTopmost()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  const session = state.session
  const uiLanguage = session?.language ?? 'zh-CN'
  const isStreaming = session?.status === 'streaming' || session?.status === 'searching'
  const statusLabel = useMemo(() => {
    if (!session) {
      return ''
    }

    if (session.status === 'searching' || session.status === 'streaming') {
      return session.loadingMessage ?? ''
    }

    return session.errorMessage ?? ''
  }, [session])

  const submit = async () => {
    if (!draft.trim() || isStreaming) {
      return
    }

    setIsSending(true)
    try {
      await window.selectionChatWindow.submitMessage(draft)
      setDraft('')
    } finally {
      setIsSending(false)
    }
  }

  const onPointerDownHeader = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    dragState.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
    event.currentTarget.setPointerCapture(event.pointerId)
    window.selectionChatWindow.notifyInteraction(1000)
  }

  const onPointerMoveHeader = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - dragState.current.x
    const deltaY = event.clientY - dragState.current.y
    dragState.current = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
    }
    window.selectionChatWindow.moveWindow(deltaX, deltaY)
  }

  const onPointerUpHeader = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current.pointerId !== event.pointerId) {
      return
    }

    dragState.current = {
      pointerId: null,
      x: 0,
      y: 0,
    }
    event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return (
    <div className="selection-chat-shell">
      <section className="selection-chat-card">
        <header
          className="selection-chat-header"
          onPointerDown={onPointerDownHeader}
          onPointerMove={onPointerMoveHeader}
          onPointerUp={onPointerUpHeader}
        >
          <div>
            <div className="selection-chat-title">{session?.selectionText || (uiLanguage === 'en' ? 'Selection Explain' : '划词解释')}</div>
            <div className="selection-chat-subtitle">
              {session?.aiProvider ? `${session.aiProvider}${session.webSearchProvider ? ` · ${session.webSearchProvider}` : ''}` : ''}
            </div>
          </div>

          <div className="selection-chat-header-actions">
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void window.selectionChatWindow.setPinned(!session?.pinned)}
              aria-label={uiLanguage === 'en' ? 'Pin' : '固定窗口'}
            >
              <Pin size={16} className={session?.pinned ? 'is-active' : ''} />
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void window.selectionChatWindow.closeWindow()}
              aria-label={uiLanguage === 'en' ? 'Close' : '关闭'}
            >
              <X size={16} />
            </Button>
          </div>
        </header>

        <div className="selection-chat-body">
          {session?.messages.map((message) => (
            <MessageBubble
              key={message.id}
              message={message}
              copied={copiedMessageId === message.id}
              uiLanguage={uiLanguage}
              onCopy={async () => {
                await window.selectionChatWindow.copyMessage(message.id)
                setCopiedMessageId(message.id)
              }}
            />
          ))}

          {statusLabel && <div className="selection-chat-status">{statusLabel}</div>}
          <div ref={messagesEndRef} />
        </div>

        <footer className="selection-chat-footer">
          <Input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={uiLanguage === 'en' ? 'Ask a follow-up…' : '继续追问…'}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                void submit()
              }
            }}
          />
          {isStreaming ? (
            <Button size="sm" variant="outline" onClick={() => void window.selectionChatWindow.stop()}>
              <Square size={14} />
            </Button>
          ) : (
            <Button size="sm" onClick={() => void submit()} disabled={!draft.trim() || isSending}>
              {isSending ? <LoaderCircle className="animate-spin" size={14} /> : <SendHorizontal size={14} />}
            </Button>
          )}
        </footer>
      </section>
    </div>
  )
}

function MessageBubble({
  message,
  copied,
  uiLanguage,
  onCopy,
}: {
  message: SelectionChatMessage
  copied: boolean
  uiLanguage: 'zh-CN' | 'en'
  onCopy: () => Promise<void>
}) {
  return (
    <article className={`selection-chat-message is-${message.role}`}>
      <div className="selection-chat-message-head">
        <span>{message.role === 'user' ? (uiLanguage === 'en' ? 'You' : '你') : 'AI'}</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void onCopy()}
          aria-label={uiLanguage === 'en' ? 'Copy message' : '复制消息'}
        >
          {copied ? <Check size={14} /> : <Copy size={14} />}
        </Button>
      </div>

      {message.text ? (
        <div className="selection-chat-markdown">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.text}</ReactMarkdown>
        </div>
      ) : (
        <div className="selection-chat-streaming">
          <LoaderCircle size={14} className="animate-spin" />
        </div>
      )}

      {message.sources?.length ? (
        <div className="selection-chat-sources">
          {message.sources.map((source) => (
            <a key={`${source.url}-${source.provider}`} href={source.url} target="_blank" rel="noreferrer">
              <strong>{source.title}</strong>
              <span>{source.provider}</span>
            </a>
          ))}
        </div>
      ) : null}

      {message.errorMessage ? <div className="selection-chat-error">{message.errorMessage}</div> : null}
    </article>
  )
}
