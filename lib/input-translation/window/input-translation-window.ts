import { app, BrowserWindow, type Rectangle } from 'electron'
import { join } from 'node:path'
import { InputTranslationWindowChannel, type InputTranslationWindowState } from '@/lib/input-translation/shared'
import type { SelectionBridge } from '@/lib/text-picker/shared'

export class InputTranslationWindow {
  private readonly window: BrowserWindow
  private rendererReady = false
  private pendingState: InputTranslationWindowState | null = null
  private shouldFocusWhenReady = false

  constructor(
    private readonly bridge: SelectionBridge,
    private readonly logger: Console = console
  ) {
    this.window = this.createWindow()
  }

  private createWindow() {
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: 400,
      height: 102,
      show: false,
      frame: false,
      acceptFirstMouse: true,
      transparent: true,
      resizable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      focusable: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: false,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/inputTranslationPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    }

    if (process.platform === 'darwin') {
      windowOptions.type = 'panel'
    }

    const inputWindow = new BrowserWindow(windowOptions)
    inputWindow.setAlwaysOnTop(true, 'pop-up-menu')
    inputWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })

    inputWindow.once('ready-to-show', () => {
      this.bridge.configureBubbleWindow(inputWindow.getNativeWindowHandle())
    })

    inputWindow.webContents.on('did-finish-load', () => {
      this.rendererReady = true
      this.flushState()
      if (this.shouldFocusWhenReady) {
        this.showFocused()
      }
    })

    inputWindow.webContents.on('render-process-gone', (_event, details) => {
      this.rendererReady = false
      this.logger.error('[InputTranslationWindow] renderer stopped', details)
    })

    inputWindow.webContents.on('preload-error', (_event, preloadPath, error) => {
      this.logger.error('[InputTranslationWindow] preload failed', { preloadPath, error })
    })

    inputWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
      const payload = { level, message, line, sourceId }
      if (typeof message === 'string' && message.includes('[InputTranslation][diagnostic]')) {
        this.logger.warn('[InputTranslationWindow][console]', payload)
        return
      }

      this.logger.info('[InputTranslationWindow][console]', payload)
    })

    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      void inputWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/input-translation.html`)
    } else {
      void inputWindow.loadFile(join(__dirname, '../renderer/input-translation.html'))
    }

    return inputWindow
  }

  isDestroyed() {
    return this.window.isDestroyed()
  }

  isVisible() {
    return this.window.isVisible()
  }

  hide() {
    this.shouldFocusWhenReady = false
    this.window.hide()
  }

  setBounds(bounds: Rectangle) {
    this.window.setBounds(bounds)
  }

  getBounds() {
    return this.window.getBounds()
  }

  showFocused() {
    if (!this.rendererReady || this.window.isDestroyed()) {
      this.shouldFocusWhenReady = true
      return
    }

    this.shouldFocusWhenReady = false
    this.window.show()
    this.window.focus()
    this.window.webContents.focus()
    this.bridge.orderBubbleFront(this.window.getNativeWindowHandle())
    this.window.webContents.send(InputTranslationWindowChannel.Focus)
  }

  sendState(state: InputTranslationWindowState) {
    this.pendingState = state
    this.flushState()
  }

  private flushState() {
    if (!this.rendererReady || !this.pendingState || this.window.isDestroyed()) {
      return
    }

    this.window.webContents.send(InputTranslationWindowChannel.State, this.pendingState)
  }

  destroy() {
    if (!this.window.isDestroyed()) {
      this.window.destroy()
    }
  }
}
