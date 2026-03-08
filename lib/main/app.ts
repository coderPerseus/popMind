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
    width: 760,
    height: 520,
    minWidth: 760,
    minHeight: 520,
    maxWidth: 760,
    maxHeight: 520,
    resizable: false,
    maximizable: false,
    backgroundColor: '#f6f3ed',
  },
  settings: {
    width: 1260,
    height: 820,
    minWidth: 1120,
    minHeight: 760,
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
    backgroundColor: initialConfig.backgroundColor,
    icon: appIcon,
    frame: false,
    titleBarStyle: 'hiddenInset',
    title: 'popMind',
    maximizable: initialConfig.maximizable,
    resizable: initialConfig.resizable,
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
