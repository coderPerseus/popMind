import { app, BrowserWindow, type Rectangle } from 'electron'
import { join } from 'node:path'
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
  destroy(): void
}

export class SelectionBubbleWindow implements BubbleWindowPort {
  private readonly window: BrowserWindow

  constructor(private readonly bridge: SelectionBridge) {
    this.window = this.createWindow()
  }

  private createWindow(): BrowserWindow {
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: 460,
      height: 50,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
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

    bubbleWindow.on('blur', () => {
      if (!bubbleWindow.isDestroyed()) {
        bubbleWindow.hide()
      }
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
    this.window.webContents.send('bubble:update', payload)
  }

  getNativeWindowHandle() {
    return this.window.getNativeWindowHandle()
  }

  orderFront() {
    this.bridge.orderBubbleFront(this.window.getNativeWindowHandle())
  }

  destroy() {
    if (!this.window.isDestroyed()) {
      this.window.destroy()
    }
  }
}
