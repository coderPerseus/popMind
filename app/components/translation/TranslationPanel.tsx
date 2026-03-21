import { Check, Copy, GripHorizontal, LoaderCircle, Pin, RefreshCw, Square, Volume2, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Streamdown } from 'streamdown'
import { Button } from '@/app/components/ui/button'
import { Select } from '@/app/components/ui/select'
import '@/app/components/translation/styles.css'
import { syncDocumentThemeWithSystemPreference } from '@/app/theme'
import {
  getLanguageFamily,
  getTranslationWindowMinHeight,
  translationEngineLabels,
  translationEngineOrder,
} from '@/lib/translation/shared'
import type { TranslationWindowResizeEdge, TranslationWindowState } from '@/lib/translation/types'

const emptyState: TranslationWindowState = {
  status: 'idle',
  pinned: false,
  queryMode: 'text',
  engineId: 'google',
  enabledEngineIds: ['google'],
  sourceLanguage: 'auto',
  targetLanguage: 'en',
  sourceText: '',
  translatedText: '',
  languages: [],
}

const resizeHandleConfigs: Array<{ edge: TranslationWindowResizeEdge; label: string }> = [
  { edge: 'top', label: '从顶部调整翻译窗口大小' },
  { edge: 'right', label: '从右侧调整翻译窗口大小' },
  { edge: 'bottom', label: '从底部调整翻译窗口大小' },
  { edge: 'left', label: '从左侧调整翻译窗口大小' },
  { edge: 'top-left', label: '从左上角调整翻译窗口大小' },
  { edge: 'top-right', label: '从右上角调整翻译窗口大小' },
  { edge: 'bottom-left', label: '从左下角调整翻译窗口大小' },
  { edge: 'bottom-right', label: '从右下角调整翻译窗口大小' },
]

const getSpeechLocale = (languageCode: string, phoneticLabel?: string) => {
  const normalizedCode = languageCode.toLowerCase()

  if (phoneticLabel === 'US') {
    return 'en-US'
  }

  if (phoneticLabel === 'UK') {
    return 'en-GB'
  }

  switch (getLanguageFamily(normalizedCode)) {
    case 'zh':
      return normalizedCode === 'zh-tw' ? 'zh-TW' : 'zh-CN'
    case 'en':
      return 'en-US'
    case 'ja':
      return 'ja-JP'
    case 'ko':
      return 'ko-KR'
    case 'fr':
      return 'fr-FR'
    case 'de':
      return 'de-DE'
    case 'es':
      return 'es-ES'
    case 'ru':
      return 'ru-RU'
    case 'it':
      return 'it-IT'
    case 'pt':
      return 'pt-PT'
    default:
      return languageCode
  }
}

const resolveSpeechVoice = (lang: string) => {
  const voices = window.speechSynthesis.getVoices()
  const normalizedLang = lang.toLowerCase()
  const family = getLanguageFamily(normalizedLang)

  return (
    voices.find((voice) => voice.lang.toLowerCase() === normalizedLang) ??
    voices.find((voice) => voice.lang.toLowerCase().startsWith(`${family}-`)) ??
    voices.find((voice) => getLanguageFamily(voice.lang) === family)
  )
}

export function TranslationPanel() {
  const [state, setState] = useState<TranslationWindowState>(emptyState)
  const [sourceLanguage, setSourceLanguage] = useState('auto')
  const [targetLanguage, setTargetLanguage] = useState('en')
  const [engineId, setEngineId] = useState<TranslationWindowState['engineId']>('google')
  const [copied, setCopied] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [activeResizeEdge, setActiveResizeEdge] = useState<TranslationWindowResizeEdge | null>(null)
  const panelRef = useRef<HTMLElement | null>(null)
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null)
  const speakingRef = useRef(false)
  const hasManualResizeRef = useRef(false)
  const dragState = useRef<{
    pointerId: number | null
    x: number
    y: number
  }>({
    pointerId: null,
    x: 0,
    y: 0,
  })
  const resizeState = useRef<{
    pointerId: number | null
    edge: TranslationWindowResizeEdge | null
    x: number
    y: number
    pendingX: number
    pendingY: number
    frameId: number | null
  }>({
    pointerId: null,
    edge: null,
    x: 0,
    y: 0,
    pendingX: 0,
    pendingY: 0,
    frameId: null,
  })

  useEffect(() => {
    return syncDocumentThemeWithSystemPreference()
  }, [])

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
    speakingRef.current = isSpeaking
  }, [isSpeaking])

  useEffect(() => {
    if (!('speechSynthesis' in window)) {
      return
    }

    return () => {
      window.speechSynthesis.cancel()
      utteranceRef.current = null
    }
  }, [])

  useEffect(() => {
    if (state.status === 'loading') {
      hasManualResizeRef.current = false
    }
  }, [state.status, state.sourceText])

  useEffect(() => {
    const resizeTracker = resizeState.current

    return () => {
      if (resizeTracker.frameId != null) {
        cancelAnimationFrame(resizeTracker.frameId)
      }
    }
  }, [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') {
        return
      }

      event.preventDefault()
      void window.translationWindow.dismissTopmost()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [])

  useEffect(() => {
    if (!speakingRef.current || !('speechSynthesis' in window)) {
      return
    }

    window.speechSynthesis.cancel()
    utteranceRef.current = null
    setIsSpeaking(false)
  }, [state.wordEntry?.headword, state.status])

  const isIdle = state.status === 'idle' && !state.translatedText
  const availableEngineIds = state.enabledEngineIds.length
    ? state.enabledEngineIds
    : translationEngineOrder.filter((item) => item === state.engineId)
  const isWordMode = state.queryMode === 'word'

  useEffect(() => {
    const measure = () => {
      if (!panelRef.current || hasManualResizeRef.current) {
        return
      }

      const nextHeight = Math.ceil(panelRef.current.scrollHeight + 20)
      window.translationWindow.resizeWindow({
        height: nextHeight,
        minHeight: getTranslationWindowMinHeight(state.queryMode),
        source: 'content',
      })
    }

    const frame = requestAnimationFrame(measure)
    return () => cancelAnimationFrame(frame)
  }, [
    state.status,
    state.translatedText,
    state.errorMessage,
    state.queryMode,
    state.wordEntry,
    sourceLanguage,
    targetLanguage,
    engineId,
    isWordMode,
  ])

  const translatedPreview =
    state.status === 'loading'
      ? ''
      : state.status === 'error'
        ? state.errorMessage || '翻译失败'
        : state.translatedText || (isIdle ? '译文会展示在这里' : '')
  const shouldRenderMarkdown = !isWordMode && state.status !== 'loading' && state.status !== 'error' && !isIdle

  const stopSpeaking = () => {
    if (!('speechSynthesis' in window)) {
      return
    }

    window.speechSynthesis.cancel()
    utteranceRef.current = null
    setIsSpeaking(false)
  }

  const handlePronounce = (phoneticLabel?: string) => {
    const headword = state.wordEntry?.headword?.trim()
    if (!headword || !('speechSynthesis' in window) || typeof SpeechSynthesisUtterance === 'undefined') {
      return
    }

    window.translationWindow.notifyInteraction(1500)

    if (isSpeaking) {
      stopSpeaking()
      return
    }

    const speechLanguage = getSpeechLocale(state.detectedSourceLanguage || state.sourceLanguage || 'en', phoneticLabel)
    const utterance = new SpeechSynthesisUtterance(headword)
    const voice = resolveSpeechVoice(speechLanguage)

    utterance.lang = speechLanguage
    utterance.rate = 0.92
    utterance.pitch = 1

    if (voice) {
      utterance.voice = voice
    }

    utterance.onend = () => {
      utteranceRef.current = null
      setIsSpeaking(false)
    }
    utterance.onerror = () => {
      utteranceRef.current = null
      setIsSpeaking(false)
    }

    utteranceRef.current = utterance
    setIsSpeaking(true)
    window.speechSynthesis.cancel()
    window.speechSynthesis.speak(utterance)
  }

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

  const handleTargetLanguageChange = async (nextTargetLanguage: string) => {
    window.translationWindow.notifyInteraction()
    setTargetLanguage(nextTargetLanguage)
    setCopied(false)

    if (!state.sourceText) {
      return
    }

    await window.translationWindow.retranslate({
      sourceLanguage,
      targetLanguage: nextTargetLanguage,
      engineId,
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

  const stopResizing = (target?: EventTarget & HTMLButtonElement) => {
    const pointerId = resizeState.current.pointerId
    if (pointerId == null) {
      return
    }

    if (resizeState.current.frameId != null) {
      cancelAnimationFrame(resizeState.current.frameId)
      resizeState.current.frameId = null
    }

    const deltaX = resizeState.current.pendingX - resizeState.current.x
    const deltaY = resizeState.current.pendingY - resizeState.current.y
    if (resizeState.current.edge && (deltaX !== 0 || deltaY !== 0)) {
      resizeState.current.x = resizeState.current.pendingX
      resizeState.current.y = resizeState.current.pendingY
      window.translationWindow.resizeWindow({
        source: 'manual',
        edge: resizeState.current.edge,
        deltaX,
        deltaY,
      })
    }

    resizeState.current.pointerId = null
    resizeState.current.edge = null

    if (target?.hasPointerCapture(pointerId)) {
      target.releasePointerCapture(pointerId)
    }

    setActiveResizeEdge(null)
    window.translationWindow.setDragging(false)
  }

  const handleResizeStart = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) {
      return
    }

    event.preventDefault()
    event.stopPropagation()

    const edge = event.currentTarget.dataset.edge as TranslationWindowResizeEdge | undefined
    if (!edge) {
      return
    }

    resizeState.current.pointerId = event.pointerId
    resizeState.current.edge = edge
    resizeState.current.x = event.screenX
    resizeState.current.y = event.screenY
    resizeState.current.pendingX = event.screenX
    resizeState.current.pendingY = event.screenY
    hasManualResizeRef.current = true
    setActiveResizeEdge(edge)
    window.translationWindow.notifyInteraction()
    window.translationWindow.setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  const flushResizeFrame = () => {
    resizeState.current.frameId = null

    if (!resizeState.current.edge) {
      return
    }

    const deltaX = resizeState.current.pendingX - resizeState.current.x
    const deltaY = resizeState.current.pendingY - resizeState.current.y
    if (deltaX === 0 && deltaY === 0) {
      return
    }

    resizeState.current.x = resizeState.current.pendingX
    resizeState.current.y = resizeState.current.pendingY
    window.translationWindow.resizeWindow({
      source: 'manual',
      edge: resizeState.current.edge,
      deltaX,
      deltaY,
    })
  }

  const handleResizeMove = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (resizeState.current.pointerId !== event.pointerId) {
      return
    }

    resizeState.current.pendingX = event.screenX
    resizeState.current.pendingY = event.screenY

    if (
      resizeState.current.pendingX === resizeState.current.x &&
      resizeState.current.pendingY === resizeState.current.y
    ) {
      return
    }

    if (resizeState.current.frameId != null) {
      return
    }

    resizeState.current.frameId = requestAnimationFrame(flushResizeFrame)
  }

  const handleResizeEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (resizeState.current.pointerId !== event.pointerId) {
      return
    }

    stopResizing(event.currentTarget)
  }

  return (
    <div className={`translation-shell ${activeResizeEdge ? 'is-resizing' : ''}`}>
      <section className={`translation-panel ${isWordMode ? 'is-word-mode' : 'is-text-mode'}`} ref={panelRef}>
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
              <Select
                value={sourceLanguage}
                onChange={(event) => setSourceLanguage(event.target.value)}
                disabled={isWordMode}
              >
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
              <Select
                value={targetLanguage}
                onChange={(event) => void handleTargetLanguageChange(event.target.value)}
                disabled={isWordMode}
              >
                {state.languages
                  .filter((item) => item.code !== 'auto')
                  .map((item) => (
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
            <div className={`translation-result-card status-${state.status}`}>
              <div className={`translation-result-content ${isWordMode ? 'is-word-mode' : ''}`}>
                {state.status === 'loading' ? (
                  <div className="translation-loading">
                    <div className="translation-loading-icon">
                      <LoaderCircle size={16} className="translation-spin" />
                    </div>
                    <div className="translation-loading-text">
                      <div className="translation-loading-title">{state.loadingTitle || '翻译中'}</div>
                      <div className="translation-loading-desc">
                        {state.loadingDescription || '正在获取译文，请稍候…'}
                      </div>
                    </div>
                  </div>
                ) : isWordMode && state.wordEntry ? (
                  <div className="translation-word-card">
                    <div className="translation-word-head">
                      <div className="translation-word-head-main">
                        <div className="translation-word-title">{state.wordEntry.headword}</div>
                        <Button
                          className={`translation-word-speak-btn ${isSpeaking ? 'is-speaking' : ''}`}
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => handlePronounce(state.wordEntry?.phonetics[0]?.label)}
                          aria-label={isSpeaking ? '停止朗读' : '朗读单词'}
                          disabled={!('speechSynthesis' in window)}
                        >
                          {isSpeaking ? <Square size={12} /> : <Volume2 size={14} />}
                        </Button>
                      </div>
                      {state.wordEntry.phonetics.length > 0 && (
                        <div className="translation-word-phonetics">
                          {state.wordEntry.phonetics.map((item) => (
                            <span key={`${item.label}-${item.value}`} className="translation-word-phonetic">
                              <span className="translation-word-phonetic-label">{item.label}</span>
                              <span>{item.value}</span>
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {state.wordEntry.definitions.length > 0 && (
                      <div className="translation-word-section">
                        {state.wordEntry.definitions.map((item, index) => (
                          <div key={`${item.part ?? 'def'}-${index}`} className="translation-word-definition">
                            {item.part ? <span className="translation-word-part">{item.part}</span> : null}
                            <span className="translation-word-meaning">{item.meaning}</span>
                          </div>
                        ))}
                      </div>
                    )}

                    {state.wordEntry.forms.length > 0 && (
                      <div className="translation-word-section">
                        <div className="translation-word-section-title">词形变化</div>
                        <div className="translation-word-tags">
                          {state.wordEntry.forms.map((item) => (
                            <span key={`${item.label}-${item.value}`} className="translation-word-tag">
                              {item.label} · {item.value}
                            </span>
                          ))}
                        </div>
                      </div>
                    )}

                    {state.wordEntry.phrases.length > 0 && (
                      <div className="translation-word-section">
                        <div className="translation-word-section-title">常见短语</div>
                        <div className="translation-word-list">
                          {state.wordEntry.phrases.map((item) => (
                            <div key={`${item.text}-${item.meaning}`} className="translation-word-list-item">
                              <div className="translation-word-list-title">{item.text}</div>
                              <div className="translation-word-list-desc">{item.meaning}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {state.wordEntry.examples.length > 0 && (
                      <div className="translation-word-section">
                        <div className="translation-word-section-title">双语例句</div>
                        <div className="translation-word-list">
                          {state.wordEntry.examples.map((item, index) => (
                            <div key={`${item.source}-${index}`} className="translation-word-list-item">
                              <div className="translation-word-example-source">{item.source}</div>
                              <div className="translation-word-example-target">{item.translated}</div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                ) : shouldRenderMarkdown ? (
                  <Streamdown className="translation-markdown" mode="static" isAnimating={false}>
                    {state.translatedText}
                  </Streamdown>
                ) : (
                  <div className="translation-result-plain">{translatedPreview}</div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* ── Footer: engine selector + copy / retranslate ── */}
        <div className="translation-footer">
          <div className="translation-engine-select-wrap">
            <Select
              value={engineId}
              onChange={(event) => void handleEngineChange(event.target.value as TranslationWindowState['engineId'])}
              disabled={isWordMode}
            >
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

      {resizeHandleConfigs.map((handle) => (
        <button
          key={handle.edge}
          type="button"
          className={`translation-edge-handle translation-edge-handle--${handle.edge}`}
          data-edge={handle.edge}
          onPointerDown={handleResizeStart}
          onPointerMove={handleResizeMove}
          onPointerUp={handleResizeEnd}
          onPointerCancel={handleResizeEnd}
          onLostPointerCapture={(event) => stopResizing(event.currentTarget)}
          aria-label={handle.label}
          tabIndex={-1}
        />
      ))}
    </div>
  )
}
