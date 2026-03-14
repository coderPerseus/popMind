import { app, BrowserWindow, type Rectangle } from 'electron'
import { join } from 'node:path'
import { SelectionChatWindowChannel } from './shared'
import type { SelectionChatWindowState } from '@/lib/selection-chat/types'
import type { SelectionBridge } from '@/lib/text-picker/shared'

export class SelectionChatWindow {
  private readonly window: BrowserWindow

  constructor(private readonly bridge: SelectionBridge) {
    this.window = this.createWindow()
  }

  private createWindow() {
    const windowOptions: Electron.BrowserWindowConstructorOptions = {
      width: 520,
      height: 620,
      minWidth: 420,
      minHeight: 500,
      show: false,
      frame: false,
      acceptFirstMouse: true,
      transparent: true,
      resizable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      skipTaskbar: true,
      hasShadow: true,
      backgroundColor: '#00000000',
      webPreferences: {
        preload: join(__dirname, '../preload/selectionChatPreload.js'),
        contextIsolation: true,
        nodeIntegration: false,
      },
    }

    if (process.platform === 'darwin') {
      windowOptions.type = 'panel'
    }

    const chatWindow = new BrowserWindow(windowOptions)
    chatWindow.setAlwaysOnTop(true, 'pop-up-menu')
    chatWindow.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen: true,
    })

    chatWindow.once('ready-to-show', () => {
      this.bridge.configureBubbleWindow(chatWindow.getNativeWindowHandle())
    })

    if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
      void chatWindow.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/selection-chat.html`)
    } else {
      void chatWindow.loadFile(join(__dirname, '../renderer/selection-chat.html'))
    }

    return chatWindow
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

  getBounds() {
    return this.window.getBounds()
  }

  setBounds(bounds: Rectangle) {
    this.window.setBounds(bounds)
  }

  getSize() {
    return this.window.getSize() as [number, number]
  }

  orderFront() {
    this.bridge.orderBubbleFront(this.window.getNativeWindowHandle())
  }

  sendState(state: SelectionChatWindowState) {
    this.window.webContents.send(SelectionChatWindowChannel.State, state)
  }

  onMove(callback: (bounds: Rectangle) => void) {
    const listener = () => callback(this.window.getBounds())
    this.window.on('move', listener)
    return () => this.window.removeListener('move', listener)
  }

  destroy() {
    if (!this.window.isDestroyed()) {
      this.window.destroy()
    }
  }
}
