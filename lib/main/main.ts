import { app, globalShortcut } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerSearchHandlers } from '@/lib/conveyor/handlers/search-handler'
import { registerTranslationHandlers } from '@/lib/conveyor/handlers/translation-handler'
import { themeStore } from '@/lib/main/theme-store'
import { TextPickerFeature } from '@/lib/text-picker/main/text-picker-feature'
import { setupApplicationMenu } from './application-menu'
import { toggleMainWindow, getOrCreateMainWindow } from './window-manager'

let textPickerFeature: TextPickerFeature | null = null

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')
  await themeStore.initialize()
  setupApplicationMenu()
  registerTranslationHandlers()
  registerSearchHandlers()

  // Initialize text picker feature (non-blocking)
  textPickerFeature = new TextPickerFeature()
  textPickerFeature.initialize()

  // Initialize the main window early so it's ready for shortcut invocation
  getOrCreateMainWindow()

  // Register global shortcut Option+Space to toggle the main search window
  globalShortcut.register('Alt+Space', () => {
    void toggleMainWindow('home')
  })

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file, you can include the rest of your app's specific main process
// code. You can also put them in separate files and import them here.
app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  textPickerFeature?.dispose()
  textPickerFeature = null
})
