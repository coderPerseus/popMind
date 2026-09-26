import { app, BrowserWindow, nativeTheme } from 'electron'
import {
  createAppWindow,
  createSettingsWindow,
  getMainWindowRouteHash,
  getSettingsWindowBackgroundColor,
  loadAppWindowRoute,
  MAIN_WINDOW_ROUTE_CONFIG,
  type MainWindowRoute,
} from './app'
import { MainWindowChannel } from '@/lib/conveyor/schemas/window-schema'
import { clipboardHistoryService } from '@/lib/clipboard/service'
import { mainLogger } from '@/lib/main/logger'
import { selectionBridge } from '@/lib/text-picker/native/selection-bridge'
import { autoDismissController } from '@/lib/windowing/auto-dismiss-controller'

// The main window only ever shows the launcher ('home'); settings has its own window.
let mainWindow: BrowserWindow | null = null
let settingsWindow: BrowserWindow | null = null
let settingsLoadPromise: Promise<void> | null = null
let isQuitting = false
let currentRoute: MainWindowRoute | null = null
let routeLoadPromise: Promise<void> | null = null
let routeLoadTarget: MainWindowRoute | null = null
const HIDDEN_WINDOW_BUTTON_POSITION = { x: -100, y: -100 }
const REGULAR_ACTIVATION_POLICY = 0
const ACCESSORY_ACTIVATION_POLICY = 1

app.once('before-quit', () => {
  isQuitting = true
})

const isNavigationAbortError = (error: unknown) => {
  return error instanceof Error && error.message.includes('ERR_ABORTED')
}

const isWindowVisible = (window: BrowserWindow | null) => Boolean(window && !window.isDestroyed() && window.isVisible())

const updateMainWindowActivationPolicy = (requestedVisible: boolean) => {
  if (process.platform !== 'darwin') {
    return
  }

  // Stay a regular (Dock) app while either the launcher or the settings window is on screen.
  const visible = requestedVisible || isWindowVisible(mainWindow) || isWindowVisible(settingsWindow)

  const activationPolicy = visible ? 'regular' : 'accessory'
  const nativeActivationPolicy = visible ? REGULAR_ACTIVATION_POLICY : ACCESSORY_ACTIVATION_POLICY

  if (selectionBridge.isSupported) {
    selectionBridge.setActivationPolicy(nativeActivationPolicy)
  }

  app.setActivationPolicy(activationPolicy)
}

const logSettingsWindow = (event: string, details: Record<string, unknown> = {}) => {
  mainLogger.info('[settings-window]', { event, ...details })
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

const applyHomeWindowConfig = (window: BrowserWindow) => {
  const config = MAIN_WINDOW_ROUTE_CONFIG.home

  // Transparent floating panel (frosted glass via CSS), above other apps and on every Space.
  window.setBackgroundColor('#00000000')
  window.setHasShadow(false)
  window.setAlwaysOnTop(true, 'floating')
  window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  window.setResizable(config.resizable)
  window.setMaximizable(config.maximizable)
  window.setMinimumSize(config.minWidth, config.minHeight)
  if (config.maxWidth && config.maxHeight) {
    window.setMaximumSize(config.maxWidth, config.maxHeight)
  }

  if (process.platform === 'darwin') {
    window.setWindowButtonVisibility(false)
    window.setWindowButtonPosition(HIDDEN_WINDOW_BUTTON_POSITION)
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
  applyHomeWindowConfig(window)

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

export const isMainWindowVisible = () => isWindowVisible(mainWindow)

export const isSettingsWindowVisible = () => isWindowVisible(settingsWindow)

const concealSettingsWindow = (window: BrowserWindow) => {
  if (window.isDestroyed() || !window.isVisible()) {
    return
  }

  window.hide()
  updateMainWindowActivationPolicy(false)
  logSettingsWindow('concealed')
}

const getOrCreateSettingsWindow = () => {
  if (settingsWindow && !settingsWindow.isDestroyed()) {
    return settingsWindow
  }

  const window = createSettingsWindow()
  settingsWindow = window
  settingsLoadPromise = loadAppWindowRoute(window, 'settings').catch((error) => {
    if (!isNavigationAbortError(error)) {
      mainLogger.error('[settings-window] failed to load', error)
    }
  })

  const syncBackground = () => {
    if (!window.isDestroyed()) {
      window.setBackgroundColor(getSettingsWindowBackgroundColor())
    }
  }
  nativeTheme.on('updated', syncBackground)

  // Closing (red button / ⌘W) only hides, so reopening is instant and keeps size, position and state.
  window.on('close', (event) => {
    if (isQuitting) {
      return
    }

    event.preventDefault()
    concealSettingsWindow(window)
  })

  window.on('closed', () => {
    nativeTheme.removeListener('updated', syncBackground)
    if (settingsWindow === window) {
      settingsWindow = null
      settingsLoadPromise = null
    }
  })

  logSettingsWindow('created')
  return window
}

const showSettingsWindow = async () => {
  const startedAt = performance.now()
  const window = getOrCreateSettingsWindow()
  await settingsLoadPromise

  if (process.platform === 'darwin') {
    updateMainWindowActivationPolicy(true)
    app.focus({ steal: true })
  }

  if (window.isMinimized()) {
    window.restore()
  }

  // Show the new window before hiding the old one so the app never has zero visible windows
  // (that would flip the Dock activation policy and flash).
  window.show()
  window.focus()

  if (isWindowVisible(mainWindow)) {
    concealMainWindow(mainWindow!, { resetHomeState: true })
  }
  logSettingsWindow('presented', { ms: Math.round(performance.now() - startedAt) })
  return window
}

export const showMainWindow = async (
  route: MainWindowRoute = 'home',
  options?: {
    searchQuery?: string
  }
) => {
  if (route === 'settings') {
    return showSettingsWindow()
  }

  const startedAt = performance.now()
  clipboardHistoryService.capturePasteTarget()

  const window = getOrCreateMainWindow()

  logMainWindow('show-requested', {
    requestedRoute: route,
    visible: window.isVisible(),
    focused: window.isFocused(),
  })

  try {
    await ensureMainWindowRoute(window, 'home')
  } catch (error) {
    console.error('[window-manager] failed to load main window route', { route, error })
  }

  autoDismissController.dispatch({
    reason: 'surface-opened',
    target: 'main',
  })
  presentMainWindow(window)

  if (isWindowVisible(settingsWindow)) {
    concealSettingsWindow(settingsWindow!)
  }
  if (options?.searchQuery?.trim()) {
    sendMainWindowSearchQuery(window, options.searchQuery)
  }
  logMainWindow('show-completed', { ms: Math.round(performance.now() - startedAt) })
  return window
}

export const hideMainWindow = () => {
  const window = getOrCreateMainWindow()
  concealMainWindow(window, { resetHomeState: true })
}

/** Create and load the hidden settings window ahead of time so the first open is instant. */
export const primeSettingsWindow = async () => {
  getOrCreateSettingsWindow()
  await settingsLoadPromise
  logSettingsWindow('primed')
}

export const primeMainWindow = async (route: MainWindowRoute = 'home') => {
  if (route === 'settings') {
    await primeSettingsWindow()
    return settingsWindow
  }

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

  if (route === 'home' && window.isVisible()) {
    concealMainWindow(window, { resetHomeState: true })
    return window
  }

  return showMainWindow(route)
}
