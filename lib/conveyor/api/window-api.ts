import { ConveyorApi } from '@/lib/preload/shared'
import { MainWindowChannel } from '@/lib/conveyor/schemas/window-schema'

export class WindowApi extends ConveyorApi {
  // Generate window methods
  windowInit = () => this.invoke('window-init')
  windowIsMinimizable = () => this.invoke('window-is-minimizable')
  windowIsMaximizable = () => this.invoke('window-is-maximizable')
  windowMinimize = () => this.invoke('window-minimize')
  windowMaximize = () => this.invoke('window-maximize')
  windowClose = () => this.invoke('window-close')
  windowDismissTopmost = () => this.invoke('window-dismiss-topmost')
  windowMaximizeToggle = () => this.invoke('window-maximize-toggle')
  windowShowRoute = (route: 'home' | 'settings') => this.invoke('window-show-route', route)
  windowShowHomeWithQuery = (query: string) => this.invoke('window-show-home-with-query', query)
  onMainWindowReset = (handler: () => void) => {
    const listener = () => handler()
    this.renderer.on(MainWindowChannel.ResetState, listener)
    return () => {
      this.renderer.removeListener(MainWindowChannel.ResetState, listener)
    }
  }
  onMainWindowSetSearchQuery = (handler: (query: string) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, query: string) => handler(query)
    this.renderer.on(MainWindowChannel.SetSearchQuery, listener)
    return () => {
      this.renderer.removeListener(MainWindowChannel.SetSearchQuery, listener)
    }
  }

  // Generate web methods
  webUndo = () => this.invoke('web-undo')
  webRedo = () => this.invoke('web-redo')
  webCut = () => this.invoke('web-cut')
  webCopy = () => this.invoke('web-copy')
  webPaste = () => this.invoke('web-paste')
  webDelete = () => this.invoke('web-delete')
  webSelectAll = () => this.invoke('web-select-all')
  webReload = () => this.invoke('web-reload')
  webForceReload = () => this.invoke('web-force-reload')
  webToggleDevtools = () => this.invoke('web-toggle-devtools')
  webActualSize = () => this.invoke('web-actual-size')
  webZoomIn = () => this.invoke('web-zoom-in')
  webZoomOut = () => this.invoke('web-zoom-out')
  webToggleFullscreen = () => this.invoke('web-toggle-fullscreen')
  webOpenUrl = (url: string) => this.invoke('web-open-url', url)
}
