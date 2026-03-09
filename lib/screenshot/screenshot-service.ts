import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { access, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { CapturedScreenshot } from './types'

const execFileAsync = promisify(execFile)

export class ScreenshotService {
  private captureInFlight = false

  isSupported() {
    return process.platform === 'darwin'
  }

  async captureInteractive(prefix = 'popmind'): Promise<CapturedScreenshot | null> {
    if (!this.isSupported()) {
      return null
    }

    if (this.captureInFlight) {
      throw new Error('capture_busy')
    }

    const filePath = join(tmpdir(), `${prefix}-${Date.now()}-${randomUUID()}.png`)
    this.captureInFlight = true

    try {
      await execFileAsync('screencapture', ['-i', '-x', filePath])
      await access(filePath)

      return {
        path: filePath,
        cleanup: async () => {
          await rm(filePath, { force: true })
        },
      }
    } catch (error) {
      await rm(filePath, { force: true })

      if (isScreenshotCancelError(error)) {
        return null
      }

      throw error
    } finally {
      this.captureInFlight = false
    }
  }
}

const isScreenshotCancelError = (error: unknown) => {
  const captureError = error as Error & { code?: number }
  return captureError?.code === 1 || (error instanceof Error && /Command failed: screencapture\b/.test(error.message))
}
