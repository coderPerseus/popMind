import { useCallback, useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { ArrowUpRight, Check, ChevronDown, Copy, LoaderCircle, RefreshCw, SendHorizontal, Square } from 'lucide-react'
import { Button } from '@/app/components/ui/button'
import { Textarea } from '@/app/components/ui/textarea'
import type { MainSearchCommand } from '@/app/components/home/query-command'
import { useI18n } from '@/app/i18n'
import type { ExplainSession, ExplainSessionMessage } from '@/lib/explain/types'

type ExplainCardProps = {
  command: MainSearchCommand & { kind: 'explain' }
  session: ExplainSession | null
  onReexplain: () => void
  onSubmitFollowup: (text: string) => Promise<boolean> | boolean
  onStop: () => void
}

const AUTO_SCROLL_THRESHOLD_PX = 56

export function ExplainCard({ command, session, onReexplain, onSubmitFollowup, onStop }: ExplainCardProps) {
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
  const statusLabel = session?.status === 'error' ? (session.errorMessage ?? '') : ''
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
  }, [session?.id])

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
    <div className="ms-command-stack">
      <section className={`ms-explain-command-card ${session?.status === 'error' ? 'is-error' : ''}`}>
        <div className="ms-explain-command-head">
          <div className="ms-explain-command-head-copy">
            <div className="ms-explain-command-eyebrow">{language === 'en' ? 'Explanation' : '解释卡片'}</div>
            <div className="ms-explain-command-query">
              {command.text || (language === 'en' ? 'Enter text to explain' : '输入要解释的文本')}
            </div>
          </div>

          <div className="ms-explain-command-meta-wrap">
            {isStreaming ? (
              <div className="ms-explain-command-status">
                <LoaderCircle size={13} className="ms-translate-command-spin" />
                <span>{language === 'en' ? 'Explaining' : '解释中'}</span>
              </div>
            ) : topbarMeta ? (
              <div className="ms-explain-command-meta">
                {topbarMeta.split(' · ').map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>
            ) : null}
          </div>
        </div>

        {!session ? (
          <div className="ms-explain-command-body is-placeholder">
            <div className="ms-explain-command-plain">
              {language === 'en' ? 'Press Enter to start asking' : '按回车开始提问'}
            </div>
          </div>
        ) : (
          <>
            <div className="ms-explain-context-card">
              <div className="ms-explain-context-text">{session.selectionText}</div>
            </div>

            <div className="ms-explain-thread-shell">
              <div className="ms-explain-thread" ref={threadRef} onScroll={onThreadScroll}>
                {visibleMessages.map((message, index) => (
                  <ExplainMessageBubble
                    key={message.id}
                    message={message}
                    copied={copiedMessageId === message.id}
                    uiLanguage={language}
                    isAnimating={message.role === 'assistant' && index === visibleMessages.length - 1 && isStreaming}
                    canRegenerate={message.id === latestAssistantMessageId}
                    onCopy={async () => {
                      if (!message.text) {
                        return
                      }
                      await navigator.clipboard.writeText(message.text)
                      setCopiedMessageId(message.id)
                    }}
                    onRegenerate={onReexplain}
                  />
                ))}

                {statusLabel ? (
                  <div className={`ms-explain-status ${session.status === 'error' ? 'is-error' : ''}`}>
                    {statusLabel}
                  </div>
                ) : null}
              </div>
            </div>
          </>
        )}

        <div className="ms-explain-command-footer">
          <div className="ms-explain-command-footer-meta">
            {session ? (
              <span>{session.language === 'en' ? 'English output' : '中文输出'}</span>
            ) : (
              <span>{language === 'en' ? 'Press Enter to ask' : '按回车开始提问'}</span>
            )}
          </div>

          <div className="ms-translate-command-footer-actions">
            <Button
              className="ms-translate-command-action-btn is-primary"
              variant="ghost"
              size="sm"
              onClick={onReexplain}
              disabled={isStreaming || !command.text}
            >
              <RefreshCw size={13} className={isStreaming ? 'ms-translate-command-spin' : ''} />
              <span>{language === 'en' ? 'Regenerate' : '重新生成'}</span>
            </Button>
          </div>
        </div>

        <footer className="ms-explain-command-composer">
          <div className="ms-explain-command-composer-frame">
            <Textarea
              ref={composerRef}
              className="ms-explain-command-input"
              rows={1}
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={language === 'en' ? 'Ask a follow-up…' : '继续提问…'}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && event.shiftKey) {
                  event.preventDefault()
                  if (session) {
                    void submit()
                  }
                }
              }}
              disabled={!session}
            />

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
                {isSending ? (
                  <LoaderCircle className="ms-translate-command-spin" size={14} />
                ) : (
                  <SendHorizontal size={14} />
                )}
              </Button>
            )}
          </div>
        </footer>
      </section>
    </div>
  )
}

function ExplainMessageBubble({
  message,
  copied,
  uiLanguage,
  isAnimating,
  canRegenerate,
  onCopy,
  onRegenerate,
}: {
  message: ExplainSessionMessage
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
    <article className={`ms-explain-message is-${message.role} ${isAnimating ? 'is-animating' : ''}`}>
      {message.text ? (
        <Streamdown
          className="ms-explain-markdown"
          mode={isAnimating ? 'streaming' : 'static'}
          isAnimating={isAnimating}
          animated={{ animation: 'blurIn', duration: 120, sep: 'word' }}
        >
          {message.text}
        </Streamdown>
      ) : (
        <div className="ms-explain-streaming">
          <LoaderCircle size={14} className="ms-translate-command-spin" />
        </div>
      )}

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

      {message.role === 'assistant' && !isAnimating && (message.text || message.errorMessage) ? (
        <div className="ms-explain-message-actions">
          {message.text ? (
            <Button
              className="ms-explain-inline-btn ms-explain-action-btn"
              size="sm"
              variant="ghost"
              onClick={() => void onCopy()}
            >
              {copied ? <Check size={14} /> : <Copy size={14} />}
              <span>
                {copied ? (uiLanguage === 'en' ? 'Copied' : '已复制') : uiLanguage === 'en' ? 'Copy' : '复制'}
              </span>
            </Button>
          ) : null}

          {canRegenerate ? (
            <Button
              className="ms-explain-inline-btn ms-explain-action-btn"
              size="sm"
              variant="ghost"
              onClick={onRegenerate}
            >
              <RefreshCw size={14} />
              <span>{uiLanguage === 'en' ? 'Regenerate' : '重新生成'}</span>
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}
