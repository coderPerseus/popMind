import { randomUUID } from 'node:crypto'
import { screen } from 'electron'
import type {
  EnabledSelectionScene,
  PickedInfo,
  SceneEnableMap,
  SelectionActionEvent,
  SelectionBridge,
  SelectionSceneValue,
  SelectionSkill,
  SelectionSnapshot,
} from '@/lib/text-picker/shared'
import {
  CHECK_DELAY_MS,
  DEFAULT_SCENE_ENABLE,
  KEYBOARD_CHECK_DELAY_MS,
  MAX_RETRIES,
  RETRY_DELAY_MS,
  SelectionScene,
  SystemCommand,
  TOOLBAR_GAP,
  TOOLBAR_HEIGHT,
  TOOLBAR_WIDTH,
} from '@/lib/text-picker/shared'
import type { BubbleWindowPort } from './bubble-window'

interface ToolbarPositionMemory {
  offsetX: number
  offsetY: number
}

interface TextPickerManagerOptions {
  bubbleWindow: BubbleWindowPort
  bridge: SelectionBridge
  logger?: Console
}

const DISMISS_SCENES = new Set<SelectionSceneValue>([
  SelectionScene.GESTURE_DISMISS,
  SelectionScene.OTHER_CLICK_DISMISS,
  SelectionScene.KEY_DISMISS,
  SelectionScene.WINDOW_FRAME_DISMISS,
])

export class TextPickerManager {
  private readonly bubbleWindow: BubbleWindowPort
  private readonly bridge: SelectionBridge
  private readonly logger: Console
  private readonly blockedApps = new Set<string>()
  private readonly blockedUrls = new Set<string>()
  private readonly positionMemory = new Map<string, ToolbarPositionMemory>()
  private readonly sceneEnable: SceneEnableMap = { ...DEFAULT_SCENE_ENABLE }

  private isRunning = false
  private globalEnabled = true
  private debounceTimer: NodeJS.Timeout | null = null
  private refreshToken = 0
  private isOverlayPolicyActive = false
  private pickedInfo: PickedInfo | null = null
  private skills: SelectionSkill[] = [
    { commandId: SystemCommand.Search, label: 'AI 搜索', enabled: true },
    { commandId: SystemCommand.Translate, label: '翻译', enabled: true },
    { commandId: SystemCommand.Summary, label: '总结', enabled: true },
    { commandId: SystemCommand.Explain, label: '解释', enabled: true },
    { commandId: SystemCommand.Rewrite, label: '改写', enabled: true },
    { commandId: SystemCommand.Copy, label: '复制', enabled: true },
    { commandId: SystemCommand.TextToSpeech, label: '朗读', enabled: true },
  ]

  constructor({
    bubbleWindow,
    bridge,
    logger = console,
  }: TextPickerManagerOptions) {
    this.bubbleWindow = bubbleWindow
    this.bridge = bridge
    this.logger = logger
    this.applyActivationPolicy()
  }

  ensurePermission({ prompt = false }: { prompt?: boolean } = {}) {
    if (!this.bridge.isSupported) {
      return false
    }

    const trusted = this.bridge.checkPermission(false)
    if (trusted || !prompt) {
      return trusted
    }

    return this.bridge.checkPermission(true)
  }

  start() {
    if (this.isRunning || !this.bridge.isSupported) {
      return false
    }

    const started = this.bridge.startActionMonitor((event) => {
      this.onActionEvent(event)
    })

    this.isRunning = started
    if (started) {
      this.logger.info('[TextPickerManager] started')
    }

    return started
  }

  stop() {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    if (this.isRunning) {
      this.bridge.stopActionMonitor()
      this.isRunning = false
      this.logger.info('[TextPickerManager] stopped')
    }
  }

  setGlobalEnabled(enabled: boolean) {
    this.globalEnabled = enabled
    if (!enabled) {
      this.hideBubble()
    }
  }

  isGlobalEnabled() {
    return this.globalEnabled
  }

  setSceneEnabled(scene: EnabledSelectionScene, enabled: boolean) {
    if (scene in this.sceneEnable) {
      this.sceneEnable[scene] = enabled
    }
  }

  isSceneEnabled(scene: SelectionSceneValue | string) {
    if (scene === SelectionScene.MANUAL) {
      return true
    }

    if (!(scene in this.sceneEnable)) {
      return false
    }

    return this.sceneEnable[scene as EnabledSelectionScene] === true
  }

  addBlockedApp(bundleId: string) {
    this.blockedApps.add(bundleId)
  }

  removeBlockedApp(bundleId: string) {
    this.blockedApps.delete(bundleId)
  }

  getBlockedApps() {
    return [...this.blockedApps]
  }

  isAppBlocked(bundleId: string) {
    return this.blockedApps.has(bundleId)
  }

  addBlockedUrl(url: string) {
    this.blockedUrls.add(url)
  }

  removeBlockedUrl(url: string) {
    this.blockedUrls.delete(url)
  }

  getBlockedUrls() {
    return [...this.blockedUrls]
  }

  getSkills() {
    return this.skills.filter((skill) => skill.enabled)
  }

  setSkills(skills: SelectionSkill[]) {
    this.skills = skills
  }

  getPickedInfo() {
    return this.pickedInfo
  }

  getCurrentSelectionText() {
    return this.pickedInfo?.text || ''
  }

  refreshSelection() {
    this.refreshToken += 1
    this.refreshSelectionWithRetries(this.refreshToken, SelectionScene.MANUAL, 0)
  }

  hideBubble() {
    if (!this.bubbleWindow.isDestroyed() && this.bubbleWindow.isVisible()) {
      this.bubbleWindow.hide()
    }

    this.leaveFullscreenOverlayMode()
  }

  memorizePosition(appId: string, offsetX: number, offsetY: number) {
    this.positionMemory.set(appId || '__default__', {
      offsetX,
      offsetY,
    })
  }

  triggerCommand(commandId: string) {
    if (!this.pickedInfo) {
      return { ok: false, reason: 'no_selection' }
    }

    this.logger.info(
      `[TextPickerManager] triggerCommand: ${commandId}, text: ${this.pickedInfo.text.slice(0, 60)}`,
    )

    return {
      ok: true,
      commandId,
      pickedInfo: this.pickedInfo,
    }
  }

  private onActionEvent(event: SelectionActionEvent) {
    if (!this.globalEnabled) {
      return
    }

    const scene = (event.scene || SelectionScene.NONE) as SelectionSceneValue | string

    if (DISMISS_SCENES.has(scene as SelectionSceneValue)) {
      this.hideBubble()
      return
    }

    const isPointerScene =
      scene === SelectionScene.NONE ||
      scene === SelectionScene.BOX_SELECT ||
      scene === SelectionScene.MULTI_CLICK ||
      scene === SelectionScene.SHIFT_MOUSE_CLICK

    if (isPointerScene) {
      this.hideOnOutsideClickIfNeeded(event)
    }

    if (scene === SelectionScene.NONE) {
      return
    }

    if (scene !== SelectionScene.MANUAL && !this.isSceneEnabled(scene)) {
      return
    }

    const delay =
      scene === SelectionScene.SHIFT_ARROW || scene === SelectionScene.CTRL_A
        ? KEYBOARD_CHECK_DELAY_MS
        : CHECK_DELAY_MS

    this.scheduleSelectionCheck(scene, delay)
  }

  private hideOnOutsideClickIfNeeded(event: SelectionActionEvent) {
    if (!event || this.bubbleWindow.isDestroyed() || !this.bubbleWindow.isVisible()) {
      return
    }

    const x = Number(event.x)
    const y = Number(event.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return
    }

    const bounds = this.bubbleWindow.getBounds()
    const right = bounds.x + bounds.width
    const bottom = bounds.y + bounds.height
    const isInsideBubble = x >= bounds.x && x <= right && y >= bounds.y && y <= bottom

    if (!isInsideBubble) {
      this.hideBubble()
    }
  }

  private scheduleSelectionCheck(scene: SelectionSceneValue | string, delay = CHECK_DELAY_MS) {
    this.refreshToken += 1
    const token = this.refreshToken

    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }

    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      this.refreshSelectionWithRetries(token, scene, 0)
    }, delay)
  }

  private refreshSelectionWithRetries(
    token: number,
    scene: SelectionSceneValue | string,
    attempt: number,
  ) {
    if (token !== this.refreshToken || !this.bridge.isSupported) {
      return
    }

    const snapshot = this.bridge.getSelectionSnapshot(scene)
    if (token !== this.refreshToken) {
      return
    }

    const text = typeof snapshot.text === 'string' ? snapshot.text.trim() : ''

    if (!text) {
      if (attempt < MAX_RETRIES) {
        setTimeout(() => {
          this.refreshSelectionWithRetries(token, scene, attempt + 1)
        }, RETRY_DELAY_MS)
        return
      }

      this.pickedInfo = null
      this.hideBubble()
      return
    }

    const bundleId = snapshot.sourceBundleId || ''
    if (bundleId && this.isAppBlocked(bundleId)) {
      this.logger.info(`[TextPickerManager] blocked app: ${bundleId}`)
      return
    }

    this.pickedInfo = {
      text,
      appName: snapshot.sourceApp || '',
      appId: bundleId,
      scene,
      selectionId: randomUUID(),
      strategy: snapshot.strategy || 'none',
      hasRect: snapshot.hasRect || false,
      rect: snapshot.rect || null,
    }

    const cursorPoint = screen.getCursorScreenPoint()
    const anchor = this.resolveAnchor(snapshot, cursorPoint)

    this.showToolbar({
      anchor,
      pickedInfo: this.pickedInfo,
    })
  }

  private showToolbar({
    anchor,
    pickedInfo,
  }: {
    anchor: { x: number; y: number }
    pickedInfo: PickedInfo
  }) {
    if (this.bubbleWindow.isDestroyed()) {
      return
    }

    const display = screen.getDisplayNearestPoint({
      x: Math.round(anchor.x),
      y: Math.round(anchor.y),
    })
    const { workArea } = display

    const memKey = pickedInfo.appId || '__default__'
    const memPos = this.positionMemory.get(memKey)

    let x = anchor.x - TOOLBAR_WIDTH / 2
    let y = anchor.y - TOOLBAR_HEIGHT - TOOLBAR_GAP

    const memorizedPosition = memPos as (ToolbarPositionMemory & { x?: number | null; y?: number | null }) | undefined
    if (memorizedPosition && memorizedPosition.x != null && memorizedPosition.y != null) {
      x = anchor.x + memPos.offsetX
      y = anchor.y + memPos.offsetY
    }

    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - TOOLBAR_WIDTH))

    if (y < workArea.y) {
      y = Math.min(anchor.y + TOOLBAR_GAP, workArea.y + workArea.height - TOOLBAR_HEIGHT)
    }

    this.bubbleWindow.setBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: TOOLBAR_WIDTH,
      height: TOOLBAR_HEIGHT,
    })

    this.bubbleWindow.sendUpdate({
      sourceApp: pickedInfo.appName,
      sourceBundleId: pickedInfo.appId,
      selectionText: pickedInfo.text,
      scene: pickedInfo.scene,
      selectionId: pickedInfo.selectionId,
      skills: this.getSkills(),
    })

    this.enterFullscreenOverlayMode()

    if (!this.bubbleWindow.isVisible()) {
      this.bubbleWindow.showInactive()
    }

    this.bubbleWindow.orderFront()
  }

  private enterFullscreenOverlayMode() {
    if (this.isOverlayPolicyActive) {
      return
    }

    this.isOverlayPolicyActive = true
    this.applyActivationPolicy()
  }

  private leaveFullscreenOverlayMode() {
    if (!this.isOverlayPolicyActive) {
      return
    }

    this.isOverlayPolicyActive = false
    this.applyActivationPolicy()
  }

  private applyActivationPolicy() {
    if (!this.bridge.isSupported) {
      return
    }

    // Always use Accessory policy — the app lives in the menu bar tray,
    // not in the Dock. This also enables the bubble to overlay fullscreen apps.
    this.bridge.setActivationPolicy(1)
  }

  private resolveAnchor(snapshot: SelectionSnapshot, cursorPoint: { x: number; y: number }) {
    const fallback = { x: cursorPoint.x, y: cursorPoint.y }

    if (!snapshot || !snapshot.hasRect || !snapshot.rect) {
      return fallback
    }

    const rawRect = snapshot.rect
    if (
      typeof rawRect.x !== 'number' ||
      typeof rawRect.y !== 'number' ||
      typeof rawRect.width !== 'number' ||
      typeof rawRect.height !== 'number' ||
      rawRect.width <= 0 ||
      rawRect.height <= 0
    ) {
      return fallback
    }

    const display = screen.getDisplayNearestPoint({
      x: Math.round(cursorPoint.x),
      y: Math.round(cursorPoint.y),
    })

    const topYAsIs = rawRect.y
    const topYFlipped = display.bounds.y + display.bounds.height - (rawRect.y + rawRect.height)

    const normalizedTopY =
      Math.abs(topYAsIs - cursorPoint.y) <= Math.abs(topYFlipped - cursorPoint.y)
        ? topYAsIs
        : topYFlipped

    return {
      x: rawRect.x + rawRect.width / 2,
      y: normalizedTopY,
    }
  }
}
