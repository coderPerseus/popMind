import { Check, Copy, GripHorizontal, LoaderCircle, Pin, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Button } from '@/app/components/ui/button'
import { ScrollArea } from '@/app/components/ui/scroll-area'
import { Select } from '@/app/components/ui/select'
import '@/app/components/translation/styles.css'
import { translationEngineLabels, translationEngineOrder } from '@/lib/translation/shared'
import type { TranslationWindowState } from '@/lib/translation/types'

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
  }>({
    pointerId: null,
    x: 0,
    y: 0,
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
    window.translationWindow.notifyInteraction()
    await window.translationWindow.retranslate({
      sourceLanguage,
      targetLanguage,
      engineId,
    })
  }

  const handleCopy = async () => {
    window.translationWindow.notifyInteraction()
    await window.translationWindow.copyTranslatedText()
    setCopied(true)
  }

  const handleEngineChange = async (nextEngineId: TranslationWindowState['engineId']) => {
    window.translationWindow.notifyInteraction()
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

  const handlePinToggle = async () => {
    window.translationWindow.notifyInteraction()
    const result = await window.translationWindow.setPinned(!state.pinned)
    setState((current) => ({ ...current, pinned: result.pinned }))
  }

  const stopDragging = (target?: EventTarget & HTMLButtonElement) => {
    const pointerId = dragState.current.pointerId
    if (pointerId == null) {
      return
    }

    dragState.current.pointerId = null

    if (target?.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId)
    }

    window.translationWindow.setDragging(false)
  }

  const handleDragStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    dragState.current.pointerId = event.pointerId
    dragState.current.x = event.screenX
    dragState.current.y = event.screenY
    window.translationWindow.notifyInteraction()
    window.translationWindow.setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const handleDragMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragState.current.pointerId !== event.pointerId) {
      return
    }

    const deltaX = event.screenX - dragState.current.x
    const deltaY = event.screenY - dragState.current.y
    if (deltaX === 0 && deltaY === 0) {
      return
    }

    dragState.current.x = event.screenX
    dragState.current.y = event.screenY

    window.translationWindow.moveWindow(deltaX, deltaY)
  }

  const handleDragEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (dragState.current.pointerId !== event.pointerId) {
      return
    }

    stopDragging(event.currentTarget)
  }

  return (
    <div className="translation-shell">
      <section className="translation-panel" ref={panelRef}>
        {/* ── Top bar: language selector + actions ── */}
        <div className="translation-topbar">
          <div className="translation-topbar-left">
            <Button
              className="translation-drag-handle"
              variant="ghost"
              size="icon-sm"
              onPointerDown={handleDragStart}
              onPointerMove={handleDragMove}
              onPointerUp={handleDragEnd}
              onPointerCancel={handleDragEnd}
              onLostPointerCapture={(event) => stopDragging(event.currentTarget)}
              aria-label="拖拽翻译气泡"
            >
              <GripHorizontal size={14} />
            </Button>

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
              onClick={handlePinToggle}
              aria-label={state.pinned ? 'Unpin translation window' : 'Pin translation window'}
            >
              <Pin size={14} />
            </Button>
            <Button
              className="translation-icon-btn"
              variant="ghost"
              size="icon-sm"
              onClick={() => {
                window.translationWindow.notifyInteraction()
                void window.translationWindow.closeWindow()
              }}
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
