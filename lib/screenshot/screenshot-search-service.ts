import { shell } from 'electron'
import { GoogleLensService } from './google-lens-service'
import { ScreenshotService } from './screenshot-service'
import type { CapturedScreenshot, ScreenshotWorkflowResult } from './types'

export class ScreenshotSearchService {
  constructor(
    private readonly screenshotService = new ScreenshotService(),
    private readonly googleLensService = new GoogleLensService(),
    private readonly logger: Console = console,
  ) {}

  async start(): Promise<ScreenshotWorkflowResult> {
    if (!this.screenshotService.isSupported()) {
      return { ok: false, reason: 'unsupported' }
    }

    let capture: CapturedScreenshot | null = null
    try {
      capture = await this.screenshotService.captureInteractive('popmind-search')
    } catch (error) {
      if (isCaptureBusyError(error)) {
        return { ok: false, reason: 'capture_busy' }
      }

      this.logger.error('[ScreenshotSearchService] capture failed', error)
      return { ok: false, reason: 'failed' }
    }

    if (!capture) {
      return { ok: false, reason: 'cancelled' }
    }

    try {
      const targetUrl = await this.googleLensService.createSearchUrl(capture.path)
      await shell.openExternal(targetUrl)
      return { ok: true }
    } catch (error) {
      this.logger.error('[ScreenshotSearchService] search failed', error)
      return { ok: false, reason: 'failed' }
    } finally {
      await capture.cleanup()
    }
  }
}

const isCaptureBusyError = (error: unknown) => error instanceof Error && error.message === 'capture_busy'
