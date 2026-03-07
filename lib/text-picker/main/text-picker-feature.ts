import { app, clipboard, dialog, globalShortcut, ipcMain, Menu, Tray, nativeImage, shell } from 'electron'
import trayIconTemplate from '@/resources/build/tray-icon-template.svg?asset'
import {
  SelectionScene,
  SystemCommand,
  type EnabledSelectionScene,
  type SelectionBridge,
} from '@/lib/text-picker/shared'
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

export class TextPickerFeature {
  private bubbleWindow: SelectionBubbleWindow | null = null
  private manager: TextPickerManager | null = null
  private tray: Tray | null = null

  constructor(
    private readonly bridge: SelectionBridge = selectionBridge,
    private readonly logger: Console = console,
  ) {}

  async initialize() {
    this.bubbleWindow = new SelectionBubbleWindow(this.bridge)
    this.manager = new TextPickerManager({
      bubbleWindow: this.bubbleWindow,
      bridge: this.bridge,
      logger: this.logger,
    })

    this.createStatusTray()
    this.setupIpc()

    if (!this.bridge.isSupported) {
      await dialog.showMessageBox({
        type: 'warning',
        title: '平台不支持',
        message: '当前仅支持 macOS。',
      })
      return false
    }

    const trusted = this.manager.ensurePermission({ prompt: true })
    if (!trusted) {
      await dialog.showMessageBox({
        type: 'warning',
        title: '需要辅助功能权限',
        message: '请在“系统设置 > 隐私与安全性 > 辅助功能”中允许本应用，然后重启应用。',
      })
      return false
    }

    const started = this.manager.start()
    if (!started) {
      await dialog.showMessageBox({
        type: 'error',
        title: '启动失败',
        message: '无法启动全局事件监听，请检查权限与系统限制。',
      })
      return false
    }

    this.registerShortcuts()
    return true
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

    const trayIcon = nativeImage.createFromPath(trayIconTemplate)
    if (!trayIcon.isEmpty()) {
      trayIcon.setTemplateImage(true)
    }

    this.tray = new Tray(trayIcon)
    this.tray.setToolTip('popMind Text Picker')
    this.tray.setContextMenu(this.buildTrayMenu())
    this.tray.on('click', () => this.manager?.refreshSelection())
  }

  private buildTrayMenu() {
    return Menu.buildFromTemplate([
      {
        label: '手动触发取词',
        click: () => this.manager?.refreshSelection(),
      },
      {
        label: '隐藏气泡',
        click: () => this.manager?.hideBubble(),
      },
      { type: 'separator' },
      {
        label: '划词开关',
        type: 'checkbox',
        checked: this.manager?.isGlobalEnabled() ?? true,
        click: (menuItem) => {
          this.manager?.setGlobalEnabled(menuItem.checked)
        },
      },
      {
        label: '显示底部应用图标',
        type: 'checkbox',
        checked: this.manager?.isDockIconEnabled() ?? false,
        click: (menuItem) => {
          this.manager?.setDockIconEnabled(menuItem.checked)
        },
      },
      {
        label: '选择模式',
        submenu: [
          this.createSceneMenuItem('拖选', SelectionScene.BOX_SELECT),
          this.createSceneMenuItem('双击/三击选词', SelectionScene.MULTI_CLICK),
          this.createSceneMenuItem('Shift+方向键', SelectionScene.SHIFT_ARROW),
          this.createSceneMenuItem('Shift+点击', SelectionScene.SHIFT_MOUSE_CLICK),
          this.createSceneMenuItem('Cmd+A 全选', SelectionScene.CTRL_A),
        ],
      },
      { type: 'separator' },
      {
        label: '打开辅助功能设置',
        click: async () => {
          try {
            await shell.openExternal(
              'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
            )
          } catch (error) {
            this.logger.error('[TextPickerFeature] failed to open accessibility settings', error)
          }
        },
      },
      { type: 'separator' },
      {
        label: '退出',
        click: () => app.quit(),
      },
    ])
  }

  private createSceneMenuItem(label: string, scene: EnabledSelectionScene) {
    return {
      label,
      type: 'checkbox' as const,
      checked: this.manager?.isSceneEnabled(scene) ?? true,
      click: (menuItem: Electron.MenuItem) => {
        this.manager?.setSceneEnabled(scene, menuItem.checked)
      },
    }
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
