import { clipboard, ipcMain, screen } from 'electron'
import { translateMessage } from '@/lib/i18n/shared'
import {
  DEFAULT_TRANSLATION_TEXT_WINDOW_MIN_HEIGHT,
  getEnabledTranslationEngineIds,
  getTranslationWindowMinHeight,
  resolvePreferredTranslationEngine,
  resolveTranslationQueryMode,
  translationLanguages,
  TranslationWindowChannel,
} from '@/lib/translation/shared'
import { translationService } from '@/lib/translation/service'
import { autoDismissController } from '@/lib/windowing/auto-dismiss-controller'
import type {
  TranslationAnchorPoint,
  TranslationEngineId,
  TranslationQueryMode,
  TranslationWindowResizeEdge,
  TranslationSettings,
  TranslationWindowResizePayload,
  TranslationWindowState,
} from '@/lib/translation/types'
import type { SelectionBridge } from '@/lib/text-picker/shared'
import { TranslationWindow } from './translation-window'

const WINDOW_GAP = 14
const APP_ACTIVATE_SUPPRESS_MS = 700
const MIN_WINDOW_WIDTH = 404
const MAX_WINDOW_WIDTH = 760
const MIN_MANUAL_WINDOW_HEIGHT = 300
const MAX_WINDOW_HEIGHT = 680

const clamp = (value: number, min: number, max: number) => {
  return Math.min(Math.max(value, min), max)
}

const hasLeftEdge = (edge: TranslationWindowResizeEdge) => {
  return edge === 'left' || edge === 'top-left' || edge === 'bottom-left'
}

const hasRightEdge = (edge: TranslationWindowResizeEdge) => {
  return edge === 'right' || edge === 'top-right' || edge === 'bottom-right'
}

const hasTopEdge = (edge: TranslationWindowResizeEdge) => {
  return edge === 'top' || edge === 'top-left' || edge === 'top-right'
}

const hasBottomEdge = (edge: TranslationWindowResizeEdge) => {
  return edge === 'bottom' || edge === 'bottom-left' || edge === 'bottom-right'
}

const resolveEnabledEngineIds = (settings: TranslationSettings) => getEnabledTranslationEngineIds(settings)

const resolveEngineId = (settings: TranslationSettings, preferred?: TranslationEngineId) =>
  resolvePreferredTranslationEngine(settings, preferred)

type TranslationWindowPresentation = 'anchored' | 'centered'

export class TranslationWindowManager {
  private window: TranslationWindow | null = null
  private detachMoveListener: (() => void) | null = null
  private state: TranslationWindowState | null = null
  private pendingRequest: {
    text: string
    selectionId?: string
    sourceAppId?: string
  } | null = null
  private lastAnchor: TranslationAnchorPoint | null = null
  private lastPresentation: TranslationWindowPresentation = 'anchored'
  private requestVersion = 0

  constructor(
    private readonly bridge: SelectionBridge,
    private readonly logger: Console = console,
    private readonly floatingBridge?: {
      noteInteraction?: (durationMs?: number) => void
      setDragging?: (isDragging: boolean) => void
      onVisibilityChange?: () => void
    }
  ) {
    this.setupIpc()
  }

  async showTranslation(payload: {
    text: string
    selectionId?: string
    sourceAppId?: string
    anchor: TranslationAnchorPoint | null
    presentation?: TranslationWindowPresentation
  }) {
    const settings = await translationService.getSettings()
    const enabledEngineIds = resolveEnabledEngineIds(settings)
    const engineId = resolveEngineId(settings, this.state?.engineId) ?? 'google'
    const presentation = payload.presentation ?? 'anchored'
    const initialQueryMode = resolveTranslationQueryMode({
      text: payload.text,
      sourceLanguage: 'auto',
    })

    this.pendingRequest = {
      text: payload.text,
      selectionId: payload.selectionId,
      sourceAppId: payload.sourceAppId,
    }

    autoDismissController.dispatch({
      reason: 'surface-opened',
      target: 'translation',
    })

    this.ensureWindow()
    this.state = {
      status: 'loading',
      pinned: this.state?.pinned ?? false,
      queryMode: initialQueryMode,
      engineId,
      enabledEngineIds,
      sourceLanguage: 'auto',
      targetLanguage: settings.firstLanguage,
      sourceText: payload.text,
      translatedText: '',
      wordEntry: undefined,
      loadingTitle: translateMessage(settings.appLanguage, 'translation.loading.title'),
      loadingDescription: translateMessage(settings.appLanguage, 'translation.loading.desc'),
      languages: translationLanguages,
    }

    this.applyDefaultContentHeight(initialQueryMode)
    this.positionWindow(payload.anchor, presentation)
    this.sendState()
    this.showWindow()

    void this.runTranslation({
      sourceLanguage: 'auto',
      engineId,
    })
  }

  async showProcessingState(payload: {
    presentation?: TranslationWindowPresentation
    loadingTitle: string
    loadingDescription?: string
  }) {
    const settings = await translationService.getSettings()
    const enabledEngineIds = resolveEnabledEngineIds(settings)
    const engineId = resolveEngineId(settings, this.state?.engineId) ?? 'google'
    const presentation = payload.presentation ?? 'centered'

    this.pendingRequest = null
    autoDismissController.dispatch({
      reason: 'surface-opened',
      target: 'translation',
    })
    this.ensureWindow()
    this.state = {
      status: 'loading',
      pinned: this.state?.pinned ?? false,
      queryMode: 'text',
      engineId,
      enabledEngineIds,
      sourceLanguage: this.state?.sourceLanguage ?? 'auto',
      targetLanguage: this.state?.targetLanguage ?? settings.firstLanguage,
      sourceText: '',
      translatedText: '',
      wordEntry: undefined,
      errorMessage: undefined,
      loadingTitle: payload.loadingTitle,
      loadingDescription: payload.loadingDescription,
      languages: translationLanguages,
    }

    this.positionWindow(null, presentation)
    this.sendState()
    this.showWindow()
  }

  async showErrorState(payload: { presentation?: TranslationWindowPresentation; errorMessage: string }) {
    const settings = await translationService.getSettings()
    const enabledEngineIds = resolveEnabledEngineIds(settings)
    const engineId = resolveEngineId(settings, this.state?.engineId) ?? 'google'
    const presentation = payload.presentation ?? this.lastPresentation

    this.pendingRequest = null
    autoDismissController.dispatch({
      reason: 'surface-opened',
      target: 'translation',
    })
    this.ensureWindow()
    this.state = {
      status: 'error',
      pinned: this.state?.pinned ?? false,
      queryMode: 'text',
      engineId,
      enabledEngineIds,
      sourceLanguage: this.state?.sourceLanguage ?? 'auto',
      targetLanguage: this.state?.targetLanguage ?? settings.firstLanguage,
      sourceText: this.state?.sourceText ?? '',
      translatedText: '',
      wordEntry: undefined,
      errorMessage: payload.errorMessage,
      loadingTitle: undefined,
      loadingDescription: undefined,
      languages: translationLanguages,
    }

    this.positionWindow(null, presentation)
    this.sendState()
    this.showWindow()
  }

  hideIfFloating() {
    if (!this.state?.pinned) {
      this.window?.hide()
      this.floatingBridge?.onVisibilityChange?.()
    }
  }

  hide() {
    this.window?.hide()
    this.floatingBridge?.onVisibilityChange?.()
  }

  isVisible() {
    return this.window?.isVisible() ?? false
  }

  isPinned() {
    return this.state?.pinned ?? false
  }

  containsPoint(x: number, y: number) {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) {
      return false
    }

    const bounds = this.window.getBounds()
    const right = bounds.x + bounds.width
    const bottom = bounds.y + bounds.height
    return x >= bounds.x && x <= right && y >= bounds.y && y <= bottom
  }

  dispose() {
    ipcMain.removeHandler(TranslationWindowChannel.GetState)
    ipcMain.removeHandler(TranslationWindowChannel.Retranslate)
    ipcMain.removeHandler(TranslationWindowChannel.SetPinned)
    ipcMain.removeHandler(TranslationWindowChannel.Copy)
    ipcMain.removeHandler(TranslationWindowChannel.Close)
    ipcMain.removeHandler(TranslationWindowChannel.DismissTopmost)
    ipcMain.removeAllListeners(TranslationWindowChannel.SetDragging)
    ipcMain.removeAllListeners(TranslationWindowChannel.NotifyInteraction)
    ipcMain.removeAllListeners(TranslationWindowChannel.Move)
    ipcMain.removeAllListeners(TranslationWindowChannel.Resize)

    this.detachMoveListener?.()
    this.detachMoveListener = null

    this.window?.destroy()
    this.window = null
  }

  private ensureWindow() {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    this.window = new TranslationWindow(this.bridge)
    this.detachMoveListener = this.window.onMove(() => undefined)

    return this.window
  }

  private setupIpc() {
    ipcMain.handle(TranslationWindowChannel.GetState, async () => this.state)
    ipcMain.handle(
      TranslationWindowChannel.Retranslate,
      async (
        _event,
        payload: {
          sourceLanguage: string
          targetLanguage?: string
          engineId: 'google' | 'deepl' | 'bing' | 'youdao' | 'ai'
        }
      ) => {
        this.noteInteraction()
        await this.runTranslation(payload)
        return { ok: true }
      }
    )
    ipcMain.handle(TranslationWindowChannel.SetPinned, async (_event, pinned: boolean) => {
      this.noteInteraction()
      if (this.state) {
        this.state = { ...this.state, pinned }
        this.sendState()
      }

      return { ok: true, pinned }
    })
    ipcMain.handle(TranslationWindowChannel.Copy, async () => {
      this.noteInteraction()
      if (this.state?.translatedText) {
        clipboard.writeText(this.state.translatedText)
      }

      return { ok: true }
    })
    ipcMain.handle(TranslationWindowChannel.Close, async () => {
      this.noteInteraction()
      this.window?.hide()
      this.floatingBridge?.onVisibilityChange?.()
      return { ok: true }
    })
    ipcMain.handle(TranslationWindowChannel.DismissTopmost, async () => {
      this.noteInteraction()
      autoDismissController.dismissTopmost('escape')
      return { ok: true }
    })
    ipcMain.on(TranslationWindowChannel.SetDragging, (_event, isDragging: boolean) => {
      this.floatingBridge?.setDragging?.(isDragging)
    })
    ipcMain.on(TranslationWindowChannel.NotifyInteraction, (_event, durationMs?: number) => {
      this.noteInteraction(typeof durationMs === 'number' ? durationMs : undefined)
    })
    ipcMain.on(TranslationWindowChannel.Move, (_event, deltaX: number, deltaY: number) => {
      this.noteInteraction(1000)
      this.moveWindow(deltaX, deltaY)
    })
    ipcMain.on(TranslationWindowChannel.Resize, (_event, payload: TranslationWindowResizePayload | number) => {
      this.noteInteraction()
      this.resizeWindow(payload)
    })
  }

  private noteInteraction(durationMs = APP_ACTIVATE_SUPPRESS_MS) {
    this.floatingBridge?.noteInteraction?.(durationMs)
  }

  private async runTranslation(payload: {
    sourceLanguage: string
    targetLanguage?: string
    engineId: 'google' | 'deepl' | 'bing' | 'youdao' | 'ai'
  }) {
    if (!this.pendingRequest || !this.state) {
      return
    }

    const settings = await translationService.getSettings()
    const enabledEngineIds = resolveEnabledEngineIds(settings)
    const engineId = resolveEngineId(settings, payload.engineId) ?? payload.engineId
    const requestVersion = ++this.requestVersion
    const currentState = this.state
    const previewQueryMode = resolveTranslationQueryMode({
      text: this.pendingRequest.text,
      sourceLanguage: payload.sourceLanguage,
    })

    this.state = {
      ...currentState,
      status: 'loading',
      sourceLanguage: payload.sourceLanguage,
      targetLanguage: payload.targetLanguage ?? currentState.targetLanguage,
      engineId,
      enabledEngineIds,
      translatedText: '',
      queryMode: previewQueryMode,
      wordEntry: undefined,
      errorMessage: undefined,
      detectedSourceLanguage: undefined,
      loadingTitle: translateMessage(settings.appLanguage, 'translation.loading.title'),
      loadingDescription: translateMessage(settings.appLanguage, 'translation.loading.desc'),
    }
    this.sendState()

    try {
      const result = await translationService.translate({
        text: this.pendingRequest.text,
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: payload.targetLanguage,
        engineId,
        selectionId: this.pendingRequest.selectionId,
        sourceAppId: this.pendingRequest.sourceAppId,
      })

      if (requestVersion !== this.requestVersion) {
        return
      }

      this.state = {
        ...currentState,
        status: 'success',
        engineId: result.engineId,
        enabledEngineIds,
        queryMode: result.queryMode,
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: result.targetLanguage,
        sourceText: result.sourceText,
        translatedText: result.translatedText,
        detectedSourceLanguage: result.detectedSourceLanguage,
        wordEntry: result.wordEntry,
        errorMessage: undefined,
        loadingTitle: undefined,
        loadingDescription: undefined,
      }
    } catch (error) {
      if (requestVersion !== this.requestVersion) {
        return
      }

      const message =
        error instanceof Error ? error.message : translateMessage(settings.appLanguage, 'translation.error.generic')
      this.logger.error('[TranslationWindowManager] translation failed', error)
      this.state = {
        ...currentState,
        status: 'error',
        enabledEngineIds,
        queryMode: 'text',
        wordEntry: undefined,
        errorMessage: message,
        loadingTitle: undefined,
        loadingDescription: undefined,
      }
    }

    this.sendState()
    this.showWindow()
  }

  private positionWindow(anchor: TranslationAnchorPoint | null, presentation: TranslationWindowPresentation) {
    const window = this.ensureWindow()
    const [width, height] = window.getSize()
    const cursorPoint = screen.getCursorScreenPoint()
    const displayPoint = anchor
      ? {
          x: Math.round(anchor.x),
          y: Math.round(anchor.topY),
        }
      : cursorPoint
    const display = screen.getDisplayNearestPoint(displayPoint)
    const { workArea } = display

    let x = workArea.x + (workArea.width - width) / 2
    let y = workArea.y + (workArea.height - height) / 2

    if (presentation === 'anchored') {
      const fallbackAnchor: TranslationAnchorPoint = {
        x: cursorPoint.x,
        topY: cursorPoint.y,
        bottomY: cursorPoint.y,
      }
      const nextAnchor = anchor ?? fallbackAnchor
      this.lastAnchor = nextAnchor
      x = nextAnchor.x - width / 2
      y = nextAnchor.topY - height - WINDOW_GAP

      x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width))

      if (y < workArea.y) {
        y = Math.min(nextAnchor.bottomY + WINDOW_GAP, workArea.y + workArea.height - height)
      }
    } else {
      this.lastAnchor = null
    }

    this.lastPresentation = presentation
    window.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width,
      height,
    })
  }

  private moveWindow(deltaX: number, deltaY: number) {
    if (!this.window || this.window.isDestroyed() || !this.window.isVisible()) {
      return
    }

    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) {
      return
    }

    const bounds = this.window.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const { workArea } = display

    const nextX = Math.max(
      workArea.x,
      Math.min(bounds.x + Math.round(deltaX), workArea.x + workArea.width - bounds.width)
    )
    const nextY = Math.max(
      workArea.y,
      Math.min(bounds.y + Math.round(deltaY), workArea.y + workArea.height - bounds.height)
    )

    this.window.setBounds({
      ...bounds,
      x: nextX,
      y: nextY,
    })
  }

  private resizeWindow(payload: TranslationWindowResizePayload | number) {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    const bounds = this.window.getBounds()
    const normalizedPayload =
      typeof payload === 'number'
        ? { height: payload, minHeight: DEFAULT_TRANSLATION_TEXT_WINDOW_MIN_HEIGHT, source: 'content' as const }
        : {
            width: payload.width,
            height: payload.height,
            minHeight: payload.minHeight,
            source: payload.source ?? 'content',
            edge: payload.edge,
            deltaX: payload.deltaX,
            deltaY: payload.deltaY,
          }

    const display = screen.getDisplayMatching(bounds)
    const { workArea } = display

    if (normalizedPayload.source === 'manual') {
      const edge = normalizedPayload.edge
      const deltaX = Number.isFinite(normalizedPayload.deltaX) ? Math.round(normalizedPayload.deltaX as number) : 0
      const deltaY = Number.isFinite(normalizedPayload.deltaY) ? Math.round(normalizedPayload.deltaY as number) : 0

      if (!edge || (deltaX === 0 && deltaY === 0)) {
        return
      }

      const nextBounds = this.resolveManualResizeBounds(bounds, workArea, edge, deltaX, deltaY)

      if (
        nextBounds.x === bounds.x &&
        nextBounds.y === bounds.y &&
        nextBounds.width === bounds.width &&
        nextBounds.height === bounds.height
      ) {
        return
      }

      this.window.setBounds(nextBounds)
      return
    }

    const width = normalizedPayload.width
    const height = normalizedPayload.height
    const contentMinHeight = Number.isFinite(normalizedPayload.minHeight)
      ? Math.round(normalizedPayload.minHeight as number)
      : DEFAULT_TRANSLATION_TEXT_WINDOW_MIN_HEIGHT
    const minHeight = contentMinHeight
    const nextWidth = Number.isFinite(width)
      ? Math.max(MIN_WINDOW_WIDTH, Math.min(Math.round(width as number), MAX_WINDOW_WIDTH))
      : bounds.width
    const nextHeight = Number.isFinite(height)
      ? Math.max(minHeight, Math.min(Math.round(height as number), MAX_WINDOW_HEIGHT))
      : bounds.height

    if (Math.abs(bounds.width - nextWidth) < 2 && Math.abs(bounds.height - nextHeight) < 2) {
      return
    }

    const nextY =
      this.lastPresentation === 'centered'
        ? Math.round(bounds.y - (nextHeight - bounds.height) / 2)
        : this.lastAnchor
          ? Math.round(this.lastAnchor.topY - nextHeight - WINDOW_GAP)
          : bounds.y
    const clampedY = Math.max(workArea.y, Math.min(nextY, workArea.y + workArea.height - nextHeight))

    this.window.setBounds({
      ...bounds,
      y: clampedY,
      width: nextWidth,
      height: nextHeight,
    })
  }

  private applyDefaultContentHeight(queryMode: TranslationQueryMode) {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    const bounds = this.window.getBounds()
    const nextHeight = getTranslationWindowMinHeight(queryMode)

    if (bounds.height === nextHeight) {
      return
    }

    this.window.setBounds({
      ...bounds,
      height: nextHeight,
    })
  }

  private resolveManualResizeBounds(
    bounds: Electron.Rectangle,
    workArea: Electron.Rectangle,
    edge: TranslationWindowResizeEdge,
    deltaX: number,
    deltaY: number
  ) {
    const right = bounds.x + bounds.width
    const bottom = bounds.y + bounds.height
    const workAreaRight = workArea.x + workArea.width
    const workAreaBottom = workArea.y + workArea.height

    let nextX = bounds.x
    let nextY = bounds.y
    let nextWidth = bounds.width
    let nextHeight = bounds.height

    if (hasLeftEdge(edge)) {
      const minLeft = Math.max(workArea.x, right - MAX_WINDOW_WIDTH)
      const maxLeft = right - MIN_WINDOW_WIDTH
      const nextLeft = clamp(bounds.x + deltaX, minLeft, maxLeft)
      nextX = nextLeft
      nextWidth = right - nextLeft
    } else if (hasRightEdge(edge)) {
      nextWidth = clamp(
        bounds.width + deltaX,
        MIN_WINDOW_WIDTH,
        Math.max(MIN_WINDOW_WIDTH, Math.min(MAX_WINDOW_WIDTH, workAreaRight - bounds.x))
      )
    }

    if (hasTopEdge(edge)) {
      const minTop = Math.max(workArea.y, bottom - MAX_WINDOW_HEIGHT)
      const maxTop = bottom - MIN_MANUAL_WINDOW_HEIGHT
      const nextTop = clamp(bounds.y + deltaY, minTop, maxTop)
      nextY = nextTop
      nextHeight = bottom - nextTop
    } else if (hasBottomEdge(edge)) {
      nextHeight = clamp(
        bounds.height + deltaY,
        MIN_MANUAL_WINDOW_HEIGHT,
        Math.max(MIN_MANUAL_WINDOW_HEIGHT, Math.min(MAX_WINDOW_HEIGHT, workAreaBottom - bounds.y))
      )
    }

    return {
      x: Math.round(nextX),
      y: Math.round(nextY),
      width: Math.round(nextWidth),
      height: Math.round(nextHeight),
    }
  }

  private sendState() {
    if (!this.state || !this.window || this.window.isDestroyed()) {
      return
    }

    this.window.sendState(this.state)
  }

  private showWindow() {
    const window = this.ensureWindow()

    if (!window.isVisible()) {
      window.showInactive()
    }

    window.orderFront()
    this.floatingBridge?.onVisibilityChange?.()
  }
}
