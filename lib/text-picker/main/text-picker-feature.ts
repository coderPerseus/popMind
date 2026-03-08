import { clipboard, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import appLogo from '@/app/assets/logo.png?asset'
import { TranslationWindowManager } from '@/lib/translation/window/translation-window-manager'
import { SystemCommand, TextPickerChannel, type SelectionBridge } from '@/lib/text-picker/shared'
import { selectionBridge } from '@/lib/text-picker/native/selection-bridge'
import { showMainWindow } from '@/lib/main/window-manager'
import { SelectionBubbleWindow } from './bubble-window'
import { TextPickerManager } from './text-picker-manager'

const IPC_HANDLE_CHANNELS = [
  TextPickerChannel.Command,
  TextPickerChannel.GetPickedInfo,
  TextPickerChannel.GetGlobalEnabled,
  TextPickerChannel.SetGlobalEnabled,
  TextPickerChannel.GetBlockApps,
  TextPickerChannel.AddBlockApp,
  TextPickerChannel.RemoveBlockApp,
  TextPickerChannel.GetSkills,
  TextPickerChannel.OpenMainWindow,
  TextPickerChannel.HideBubble,
] as const

const IPC_EVENT_CHANNELS = [
  TextPickerChannel.MoveBubble,
  TextPickerChannel.ResizeBubble,
  TextPickerChannel.SetBubbleDragging,
  TextPickerChannel.NotifyBubbleInteraction,
] as const

export class TextPickerFeature {
  private bubbleWindow: SelectionBubbleWindow | null = null
  private manager: TextPickerManager | null = null
  private translationWindowManager: TranslationWindowManager | null = null
  private tray: Tray | null = null

  constructor(
    private readonly bridge: SelectionBridge = selectionBridge,
    private readonly logger: Console = console
  ) {}

  async initialize() {
    this.bubbleWindow = new SelectionBubbleWindow(this.bridge)
    this.translationWindowManager = new TranslationWindowManager(this.bridge, this.logger, {
      noteInteraction: (durationMs) => {
        this.manager?.noteBubbleInteraction(durationMs)
      },
      setDragging: (isDragging) => {
        this.manager?.setBubbleDragging(isDragging)
      },
    })
    this.manager = new TextPickerManager({
      bubbleWindow: this.bubbleWindow,
      bridge: this.bridge,
      logger: this.logger,
      onSelectionShown: () => {
        this.translationWindowManager?.hideIfFloating()
      },
      isSecondaryFloatingVisible: () => this.translationWindowManager?.isVisible() ?? false,
      isEventInsideSecondaryFloating: (event) => {
        const x = Number(event.x)
        const y = Number(event.y)

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return false
        }

        return this.translationWindowManager?.containsPoint(x, y) ?? false
      },
      hideSecondaryFloating: () => {
        if (!this.translationWindowManager?.isPinned()) {
          this.translationWindowManager?.hide()
        }
      },
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
        '[TextPickerFeature] accessibility permission not granted, text picker inactive until authorized'
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

  isBubbleVisible() {
    return this.bubbleWindow?.isVisible() ?? false
  }

  shouldSuppressAppActivation() {
    return this.manager?.shouldSuppressAppActivation() ?? false
  }

  dispose() {
    globalShortcut.unregister('CommandOrControl+Shift+E')
    globalShortcut.unregister('CommandOrControl+Shift+X')

    for (const channel of IPC_HANDLE_CHANNELS) {
      ipcMain.removeHandler(channel)
    }

    for (const channel of IPC_EVENT_CHANNELS) {
      ipcMain.removeAllListeners(channel)
    }

    this.manager?.stop()
    this.manager = null

    this.translationWindowManager?.dispose()
    this.translationWindowManager = null

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

    // Left-click: show the status menu
    this.tray.on('click', () => {
      this.tray?.popUpContextMenu(this.buildTrayMenu())
    })

    // Right-click: show text picker context menu
    this.tray.on('right-click', () => {
      this.tray?.popUpContextMenu(this.buildTrayMenu())
    })
  }

  private buildTrayMenu() {
    const isEnabled = this.manager?.isGlobalEnabled() ?? true

    return Menu.buildFromTemplate([
      {
        label: '打开主页',
        click: () => {
          this.manager?.hideBubble()
          void showMainWindow('home')
        },
      },
      {
        label: isEnabled ? '关闭划词' : '开启划词',
        click: () => {
          this.manager?.setGlobalEnabled(!isEnabled)
        },
      },
      {
        label: '显示配置页面',
        accelerator: 'Command+,',
        click: () => {
          this.manager?.hideBubble()
          void showMainWindow('settings')
        },
      },
      {
        type: 'separator',
      },
      {
        label: '退出',
        role: 'quit',
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
    ipcMain.handle(TextPickerChannel.Command, async (_event, commandId: string, selectionId?: string) => {
      this.logger.info('[TextPickerFeature] ipc command received', {
        commandId,
        selectionId,
      })
      this.manager?.noteBubbleInteraction()

      const pickedInfo = this.manager?.getPickedInfo()
      if (!pickedInfo?.text) {
        this.logger.warn('[TextPickerFeature] ipc command rejected: empty_selection', {
          commandId,
          selectionId,
        })
        return { ok: false, reason: 'empty_selection' }
      }

      if (selectionId && pickedInfo.selectionId !== selectionId) {
        this.logger.warn('[TextPickerFeature] ipc command rejected: stale_selection', {
          commandId,
          requestedSelectionId: selectionId,
          currentSelectionId: pickedInfo.selectionId,
        })
        this.manager?.hideBubble()
        return { ok: false, reason: 'stale_selection' }
      }

      if (commandId === SystemCommand.Copy) {
        this.manager?.hideBubble()

        const sourceAppPid =
          Number.isFinite(pickedInfo.sourceAppPid) && Number(pickedInfo.sourceAppPid) > 0
            ? Number(pickedInfo.sourceAppPid)
            : -1

        const copiedByMenu =
          sourceAppPid > 0 ? await this.bridge.copySelectionAsync(true, sourceAppPid, pickedInfo.text) : false
        const copiedByShortcut = copiedByMenu ? false : await this.bridge.copySelectionAsync(false, -1, pickedInfo.text)

        const nativeStrategy = copiedByMenu ? 'menu_copy' : copiedByShortcut ? 'shortcut_copy' : 'native_failed'
        const clipboardText = clipboard.readText()
        const clipboardMatches = clipboardText === pickedInfo.text

        if (!copiedByMenu && !copiedByShortcut) {
          this.logger.warn(
            `[TextPickerFeature] native copy failed for ${pickedInfo.appId || 'unknown_app'}, falling back to clipboard.writeText`
          )
          clipboard.writeText(pickedInfo.text)
        } else if (!clipboardMatches) {
          this.logger.warn(
            '[TextPickerFeature] native copy reported success but clipboard mismatched, forcing fallback',
            {
              appId: pickedInfo.appId || 'unknown_app',
              nativeStrategy,
              expectedTextLength: pickedInfo.text.length,
              clipboardTextLength: clipboardText.length,
              clipboardPreview: clipboardText.slice(0, 60),
            }
          )
          clipboard.writeText(pickedInfo.text)
        }

        const finalClipboardText = clipboard.readText()
        const strategy =
          finalClipboardText === pickedInfo.text
            ? copiedByMenu
              ? 'menu_copy'
              : copiedByShortcut
                ? 'shortcut_copy'
                : 'clipboard_write'
            : 'clipboard_write_failed'

        this.logger.info('[TextPickerFeature] ipc command handled: copy', {
          commandId,
          selectionId: pickedInfo.selectionId,
          nativeStrategy,
          clipboardMatchesAfterWrite: finalClipboardText === pickedInfo.text,
        })
        return {
          ok: true,
          commandId,
          strategy,
        }
      }

      if (commandId === SystemCommand.HideTextPicker) {
        this.manager?.hideBubble()
        this.logger.info('[TextPickerFeature] ipc command handled: hide')
        return { ok: true, commandId }
      }

      if (
        commandId === SystemCommand.Translate ||
        commandId === SystemCommand.Explain ||
        commandId === SystemCommand.Search
      ) {
        const commandNameMap: Record<string, string> = {
          [SystemCommand.Translate]: 'translate',
          [SystemCommand.Explain]: 'explain',
          [SystemCommand.Search]: 'search',
        }

        if (commandId === SystemCommand.Translate) {
          const anchor = this.manager?.getCurrentAnchor() ?? null
          this.logger.info('[TextPickerFeature] bubble skill clicked: translate', {
            selectionId: pickedInfo.selectionId,
            anchor,
          })
          this.manager?.hideBubble()
          await this.translationWindowManager?.showTranslation({
            text: pickedInfo.text,
            selectionId: pickedInfo.selectionId,
            sourceAppId: pickedInfo.appId,
            anchor,
          })
          return { ok: true, commandId }
        }

        const targetUrl = this.buildExternalCommandUrl(commandId, pickedInfo.text)
        this.logger.info(`[TextPickerFeature] bubble skill clicked: ${commandNameMap[commandId]}`, {
          selectionId: pickedInfo.selectionId,
          targetUrl,
        })

        if (!targetUrl) {
          this.logger.warn('[TextPickerFeature] ipc command rejected: missing_target_url', {
            commandId,
          })
          return { ok: false, reason: 'missing_target_url' }
        }

        this.manager?.hideBubble()
        await shell.openExternal(targetUrl)
        return { ok: true, commandId }
      }

      this.logger.warn('[TextPickerFeature] ipc command rejected: not_implemented', {
        commandId,
      })
      return { ok: false, reason: 'not_implemented' }
    })

    ipcMain.handle(TextPickerChannel.GetPickedInfo, async () => this.manager?.getPickedInfo() || null)

    ipcMain.handle(TextPickerChannel.GetGlobalEnabled, async () => ({
      isEnabled: this.manager?.isGlobalEnabled() ?? false,
    }))

    ipcMain.handle(TextPickerChannel.SetGlobalEnabled, async (_event, enabled: boolean) => {
      this.manager?.setGlobalEnabled(enabled)
      return { ok: true }
    })

    ipcMain.handle(TextPickerChannel.GetBlockApps, async () => ({
      apps: this.manager?.getBlockedApps() || [],
    }))

    ipcMain.handle(TextPickerChannel.AddBlockApp, async (_event, bundleId: string) => {
      this.manager?.addBlockedApp(bundleId)
      return { ok: true }
    })

    ipcMain.handle(TextPickerChannel.RemoveBlockApp, async (_event, bundleId: string) => {
      this.manager?.removeBlockedApp(bundleId)
      return { ok: true }
    })

    ipcMain.handle(TextPickerChannel.GetSkills, async () => ({
      skills: this.manager?.getSkills() || [],
    }))

    ipcMain.handle(TextPickerChannel.OpenMainWindow, async () => {
      this.manager?.hideBubble()
      await showMainWindow()
      return { ok: true }
    })

    ipcMain.handle(TextPickerChannel.HideBubble, async () => {
      this.manager?.hideBubble()
      return { ok: true }
    })

    ipcMain.on(TextPickerChannel.MoveBubble, (_event, deltaX: number, deltaY: number) => {
      this.logger.info('[TextPickerFeature] ipc move bubble', { deltaX, deltaY })
      this.manager?.moveBubble(deltaX, deltaY)
    })

    ipcMain.on(TextPickerChannel.ResizeBubble, (_event, width: number) => {
      this.logger.info('[TextPickerFeature] ipc resize bubble', { width })
      this.manager?.resizeBubble(width)
    })

    ipcMain.on(TextPickerChannel.SetBubbleDragging, (_event, isDragging: boolean) => {
      this.logger.info('[TextPickerFeature] ipc set bubble dragging', { isDragging })
      this.manager?.setBubbleDragging(isDragging)
    })

    ipcMain.on(TextPickerChannel.NotifyBubbleInteraction, () => {
      this.logger.info('[TextPickerFeature] ipc notify bubble interaction')
      this.manager?.noteBubbleInteraction()
    })
  }

  private buildExternalCommandUrl(commandId: string, text: string) {
    const trimmedText = text.trim()
    if (!trimmedText) {
      return ''
    }

    if (commandId === SystemCommand.Translate) {
      const query = new URLSearchParams({
        sl: 'auto',
        tl: 'zh-CN',
        text: trimmedText,
        op: 'translate',
      })
      return `https://translate.google.com/?${query.toString()}`
    }

    if (commandId === SystemCommand.Explain) {
      const query = new URLSearchParams({
        q: `Explain the following text in Chinese: ${trimmedText}`,
      })
      return `https://www.perplexity.ai/search?${query.toString()}`
    }

    if (commandId === SystemCommand.Search) {
      const query = new URLSearchParams({
        q: trimmedText,
      })
      return `https://www.perplexity.ai/search?${query.toString()}`
    }

    return ''
  }
}
