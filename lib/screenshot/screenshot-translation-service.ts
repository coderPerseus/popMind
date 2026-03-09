import { TranslationWindowManager } from '@/lib/translation/window/translation-window-manager'
import { ScreenshotService } from './screenshot-service'
import type { CapturedScreenshot, ScreenshotWorkflowResult } from './types'
import { VisionOcrService } from './vision-ocr-service'

export class ScreenshotTranslationService {
  constructor(
    private readonly translationWindowManager: TranslationWindowManager,
    private readonly screenshotService = new ScreenshotService(),
    private readonly ocrService = new VisionOcrService(),
    private readonly logger: Console = console,
  ) {}

  async start(): Promise<ScreenshotWorkflowResult> {
    if (!this.screenshotService.isSupported() || !this.ocrService.isSupported()) {
      await this.translationWindowManager.showErrorState({
        presentation: 'centered',
        errorMessage: '当前系统暂不支持截图翻译',
      })
      return { ok: false, reason: 'unsupported' }
    }

    let capture: CapturedScreenshot | null = null
    try {
      capture = await this.screenshotService.captureInteractive('popmind-translate')
    } catch (error) {
      if (isCaptureBusyError(error)) {
        return { ok: false, reason: 'capture_busy' }
      }

      this.logger.error('[ScreenshotTranslationService] capture failed', error)
      await this.translationWindowManager.showErrorState({
        presentation: 'centered',
        errorMessage: '截图失败，请重试',
      })
      return { ok: false, reason: 'failed' }
    }

    if (!capture) {
      return { ok: false, reason: 'cancelled' }
    }

    try {
      await this.translationWindowManager.showProcessingState({
        presentation: 'centered',
        loadingTitle: '识别截图中',
        loadingDescription: '正在提取截图里的文字…',
      })

      const recognizedText = (await this.ocrService.recognizeText(capture.path)).trim()
      if (!recognizedText) {
        await this.translationWindowManager.showErrorState({
          presentation: 'centered',
          errorMessage: '未识别到可翻译的文字',
        })
        return { ok: false, reason: 'empty_text' }
      }

      await this.translationWindowManager.showTranslation({
        text: recognizedText,
        sourceAppId: 'screenshot',
        anchor: null,
        presentation: 'centered',
      })
      return { ok: true }
    } catch (error) {
      this.logger.error('[ScreenshotTranslationService] translation failed', error)
      await this.translationWindowManager.showErrorState({
        presentation: 'centered',
        errorMessage: error instanceof Error ? error.message : '截图翻译失败',
      })
      return { ok: false, reason: 'failed' }
    } finally {
      await capture.cleanup()
    }
  }
}

const isCaptureBusyError = (error: unknown) => error instanceof Error && error.message === 'capture_busy'
