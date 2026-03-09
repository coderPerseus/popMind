export interface CapturedScreenshot {
  path: string
  cleanup(): Promise<void>
}

export type ScreenshotWorkflowResult =
  | { ok: true }
  | { ok: false; reason: 'cancelled' | 'capture_busy' | 'empty_text' | 'unsupported' | 'failed' }
