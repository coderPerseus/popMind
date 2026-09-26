import { BrowserWindow, shell } from 'electron'
import { handle } from '@/lib/main/shared'
import { showMainWindow } from '@/lib/main/window-manager'
import { autoDismissController } from '@/lib/windowing/auto-dismiss-controller'
import { electronAPI } from '@electron-toolkit/preload'

export const registerWindowHandlers = (mainWindow: BrowserWindow) => {
  // Settings has its own window, so act on whichever window is focused (usually the caller).
  const target = () => {
    const focused = BrowserWindow.getFocusedWindow()
    return focused && !focused.isDestroyed() ? focused : mainWindow
  }

  // Window operations
  handle('window-init', () => {
    const window = target()
    const { width, height } = window.getBounds()
    const minimizable = window.isMinimizable()
    const maximizable = window.isMaximizable()
    const platform = electronAPI.process.platform

    return { width, height, minimizable, maximizable, platform }
  })

  handle('window-is-minimizable', () => target().isMinimizable())
  handle('window-is-maximizable', () => target().isMaximizable())
  handle('window-minimize', () => target().minimize())
  handle('window-maximize', () => target().maximize())
  handle('window-close', () => target().close())
  handle('window-dismiss-topmost', () => {
    autoDismissController.dismissTopmost('escape')
  })
  handle('window-maximize-toggle', () => {
    const window = target()
    return window.isMaximized() ? window.unmaximize() : window.maximize()
  })
  handle('window-show-route', async (route) => {
    await showMainWindow(route)
  })
  handle('window-show-home-with-query', async (query: string) => {
    await showMainWindow('home', { searchQuery: query })
  })

  // Web content operations
  const webContents = () => target().webContents
  handle('web-undo', () => webContents().undo())
  handle('web-redo', () => webContents().redo())
  handle('web-cut', () => webContents().cut())
  handle('web-copy', () => webContents().copy())
  handle('web-paste', () => webContents().paste())
  handle('web-delete', () => webContents().delete())
  handle('web-select-all', () => webContents().selectAll())
  handle('web-reload', () => webContents().reload())
  handle('web-force-reload', () => webContents().reloadIgnoringCache())
  handle('web-toggle-devtools', () => webContents().toggleDevTools())
  handle('web-actual-size', () => webContents().setZoomLevel(0))
  handle('web-zoom-in', () => webContents().setZoomLevel(webContents().zoomLevel + 0.5))
  handle('web-zoom-out', () => webContents().setZoomLevel(webContents().zoomLevel - 0.5))
  handle('web-toggle-fullscreen', () => {
    const window = target()
    window.setFullScreen(!window.fullScreen)
  })
  handle('web-open-url', (url: string) => shell.openExternal(url))
}
