import { app, BrowserWindow, type Rectangle } from 'electron'
import { join } from 'node:path'
import { TextPickerChannel, TOOLBAR_HEIGHT, TOOLBAR_MIN_WIDTH } from '@/lib/text-picker/shared'
import type { BubbleUpdatePayload, SelectionBridge } from '@/lib/text-picker/shared'

export interface BubbleWindowPort {
  isDestroyed(): boolean
  isVisible(): boolean
  hide(): void
  showInactive(): void
  setBounds(bounds: Rectangle): void
  getBounds(): Rectangle
  sendUpdate(payload: BubbleUpdatePayload): void
  getNativeWindowHandle(): Buffer
  orderFront(): void
  onMove(callback: (bounds: Rectangle) => void): () => void
  destroy(): void
}

export class SelectionBubbleWindow implements BubbleWindowPort {
  private readonly window: BrowserWindow
  private readonly logger: Console
  private rendererReady = false
  private pendingPayload: BubbleUpdatePayload | null = null
  private reloadTimer: NodeJS.Timeout | null = null

  constructor(
    private readonly bridge: SelectionBridge,
    logger: Console = console
  ) {
    this.logger = logger
    this.window = this.createWindow()
  }

  private createWindow(): BrowserWindow {
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: TOOLBAR_MIN_WIDTH,
      height: TOOLBAR_HEIGHT,
      show: false,
      frame: false,
      // Keep first click functional while the bubble stays non-active.
      acceptFirstMouse: true,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/bubblePreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    }

    if (process.platform === 'darwin') {
      windowOptions.type = 'panel'
    }

    const bubbleWindow = new BrowserWindow(windowOptions)
    bubbleWindow.setAlwaysOnTop(true, 'pop-up-menu')
    bubbleWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    })
    this.attachLifecycle(bubbleWindow)

    bubbleWindow.once('ready-to-show', () => {
      this.bridge.configureBubbleWindow(bubbleWindow.getNativeWindowHandle())
    })

    void this.loadContent(bubbleWindow)

    return bubbleWindow
  }

  private getBubbleUrl() {
    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      return `${process.env['ELECTRON_RENDERER_URL']}/bubble.html`
    }

    return join(__dirname, '../renderer/bubble.html')
  }

  private async loadContent(window = this.window) {
    if (window.isDestroyed()) {
      return
    }

    this.rendererReady = false

    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      await window.loadURL(this.getBubbleUrl())
      return
    }

    await window.loadFile(this.getBubbleUrl())
  }

  private attachLifecycle(window: BrowserWindow) {
    const logPrefix = '[SelectionBubbleWindow]'

    window.webContents.on('did-finish-load', () => {
      this.rendererReady = true
      this.logger.info(`${logPrefix} renderer ready`, {
        url: window.webContents.getURL(),
        visible: window.isVisible(),
      })
      this.flushPendingPayload('did-finish-load')
    })

    window.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
      if (!isMainFrame) {
        return
      }

      this.rendererReady = false
      this.logger.warn(`${logPrefix} did-fail-load`, {
        errorCode,
        errorDescription,
        validatedURL,
      })
      this.scheduleReload(`did-fail-load:${errorCode}`)
    })

    window.webContents.on('render-process-gone', (_event, details) => {
      this.rendererReady = false
      this.logger.error(`${logPrefix} render-process-gone`, details)
      this.scheduleReload(`render-process-gone:${details.reason}`)
    })

    window.on('unresponsive', () => {
      this.rendererReady = false
      this.logger.error(`${logPrefix} unresponsive`)
      this.scheduleReload('unresponsive')
    })

    window.on('responsive', () => {
      this.logger.info(`${logPrefix} responsive`)
    })

    window.on('closed', () => {
      this.rendererReady = false
      if (this.reloadTimer) {
        clearTimeout(this.reloadTimer)
        this.reloadTimer = null
      }
    })
  }

  private scheduleReload(reason: string) {
    if (this.window.isDestroyed() || this.reloadTimer) {
      return
    }

    this.logger.warn('[SelectionBubbleWindow] scheduling reload', { reason })
    this.reloadTimer = setTimeout(() => {
      this.reloadTimer = null
      void this.reload(reason)
    }, 150)
  }

  private async reload(reason: string) {
    if (this.window.isDestroyed()) {
      return
    }

    try {
      this.logger.warn('[SelectionBubbleWindow] reloading renderer', {
        reason,
        visible: this.window.isVisible(),
      })
      await this.loadContent()
    } catch (error) {
      this.logger.error('[SelectionBubbleWindow] reload failed', {
        reason,
        error,
      })
      this.scheduleReload(`retry:${reason}`)
    }
  }

  private flushPendingPayload(source: string) {
    if (!this.pendingPayload || this.window.isDestroyed() || !this.rendererReady) {
      return
    }

    try {
      this.window.webContents.send(TextPickerChannel.BubbleUpdate, this.pendingPayload)
      this.logger.info('[SelectionBubbleWindow] replayed pending payload', {
        source,
        selectionId: this.pendingPayload.selectionId,
        textLength: this.pendingPayload.selectionText.length,
      })
    } catch (error) {
      this.rendererReady = false
      this.logger.error('[SelectionBubbleWindow] replay pending payload failed', {
        source,
        error,
      })
      this.scheduleReload(`replay-failed:${source}`)
    }
  }

  isDestroyed() {
    return this.window.isDestroyed()
  }

  isVisible() {
    return this.window.isVisible()
  }

  hide() {
    this.window.hide()
  }

  showInactive() {
    this.window.showInactive()
  }

  setBounds(bounds: Rectangle) {
    this.window.setBounds(bounds)
  }

  getBounds() {
    return this.window.getBounds()
  }

  sendUpdate(payload: BubbleUpdatePayload) {
    this.pendingPayload = payload

    if (this.window.isDestroyed()) {
      return
    }

    if (!this.rendererReady || this.window.webContents.isLoadingMainFrame()) {
      this.logger.info('[SelectionBubbleWindow] queueing payload until renderer is ready', {
        rendererReady: this.rendererReady,
        loading: this.window.webContents.isLoadingMainFrame(),
        selectionId: payload.selectionId,
      })
      return
    }

    try {
      this.window.webContents.send(TextPickerChannel.BubbleUpdate, payload)
      this.logger.info('[SelectionBubbleWindow] sent update', {
        selectionId: payload.selectionId,
        textLength: payload.selectionText.length,
      })
    } catch (error) {
      this.rendererReady = false
      this.logger.error('[SelectionBubbleWindow] send update failed', {
        selectionId: payload.selectionId,
        error,
      })
      this.scheduleReload('send-update-failed')
    }
  }

  getNativeWindowHandle() {
    return this.window.getNativeWindowHandle()
  }

  orderFront() {
    this.bridge.orderBubbleFront(this.window.getNativeWindowHandle())
  }

  onMove(callback: (bounds: Rectangle) => void) {
    const listener = () => callback(this.window.getBounds())
    this.window.on('move', listener)
    return () => {
      this.window.removeListener('move', listener)
    }
  }

  destroy() {
    if (this.reloadTimer) {
      clearTimeout(this.reloadTimer)
      this.reloadTimer = null
    }
    if (!this.window.isDestroyed()) {
      this.window.destroy()
    }
  }
}
