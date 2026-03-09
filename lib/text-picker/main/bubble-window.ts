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

  constructor(private readonly bridge: SelectionBridge) {
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

    bubbleWindow.once('ready-to-show', () => {
      this.bridge.configureBubbleWindow(bubbleWindow.getNativeWindowHandle())
    })

    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      void bubbleWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/bubble.html`)
    } else {
      void bubbleWindow.loadFile(join(__dirname, '../renderer/bubble.html'))
    }

    return bubbleWindow
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
    this.window.webContents.send(TextPickerChannel.BubbleUpdate, payload)
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
    if (!this.window.isDestroyed()) {
      this.window.destroy()
    }
  }
}
