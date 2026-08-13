import { clipboard, ipcMain, screen } from 'electron'
import {
  InputTranslationWindowChannel,
  type InputTranslationOptions,
  type InputTranslationWindowState,
} from '@/lib/input-translation/shared'
import type { SelectionBridge } from '@/lib/text-picker/shared'
import {
  getEnabledTranslationEngineIds,
  resolvePreferredTranslationEngine,
  translationLanguages,
} from '@/lib/translation/shared'
import { translationService } from '@/lib/translation/service'
import type { TranslationEngineId } from '@/lib/translation/types'
import { InputTranslationWindow } from './input-translation-window'

const WINDOW_WIDTH = 400
const WINDOW_MIN_HEIGHT = 94
const WINDOW_INITIAL_HEIGHT = 102
const WINDOW_GAP = 10
const WINDOW_MARGIN = 10

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

export class InputTranslationWindowManager {
  private window: InputTranslationWindow | null = null
  private state: InputTranslationWindowState | null = null
  private preferredEngineId: TranslationEngineId | undefined = 'deepl'
  private preferredTargetLanguage = 'en'
  private translationRequestVersion = 0
  private anchorPoint: { x: number; y: number } | null = null
  private hasManualPosition = false

  constructor(
    private readonly bridge: SelectionBridge,
    private readonly logger: Console = console,
    private readonly lifecycle?: {
      onWillShow?: () => void
      onVisibilityChange?: () => void
    }
  ) {
    this.setupIpc()
  }

  async showAtCursor() {
    if (this.isVisible()) {
      this.hide()
      this.logger.warn('[InputTranslation][diagnostic] overlay closed by shortcut')
      return
    }

    const settings = await translationService.getSettings()
    const enabledEngineIds = getEnabledTranslationEngineIds(settings)
    const engineId = resolvePreferredTranslationEngine(settings, this.preferredEngineId) ?? 'google'
    const requestId = (this.state?.requestId ?? 0) + 1
    this.preferredEngineId = engineId
    this.translationRequestVersion += 1
    this.anchorPoint = screen.getCursorScreenPoint()
    this.hasManualPosition = false
    const workArea = screen.getDisplayNearestPoint(this.anchorPoint).workArea
    const maxWindowHeight = Math.max(WINDOW_MIN_HEIGHT, workArea.height - WINDOW_MARGIN * 2)
    this.state = {
      status: 'idle',
      requestId,
      value: '',
      sourceText: '',
      maxWindowHeight,
      engineId,
      enabledEngineIds: enabledEngineIds.length ? enabledEngineIds : [engineId],
      targetLanguage: this.preferredTargetLanguage,
      languages: translationLanguages,
      copied: false,
      errorMessage: undefined,
    }

    this.lifecycle?.onWillShow?.()
    const window = this.ensureWindow()
    const bounds = this.resolveWindowBounds(WINDOW_INITIAL_HEIGHT)
    window.setBounds(bounds)
    window.sendState(this.state)
    window.showFocused()
    this.lifecycle?.onVisibilityChange?.()

    this.logger.warn('[InputTranslation][diagnostic] overlay opened by shortcut', {
      anchor: this.anchorPoint,
      bounds,
      engineId,
      enabledEngineIds: this.state.enabledEngineIds,
      targetLanguage: this.preferredTargetLanguage,
    })
  }

  hide() {
    this.translationRequestVersion += 1
    if (this.window?.isVisible()) {
      this.window.hide()
      this.lifecycle?.onVisibilityChange?.()
    }
  }

  isVisible() {
    return this.window?.isVisible() ?? false
  }

  containsPoint(x: number, y: number) {
    if (!this.window?.isVisible()) {
      return false
    }

    const bounds = this.window.getBounds()
    return x >= bounds.x && x <= bounds.x + bounds.width && y >= bounds.y && y <= bounds.y + bounds.height
  }

  dispose() {
    ipcMain.removeHandler(InputTranslationWindowChannel.GetState)
    ipcMain.removeHandler(InputTranslationWindowChannel.Translate)
    ipcMain.removeHandler(InputTranslationWindowChannel.UpdateOptions)
    ipcMain.removeHandler(InputTranslationWindowChannel.CopyDraft)
    ipcMain.removeAllListeners(InputTranslationWindowChannel.Resize)
    ipcMain.removeAllListeners(InputTranslationWindowChannel.Move)
    ipcMain.removeHandler(InputTranslationWindowChannel.Close)
    this.window?.destroy()
    this.window = null
  }

  private ensureWindow() {
    if (!this.window || this.window.isDestroyed()) {
      this.window = new InputTranslationWindow(this.bridge, this.logger)
    }

    return this.window
  }

  private resolveWindowBounds(requestedHeight: number) {
    const anchor = this.anchorPoint ?? screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(anchor)
    const { workArea } = display
    const maxHeight = Math.max(WINDOW_MIN_HEIGHT, workArea.height - WINDOW_MARGIN * 2)
    const height = Math.round(clamp(requestedHeight, WINDOW_MIN_HEIGHT, maxHeight))
    const width = Math.min(WINDOW_WIDTH, workArea.width - WINDOW_MARGIN * 2)
    const x = clamp(
      anchor.x - width / 2,
      workArea.x + WINDOW_MARGIN,
      workArea.x + workArea.width - width - WINDOW_MARGIN
    )
    const aboveY = anchor.y - height - WINDOW_GAP
    const belowY = anchor.y + WINDOW_GAP
    let y = aboveY

    if (aboveY < workArea.y + WINDOW_MARGIN) {
      y = belowY + height <= workArea.y + workArea.height - WINDOW_MARGIN ? belowY : aboveY
    }

    y = clamp(y, workArea.y + WINDOW_MARGIN, workArea.y + workArea.height - height - WINDOW_MARGIN)

    return {
      x: Math.round(x),
      y: Math.round(y),
      width,
      height,
    }
  }

  private resizeWindow(requestedHeight: number) {
    if (!this.window || this.window.isDestroyed() || !Number.isFinite(requestedHeight)) {
      return
    }

    const currentBounds = this.window.getBounds()
    const bounds = this.hasManualPosition
      ? this.resolveManuallyPositionedBounds(currentBounds, requestedHeight)
      : this.resolveWindowBounds(requestedHeight)
    if (
      currentBounds.x === bounds.x &&
      currentBounds.y === bounds.y &&
      currentBounds.width === bounds.width &&
      currentBounds.height === bounds.height
    ) {
      return
    }

    this.window.setBounds(bounds)
  }

  private resolveManuallyPositionedBounds(currentBounds: Electron.Rectangle, requestedHeight: number) {
    const center = {
      x: Math.round(currentBounds.x + currentBounds.width / 2),
      y: Math.round(currentBounds.y + currentBounds.height / 2),
    }
    const { workArea } = screen.getDisplayNearestPoint(center)
    const maxHeight = Math.max(WINDOW_MIN_HEIGHT, workArea.height - WINDOW_MARGIN * 2)
    const height = Math.round(clamp(requestedHeight, WINDOW_MIN_HEIGHT, maxHeight))
    const width = Math.min(currentBounds.width, workArea.width - WINDOW_MARGIN * 2)
    const bottom = currentBounds.y + currentBounds.height

    return {
      x: Math.round(
        clamp(currentBounds.x, workArea.x + WINDOW_MARGIN, workArea.x + workArea.width - width - WINDOW_MARGIN)
      ),
      y: Math.round(
        clamp(bottom - height, workArea.y + WINDOW_MARGIN, workArea.y + workArea.height - height - WINDOW_MARGIN)
      ),
      width,
      height,
    }
  }

  private moveWindow(deltaX: number, deltaY: number) {
    if (
      !this.window ||
      this.window.isDestroyed() ||
      !this.window.isVisible() ||
      !Number.isFinite(deltaX) ||
      !Number.isFinite(deltaY)
    ) {
      return
    }

    const currentBounds = this.window.getBounds()
    const candidateX = currentBounds.x + Math.round(deltaX)
    const candidateY = currentBounds.y + Math.round(deltaY)
    const candidateCenter = {
      x: Math.round(candidateX + currentBounds.width / 2),
      y: Math.round(candidateY + currentBounds.height / 2),
    }
    const { workArea } = screen.getDisplayNearestPoint(candidateCenter)
    const x = clamp(
      candidateX,
      workArea.x + WINDOW_MARGIN,
      workArea.x + workArea.width - currentBounds.width - WINDOW_MARGIN
    )
    const y = clamp(
      candidateY,
      workArea.y + WINDOW_MARGIN,
      workArea.y + workArea.height - currentBounds.height - WINDOW_MARGIN
    )

    const isFirstManualMove = !this.hasManualPosition
    const bounds = {
      ...currentBounds,
      x: Math.round(x),
      y: Math.round(y),
    }
    this.hasManualPosition = true
    this.window.setBounds(bounds)

    if (isFirstManualMove) {
      this.logger.warn('[InputTranslation][diagnostic] overlay drag started', {
        from: currentBounds,
        to: bounds,
      })
    }
  }

  private setupIpc() {
    ipcMain.handle(InputTranslationWindowChannel.GetState, async () => this.state)
    ipcMain.handle(
      InputTranslationWindowChannel.Translate,
      async (_event, payload: InputTranslationOptions & { text: string }) => {
        return this.runTranslation(payload.text, payload)
      }
    )
    ipcMain.handle(InputTranslationWindowChannel.UpdateOptions, async (_event, payload: InputTranslationOptions) => {
      if (!this.state) {
        return { ok: false }
      }

      const settings = await translationService.getSettings()
      const engineId = resolvePreferredTranslationEngine(settings, payload.engineId) ?? this.state.engineId
      const targetLanguage = this.resolveTargetLanguage(payload.targetLanguage)
      this.preferredEngineId = engineId
      this.preferredTargetLanguage = targetLanguage
      this.state = {
        ...this.state,
        engineId,
        targetLanguage,
      }
      this.sendState()

      if (this.state.sourceText) {
        return this.runTranslation(this.state.sourceText, { engineId, targetLanguage })
      }

      return { ok: true }
    })
    ipcMain.handle(InputTranslationWindowChannel.CopyDraft, async (_event, text: string) => {
      if (!text || this.state?.status !== 'success') {
        return { ok: false }
      }

      clipboard.writeText(text)
      return { ok: clipboard.readText() === text }
    })
    ipcMain.on(InputTranslationWindowChannel.Resize, (_event, height: number) => {
      this.resizeWindow(height)
    })
    ipcMain.on(InputTranslationWindowChannel.Move, (_event, deltaX: number, deltaY: number) => {
      this.moveWindow(deltaX, deltaY)
    })
    ipcMain.handle(InputTranslationWindowChannel.Close, async () => {
      this.hide()
      return { ok: true }
    })
  }

  private async runTranslation(text: string, options: InputTranslationOptions) {
    const normalizedText = text.trim()
    if (!this.state || !normalizedText) {
      return { ok: false, error: '请输入需要翻译的内容' }
    }

    const settings = await translationService.getSettings()
    const enabledEngineIds = getEnabledTranslationEngineIds(settings)
    const engineId = resolvePreferredTranslationEngine(settings, options.engineId) ?? this.state.engineId
    const targetLanguage = this.resolveTargetLanguage(options.targetLanguage)
    const requestVersion = ++this.translationRequestVersion
    this.preferredEngineId = engineId
    this.preferredTargetLanguage = targetLanguage

    this.state = {
      ...this.state,
      status: 'loading',
      value: normalizedText,
      sourceText: normalizedText,
      engineId,
      enabledEngineIds: enabledEngineIds.length ? enabledEngineIds : [engineId],
      targetLanguage,
      copied: false,
      errorMessage: undefined,
    }
    this.sendState()

    this.logger.warn('[InputTranslation][diagnostic] translation started', {
      engineId,
      targetLanguage,
      sourceLength: normalizedText.length,
    })

    try {
      const result = await translationService.translate({
        text: normalizedText,
        sourceLanguage: 'auto',
        targetLanguage,
        queryMode: 'text',
        engineId,
      })

      if (requestVersion !== this.translationRequestVersion || !this.state) {
        return { ok: false, error: 'stale_request' }
      }

      clipboard.writeText(result.translatedText)
      const clipboardVerified = clipboard.readText() === result.translatedText
      this.state = {
        ...this.state,
        status: 'success',
        value: result.translatedText,
        sourceText: normalizedText,
        engineId: result.engineId,
        targetLanguage: result.targetLanguage,
        copied: clipboardVerified,
        errorMessage: undefined,
      }
      this.sendState()
      this.window?.showFocused()

      this.logger.warn('[InputTranslation][diagnostic] translation completed', {
        engineId: result.engineId,
        targetLanguage: result.targetLanguage,
        resultLength: result.translatedText.length,
        clipboardVerified,
      })

      return { ok: clipboardVerified }
    } catch (error) {
      if (requestVersion !== this.translationRequestVersion || !this.state) {
        return { ok: false, error: 'stale_request' }
      }

      const errorMessage = error instanceof Error ? error.message : '翻译失败，请稍后重试'
      this.state = {
        ...this.state,
        status: 'error',
        value: normalizedText,
        copied: false,
        errorMessage,
      }
      this.sendState()
      this.logger.error('[InputTranslation] translation failed', error)
      return { ok: false, error: errorMessage }
    }
  }

  private resolveTargetLanguage(targetLanguage: string) {
    return translationLanguages.some((language) => language.code === targetLanguage && language.code !== 'auto')
      ? targetLanguage
      : 'en'
  }

  private sendState() {
    if (this.state) {
      this.window?.sendState(this.state)
    }
  }
}
