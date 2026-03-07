import { type App, shell } from 'electron'
import { handle } from '@/lib/main/shared'
import { selectionBridge } from '@/lib/text-picker/native/selection-bridge'

export const registerAppHandlers = (app: App) => {
  handle('version', () => app.getVersion())

  handle('checkAccessibility', () => ({
    granted: selectionBridge.isSupported ? selectionBridge.checkPermission(false) : false,
    supported: selectionBridge.isSupported,
  }))

  handle('openAccessibilitySettings', async () => {
    if (selectionBridge.isSupported) {
      selectionBridge.checkPermission(true)
    }
    await shell.openExternal(
      'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
    )
    return true
  })
}
