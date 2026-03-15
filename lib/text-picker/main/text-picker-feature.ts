import { app, clipboard, globalShortcut, ipcMain, Menu, nativeImage, shell, Tray } from 'electron'
import appLogo from '@/app/assets/logo.png?asset'
import { POPMIND_RELEASES_URL } from '@/lib/app/release'
import { exportMainProcessLogs } from '@/lib/main/logger'
import { getMacCodeSigningInfo } from '@/lib/main/macos-code-signing'
import { ScreenshotSearchService } from '@/lib/screenshot/screenshot-search-service'
import { ScreenshotTranslationService } from '@/lib/screenshot/screenshot-translation-service'
import { capabilityService } from '@/lib/capability/service'
import { formatLanguageLabel } from '@/lib/i18n/shared'
import { SelectionChatWindowManager } from '@/lib/selection-chat/window/selection-chat-window-manager'
import { TranslationWindowManager } from '@/lib/translation/window/translation-window-manager'
import { SystemCommand, TextPickerChannel, type SelectionBridge } from '@/lib/text-picker/shared'
import type { PickedInfo } from '@/lib/text-picker/shared'
import { selectionBridge } from '@/lib/text-picker/native/selection-bridge'
import { showMainWindow } from '@/lib/main/window-manager'
import { autoDismissController, type DismissContext } from '@/lib/windowing/auto-dismiss-controller'
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
  TextPickerChannel.DismissTopmost,
] as const

const IPC_EVENT_CHANNELS = [
  TextPickerChannel.MoveBubble,
  TextPickerChannel.ResizeBubble,
  TextPickerChannel.SetBubbleDragging,
  TextPickerChannel.NotifyBubbleInteraction,
] as const

const HIDE_BUBBLE_SHORTCUT = 'CommandOrControl+Shift+X'
const SCREENSHOT_TRANSLATE_SHORTCUT = 'CommandOrControl+Alt+T'
const SCREENSHOT_SEARCH_SHORTCUT = 'CommandOrControl+Alt+S'
const MAX_COMMAND_CONTEXTS = 12
const COMMAND_CONTEXT_TTL_MS = 2 * 60 * 1000

interface CommandContextSnapshot {
  pickedInfo: PickedInfo
  anchor: {
    x: number
    topY: number
    bottomY: number
  } | null
  createdAt: number
}

export class TextPickerFeature {
  private bubbleWindow: SelectionBubbleWindow | null = null
  private manager: TextPickerManager | null = null
  private translationWindowManager: TranslationWindowManager | null = null
  private selectionChatWindowManager: SelectionChatWindowManager | null = null
  private screenshotTranslationService: ScreenshotTranslationService | null = null
  private screenshotSearchService: ScreenshotSearchService | null = null
  private tray: Tray | null = null
  private detachCapabilityListener: (() => void) | null = null
  private readonly commandContexts = new Map<string, CommandContextSnapshot>()
  private permissionRetryTimer: NodeJS.Timeout | null = null
  private lastMonitorStateKey: string | null = null

  constructor(
    private readonly bridge: SelectionBridge = selectionBridge,
    private readonly logger: Console = console
  ) {}

  async initialize() {
    this.logger.info('[TextPickerFeature] initialize start', {
      isPackaged: app.isPackaged,
      bridgeSupported: this.bridge.isSupported,
      version: app.getVersion(),
    })

    this.bubbleWindow = new SelectionBubbleWindow(this.bridge, this.logger)
    this.translationWindowManager = new TranslationWindowManager(this.bridge, this.logger, {
      noteInteraction: (durationMs) => {
        this.manager?.noteBubbleInteraction(durationMs)
      },
      setDragging: (isDragging) => {
        this.manager?.setBubbleDragging(isDragging)
      },
    })
    this.selectionChatWindowManager = new SelectionChatWindowManager(this.bridge, this.logger, {
      noteInteraction: (durationMs) => {
        this.manager?.noteBubbleInteraction(durationMs)
      },
      setDragging: (isDragging) => {
        this.manager?.setBubbleDragging(isDragging)
      },
    })
    this.screenshotTranslationService = new ScreenshotTranslationService(this.translationWindowManager)
    this.screenshotSearchService = new ScreenshotSearchService(undefined, undefined, this.logger)
    this.manager = new TextPickerManager({
      bubbleWindow: this.bubbleWindow,
      bridge: this.bridge,
      logger: this.logger,
      onSelectionShown: () => {
        this.rememberCommandContext()
        this.dispatchAutoDismiss({
          reason: 'selection-changed',
          source: 'bubble',
        })
      },
      isSecondaryFloatingVisible: () =>
        (this.translationWindowManager?.isVisible() ?? false) ||
        (this.selectionChatWindowManager?.isVisible() ?? false),
      isEventInsideSecondaryFloating: (event) => {
        const x = Number(event.x)
        const y = Number(event.y)

        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return false
        }

        return (
          (this.translationWindowManager?.containsPoint(x, y) ?? false) ||
          (this.selectionChatWindowManager?.containsPoint(x, y) ?? false)
        )
      },
      hideSecondaryFloating: () => {
        if (!this.translationWindowManager?.isPinned()) {
          this.translationWindowManager?.hide()
        }
        if (!this.selectionChatWindowManager?.isPinned()) {
          this.selectionChatWindowManager?.hide()
        }
      },
      dispatchAutoDismiss: (context) => {
        this.dispatchAutoDismiss(context)
      },
    })

    this.registerAutoDismissSurfaces()
    this.createStatusTray()
    this.setupIpc()
    this.registerScreenshotShortcuts()
    const settings = await capabilityService.getSettings()
    this.manager?.setLanguage(settings.appLanguage)
    this.detachCapabilityListener = capabilityService.subscribe((nextSettings) => {
      this.manager?.setLanguage(nextSettings.appLanguage)
    })

    if (!this.bridge.isSupported) {
      this.logger.warn('[TextPickerFeature] platform not supported, text picker disabled')
      return false
    }

    await this.logMacCodeSigningDiagnostics()

    const trusted = this.manager.ensurePermission({ prompt: false })
    this.logger.info('[TextPickerFeature] accessibility permission check', { trusted })
    if (!trusted) {
      this.logger.warn(
        '[TextPickerFeature] accessibility permission not granted, text picker inactive until authorized'
      )
      this.startPermissionRetryPolling()
      return false
    }

    const started = this.manager.start()
    this.logMonitorState('initialize', trusted, started)
    if (!started) {
      this.logger.error('[TextPickerFeature] failed to start action monitor')
      return false
    }

    this.stopPermissionRetryPolling()
    this.registerSelectionShortcuts()
    return true
  }

  /** Try to start the monitor if it was previously blocked by missing permission. */
  retryStart(): boolean {
    return this.ensureMonitoringActive('retry')
  }

  isBubbleVisible() {
    return this.bubbleWindow?.isVisible() ?? false
  }

  shouldSuppressAppActivation() {
    return this.manager?.shouldSuppressAppActivation() ?? false
  }

  dispose() {
    globalShortcut.unregister(HIDE_BUBBLE_SHORTCUT)
    globalShortcut.unregister(SCREENSHOT_TRANSLATE_SHORTCUT)
    globalShortcut.unregister(SCREENSHOT_SEARCH_SHORTCUT)
    this.stopPermissionRetryPolling()

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
    this.selectionChatWindowManager?.dispose()
    this.selectionChatWindowManager = null
    this.screenshotTranslationService = null
    this.screenshotSearchService = null
    this.detachCapabilityListener?.()
    this.detachCapabilityListener = null

    this.tray?.destroy()
    this.tray = null

    autoDismissController.unregister('bubble')
    autoDismissController.unregister('translation')
    autoDismissController.unregister('selection-chat')
    this.bubbleWindow?.destroy()
    this.bubbleWindow = null
  }

  private dispatchAutoDismiss(context: DismissContext) {
    autoDismissController.dispatch(context)
  }

  private rememberCommandContext() {
    const pickedInfo = this.manager?.getPickedInfo()
    if (!pickedInfo?.selectionId || !pickedInfo.text) {
      return
    }

    this.commandContexts.set(pickedInfo.selectionId, {
      pickedInfo,
      anchor: this.manager?.getCurrentAnchor() ?? null,
      createdAt: Date.now(),
    })

    for (const [selectionId, snapshot] of this.commandContexts) {
      if (
        this.commandContexts.size <= MAX_COMMAND_CONTEXTS &&
        Date.now() - snapshot.createdAt <= COMMAND_CONTEXT_TTL_MS
      ) {
        continue
      }

      this.commandContexts.delete(selectionId)
    }
  }

  private resolveCommandContext(selectionId?: string) {
    const livePickedInfo = this.manager?.getPickedInfo() ?? null
    const liveAnchor = this.manager?.getCurrentAnchor() ?? null

    if (selectionId && livePickedInfo?.selectionId === selectionId && livePickedInfo.text) {
      return {
        source: 'live' as const,
        pickedInfo: livePickedInfo,
        anchor: liveAnchor,
      }
    }

    if (!selectionId) {
      return livePickedInfo?.text
        ? {
            source: 'live' as const,
            pickedInfo: livePickedInfo,
            anchor: liveAnchor,
          }
        : null
    }

    const cached = this.commandContexts.get(selectionId)
    if (!cached) {
      return null
    }

    if (Date.now() - cached.createdAt > COMMAND_CONTEXT_TTL_MS) {
      this.commandContexts.delete(selectionId)
      return null
    }

    return {
      source: 'cached' as const,
      pickedInfo: cached.pickedInfo,
      anchor: cached.anchor,
    }
  }

  private registerAutoDismissSurfaces() {
    autoDismissController.register({
      id: 'bubble',
      priority: 200,
      isVisible: () => this.bubbleWindow?.isVisible() ?? false,
      hide: () => {
        this.manager?.hideBubble()
      },
      shouldDismiss: (context) => {
        if (!this.bubbleWindow || this.bubbleWindow.isDestroyed() || !this.bubbleWindow.isVisible()) {
          return false
        }

        if (context.reason === 'escape' || context.reason === 'dismiss-scene') {
          return true
        }

        if (context.reason === 'surface-opened') {
          return context.target === 'translation' || context.target === 'selection-chat' || context.target === 'main'
        }

        if (context.reason !== 'outside-pointer') {
          return false
        }

        const { x, y } = context
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return false
        }

        const bounds = this.bubbleWindow.getBounds()
        const right = bounds.x + bounds.width
        const bottom = bounds.y + bounds.height
        return x! < bounds.x || x! > right || y! < bounds.y || y! > bottom
      },
    })

    autoDismissController.register({
      id: 'translation',
      priority: 300,
      isVisible: () => this.translationWindowManager?.isVisible() ?? false,
      hide: () => {
        this.translationWindowManager?.hide()
      },
      shouldDismiss: (context) => {
        const manager = this.translationWindowManager
        if (!manager?.isVisible()) {
          return false
        }

        if (context.reason === 'escape') {
          return true
        }

        if (manager.isPinned()) {
          return false
        }

        if (context.reason === 'selection-changed' || context.reason === 'dismiss-scene') {
          return true
        }

        if (context.reason === 'surface-opened') {
          return context.target !== 'translation'
        }

        if (context.reason !== 'outside-pointer') {
          return false
        }

        const { x, y } = context
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return false
        }

        return !manager.containsPoint(x!, y!)
      },
    })

    autoDismissController.register({
      id: 'selection-chat',
      priority: 320,
      isVisible: () => this.selectionChatWindowManager?.isVisible() ?? false,
      hide: () => {
        this.selectionChatWindowManager?.hide()
      },
      shouldDismiss: (context) => {
        const manager = this.selectionChatWindowManager
        if (!manager?.isVisible()) {
          return false
        }

        if (context.reason === 'escape') {
          return true
        }

        if (manager.isPinned()) {
          return false
        }

        if (context.reason === 'surface-opened') {
          return context.target !== 'selection-chat'
        }

        if (context.reason !== 'outside-pointer') {
          return false
        }

        const { x, y } = context
        if (!Number.isFinite(x) || !Number.isFinite(y)) {
          return false
        }

        return !manager.containsPoint(x!, y!)
      },
    })
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
        accelerator: 'Alt+Space',
        click: () => {
          this.manager?.hideBubble()
          void showMainWindow('home')
        },
      },
      {
        label: '截图翻译',
        accelerator: SCREENSHOT_TRANSLATE_SHORTCUT,
        click: () => {
          void this.triggerScreenshotTranslation()
        },
      },
      {
        label: '截图搜索',
        accelerator: SCREENSHOT_SEARCH_SHORTCUT,
        click: () => {
          void this.triggerScreenshotSearch()
        },
      },
      {
        type: 'separator',
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
        label: `版本 ${app.getVersion()}`,
        click: () => {
          void shell.openExternal(POPMIND_RELEASES_URL)
        },
      },
      {
        label: '退出',
        role: 'quit',
      },
      {
        label: '导出日志',
        click: () => {
          void exportMainProcessLogs()
        },
      },
    ])
  }

  private registerSelectionShortcuts() {
    this.registerGlobalShortcut(HIDE_BUBBLE_SHORTCUT, 'hide-bubble', () => {
      this.manager?.hideBubble()
    })
  }

  private registerScreenshotShortcuts() {
    this.registerGlobalShortcut(SCREENSHOT_TRANSLATE_SHORTCUT, 'screenshot-translate', () => {
      void this.triggerScreenshotTranslation()
    })

    this.registerGlobalShortcut(SCREENSHOT_SEARCH_SHORTCUT, 'screenshot-search', () => {
      void this.triggerScreenshotSearch()
    })
  }

  private registerGlobalShortcut(accelerator: string, label: string, handler: () => void) {
    globalShortcut.unregister(accelerator)

    const registered = globalShortcut.register(accelerator, () => {
      this.logger.info('[TextPickerFeature] shortcut triggered', {
        accelerator,
        label,
      })
      handler()
    })

    this.logger.info('[TextPickerFeature] shortcut registration', {
      accelerator,
      label,
      registered,
    })

    if (!registered) {
      this.logger.warn('[TextPickerFeature] shortcut registration failed', {
        accelerator,
        label,
      })
    }

    return registered
  }

  private startPermissionRetryPolling() {
    if (this.permissionRetryTimer || !this.bridge.isSupported) {
      return
    }

    this.logger.info('[TextPickerFeature] starting accessibility retry polling')
    this.permissionRetryTimer = setInterval(() => {
      this.ensureMonitoringActive('permission-poll')
    }, 2500)
  }

  private stopPermissionRetryPolling() {
    if (!this.permissionRetryTimer) {
      return
    }

    clearInterval(this.permissionRetryTimer)
    this.permissionRetryTimer = null
    this.logger.info('[TextPickerFeature] stopped accessibility retry polling')
  }

  private logMonitorState(source: string, granted: boolean, running: boolean, started?: boolean) {
    const stateKey = `${granted}:${running}:${started ?? 'na'}`
    if (stateKey === this.lastMonitorStateKey) {
      return
    }

    this.lastMonitorStateKey = stateKey
    this.logger.info('[TextPickerFeature] monitor state', {
      source,
      granted,
      running,
      started,
    })
  }

  private ensureMonitoringActive(source: string) {
    if (!this.manager || !this.bridge.isSupported) {
      return false
    }

    const granted = this.manager.ensurePermission({ prompt: false })
    const running = this.manager.isMonitoringActive()

    if (!granted) {
      this.logMonitorState(source, false, running)
      this.startPermissionRetryPolling()
      return false
    }

    if (running) {
      this.logMonitorState(source, true, true)
      this.stopPermissionRetryPolling()
      return true
    }

    const started = this.manager.start()
    this.logMonitorState(source, true, started, started)

    if (!started) {
      this.logger.error('[TextPickerFeature] failed to start action monitor after permission grant', { source })
      this.startPermissionRetryPolling()
      return false
    }

    this.stopPermissionRetryPolling()
    this.registerSelectionShortcuts()
    return true
  }

  private async logMacCodeSigningDiagnostics() {
    if (process.platform !== 'darwin' || !app.isPackaged) {
      return
    }

    const signingInfo = await getMacCodeSigningInfo()
    if (!signingInfo) {
      return
    }

    this.logger.info('[TextPickerFeature] macOS code signing', signingInfo)

    if (!signingInfo.isAdhoc) {
      return
    }

    this.logger.warn(
      '[TextPickerFeature] packaged macOS build is ad-hoc signed; Accessibility permission may remain unavailable after rebuild or reinstall until the app is signed with a stable identity and re-authorized',
      signingInfo
    )
  }

  private async triggerScreenshotTranslation() {
    this.manager?.hideBubble()
    await this.screenshotTranslationService?.start()
  }

  private async triggerScreenshotSearch() {
    this.manager?.hideBubble()
    await this.screenshotSearchService?.start()
  }

  private setupIpc() {
    ipcMain.handle(TextPickerChannel.Command, async (_event, commandId: string, selectionId?: string) => {
      this.manager?.noteBubbleInteraction()

      const commandContext = this.resolveCommandContext(selectionId)
      if (!commandContext?.pickedInfo.text) {
        this.logger.warn('[TextPickerFeature] ipc command rejected: empty_selection', {
          commandId,
          selectionId,
          liveSelectionId: this.manager?.getPickedInfo()?.selectionId ?? null,
        })
        return { ok: false, reason: 'empty_selection' }
      }

      const { pickedInfo } = commandContext
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

        // The selected text is already resolved before the bubble is shown.
        // Writing it directly avoids a second round-trip through the source app
        // and removes the menu/shortcut clipboard polling delay.
        clipboard.writeText(pickedInfo.text)

        const finalClipboardText = clipboard.readText()
        const strategy = finalClipboardText === pickedInfo.text ? 'clipboard_write' : 'clipboard_write_failed'

        if (strategy === 'clipboard_write_failed') {
          this.logger.warn('[TextPickerFeature] clipboard.writeText verification failed', {
            appId: pickedInfo.appId || 'unknown_app',
            expectedTextLength: pickedInfo.text.length,
            clipboardTextLength: finalClipboardText.length,
            clipboardPreview: finalClipboardText.slice(0, 60),
          })
        }

        return {
          ok: strategy === 'clipboard_write',
          commandId,
          strategy,
        }
      }

      if (commandId === SystemCommand.HideTextPicker) {
        this.manager?.hideBubble()
        return { ok: true, commandId }
      }

      if (
        commandId === SystemCommand.Translate ||
        commandId === SystemCommand.Explain ||
        commandId === SystemCommand.Search
      ) {
        if (commandId === SystemCommand.Translate) {
          const anchor = commandContext.anchor
          await this.translationWindowManager?.showTranslation({
            text: pickedInfo.text,
            selectionId: pickedInfo.selectionId,
            sourceAppId: pickedInfo.appId,
            anchor,
          })
          return { ok: true, commandId }
        }

        if (commandId === SystemCommand.Explain) {
          const settings = await capabilityService.getSettings()
          if (
            !settings.aiService.activeProvider ||
            !settings.aiService.providers[settings.aiService.activeProvider].apiKey.trim()
          ) {
            const targetUrl = this.buildExternalCommandUrl(commandId, pickedInfo.text, settings.appLanguage)
            if (!targetUrl) {
              return { ok: false, reason: 'missing_target_url' }
            }

            this.manager?.hideBubble()
            await shell.openExternal(targetUrl)
            return { ok: true, commandId }
          }

          await this.selectionChatWindowManager?.open({
            text: pickedInfo.text,
            selectionId: pickedInfo.selectionId,
            sourceAppId: pickedInfo.appId,
            anchor: commandContext.anchor,
          })
          return { ok: true, commandId }
        }

        const settings = await capabilityService.getSettings()
        const targetUrl = this.buildExternalCommandUrl(commandId, pickedInfo.text, settings.appLanguage)
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

    ipcMain.handle(TextPickerChannel.OpenMainWindow, async (_event, query?: string) => {
      await showMainWindow('home', {
        searchQuery: query?.trim() ? query : undefined,
      })
      return { ok: true }
    })

    ipcMain.handle(TextPickerChannel.HideBubble, async () => {
      this.manager?.hideBubble()
      return { ok: true }
    })
    ipcMain.handle(TextPickerChannel.DismissTopmost, async () => {
      autoDismissController.dismissTopmost('escape')
      return { ok: true }
    })

    ipcMain.on(TextPickerChannel.MoveBubble, (_event, deltaX: number, deltaY: number) => {
      this.manager?.moveBubble(deltaX, deltaY)
    })

    ipcMain.on(TextPickerChannel.ResizeBubble, (_event, width: number) => {
      this.manager?.resizeBubble(width)
    })

    ipcMain.on(TextPickerChannel.SetBubbleDragging, (_event, isDragging: boolean) => {
      this.manager?.setBubbleDragging(isDragging)
    })

    ipcMain.on(TextPickerChannel.NotifyBubbleInteraction, () => {
      this.manager?.noteBubbleInteraction()
    })
  }

  private buildExternalCommandUrl(commandId: string, text: string, appLanguage: 'zh-CN' | 'en' = 'zh-CN') {
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
        q: `Explain the following text in ${formatLanguageLabel(appLanguage)}: ${trimmedText}`,
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
