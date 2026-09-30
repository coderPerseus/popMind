// The Paste-style bottom panel (spec §5.4).
//
// Key property: showing the panel never activates popMind. The window is an NSPanel (`type: 'panel'`) that is ordered
// front through the native `presentPanelWithoutActivation`, so the app the user is typing in stays frontmost and
// receives the ⌘V after the panel hides. This module never touches the Dock activation policy.
import { app, BrowserWindow, screen } from 'electron'
import { join } from 'node:path'
import { capabilityStore } from '@/lib/capability/store'
import { clipboardEvents } from '@/lib/clipboard/events'
import { clipboardNative } from '@/lib/clipboard/native-bridge'
import type { ClipItemsChangedEvent, ClipPanelShowEvent, ClipPasteStackState } from '@/lib/clipboard/types'
import type { PasteTarget } from '@/lib/clipboard/write/paste-service'
import { getClipboardSettings } from '@/lib/clipboard/write/settings'
import { ClipboardChannel } from '@/lib/conveyor/schemas/clipboard-schema'
import { mainLogger } from '@/lib/main/logger'
import { clampPanelHeight, computePanelBounds, resizePanelKeepingBottom } from './panel-geometry'
import { loadPanelHeight, savePanelHeight } from './panel-state'

/** Top corner radius of the panel; keep in sync with `.cp-strip` border-radius in clipboard-panel.css. */
const PANEL_CORNER_RADIUS = 4

const PANEL_PAGE = 'clipboard-panel.html'
/** If the renderer does not call `clip-panel-hide` after `PanelRequestHide`, hide anyway. */
const HIDE_FALLBACK_MS = 250
/** Ignore blur right after presenting: the native present can flicker key state. */
const BLUR_GRACE_MS = 250
/** First show right after a cold load: give React a moment to subscribe before the show event. */
const COLD_START_SETTLE_MS = 150
const LOAD_WAIT_TIMEOUT_MS = 3000
const HEIGHT_PERSIST_DEBOUNCE_MS = 300

export type ShowPanelOptions = {
  initialQuery?: string
  /**
   * `launcher`: opened from the launcher window (`/clip`). popMind itself is frontmost then, so the app that was
   * frontmost before the launcher opened is used as the paste target.
   */
  source: 'shortcut' | 'launcher'
}

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

const round = (value: number) => Math.round(value * 10) / 10

class ClipboardPanelWindow {
  private window: BrowserWindow | null = null
  private loadPromise: Promise<void> | null = null
  private loaded = false
  private height = loadPanelHeight()
  private target: PasteTarget | null = null
  private launcherTarget: PasteTarget | null = null
  private presentedAt = 0
  private hideTimer: NodeJS.Timeout | null = null
  private heightPersistTimer: NodeJS.Timeout | null = null
  private reloadTimer: NodeJS.Timeout | null = null
  private showInFlight: Promise<void> | null = null
  private eventsAttached = false

  /** Creates and loads the hidden window so the first shortcut press only has to slide content in. */
  prewarm() {
    const startedAt = performance.now()
    this.ensureWindow()
    void this.loadPromise?.then(() => {
      mainLogger.info('[clip-panel] prewarmed', { ms: Math.round(performance.now() - startedAt) })
    })
  }

  isVisible() {
    return Boolean(this.window && !this.window.isDestroyed() && this.window.isVisible())
  }

  getTarget() {
    return this.target
  }

  /**
   * Called whenever the launcher window is about to show, while the app the user came from is still frontmost.
   * Remembered so that `/clip` (launcher → panel) can paste back into that app.
   */
  rememberLauncherTarget() {
    this.launcherTarget = this.readFrontmostExternalApp()
  }

  show(options: ShowPanelOptions) {
    if (this.showInFlight) {
      return this.showInFlight
    }

    const pending = this.doShow(options)
      .catch((error) => {
        mainLogger.error('[clip-panel] show failed', error)
      })
      .finally(() => {
        this.showInFlight = null
      })
    this.showInFlight = pending
    return pending
  }

  toggle() {
    if (this.isVisible()) {
      this.requestHide('shortcut')
      return Promise.resolve()
    }

    return this.show({ source: 'shortcut' })
  }

  /** Ask the renderer to animate out; it answers with `clip-panel-hide`. Forced after 250 ms. */
  requestHide(reason: string) {
    const window = this.window
    if (!window || window.isDestroyed() || !window.isVisible()) return
    if (this.hideTimer) return

    mainLogger.info('[clip-panel] request-hide', { reason })
    if (this.loaded && !window.webContents.isDestroyed()) {
      window.webContents.send(ClipboardChannel.PanelRequestHide)
    }

    this.hideTimer = setTimeout(() => {
      this.hideTimer = null
      if (this.isVisible()) {
        mainLogger.warn('[clip-panel] renderer did not confirm hide, forcing', { reason })
        this.hideNow(`${reason}:forced`)
      }
    }, HIDE_FALLBACK_MS)
  }

  hideNow(reason: string) {
    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    const window = this.window
    if (!window || window.isDestroyed() || !window.isVisible()) return

    window.hide()
    mainLogger.info('[clip-panel] hidden', { reason, shownForMs: Date.now() - this.presentedAt })
  }

  setHeight(height: number) {
    const clamped = clampPanelHeight(height)
    this.height = clamped

    const window = this.window
    if (window && !window.isDestroyed() && window.isVisible()) {
      const bounds = window.getBounds()
      const display = screen.getDisplayMatching(bounds)
      window.setBounds(resizePanelKeepingBottom(bounds, clamped, display.workArea.height))
    }

    if (this.heightPersistTimer) clearTimeout(this.heightPersistTimer)
    this.heightPersistTimer = setTimeout(() => {
      this.heightPersistTimer = null
      savePanelHeight(clamped)
      mainLogger.info('[clip-panel] height saved', { height: clamped })
    }, HEIGHT_PERSIST_DEBOUNCE_MS)
  }

  /** Native drag of files out of the panel. Must run while the renderer's drag gesture is in progress. */
  startDrag(item: Electron.Item) {
    const window = this.window
    if (!window || window.isDestroyed()) return false
    window.webContents.startDrag(item)
    return true
  }

  dispose() {
    for (const timer of [this.hideTimer, this.heightPersistTimer, this.reloadTimer]) {
      if (timer) clearTimeout(timer)
    }
    this.hideTimer = null
    this.heightPersistTimer = null
    this.reloadTimer = null

    if (this.window && !this.window.isDestroyed()) {
      this.window.destroy()
    }
    this.window = null
    this.loadPromise = null
    this.loaded = false
  }

  // ---- internals ----

  private readFrontmostExternalApp(): PasteTarget | null {
    const frontmost = clipboardNative.getFrontmostApp()
    if (!frontmost || frontmost.pid <= 0 || frontmost.pid === process.pid) {
      return null
    }

    return { pid: frontmost.pid, bundleId: frontmost.bundleId, name: frontmost.name }
  }

  private resolveTarget(source: ShowPanelOptions['source']): PasteTarget | null {
    const frontmost = this.readFrontmostExternalApp()
    if (frontmost) return frontmost
    // popMind itself is frontmost: only the launcher hand-off has a meaningful previous app.
    return source === 'launcher' ? this.launcherTarget : null
  }

  private getPageUrl() {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      return `${process.env['ELECTRON_RENDERER_URL']}/${PANEL_PAGE}`
    }

    return join(__dirname, `../renderer/${PANEL_PAGE}`)
  }

  private ensureWindow(): BrowserWindow {
    if (this.window && !this.window.isDestroyed()) {
      return this.window
    }

    const window = new BrowserWindow({
      width: 1200,
      height: this.height,
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
      // The system rounds frameless windows by ~10px, which hides the smaller CSS radius; the shape comes from
      // PANEL_CORNER_RADIUS (vibrancy mask) + the matching CSS radius on .cp-strip instead.
      roundedCorners: false,
      ...(process.platform === 'darwin'
        ? {
            type: 'panel' as const,
            // The app is not active while the panel shows; without `active` the glass would turn flat grey.
            vibrancy: 'popover' as const,
            visualEffectState: 'active' as const,
          }
        : {}),
      webPreferences: {
        // Same preload as the main window: exposes window.conveyor.
        preload: join(__dirname, '../preload/preload.js'),
        sandbox: false,
      },
    })

    window.setHasShadow(false)
    window.setAlwaysOnTop(true, 'pop-up-menu')
    // `skipTransformProcessType`: do not let Electron flip the Dock activation policy (window-manager owns it).
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })

    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event) => event.preventDefault())

    this.attachWindowEvents(window)
    this.window = window
    this.applyAppearance(window)
    const detachSettings = capabilityStore.subscribe(() => {
      if (!window.isDestroyed()) this.applyAppearance(window)
    })
    window.once('closed', detachSettings)
    this.loadContent(window)
    this.attachBusEvents()
    return window
  }

  /** The panel has its own theme (settings.clipboard.appearance), independent of the app theme. */
  private applyAppearance(window: BrowserWindow) {
    clipboardNative.setVibrancyTopCornerRadius(window.getNativeWindowHandle(), PANEL_CORNER_RADIUS)
    const appearance = getClipboardSettings().appearance ?? 'dark'
    clipboardNative.setWindowAppearance(window.getNativeWindowHandle(), appearance === 'app' ? 'inherit' : appearance)
  }

  private loadContent(window: BrowserWindow) {
    this.loaded = false
    const url = this.getPageUrl()
    const startedAt = performance.now()

    const load = !app.isPackaged && process.env['ELECTRON_RENDERER_URL'] ? window.loadURL(url) : window.loadFile(url)

    this.loadPromise = load
      .then(() => {
        this.loaded = true
        mainLogger.info('[clip-panel] page loaded', { url, ms: Math.round(performance.now() - startedAt) })
      })
      .catch((error) => {
        if (!(error instanceof Error && error.message.includes('ERR_ABORTED'))) {
          mainLogger.error('[clip-panel] page load failed', error)
          this.scheduleReload('load-failed')
        }
      })
  }

  private scheduleReload(reason: string) {
    if (this.reloadTimer) return
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null
      const window = this.window
      if (!window || window.isDestroyed()) return
      mainLogger.warn('[clip-panel] reloading page', { reason })
      this.loadContent(window)
    }, 500)
  }

  private attachWindowEvents(window: BrowserWindow) {
    window.on('blur', () => {
      if (!window.isVisible()) return
      const sincePresent = Date.now() - this.presentedAt
      if (sincePresent < BLUR_GRACE_MS) {
        mainLogger.info('[clip-panel] blur ignored (grace)', { sincePresent })
        return
      }
      this.requestHide('blur')
    })

    window.on('hide', () => {
      if (this.hideTimer) {
        clearTimeout(this.hideTimer)
        this.hideTimer = null
      }
    })

    window.webContents.on('render-process-gone', (_event, details) => {
      this.loaded = false
      mainLogger.error('[clip-panel] render-process-gone', details)
      this.scheduleReload(`render-process-gone:${details.reason}`)
    })

    window.on('unresponsive', () => mainLogger.warn('[clip-panel] unresponsive'))

    window.on('closed', () => {
      if (this.window === window) {
        this.window = null
        this.loaded = false
        this.loadPromise = null
      }
    })
  }

  /** Forwards main-process clipboard events to the panel renderer. */
  private attachBusEvents() {
    if (this.eventsAttached) return
    this.eventsAttached = true

    clipboardEvents.on('items-changed', (event: ClipItemsChangedEvent) => {
      this.send(ClipboardChannel.ItemsChanged, event)
    })
    clipboardEvents.on('paste-stack', (state: ClipPasteStackState) => {
      this.send(ClipboardChannel.PasteStack, state)
    })
  }

  private send(channel: string, payload?: unknown) {
    const window = this.window
    if (!window || window.isDestroyed() || window.webContents.isDestroyed() || !this.loaded) return
    window.webContents.send(channel, payload)
  }

  private async waitUntilLoaded(): Promise<boolean> {
    if (this.loaded) return true
    const pending = this.loadPromise
    if (!pending) return false
    await Promise.race([pending, wait(LOAD_WAIT_TIMEOUT_MS)])
    return this.loaded
  }

  private async doShow(options: ShowPanelOptions) {
    const startedAt = performance.now()
    const steps: Record<string, number> = {}
    const mark = (name: string) => {
      steps[name] = round(performance.now() - startedAt)
    }

    const window = this.ensureWindow()
    const wasLoaded = this.loaded

    // 1. Remember who receives the paste, before anything can change the frontmost app.
    const target = this.resolveTarget(options.source)
    this.target = target
    mark('targetMs')

    if (this.hideTimer) {
      clearTimeout(this.hideTimer)
      this.hideTimer = null
    }

    const loaded = await this.waitUntilLoaded()
    mark('loadedMs')
    if (!loaded) {
      mainLogger.warn('[clip-panel] show aborted: page not loaded')
      return
    }

    // 2. Position: display under the cursor, full work-area width, glued to the bottom.
    const cursor = screen.getCursorScreenPoint()
    const display = screen.getDisplayNearestPoint(cursor)
    const bounds = computePanelBounds(display.workArea, this.height)
    window.setBounds(bounds)
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    mark('positionMs')

    // 3. Tell the renderer (it plays the slide-in when the window appears).
    const settings = getClipboardSettings()
    const accessibility = clipboardNative.isAccessibilityTrusted()
    const secureInput = clipboardNative.isSecureInputEnabled()
    const event: ClipPanelShowEvent = {
      openedAt: Date.now(),
      targetAppName: target?.name,
      canDirectPaste: settings.directPaste && accessibility && !secureInput && target !== null,
      initialQuery: options.initialQuery?.trim() ? options.initialQuery.trim() : undefined,
    }
    if (!wasLoaded) {
      await wait(COLD_START_SETTLE_MS)
    }
    window.webContents.send(ClipboardChannel.PanelShow, event)
    mark('eventMs')

    // 4. Show without activating popMind.
    this.applyAppearance(window)
    this.presentedAt = Date.now()
    const nativePresented = clipboardNative.presentPanelWithoutActivation(window.getNativeWindowHandle())
    if (!nativePresented) {
      mainLogger.warn('[clip-panel] native present unavailable, falling back to showInactive + focus')
      window.showInactive()
      window.focus()
    }
    window.webContents.focus()
    mark('presentMs')

    // Moving a hidden window between displays with different scale factors can leave stale bounds.
    const actual = window.getBounds()
    if (
      actual.x !== bounds.x ||
      actual.y !== bounds.y ||
      actual.width !== bounds.width ||
      actual.height !== bounds.height
    ) {
      window.setBounds(bounds)
      mainLogger.info('[clip-panel] bounds corrected', { wanted: bounds, actual })
    }

    mainLogger.info('[clip-panel] shown', {
      totalMs: round(performance.now() - startedAt),
      steps,
      nativePresented,
      source: options.source,
      display: display.id,
      bounds,
      target: target ? { bundleId: target.bundleId, name: target.name, pid: target.pid } : null,
      canDirectPaste: event.canDirectPaste,
      accessibility,
      secureInput,
      hasInitialQuery: Boolean(event.initialQuery),
    })
  }
}

export const clipboardPanel = new ClipboardPanelWindow()

export const isClipboardPanelVisible = () => clipboardPanel.isVisible()
