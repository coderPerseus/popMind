import { type App, shell } from 'electron'
import { fetchLatestRelease } from '@/lib/app/latest-release'
import { handle } from '@/lib/main/shared'
import { themeStore } from '@/lib/main/theme-store'
import { selectionBridge } from '@/lib/text-picker/native/selection-bridge'

export const registerAppHandlers = (app: App) => {
  handle('version', () => app.getVersion())
  handle('latestRelease', () => fetchLatestRelease())

  handle('checkAccessibility', () => ({
    granted: selectionBridge.isSupported ? selectionBridge.checkPermission(false) : false,
    supported: selectionBridge.isSupported,
  }))

  handle('openAccessibilitySettings', async () => {
    if (selectionBridge.isSupported) {
      selectionBridge.checkPermission(true)
    }
    await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility')
    return true
  })

  handle('getThemeMode', () => themeStore.getThemeMode())

  handle('setThemeMode', async (mode) => {
    return themeStore.setThemeMode(mode)
  })
}
