import { useCallback, useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { ArrowUpRight, Check, ChevronDown, Copy, LoaderCircle, RefreshCw, SendHorizontal, Square } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Select } from '@/app/components/ui/select'
import { Switch } from '@/app/components/ui/switch'
import { Textarea } from '@/app/components/ui/textarea'
import type { MainSearchCommand } from '@/app/components/home/query-command'
import { useI18n } from '@/app/i18n'
import { aiProviderLabels } from '@/lib/capability/ai-providers'
import type { AiProviderId } from '@/lib/capability/types'
import type { ExplainSession, ExplainSessionMessage } from '@/lib/explain/types'

type ExplainCardProps = {
  command: MainSearchCommand & { kind: 'explain' | 'gemma' }
  session: ExplainSession | null
  configuredProviders: AiProviderId[]
  selectedProviderId?: AiProviderId
  webSearchEnabled: boolean
  canSwitchProvider: boolean
  onReexplain: () => void
  onSubmitFollowup: (text: string) => Promise<boolean> | boolean
  onStop: () => void
  onWebSearchChange: (enabled: boolean) => void
  onProviderChange: (providerId: AiProviderId) => void
}

const AUTO_SCROLL_THRESHOLD_PX = 56

export function ExplainCard({
  command,
  session,
  configuredProviders,
  selectedProviderId,
  webSearchEnabled,
  canSwitchProvider,
  onReexplain,
  onSubmitFollowup,
  onStop,
  onWebSearchChange,
  onProviderChange,
}: ExplainCardProps) {
  const { language } = useI18n()
  const [draft, setDraft] = useState('')
  const [copiedMessageId, setCopiedMessageId] = useState<string | null>(null)
  const [isSending, setIsSending] = useState(false)
  const threadRef = useRef<HTMLDivElement | null>(null)
  const composerRef = useRef<HTMLTextAreaElement | null>(null)
  const shouldAutoScrollRef = useRef(true)
  const forceScrollSessionRef = useRef(0)
  const forceScrollTimeoutRef = useRef<number | null>(null)

  const isStreaming = session?.status === 'streaming' || session?.status === 'searching'
  const visibleMessages = session?.messages.filter((message, index) => !(index === 0 && message.role === 'user')) ?? []
  const statusLabel =
    session?.status === 'error' && !visibleMessages.some((message) => message.errorMessage)
      ? (session.errorMessage ?? '')
      : ''
  const isChatMode = command.kind === 'gemma' || session?.mode === 'chat'
  const queryPlaceholder = isChatMode
    ? language === 'en'
      ? 'Enter your message'
      : '输入想聊的内容'
    : language === 'en'
      ? 'Enter text to explain'
      : '输入要解释的文本'
  const idleHint = isChatMode
    ? language === 'en'
      ? 'Press Enter to start chatting'
      : '按回车开始对话'
    : language === 'en'
      ? 'Press Enter to start asking'
      : '按回车开始提问'
  const composerPlaceholder = isChatMode
    ? language === 'en'
      ? 'Continue chatting…'
      : '继续聊…'
    : language === 'en'
      ? 'Ask a follow-up…'
      : '继续提问…'

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
    if (!copiedMessageId) {
      return
    }

    const timer = window.setTimeout(() => setCopiedMessageId(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copiedMessageId])

  useEffect(() => {
    if (!shouldAutoScrollRef.current) {
      return
    }

    scheduleForceScrollToBottom()
  }, [scheduleForceScrollToBottom, session?.messages, session?.status])

  useEffect(() => {
    return () => {
      if (forceScrollTimeoutRef.current != null) {
        window.clearTimeout(forceScrollTimeoutRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!session) {
      setDraft('')
    }
  }, [session, session?.id])

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
      await onSubmitFollowup(message)
    } finally {
      setIsSending(false)
    }
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
    <section className={`ms-explain-shell ${session?.status === 'error' ? 'is-error' : ''}`}>
      <nav className="ms-explain-nav">
        <div className="ms-explain-command-query">{command.text || queryPlaceholder}</div>

        <div className="ms-explain-command-head-actions">
          <label className="ms-explain-network-toggle">
            <span>{language === 'en' ? 'Web' : '联网'}</span>
            <Switch
              checked={webSearchEnabled}
              size="sm"
              disabled={isStreaming}
              aria-label={language === 'en' ? 'Enable web search' : '开启联网搜索'}
              onCheckedChange={onWebSearchChange}
            />
          </label>

          {canSwitchProvider ? (
            <Select
              className="ms-explain-provider-select"
              value={selectedProviderId ?? ''}
              disabled={isStreaming}
              aria-label={language === 'en' ? 'AI provider' : '选择模型服务'}
              onChange={(event) => {
                const nextProvider = event.target.value as AiProviderId
                if (nextProvider) {
                  onProviderChange(nextProvider)
                }
              }}
            >
              {configuredProviders.map((providerId) => (
                <option key={providerId} value={providerId}>
                  {aiProviderLabels[providerId]}
                </option>
              ))}
            </Select>
          ) : null}
        </div>
      </nav>

      {!session ? (
        <div className="ms-explain-thread is-placeholder">
          <div className="ms-explain-command-plain is-placeholder">{idleHint}</div>
        </div>
      ) : (
        <div className="ms-explain-thread" ref={threadRef} onScroll={onThreadScroll}>
          {visibleMessages.map((message, index) => (
            <ExplainMessageBubble
              key={message.id}
              message={message}
              copied={copiedMessageId === message.id}
              uiLanguage={language}
              isStreaming={isStreaming}
              loadingLabel={session.loadingMessage}
              isAnimating={message.role === 'assistant' && index === visibleMessages.length - 1 && isStreaming}
              onCopy={async () => {
                if (!message.text) {
                  return
                }
                await navigator.clipboard.writeText(message.text)
                setCopiedMessageId(message.id)
              }}
            />
          ))}

          {statusLabel ? (
            <div className={`ms-explain-status ${session.status === 'error' ? 'is-error' : ''}`}>{statusLabel}</div>
          ) : null}
        </div>
      )}

      <footer className="ms-explain-dock">
        <div className="ms-explain-command-composer-frame">
          <Textarea
            ref={composerRef}
            className="ms-explain-command-input"
            rows={1}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={composerPlaceholder}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                if (session) {
                  void submit()
                }
              }
            }}
            disabled={!session}
          />

          <div className="ms-explain-send-wrap">
            <Button
              className="ms-explain-regenerate-btn"
              variant="ghost"
              size="sm"
              onClick={onReexplain}
              disabled={isStreaming || !command.text}
            >
              <RefreshCw size={13} />
              <span>{language === 'en' ? 'Regenerate' : '重新生成'}</span>
            </Button>

            {isStreaming ? (
              <Button className="ms-explain-command-send-btn" size="icon-sm" variant="outline" onClick={onStop}>
                <Square size={14} />
              </Button>
            ) : (
              <Button
                className="ms-explain-command-send-btn"
                size="icon-sm"
                onClick={() => {
                  if (session) {
                    void submit()
                  } else {
                    onReexplain()
                  }
                }}
                disabled={session ? !draft.trim() || isSending : !command.text.trim()}
              >
                {isSending ? <LoaderCircle className="ms-translate-command-spin" size={14} /> : <SendHorizontal size={14} />}
              </Button>
            )}
          </div>
        </div>
      </footer>
    </section>
  )
}

function ExplainMessageBubble({
  message,
  copied,
  uiLanguage,
  isStreaming,
  loadingLabel,
  isAnimating,
  onCopy,
}: {
  message: ExplainSessionMessage
  copied: boolean
  uiLanguage: 'zh-CN' | 'en'
  isStreaming: boolean
  loadingLabel?: string
  isAnimating: boolean
  onCopy: () => Promise<void>
}) {
  const [sourcesExpanded, setSourcesExpanded] = useState(false)
  const sourceToggleLabel =
    uiLanguage === 'en'
      ? `Sources${message.sources?.length ? ` · ${message.sources.length}` : ''}`
      : `参考来源${message.sources?.length ? ` · ${message.sources.length}` : ''}`
  const showLoading = message.role === 'assistant' && isStreaming && !message.text && !message.errorMessage
  const showStopped = message.role === 'assistant' && !isStreaming && !message.text && !message.errorMessage

  return (
    <article
      className={`ms-explain-message is-${message.role} ${isAnimating ? 'is-animating' : ''} ${message.errorMessage && !message.text ? 'is-error' : ''}`}
    >
      {message.text ? (
        <Streamdown
          className="ms-explain-markdown"
          mode={isAnimating ? 'streaming' : 'static'}
          isAnimating={isAnimating}
          animated={{ animation: 'blurIn', duration: 120, sep: 'word' }}
        >
          {message.text}
        </Streamdown>
      ) : showLoading ? (
        <div className="ms-explain-streaming">
          <LoaderCircle size={14} className="ms-translate-command-spin" />
          <span>{loadingLabel || (uiLanguage === 'en' ? 'Generating…' : '正在生成…')}</span>
        </div>
      ) : showStopped ? (
        <div className="ms-explain-streaming">{uiLanguage === 'en' ? 'Generation stopped' : '已停止生成'}</div>
      ) : null}

      {message.sources?.length ? (
        <div className={`ms-explain-sources-wrap ${sourcesExpanded ? 'is-expanded' : ''}`}>
          <button
            type="button"
            className="ms-explain-sources-toggle"
            onClick={() => setSourcesExpanded((current) => !current)}
            aria-expanded={sourcesExpanded}
          >
            <span className="ms-explain-sources-toggle-copy">
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
            <ChevronDown
              size={14}
              className={`ms-explain-sources-toggle-icon ${sourcesExpanded ? 'is-expanded' : ''}`}
            />
          </button>

          {sourcesExpanded ? (
            <div className="ms-explain-sources">
              {message.sources.map((source) => (
                <a key={`${source.url}-${source.provider}`} href={source.url} target="_blank" rel="noreferrer">
                  <div className="ms-explain-source-head">
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

      {message.errorMessage ? <div className="ms-explain-error">{message.errorMessage}</div> : null}

      {message.role === 'assistant' && !isAnimating && message.text ? (
        <div className="ms-explain-message-actions">
          <Button className="ms-explain-inline-btn ms-explain-action-btn" size="sm" variant="ghost" onClick={() => void onCopy()}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? (uiLanguage === 'en' ? 'Copied' : '已复制') : uiLanguage === 'en' ? 'Copy' : '复制'}</span>
          </Button>
        </div>
      ) : null}
    </article>
  )
}
