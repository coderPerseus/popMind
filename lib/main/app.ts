import { BrowserWindow, nativeTheme, shell, app } from 'electron'
import { join } from 'path'
import appIcon from '@/resources/build/icon.png?asset'
import { registerResourcesProtocol } from './protocols'
import { registerWindowHandlers } from '@/lib/conveyor/handlers/window-handler'
import { registerAppHandlers } from '@/lib/conveyor/handlers/app-handler'
import { registerCapabilityHandlers } from '@/lib/conveyor/handlers/capability-handler'
import { registerClipboardHandlers } from '@/lib/conveyor/handlers/clipboard-handler'

export type MainWindowRoute = 'home' | 'settings'

type RouteWindowConfig = {
  width: number
  height: number
  minWidth: number
  minHeight: number
  maxWidth?: number
  maxHeight?: number
  resizable: boolean
  maximizable: boolean
  backgroundColor: string
}

const ROUTE_HASH: Record<MainWindowRoute, string> = {
  home: '/',
  settings: '/settings',
}

export const MAIN_WINDOW_ROUTE_CONFIG: Record<MainWindowRoute, RouteWindowConfig> = {
  home: {
    width: 820,
    height: 540,
    minWidth: 820,
    minHeight: 540,
    maxWidth: 820,
    maxHeight: 540,
    resizable: false,
    maximizable: false,
    backgroundColor: '#00000000',
  },
  settings: {
    width: 1200,
    height: 800,
    minWidth: 1000,
    minHeight: 720,
    resizable: true,
    maximizable: true,
    backgroundColor: '#f2f2f2',
  },
}

export const getMainWindowRouteHash = (route: MainWindowRoute) => ROUTE_HASH[route]

export async function loadAppWindowRoute(window: BrowserWindow, route: MainWindowRoute = 'home') {
  const hash = getMainWindowRouteHash(route)

  if (!app.isPackaged && process.env['ELECTRON_RENDERER_URL']) {
    await window.loadURL(`${process.env['ELECTRON_RENDERER_URL']}#${hash}`)
    return
  }

  await window.loadFile(join(__dirname, '../renderer/index.html'), { hash })
}

export function createAppWindow(): BrowserWindow {
  // Register custom protocol for resources
  registerResourcesProtocol()
  const initialConfig = MAIN_WINDOW_ROUTE_CONFIG.home

  // Create the main window.
  const mainWindow = new BrowserWindow({
    width: initialConfig.width,
    height: initialConfig.height,
    show: false,
    paintWhenInitiallyHidden: true,
    minWidth: initialConfig.minWidth,
    minHeight: initialConfig.minHeight,
    maxWidth: initialConfig.maxWidth,
    maxHeight: initialConfig.maxHeight,
    backgroundColor: '#00000000',
    transparent: true,
    icon: appIcon,
    frame: false,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: -100, y: -100 },
    title: 'popMind',
    maximizable: initialConfig.maximizable,
    resizable: initialConfig.resizable,
    hasShadow: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
    },
  })

  // Register IPC events for the main window.
  registerWindowHandlers(mainWindow)
  registerAppHandlers(app)
  registerCapabilityHandlers()
  registerClipboardHandlers()

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return mainWindow
}

export const getSettingsWindowBackgroundColor = () =>
  nativeTheme.shouldUseDarkColors ? '#1e1e1f' : MAIN_WINDOW_ROUTE_CONFIG.settings.backgroundColor

/**
 * Settings lives in its own regular (opaque, resizable) window, like Raycast/Alfred preferences.
 * Keeping it separate from the transparent launcher panel means switching never reloads a page
 * or morphs one window's size/shadow/level — we just hide one window and show the other.
 * IPC handlers are registered once by createAppWindow and shared by both windows.
 */
export function createSettingsWindow(): BrowserWindow {
  const config = MAIN_WINDOW_ROUTE_CONFIG.settings

  const settingsWindow = new BrowserWindow({
    width: config.width,
    height: config.height,
    minWidth: config.minWidth,
    minHeight: config.minHeight,
    show: false,
    paintWhenInitiallyHidden: true,
    backgroundColor: getSettingsWindowBackgroundColor(),
    icon: appIcon,
    titleBarStyle: 'hidden',
    trafficLightPosition: { x: 14, y: 14 },
    title: 'popMind',
    resizable: config.resizable,
    maximizable: config.maximizable,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/preload.js'),
      sandbox: false,
    },
  })

  settingsWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return settingsWindow
}
