import { app, BrowserWindow } from 'electron'
import {
  createAppWindow,
  getMainWindowRouteHash,
  loadAppWindowRoute,
  MAIN_WINDOW_ROUTE_CONFIG,
  type MainWindowRoute,
} from './app'
import { selectionBridge } from '@/lib/text-picker/native/selection-bridge'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let currentRoute: MainWindowRoute | null = null
let routeLoadPromise: Promise<void> | null = null
let routeLoadTarget: MainWindowRoute | null = null
const HIDDEN_WINDOW_BUTTON_POSITION = { x: -100, y: -100 }
const SETTINGS_WINDOW_BUTTON_POSITION = { x: 14, y: 14 }

app.once('before-quit', () => {
  isQuitting = true
})

const isNavigationAbortError = (error: unknown) => {
  return error instanceof Error && error.message.includes('ERR_ABORTED')
}

const presentMainWindow = (window: BrowserWindow) => {
  if (window.isDestroyed()) {
    return
  }

  if (process.platform === 'darwin') {
    // Switch to regular app activation before showing main window, so macOS
    // changes focus to popMind instead of rendering above a fullscreen app.
    if (selectionBridge.isSupported) {
      selectionBridge.setActivationPolicy(0)
    }
    app.setActivationPolicy('regular')
    app.dock?.show()
    app.focus({ steal: true })
  }

  if (window.isMinimized()) {
    window.restore()
  }

  window.show()
  if (process.platform !== 'darwin') {
    app.focus({ steal: true })
  }
  window.focus()
}

const attachMainWindowLifecycle = (window: BrowserWindow) => {
  window.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    window.hide()

    if (process.platform === 'darwin') {
      // Return to tray-style behavior after the main window is hidden.
      if (selectionBridge.isSupported) {
        selectionBridge.setActivationPolicy(1)
      }
      app.setActivationPolicy('accessory')
      app.dock?.hide()
    }
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
    currentRoute = null
    routeLoadPromise = null
    routeLoadTarget = null
  })
}

const isShowingRoute = (window: BrowserWindow, route: MainWindowRoute) => {
  const currentUrl = window.webContents.getURL()
  if (!currentUrl) {
    return false
  }

  try {
    return new URL(currentUrl).hash === `#${getMainWindowRouteHash(route)}`
  } catch {
    return false
  }
}

const applyWindowRouteConfig = (window: BrowserWindow, route: MainWindowRoute) => {
  const config = MAIN_WINDOW_ROUTE_CONFIG[route]

  if (window.isMaximized()) {
    window.unmaximize()
  }

  // Home route: transparent + no shadow (frosted glass effect via CSS)
  // Settings route: opaque with system shadow
  const isHome = route === 'home'
  window.setBackgroundColor(isHome ? '#00000000' : config.backgroundColor)
  window.setHasShadow(!isHome)
  window.setResizable(config.resizable)
  window.setMaximizable(config.maximizable)
  window.setMinimumSize(config.minWidth, config.minHeight)

  if (process.platform === 'darwin') {
    const showWindowButtons = !isHome
    window.setWindowButtonVisibility(showWindowButtons)
    window.setWindowButtonPosition(showWindowButtons ? SETTINGS_WINDOW_BUTTON_POSITION : HIDDEN_WINDOW_BUTTON_POSITION)
  }

  if (config.maxWidth && config.maxHeight) {
    window.setMaximumSize(config.maxWidth, config.maxHeight)
  } else {
    window.setMaximumSize(10000, 10000)
  }

  const [currentWidth, currentHeight] = window.getSize()
  if (currentWidth !== config.width || currentHeight !== config.height) {
    window.setSize(config.width, config.height, true)
    window.center()
  }
}


const ensureMainWindowRoute = async (window: BrowserWindow, route: MainWindowRoute) => {
  if (window.isDestroyed()) {
    return
  }

  if (routeLoadPromise && routeLoadTarget === route) {
    await routeLoadPromise
    return
  }

  if (currentRoute === route && (window.webContents.isLoadingMainFrame() || isShowingRoute(window, route))) {
    return
  }

  currentRoute = route
  routeLoadTarget = route
  applyWindowRouteConfig(window, route)

  const pendingLoad = loadAppWindowRoute(window, route)
    .catch((error) => {
      if (!isNavigationAbortError(error)) {
        throw error
      }
    })
    .finally(() => {
      if (routeLoadPromise === pendingLoad) {
        routeLoadPromise = null
        routeLoadTarget = null
      }
    })

  routeLoadPromise = pendingLoad
  await pendingLoad
}

export const getOrCreateMainWindow = () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    return mainWindow
  }

  const window = createAppWindow()
  attachMainWindowLifecycle(window)
  mainWindow = window
  return window
}

export const showMainWindow = async (route: MainWindowRoute = 'home') => {
  const window = getOrCreateMainWindow()

  presentMainWindow(window)

  try {
    await ensureMainWindowRoute(window, route)
  } catch (error) {
    console.error('[window-manager] failed to load main window route', { route, error })
  }

  presentMainWindow(window)
  return window
}
