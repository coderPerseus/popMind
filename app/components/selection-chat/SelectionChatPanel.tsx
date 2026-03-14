import { ArrowUpRight, Check, ChevronDown, Copy, GripHorizontal, LoaderCircle, Pin, RotateCcw, SendHorizontal, Square, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { Button } from '@/app/components/ui/button'
import { Textarea } from '@/app/components/ui/textarea'
import { syncDocumentThemeWithSystemPreference } from '@/app/theme'
import type { SelectionChatMessage, SelectionChatWindowState } from '@/lib/selection-chat/types'
import './styles.css'

const emptyState: SelectionChatWindowState = {
  session: null,
}

const AUTO_SCROLL_THRESHOLD_PX = 56

export function SelectionChatPanel() {
  const [state, setState] = useState<SelectionChatWindowState>(emptyState)
  const [draft, setDraft] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const forceScrollSessionRef = useRef(0)
  const forceScrollTimeoutRef = useRef<number | null>(null)
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
  const statusLabel = session?.status === 'error' ? session.errorMessage ?? '' : ''
  const topbarMeta = [session?.aiProvider, session?.modelId, session?.webSearchProvider].filter(Boolean).join(' · ')
  const visibleMessages = session?.messages.filter((message, index) => !(index === 0 && message.role === 'user')) ?? []
  const latestAssistantMessageId = [...visibleMessages].reverse().find((message) => message.role === 'assistant')?.id

  const resizeComposer = () => {
    const composer = composerRef.current
    if (!composer) {
      return
    }

    composer.style.height = '0px'
    composer.style.height = `${Math.min(composer.scrollHeight, 128)}px`
  }

  const scrollThreadToBottom = useCallback(() => {
    const thread = threadRef.current
    if (!thread) {
      return
    }

    thread.scrollTo({
      top: thread.scrollHeight,
      behavior: 'auto',
    })
  }, [])

  const scheduleForceScrollToBottom = useCallback(() => {
    if (!shouldAutoScrollRef.current) {
      return
    }

    forceScrollSessionRef.current += 1
    const sessionId = forceScrollSessionRef.current

    if (forceScrollTimeoutRef.current != null) {
      window.clearTimeout(forceScrollTimeoutRef.current)
      forceScrollTimeoutRef.current = null
    }

    const run = () => {
      if (forceScrollSessionRef.current !== sessionId || !shouldAutoScrollRef.current) {
        return
      }

      scrollThreadToBottom()
    }

    run()
    requestAnimationFrame(() => {
      run()
      requestAnimationFrame(run)
    })
    forceScrollTimeoutRef.current = window.setTimeout(() => {
      run()
      forceScrollTimeoutRef.current = null
    }, 48)
  }, [scrollThreadToBottom])

  useEffect(() => {
    resizeComposer()
  }, [draft])

  useEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return
    }

    scheduleForceScrollToBottom()
  }, [scheduleForceScrollToBottom, state.session?.messages, state.session?.status])

  useEffect(() => {
    return () => {
      if (forceScrollTimeoutRef.current != null) {
        window.clearTimeout(forceScrollTimeoutRef.current)
      }
    }
  }, [])

  const submit = async () => {
    const message = draft.trim()
    if (!message || isStreaming) {
      return
    }

    shouldAutoScrollRef.current = true
    scheduleForceScrollToBottom()
    setDraft('')
    requestAnimationFrame(() => {
      resizeComposer()
      scheduleForceScrollToBottom()
    })
    setIsSending(true)
    try {
      const submitTask = window.selectionChatWindow.submitMessage(message)
      requestAnimationFrame(scheduleForceScrollToBottom)
      await submitTask
    } finally {
      setIsSending(false)
    }
  }

  const stopDragging = (element?: HTMLButtonElement) => {
    const pointerId = dragState.current.pointerId
    if (pointerId == null) {
      return
    }

    if (pointerId != null && element?.hasPointerCapture(pointerId)) {
      element.releasePointerCapture(pointerId)
    }

    window.selectionChatWindow.setDragging(false)
    dragState.current = {
      pointerId: null,
      x: 0,
      y: 0,
    }
  }

  const onPointerDownHeader = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    dragState.current = {
      pointerId: event.pointerId,
      x: event.screenX,
      y: event.screenY,
    }
    window.selectionChatWindow.setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
    window.selectionChatWindow.notifyInteraction()
  }

  const onPointerMoveHeader = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragState.current.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.screenX - dragState.current.x
    const deltaY = event.screenY - dragState.current.y
    if (deltaX === 0 && deltaY === 0) {
      return
    }

    dragState.current = {
      pointerId: event.pointerId,
      x: event.screenX,
      y: event.screenY,
    }
    window.selectionChatWindow.moveWindow(deltaX, deltaY)
  }

  const onPointerUpHeader = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragState.current.pointerId !== event.pointerId) {
      return
    }

    stopDragging(event.currentTarget)
  }

  const onThreadScroll = () => {
    const thread = threadRef.current
    if (!thread) {
      return
    }

    const distanceToBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight
    shouldAutoScrollRef.current = distanceToBottom <= AUTO_SCROLL_THRESHOLD_PX
  }

  return (
    <div className="selection-chat-shell">
      <section className="selection-chat-panel">
        <div className="selection-chat-topbar">
          <div className="selection-chat-topbar-left">
            <Button
              className="selection-chat-drag-handle"
              variant="ghost"
              size="icon-sm"
              onPointerDown={onPointerDownHeader}
              onPointerMove={onPointerMoveHeader}
              onPointerUp={onPointerUpHeader}
              onPointerCancel={(event) => stopDragging(event.currentTarget)}
              onLostPointerCapture={(event) => stopDragging(event.currentTarget)}
              aria-label={uiLanguage === 'en' ? 'Drag explain window' : '拖拽解释窗口'}
            >
              <GripHorizontal size={14} />
            </Button>

            <div className="selection-chat-topbar-copy">
              <div className="selection-chat-eyebrow">{uiLanguage === 'en' ? 'Selection Explain' : '划词解释'}</div>
              <div className="selection-chat-subtitle">{topbarMeta || (uiLanguage === 'en' ? 'Ready' : '就绪')}</div>
            </div>
          </div>

          <div className="selection-chat-topbar-actions">
            <Button
              className={`selection-chat-icon-btn ${session?.pinned ? 'is-active' : ''}`}
              variant="ghost"
              size="icon-sm"
              onClick={() => void window.selectionChatWindow.setPinned(!session?.pinned)}
              aria-label={uiLanguage === 'en' ? 'Pin' : '固定窗口'}
            >
              <Pin size={14} />
            </Button>
            <Button
              className="selection-chat-icon-btn"
              variant="ghost"
              size="icon-sm"
              onClick={() => void window.selectionChatWindow.closeWindow()}
              aria-label={uiLanguage === 'en' ? 'Close' : '关闭'}
            >
              <X size={14} />
            </Button>
          </div>
        </div>

        <div className="selection-chat-body">
          {session ? (
            <>
              <div className="selection-chat-context-card">
                <div className="selection-chat-context-text">{session.selectionText}</div>
              </div>

              <div className="selection-chat-thread-shell">
                <div className="selection-chat-thread" ref={threadRef} onScroll={onThreadScroll}>
                  {visibleMessages.map((message, index) => (
                    <MessageBubble
                      key={message.id}
                      message={message}
                      copied={copiedMessageId === message.id}
                      uiLanguage={uiLanguage}
                      isAnimating={message.role === 'assistant' && index === visibleMessages.length - 1 && isStreaming}
                      canRegenerate={message.id === latestAssistantMessageId}
                      onCopy={async () => {
                        await window.selectionChatWindow.copyMessage(message.id)
                        setCopiedMessageId(message.id)
                      }}
                      onRegenerate={() => void window.selectionChatWindow.regenerate()}
                    />
                  ))}

                  {statusLabel ? (
                    <div className={`selection-chat-status ${session.status === 'error' ? 'is-error' : ''}`}>{statusLabel}</div>
                  ) : null}
                  <div ref={messagesEndRef} />
                </div>
              </div>
            </>
          ) : (
            <div className="selection-chat-empty-card">
              <div className="selection-chat-empty-title">
                {uiLanguage === 'en' ? 'Explain selected text with context-aware AI' : '用带上下文的 AI 解释当前选区'}
              </div>
              <div className="selection-chat-empty-desc">
                {uiLanguage === 'en'
                  ? 'Select text and trigger Explain to open a polished conversation panel.'
                  : '先选中文本，再点击“解释”，这里会以更平滑的方式展示答案。'}
              </div>
            </div>
          )}
        </div>

        <footer className="selection-chat-composer">
          <div className="selection-chat-composer-frame">
            <Textarea
              ref={composerRef}
              className="selection-chat-input"
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={uiLanguage === 'en' ? 'Ask a follow-up…' : '继续追问…'}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.shiftKey) {
                  event.preventDefault()
                  void submit()
                }
              }}
            />

            {isStreaming ? (
              <Button className="selection-chat-send-btn" size="icon-sm" variant="outline" onClick={() => void window.selectionChatWindow.stop()}>
                <Square size={14} />
              </Button>
            ) : (
              <Button className="selection-chat-send-btn" size="icon-sm" onClick={() => void submit()} disabled={!draft.trim() || isSending}>
                {isSending ? <LoaderCircle className="animate-spin" size={14} /> : <SendHorizontal size={14} />}
              </Button>
            )}
          </div>
        </footer>
      </section>
    </div>
  )
}

function MessageBubble({
  message,
  copied,
  uiLanguage,
  isAnimating,
  canRegenerate,
  onCopy,
  onRegenerate,
}: {
  message: SelectionChatMessage
  copied: boolean
  uiLanguage: 'zh-CN' | 'en'
  isAnimating: boolean
  canRegenerate: boolean
  onCopy: () => Promise<void>
  onRegenerate: () => void
}) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false)
  const sourceToggleLabel =
    uiLanguage === 'en'
      ? `Sources${message.sources?.length ? ` · ${message.sources.length}` : ''}`
      : `参考来源${message.sources?.length ? ` · ${message.sources.length}` : ''}`

  return (
    <article className={`selection-chat-message is-${message.role} ${isAnimating ? 'is-animating' : ''}`}>
      {message.text ? (
        <Streamdown
          className="selection-chat-markdown"
          mode={isAnimating ? 'streaming' : 'static'}
          isAnimating={isAnimating}
          animated={{ animation: 'blurIn', duration: 120, sep: 'word' }}
        >
          {message.text}
        </Streamdown>
      ) : (
        <div className="selection-chat-streaming">
          <LoaderCircle size={14} className="animate-spin" />
        </div>
      )}

      {message.sources?.length ? (
        <div className={`selection-chat-sources-wrap ${sourcesExpanded ? 'is-expanded' : ''}`}>
          <button
            type="button"
            className="selection-chat-sources-toggle"
            onClick={() => setSourcesExpanded((current) => !current)}
            aria-expanded={sourcesExpanded}
          >
            <span className="selection-chat-sources-toggle-copy">
              <strong>{sourceToggleLabel}</strong>
              <span>
                {sourcesExpanded
                  ? uiLanguage === 'en'
                    ? 'Hide source list'
                    : '收起来源列表'
                  : uiLanguage === 'en'
                    ? 'Show source list'
                    : '展开来源列表'}
              </span>
            </span>
            <ChevronDown size={14} className={`selection-chat-sources-toggle-icon ${sourcesExpanded ? 'is-expanded' : ''}`} />
          </button>

          {sourcesExpanded ? (
            <div className="selection-chat-sources">
              {message.sources.map((source) => (
                <a key={`${source.url}-${source.provider}`} href={source.url} target="_blank" rel="noreferrer">
                  <div className="selection-chat-source-head">
                    <strong>{source.title}</strong>
                    <ArrowUpRight size={12} />
                  </div>
                  <span>{source.provider}</span>
                </a>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {message.errorMessage ? <div className="selection-chat-error">{message.errorMessage}</div> : null}

      {message.role === 'assistant' && !isAnimating && (message.text || message.errorMessage) ? (
        <div className="selection-chat-message-actions">
          {message.text ? (
            <Button className="selection-chat-inline-btn selection-chat-action-btn" size="sm" variant="ghost" onClick={() => void onCopy()}>
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>{copied ? (uiLanguage === 'en' ? 'Copied' : '已复制') : uiLanguage === 'en' ? 'Copy' : '复制'}</span>
            </Button>
          ) : null}

          {canRegenerate ? (
            <Button className="selection-chat-inline-btn selection-chat-action-btn" size="sm" variant="ghost" onClick={onRegenerate}>
              <RotateCcw size={14} />
              <span>{uiLanguage === 'en' ? 'Regenerate' : '重新生成'}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
