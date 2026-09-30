// Full-screen "focus complete" moment (spec docs/todo-focus-redesign.md): a transparent, non-activating panel over
// the display under the cursor with native vibrancy behind the page. It never activates popMind, so the user's app
// keeps focus once the overlay goes away.
import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { clipboardNative } from '@/lib/clipboard/native-bridge'
import { mainLogger } from '@/lib/main/logger'
import { TodoChannel } from '@/lib/todo-focus/store'
import type { FocusCelebration } from '@/lib/todo-focus/types'

const PAGE = 'focus-overlay.html'
const FADE_IN_MS = 420
const FADE_OUT_MS = 280
/** Nobody at the desk: fade away on its own. */
const AUTO_HIDE_MS = 60_000

class FocusOverlay {
  private window: BrowserWindow | null = null
  private loadPromise: Promise<void> | null = null
  private fadeTimer: NodeJS.Timeout | null = null
  private autoHideTimer: NodeJS.Timeout | null = null

  private pageUrl() {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL'])
      return `${process.env['ELECTRON_RENDERER_URL']}/${PAGE}`
    return join(__dirname, `../renderer/${PAGE}`)
  }

  private ensureWindow() {
    if (this.window && !this.window.isDestroyed()) return this.window

    const window = new BrowserWindow({
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      hasShadow: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      acceptFirstMouse: true,
      enableLargerThanScreen: true,
      ...(process.platform === 'darwin'
        ? { type: 'panel' as const, vibrancy: 'fullscreen-ui' as const, visualEffectState: 'active' as const }
        : {}),
      webPreferences: {
        preload: join(__dirname, '../preload/preload.js'),
        sandbox: false,
      },
    })
    window.setAlwaysOnTop(true, 'screen-saver')
    // skipTransformProcessType: never flip the Dock activation policy (window-manager owns it).
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())
    window.on('closed', () => {
      if (this.window === window) {
        this.window = null
        this.loadPromise = null
      }
    })

    const url = this.pageUrl()
    const load = !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] ? window.loadURL(url) : window.loadFile(url)
    this.loadPromise = load.catch((error) => mainLogger.error('[focus-overlay] page load failed', error))
    this.window = window
    return window
  }

  /** Builds the window ahead of time (called when a focus run starts) so the end moment appears instantly. */
  prewarm() {
    this.ensureWindow()
  }

  private fade(window: BrowserWindow, from: number, to: number, durationMs: number, done?: () => void) {
    if (this.fadeTimer) clearInterval(this.fadeTimer)
    const startedAt = Date.now()
    window.setOpacity(from)
    this.fadeTimer = setInterval(() => {
      if (window.isDestroyed()) return
      const progress = Math.min(1, (Date.now() - startedAt) / durationMs)
      const eased = 1 - (1 - progress) ** 3
      window.setOpacity(from + (to - from) * eased)
      if (progress >= 1) {
        if (this.fadeTimer) clearInterval(this.fadeTimer)
        this.fadeTimer = null
        done?.()
      }
    }, 16)
  }

  async show(payload: FocusCelebration) {
    const startedAt = performance.now()
    const window = this.ensureWindow()
    await this.loadPromise
    // Quit / dispose may have happened while the page was loading.
    if (window.isDestroyed()) return

    const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
    window.setBounds(display.bounds)
    window.setOpacity(0)
    window.webContents.send(TodoChannel.Celebrate, payload)

    const presented = clipboardNative.presentPanelWithoutActivation(window.getNativeWindowHandle())
    if (!presented) {
      window.showInactive()
      window.focus()
    }
    this.fade(window, 0, 1, FADE_IN_MS)

    if (this.autoHideTimer) clearTimeout(this.autoHideTimer)
    this.autoHideTimer = setTimeout(() => this.hide('timeout'), AUTO_HIDE_MS)
    mainLogger.info('[focus-overlay] shown', {
      displayId: display.id,
      nativePresented: presented,
      ms: Math.round(performance.now() - startedAt),
    })
  }

  hide(reason: string) {
    if (this.autoHideTimer) clearTimeout(this.autoHideTimer)
    this.autoHideTimer = null
    const window = this.window
    if (!window || window.isDestroyed() || !window.isVisible()) return
    this.fade(window, window.getOpacity(), 0, FADE_OUT_MS, () => {
      if (!window.isDestroyed()) window.hide()
    })
    mainLogger.info('[focus-overlay] hidden', { reason })
  }

  dispose() {
    if (this.fadeTimer) clearInterval(this.fadeTimer)
    if (this.autoHideTimer) clearTimeout(this.autoHideTimer)
    if (this.window && !this.window.isDestroyed()) this.window.destroy()
    this.window = null
  }
}

export const focusOverlay = new FocusOverlay()
