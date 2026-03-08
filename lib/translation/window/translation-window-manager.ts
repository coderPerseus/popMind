import { clipboard, ipcMain, screen } from 'electron'
import { translationEngineOrder, translationLanguages, TranslationWindowChannel } from '@/lib/translation/shared'
import { translationService } from '@/lib/translation/service'
import type { TranslationAnchorPoint, TranslationEngineId, TranslationSettings, TranslationWindowState } from '@/lib/translation/types'
import type { SelectionBridge } from '@/lib/text-picker/shared'
import { TranslationWindow } from './translation-window'

const WINDOW_GAP = 14

const resolveEnabledEngineIds = (settings: TranslationSettings) => {
  return translationEngineOrder.filter((engineId) => settings.enabledEngines[engineId])
}

const resolveEngineId = (settings: TranslationSettings, preferred?: TranslationEngineId) => {
  if (preferred && settings.enabledEngines[preferred]) {
    return preferred
  }

  return resolveEnabledEngineIds(settings)[0]
}

export class TranslationWindowManager {
  private window: TranslationWindow | null = null
  private detachMoveListener: (() => void) | null = null
  private state: TranslationWindowState | null = null
  private pendingRequest: {
    text: string
    selectionId?: string
    sourceAppId?: string
  } | null = null
  private ignoreMoveUntil = 0
  private lastAnchor: TranslationAnchorPoint | null = null
  private requestVersion = 0

  constructor(
    private readonly bridge: SelectionBridge,
    private readonly logger: Console = console,
  ) {
    this.setupIpc()
  }

  async showTranslation(payload: {
    text: string
    selectionId?: string
    sourceAppId?: string
    anchor: TranslationAnchorPoint | null
  }) {
    const settings = await translationService.getSettings()
    const enabledEngineIds = resolveEnabledEngineIds(settings)
    const engineId = resolveEngineId(settings, this.state?.engineId ?? 'google') ?? 'google'

    this.pendingRequest = {
      text: payload.text,
      selectionId: payload.selectionId,
      sourceAppId: payload.sourceAppId,
    }

    this.ensureWindow()
    this.state = {
      status: 'loading',
      pinned: this.state?.pinned ?? false,
      engineId,
      enabledEngineIds,
      sourceLanguage: 'auto',
      targetLanguage: settings.firstLanguage,
      sourceText: payload.text,
      translatedText: '',
      languages: translationLanguages,
    }

    this.positionWindow(payload.anchor)
    this.sendState()
    this.showWindow()

    void this.runTranslation({
      sourceLanguage: 'auto',
      targetLanguage: settings.firstLanguage,
      engineId,
    })
  }

  hideIfFloating() {
    if (!this.state?.pinned) {
      this.window?.hide()
    }
  }

  hide() {
    this.window?.hide()
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
    ipcMain.removeAllListeners(TranslationWindowChannel.Move)

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
    this.detachMoveListener = this.window.onMove(() => {
      this.ignoreMoveUntil = Date.now() + 120
    })

    return this.window
  }

  private setupIpc() {
    ipcMain.handle(TranslationWindowChannel.GetState, async () => this.state)
    ipcMain.handle(
      TranslationWindowChannel.Retranslate,
      async (_event, payload: { sourceLanguage: string; targetLanguage: string; engineId: 'google' | 'deepl' | 'bing' | 'youdao' | 'deepseek' }) => {
        await this.runTranslation(payload)
        return { ok: true }
      },
    )
    ipcMain.handle(TranslationWindowChannel.SetPinned, async (_event, pinned: boolean) => {
      if (this.state) {
        this.state = { ...this.state, pinned }
        this.sendState()
      }

      return { ok: true, pinned }
    })
    ipcMain.handle(TranslationWindowChannel.Copy, async () => {
      if (this.state?.translatedText) {
        clipboard.writeText(this.state.translatedText)
      }

      return { ok: true }
    })
    ipcMain.handle(TranslationWindowChannel.Close, async () => {
      this.window?.hide()
      return { ok: true }
    })
    ipcMain.on(TranslationWindowChannel.Move, (_event, deltaX: number, deltaY: number) => {
      this.moveWindow(deltaX, deltaY)
    })
    ipcMain.on(TranslationWindowChannel.Resize, (_event, height: number) => {
      this.resizeWindow(height)
    })
  }

  private async runTranslation(payload: {
    sourceLanguage: string
    targetLanguage: string
    engineId: 'google' | 'deepl' | 'bing' | 'youdao' | 'deepseek'
  }) {
    if (!this.pendingRequest || !this.state) {
      return
    }

    const settings = await translationService.getSettings()
    const enabledEngineIds = resolveEnabledEngineIds(settings)
    const engineId = resolveEngineId(settings, payload.engineId) ?? payload.engineId
    const requestVersion = ++this.requestVersion

    this.state = {
      ...this.state,
      status: 'loading',
      sourceLanguage: payload.sourceLanguage,
      targetLanguage: payload.targetLanguage,
      engineId,
      enabledEngineIds,
      translatedText: '',
      errorMessage: undefined,
      detectedSourceLanguage: undefined,
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
        ...this.state,
        status: 'success',
        engineId: result.engineId,
        enabledEngineIds,
        sourceLanguage: payload.sourceLanguage,
        targetLanguage: result.targetLanguage,
        sourceText: result.sourceText,
        translatedText: result.translatedText,
        detectedSourceLanguage: result.detectedSourceLanguage,
        errorMessage: undefined,
      }
    } catch (error) {
      if (requestVersion !== this.requestVersion) {
        return
      }

      const message = error instanceof Error ? error.message : 'Translation failed'
      this.logger.error('[TranslationWindowManager] translation failed', error)
      this.state = {
        ...this.state,
        status: 'error',
        enabledEngineIds,
        errorMessage: message,
      }
    }

    this.sendState()
    this.showWindow()
  }

  private positionWindow(anchor: TranslationAnchorPoint | null) {
    const window = this.ensureWindow()
    const [width, height] = window.getSize()
    const cursorPoint = screen.getCursorScreenPoint()
    const fallbackAnchor: TranslationAnchorPoint = {
      x: cursorPoint.x,
      topY: cursorPoint.y,
      bottomY: cursorPoint.y,
    }
    const nextAnchor = anchor ?? fallbackAnchor
    this.lastAnchor = nextAnchor
    const display = screen.getDisplayNearestPoint({
      x: Math.round(nextAnchor.x),
      y: Math.round(nextAnchor.topY),
    })
    const { workArea } = display

    let x = nextAnchor.x - width / 2
    let y = nextAnchor.topY - height - WINDOW_GAP

    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - width))

    if (y < workArea.y) {
      y = Math.min(nextAnchor.bottomY + WINDOW_GAP, workArea.y + workArea.height - height)
    }

    this.ignoreMoveUntil = Date.now() + 120
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

    if (Date.now() < this.ignoreMoveUntil) {
      return
    }

    const bounds = this.window.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const { workArea } = display

    const nextX = Math.max(workArea.x, Math.min(bounds.x + Math.round(deltaX), workArea.x + workArea.width - bounds.width))
    const nextY = Math.max(workArea.y, Math.min(bounds.y + Math.round(deltaY), workArea.y + workArea.height - bounds.height))

    this.ignoreMoveUntil = Date.now() + 120
    this.window.setBounds({
      ...bounds,
      x: nextX,
      y: nextY,
    })
    this.window.orderFront()
  }

  private resizeWindow(height: number) {
    if (!this.window || this.window.isDestroyed()) {
      return
    }

    if (!Number.isFinite(height)) {
      return
    }

    const bounds = this.window.getBounds()
    const nextHeight = Math.max(220, Math.min(Math.round(height), 560))

    if (Math.abs(bounds.height - nextHeight) < 2) {
      return
    }

    const nextY = this.lastAnchor ? Math.round(this.lastAnchor.topY - nextHeight - WINDOW_GAP) : bounds.y
    const display = screen.getDisplayMatching(bounds)
    const clampedY = Math.max(display.workArea.y, Math.min(nextY, display.workArea.y + display.workArea.height - nextHeight))

    this.ignoreMoveUntil = Date.now() + 120
    this.window.setBounds({
      ...bounds,
      y: clampedY,
      height: nextHeight,
    })
    this.window.orderFront()
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
  }
}
