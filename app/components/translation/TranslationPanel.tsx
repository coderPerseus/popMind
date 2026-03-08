import { Check, Copy, LoaderCircle, Pin, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { ScrollArea } from '@/app/components/ui/scroll-area'
import { Select } from '@/app/components/ui/select'
import '@/app/components/translation/styles.css'
import { translationEngineLabels, translationEngineOrder } from '@/lib/translation/shared'
import type { TranslationWindowState } from '@/lib/translation/types'

const DRAG_GUARD_MS = 260

const emptyState: TranslationWindowState = {
  status: 'idle',
  pinned: false,
  engineId: 'google',
  enabledEngineIds: ['google'],
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  sourceText: '',
  translatedText: '',
  languages: [],
}

export function TranslationPanel() {
  const [state, setState] = useState<TranslationWindowState>(emptyState)
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [targetLanguage, setTargetLanguage] = useState('en')
  const [engineId, setEngineId] = useState<TranslationWindowState['engineId']>('google')
  const [copied, setCopied] = useState(false)
  const panelRef = useRef<HTMLElement | null>(null)
  const dragState = useRef<{
    pointerId: number | null
    x: number
    y: number
    suppressUntil: number
  }>({
    pointerId: null,
    x: 0,
    y: 0,
    suppressUntil: 0,
  })

  useEffect(() => {
    let mounted = true

    const syncState = (nextState: TranslationWindowState) => {
      if (!mounted) {
        return
      }

      setState(nextState)
      setSourceLanguage(nextState.sourceLanguage)
      setTargetLanguage(nextState.targetLanguage)
      setEngineId(nextState.engineId)
      setCopied(false)
    }

    const unsubscribe = window.translationWindow.onState(syncState)
    void window.translationWindow.getState().then((nextState) => {
      if (nextState) {
        syncState(nextState)
      }
    })

    return () => {
      mounted = false
      unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!copied) {
      return
    }

    const timer = window.setTimeout(() => setCopied(false), 1500)
    return () => window.clearTimeout(timer)
  }, [copied])

  useEffect(() => {
    const measure = () => {
      if (!panelRef.current) {
        return
      }

      const nextHeight = Math.ceil(panelRef.current.scrollHeight + 20)
      window.translationWindow.resizeWindow(nextHeight)
    }

    const frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [state.status, state.translatedText, state.errorMessage, sourceLanguage, targetLanguage, engineId])

  const isIdle = state.status === 'idle' && !state.translatedText
  const availableEngineIds = state.enabledEngineIds.length ? state.enabledEngineIds : translationEngineOrder.filter((item) => item === state.engineId)

  const translatedPreview =
    state.status === 'loading'
      ? ''
      : state.status === 'error'
        ? state.errorMessage || '翻译失败'
        : state.translatedText || (isIdle ? '译文会展示在这里' : '')

  const handleRetranslate = async () => {
    await window.translationWindow.retranslate({
      sourceLanguage,
      targetLanguage,
      engineId,
    })
  }

  const handleCopy = async () => {
    await window.translationWindow.copyTranslatedText()
    setCopied(true)
  }

  const handleEngineChange = async (nextEngineId: TranslationWindowState['engineId']) => {
    setEngineId(nextEngineId)
    setCopied(false)

    if (!state.sourceText) {
      return
    }

    await window.translationWindow.retranslate({
      sourceLanguage,
      targetLanguage,
      engineId: nextEngineId,
    })
  }

  const stopDragBubble = (event: React.PointerEvent | React.MouseEvent) => {
    event.stopPropagation()
  }

  const handlePinToggle = async () => {
    const result = await window.translationWindow.setPinned(!state.pinned)
    setState((current) => ({ ...current, pinned: result.pinned }))
  }

  const handleDragStart = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) {
      return
    }

    dragState.current.pointerId = event.pointerId
    dragState.current.x = event.clientX
    dragState.current.y = event.clientY
    dragState.current.suppressUntil = Date.now() + DRAG_GUARD_MS
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleDragMove = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.clientX - dragState.current.x
    const deltaY = event.clientY - dragState.current.y

    dragState.current.x = event.clientX
    dragState.current.y = event.clientY

    window.translationWindow.moveWindow(deltaX, deltaY)
  }

  const handleDragEnd = (event: React.PointerEvent<HTMLDivElement>) => {
    if (dragState.current.pointerId !== event.pointerId) {
      return
    }

    dragState.current.pointerId = null
    event.currentTarget.releasePointerCapture(event.pointerId)
  }



  return (
    <div className="translation-shell">
      <section className="translation-panel" ref={panelRef}>

        {/* ── Top bar: language selector + actions ── */}
        <div
          className="translation-topbar"
          onPointerDown={handleDragStart}
          onPointerMove={handleDragMove}
          onPointerUp={handleDragEnd}
          onPointerCancel={handleDragEnd}
        >
          <div className="translation-topbar-left">
            <div className="translation-select-wrap">
              <Select value={sourceLanguage} onChange={(event) => setSourceLanguage(event.target.value)}>
                {state.languages.map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </div>

            <div className="translation-arrow" aria-hidden="true">
              →
            </div>

            <div className="translation-select-wrap">
              <Select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>
                {state.languages.filter((item) => item.code !== 'auto').map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="translation-topbar-actions">
            <Button
              className={`translation-icon-btn ${state.pinned ? 'is-active' : ''}`}
              variant="ghost"
              size="icon-sm"
              onPointerDown={stopDragBubble}
              onClick={handlePinToggle}
              aria-label={state.pinned ? 'Unpin translation window' : 'Pin translation window'}
            >
              <Pin size={14} />
            </Button>
            <Button
              className="translation-icon-btn"
              variant="ghost"
              size="icon-sm"
              onPointerDown={stopDragBubble}
              onClick={() => void window.translationWindow.closeWindow()}
              aria-label="Close translation window"
            >
              <X size={14} />
            </Button>
          </div>
        </div>

        {/* ── Body: translation result ── */}
        <div className="translation-body">
          <div className="translation-result-shell">
            <ScrollArea className={`translation-result-card status-${state.status}`}>
              {state.status === 'loading' ? (
                <div className="translation-loading">
                  <div className="translation-loading-icon">
                    <LoaderCircle size={16} className="translation-spin" />
                  </div>
                  <div className="translation-loading-text">
                    <div className="translation-loading-title">翻译中</div>
                    <div className="translation-loading-desc">正在获取译文，请稍候…</div>
                  </div>
                </div>
              ) : (
                translatedPreview
              )}
            </ScrollArea>
          </div>
        </div>

        {/* ── Footer: engine selector + copy / retranslate ── */}
        <div className="translation-footer">
          <div className="translation-engine-select-wrap">
            <Select value={engineId} onChange={(event) => void handleEngineChange(event.target.value as TranslationWindowState['engineId'])}>
              {availableEngineIds.map((item) => (
                <option key={item} value={item}>
                  {translationEngineLabels[item]}
                </option>
              ))}
            </Select>
          </div>

          <div className="translation-footer-actions">
            <Button
              className="translation-action-btn"
              variant="ghost"
              size="sm"
              onClick={handleCopy}
              disabled={!state.translatedText || state.status === 'loading'}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              <span>{copied ? '已复制' : '复制'}</span>
            </Button>

            <Button
              className="translation-action-btn is-primary"
              variant="ghost"
              size="sm"
              onClick={handleRetranslate}
              disabled={state.status === 'loading' || !state.sourceText}
            >
              <RefreshCw size={13} className={state.status === 'loading' ? 'translation-spin' : ''} />
              <span>重新翻译</span>
            </Button>
          </div>
        </div>

      </section>
    </div>
  )
}
