import { BrowserWindow, shell, app } from 'electron'
import { join } from 'path'
import appIcon from '@/resources/build/icon.png?asset'
import { registerResourcesProtocol } from './protocols'
import { registerWindowHandlers } from '@/lib/conveyor/handlers/window-handler'
import { registerAppHandlers } from '@/lib/conveyor/handlers/app-handler'

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
    width: 680,
    height: 480,
    minWidth: 680,
    minHeight: 480,
    maxWidth: 680,
    maxHeight: 480,
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
    backgroundColor: '#f6f4ef',
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

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  return mainWindow
}
