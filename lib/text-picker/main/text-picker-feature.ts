import { clipboard, globalShortcut, ipcMain, Menu, nativeImage, Tray } from 'electron'
import appLogo from '@/app/assets/logo.png?asset'
import { SystemCommand, type SelectionBridge } from '@/lib/text-picker/shared'
import { selectionBridge } from '@/lib/text-picker/native/selection-bridge'
import { SelectionBubbleWindow } from './bubble-window'
import { TextPickerManager } from './text-picker-manager'

const IPC_CHANNELS = [
  'textPicker:command',
  'textPicker:getPickedInfo',
  'textPicker:getGlobalEnabled',
  'textPicker:setGlobalEnabled',
  'textPicker:getBlockApps',
  'textPicker:addBlockApp',
  'textPicker:removeBlockApp',
  'textPicker:getSkills',
  'textPicker:hideBubble',
] as const

interface TextPickerFeatureOptions {
  onTrayClick?: () => void
}

export class TextPickerFeature {
  private bubbleWindow: SelectionBubbleWindow | null = null
  private manager: TextPickerManager | null = null
  private tray: Tray | null = null
  private onTrayClick: (() => void) | undefined

  constructor(
    private readonly bridge: SelectionBridge = selectionBridge,
    private readonly logger: Console = console,
  ) {}

  async initialize(options: TextPickerFeatureOptions = {}) {
    this.onTrayClick = options.onTrayClick

    this.bubbleWindow = new SelectionBubbleWindow(this.bridge)
    this.manager = new TextPickerManager({
      bubbleWindow: this.bubbleWindow,
      bridge: this.bridge,
      logger: this.logger,
    })

    this.createStatusTray()
    this.setupIpc()

    if (!this.bridge.isSupported) {
      this.logger.warn('[TextPickerFeature] platform not supported, text picker disabled')
      return false
    }

    const trusted = this.manager.ensurePermission({ prompt: false })
    if (!trusted) {
      this.logger.warn(
        '[TextPickerFeature] accessibility permission not granted, text picker inactive until authorized',
      )
      return false
    }

    const started = this.manager.start()
    if (!started) {
      this.logger.error('[TextPickerFeature] failed to start action monitor')
      return false
    }

    this.registerShortcuts()
    return true
  }

  /** Try to start the monitor if it was previously blocked by missing permission. */
  retryStart(): boolean {
    if (!this.manager || !this.bridge.isSupported) return false
    if (this.manager.ensurePermission({ prompt: false })) {
      const started = this.manager.start()
      if (started) this.registerShortcuts()
      return started
    }
    return false
  }

  dispose() {
    globalShortcut.unregister('CommandOrControl+Shift+E')
    globalShortcut.unregister('CommandOrControl+Shift+X')

    for (const channel of IPC_CHANNELS) {
      ipcMain.removeHandler(channel)
    }

    this.manager?.stop()
    this.manager = null

    this.tray?.destroy()
    this.tray = null

    this.bubbleWindow?.destroy()
    this.bubbleWindow = null
  }

  private createStatusTray() {
    if (this.tray || !this.manager) {
      return
    }

    const icon = nativeImage.createFromPath(appLogo).resize({ width: 18, height: 18 })
    icon.setTemplateImage(true)

    this.tray = new Tray(icon)
    this.tray.setToolTip('popMind')

    // Left-click: open main window
    this.tray.on('click', () => {
      this.onTrayClick?.()
    })

    // Right-click: show text picker context menu
    this.tray.on('right-click', () => {
      this.tray?.popUpContextMenu(this.buildTrayMenu())
    })
  }

  private buildTrayMenu() {
    return Menu.buildFromTemplate([
      {
        label: '划词开关',
        type: 'checkbox',
        checked: this.manager?.isGlobalEnabled() ?? true,
        click: (menuItem) => {
          this.manager?.setGlobalEnabled(menuItem.checked)
        },
      },
    ])
  }

  private registerShortcuts() {
    globalShortcut.register('CommandOrControl+Shift+E', () => {
      this.manager?.refreshSelection()
    })

    globalShortcut.register('CommandOrControl+Shift+X', () => {
      this.manager?.hideBubble()
    })
  }

  private setupIpc() {
    ipcMain.handle('textPicker:command', async (_event, commandId: string) => {
      const pickedInfo = this.manager?.getPickedInfo()
      if (!pickedInfo?.text) {
        return { ok: false, reason: 'empty_selection' }
      }

      if (commandId === SystemCommand.Copy) {
        clipboard.writeText(pickedInfo.text)
        this.manager?.hideBubble()
        return { ok: true, commandId }
      }

      if (commandId === SystemCommand.HideTextPicker) {
        this.manager?.hideBubble()
        return { ok: true, commandId }
      }

      const result = this.manager?.triggerCommand(commandId)
      this.manager?.hideBubble()
      return result || { ok: false }
    })

    ipcMain.handle('textPicker:getPickedInfo', async () => this.manager?.getPickedInfo() || null)

    ipcMain.handle('textPicker:getGlobalEnabled', async () => ({
      isEnabled: this.manager?.isGlobalEnabled() ?? false,
    }))

    ipcMain.handle('textPicker:setGlobalEnabled', async (_event, enabled: boolean) => {
      this.manager?.setGlobalEnabled(enabled)
      return { ok: true }
    })

    ipcMain.handle('textPicker:getBlockApps', async () => ({
      apps: this.manager?.getBlockedApps() || [],
    }))

    ipcMain.handle('textPicker:addBlockApp', async (_event, bundleId: string) => {
      this.manager?.addBlockedApp(bundleId)
      return { ok: true }
    })

    ipcMain.handle('textPicker:removeBlockApp', async (_event, bundleId: string) => {
      this.manager?.removeBlockedApp(bundleId)
      return { ok: true }
    })

    ipcMain.handle('textPicker:getSkills', async () => ({
      skills: this.manager?.getSkills() || [],
    }))

    ipcMain.handle('textPicker:hideBubble', async () => {
      this.manager?.hideBubble()
      return { ok: true }
    })
  }
}
