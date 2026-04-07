import { app, BrowserWindow } from 'electron'
import {
  createAppWindow,
  getMainWindowRouteHash,
  loadAppWindowRoute,
  MAIN_WINDOW_ROUTE_CONFIG,
  type MainWindowRoute,
} from './app'
import { MainWindowChannel } from '@/lib/conveyor/schemas/window-schema'
import { clipboardHistoryService } from '@/lib/clipboard/service'
import { mainLogger } from '@/lib/main/logger'
import { selectionBridge } from '@/lib/text-picker/native/selection-bridge'
import { autoDismissController } from '@/lib/windowing/auto-dismiss-controller'

let mainWindow: BrowserWindow | null = null
let isQuitting = false
let currentRoute: MainWindowRoute | null = null
let routeLoadPromise: Promise<void> | null = null
let routeLoadTarget: MainWindowRoute | null = null
const HIDDEN_WINDOW_BUTTON_POSITION = { x: -100, y: -100 }
const SETTINGS_WINDOW_BUTTON_POSITION = { x: 14, y: 14 }
const REGULAR_ACTIVATION_POLICY = 0
const ACCESSORY_ACTIVATION_POLICY = 1

app.once('before-quit', () => {
  isQuitting = true
})

const isNavigationAbortError = (error: unknown) => {
  return error instanceof Error && error.message.includes('ERR_ABORTED')
}

const updateMainWindowActivationPolicy = (visible: boolean) => {
  if (process.platform !== 'darwin') {
    return
  }

  const activationPolicy = visible ? 'regular' : 'accessory'
  const nativeActivationPolicy = visible ? REGULAR_ACTIVATION_POLICY : ACCESSORY_ACTIVATION_POLICY

  if (selectionBridge.isSupported) {
    selectionBridge.setActivationPolicy(nativeActivationPolicy)
  }

  app.setActivationPolicy(activationPolicy)
}

const logMainWindow = (event: string, details: Record<string, unknown> = {}) => {
  mainLogger.info('[main-window]', {
    event,
    route: currentRoute,
    ...details,
  })
}

const presentMainWindow = (window: BrowserWindow) => {
  if (window.isDestroyed()) {
    return
  }

  if (process.platform === 'darwin') {
    updateMainWindowActivationPolicy(true)
    app.focus({ steal: true })
  }

  if (window.isMinimized()) {
    window.restore()
  }

  window.show()
  window.moveTop()
  if (process.platform !== 'darwin') {
    app.focus({ steal: true })
  }
  window.focus()
  logMainWindow('presented', {
    visible: window.isVisible(),
    focused: window.isFocused(),
  })
}

const sendMainWindowSearchQuery = (window: BrowserWindow, query: string) => {
  if (window.isDestroyed() || !query.trim() || window.webContents.isDestroyed()) {
    return
  }

  window.webContents.send(MainWindowChannel.SetSearchQuery, query)
}

const concealMainWindow = (window: BrowserWindow, options?: { resetHomeState?: boolean }) => {
  if (window.isDestroyed()) {
    return
  }

  if (options?.resetHomeState && currentRoute === 'home' && !window.webContents.isDestroyed()) {
    window.webContents.send(MainWindowChannel.ResetState)
  }

  window.hide()

  if (process.platform === 'darwin') {
    updateMainWindowActivationPolicy(false)
  }

  logMainWindow('concealed', {
    visible: window.isVisible(),
    focused: window.isFocused(),
  })
}

const registerMainWindowSurface = (window: BrowserWindow) => {
  autoDismissController.register({
    id: 'main',
    priority: 100,
    isVisible: () => !window.isDestroyed() && window.isVisible(),
    hide: () => {
      concealMainWindow(window, { resetHomeState: true })
    },
    shouldDismiss: (context) => {
      if (window.isDestroyed() || !window.isVisible()) {
        return false
      }

      if (context.reason === 'escape') {
        return true
      }

      // The settings route shares the same BrowserWindow instance, but it must not
      // inherit the auto-dismiss behavior used by the home search surface.
      if (currentRoute !== 'home') {
        return false
      }

      if (context.reason === 'blur') {
        return true
      }

      if (window.isFocused()) {
        return false
      }

      if (context.reason === 'surface-opened') {
        return context.target !== 'main'
      }

      return context.reason === 'selection-changed' || context.reason === 'dismiss-scene'
    },
  })
}

const attachMainWindowLifecycle = (window: BrowserWindow) => {
  window.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    concealMainWindow(window, { resetHomeState: true })
  })

  window.on('blur', () => {
    if (isQuitting) {
      return
    }

    if (currentRoute !== 'home') {
      return
    }

    autoDismissController.dispatch({
      reason: 'blur',
      source: 'main',
    })
  })

  window.on('closed', () => {
    if (mainWindow === window) {
      mainWindow = null
    }
    currentRoute = null
    routeLoadPromise = null
    routeLoadTarget = null
    autoDismissController.unregister('main')
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
  window.setAlwaysOnTop(isHome, isHome ? 'floating' : 'normal')
  window.setVisibleOnAllWorkspaces(isHome, isHome ? { visibleOnFullScreen: true } : undefined)
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
  registerMainWindowSurface(window)
  attachMainWindowLifecycle(window)
  mainWindow = window
  return window
}

export const isMainWindowVisible = () => {
  return Boolean(mainWindow && !mainWindow.isDestroyed() && mainWindow.isVisible())
}

export const showMainWindow = async (
  route: MainWindowRoute = 'home',
  options?: {
    searchQuery?: string
  }
) => {
  if (route === 'home') {
    clipboardHistoryService.capturePasteTarget()
  }

  const window = getOrCreateMainWindow()
  const shouldHideDuringRouteSwitch =
    window.isVisible() && currentRoute !== null && (currentRoute !== route || !isShowingRoute(window, route))

  logMainWindow('show-requested', {
    requestedRoute: route,
    visible: window.isVisible(),
    focused: window.isFocused(),
  })

  if (shouldHideDuringRouteSwitch) {
    concealMainWindow(window, { resetHomeState: false })
  }

  try {
    await ensureMainWindowRoute(window, route)
  } catch (error) {
    console.error('[window-manager] failed to load main window route', { route, error })
  }

  autoDismissController.dispatch({
    reason: 'surface-opened',
    target: 'main',
  })
  presentMainWindow(window)
  if (route === 'home' && options?.searchQuery?.trim()) {
    sendMainWindowSearchQuery(window, options.searchQuery)
  }
  return window
}

export const hideMainWindow = () => {
  const window = getOrCreateMainWindow()
  concealMainWindow(window, { resetHomeState: true })
}

export const primeMainWindow = async (route: MainWindowRoute = 'home') => {
  const window = getOrCreateMainWindow()

  logMainWindow('prime-requested', {
    requestedRoute: route,
    visible: window.isVisible(),
    focused: window.isFocused(),
  })

  try {
    await ensureMainWindowRoute(window, route)
    logMainWindow('prime-completed', {
      requestedRoute: route,
      url: window.webContents.getURL(),
    })
  } catch (error) {
    console.error('[main-window] failed to prime route', { route, error })
  }

  return window
}

export const toggleMainWindow = async (route: MainWindowRoute = 'home') => {
  const window = getOrCreateMainWindow()

  logMainWindow('toggle-requested', {
    requestedRoute: route,
    visible: window.isVisible(),
    focused: window.isFocused(),
  })

  if (window.isVisible()) {
    concealMainWindow(window, { resetHomeState: true })
    return window
  }

  return showMainWindow(route)
}
