import { app, BrowserWindow, type Rectangle } from 'electron'
import { join } from 'node:path'
import { TranslationWindowChannel } from '@/lib/translation/shared'
import type { TranslationWindowState } from '@/lib/translation/types'
import type { SelectionBridge } from '@/lib/text-picker/shared'

export interface TranslationWindowPort {
  isDestroyed(): boolean
  isVisible(): boolean
  hide(): void
  showInactive(): void
  setBounds(bounds: Rectangle): void
  getBounds(): Rectangle
  getSize(): [number, number]
  orderFront(): void
  sendState(state: TranslationWindowState): void
  onMove(callback: (bounds: Rectangle) => void): () => void
  destroy(): void
}

export class TranslationWindow implements TranslationWindowPort {
  private readonly window: BrowserWindow

  constructor(private readonly bridge: SelectionBridge) {
    this.window = this.createWindow()
  }

  private createWindow() {
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: 404,
      height: 248,
      show: false,
      frame: false,
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
        preload: join(__dirname, '../preload/translationPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    }

    if (process.platform === 'darwin') {
      windowOptions.type = 'panel'
    }

    const translationWindow = new BrowserWindow(windowOptions)
    translationWindow.setAlwaysOnTop(true, 'pop-up-menu')
    translationWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    })

    this.bridge.configureBubbleWindow(translationWindow.getNativeWindowHandle())

    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      void translationWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/translate.html`)
    } else {
      void translationWindow.loadFile(join(__dirname, '../renderer/translate.html'))
    }

    return translationWindow
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

  getSize() {
    return this.window.getSize()
  }

  orderFront() {
    this.bridge.orderBubbleFront(this.window.getNativeWindowHandle())
  }

  sendState(state: TranslationWindowState) {
    this.window.webContents.send(TranslationWindowChannel.State, state)
  }

  onMove(callback: (bounds: Rectangle) => void) {
    const listener = () => callback(this.window.getBounds())
    this.window.on('move', listener)
    return () => {
      this.window.removeListener('move', listener)
    }
  }

  destroy() {
    if (!this.window.isDestroyed()) {
      this.window.destroy()
    }
  }
}
