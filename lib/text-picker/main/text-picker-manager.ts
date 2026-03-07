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

interface AnchorPoint {
  x: number
  y: number
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
  private bubbleDragReleaseTimer: NodeJS.Timeout | null = null
  private refreshToken = 0
  private isOverlayPolicyActive = false
  private isBubbleDragging = false
  private ignorePointerEventsUntil = 0
  private currentAnchor: AnchorPoint | null = null
  private pickedInfo: PickedInfo | null = null
  private skills: SelectionSkill[] = [
    { commandId: SystemCommand.Translate, label: '翻译', enabled: true },
    { commandId: SystemCommand.Explain, label: '解释', enabled: true },
    { commandId: SystemCommand.Copy, label: '复制', enabled: true },
    { commandId: SystemCommand.Search, label: 'AI 搜', enabled: true },
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

    if (this.bubbleDragReleaseTimer) {
      clearTimeout(this.bubbleDragReleaseTimer)
      this.bubbleDragReleaseTimer = null
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

    this.currentAnchor = null
    this.leaveFullscreenOverlayMode()
  }

  memorizePosition(appId: string, offsetX: number, offsetY: number) {
    this.positionMemory.set(appId || '__default__', {
      offsetX,
      offsetY,
    })
  }

  moveBubble(deltaX: number, deltaY: number) {
    if (
      this.bubbleWindow.isDestroyed() ||
      !this.bubbleWindow.isVisible() ||
      !this.currentAnchor ||
      !this.pickedInfo
    ) {
      return
    }

    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY) || (deltaX === 0 && deltaY === 0)) {
      return
    }

    const bounds = this.bubbleWindow.getBounds()
    const display = screen.getDisplayMatching(bounds)
    const { workArea } = display

    const nextX = Math.max(
      workArea.x,
      Math.min(bounds.x + Math.round(deltaX), workArea.x + workArea.width - bounds.width),
    )
    const nextY = Math.max(
      workArea.y,
      Math.min(bounds.y + Math.round(deltaY), workArea.y + workArea.height - bounds.height),
    )

    this.bubbleWindow.setBounds({
      ...bounds,
      x: nextX,
      y: nextY,
    })

    this.memorizePosition(
      this.pickedInfo.appId,
      nextX - this.currentAnchor.x,
      nextY - this.currentAnchor.y,
    )

    this.bubbleWindow.orderFront()
  }

  setBubbleDragging(isDragging: boolean) {
    if (this.bubbleDragReleaseTimer) {
      clearTimeout(this.bubbleDragReleaseTimer)
      this.bubbleDragReleaseTimer = null
    }

    if (isDragging) {
      this.isBubbleDragging = true
      this.ignorePointerEventsUntil = Number.POSITIVE_INFINITY
      return
    }

    this.bubbleDragReleaseTimer = setTimeout(() => {
      this.isBubbleDragging = false
      this.ignorePointerEventsUntil = Date.now() + 180
      this.bubbleDragReleaseTimer = null
    }, 0)
  }

  triggerCommand(commandId: string, selectionId?: string) {
    if (!this.pickedInfo) {
      return { ok: false, reason: 'no_selection' }
    }

    if (selectionId && this.pickedInfo.selectionId !== selectionId) {
      this.logger.warn(
        `[TextPickerManager] stale selection rejected: current=${this.pickedInfo.selectionId}, requested=${selectionId}`,
      )
      return { ok: false, reason: 'stale_selection' }
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

    if (this.isBubbleDragging || Date.now() < this.ignorePointerEventsUntil) {
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

    if (isPointerScene && this.isEventInsideBubble(event)) {
      return
    }

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

  private isEventInsideBubble(event: SelectionActionEvent) {
    if (!event || this.bubbleWindow.isDestroyed() || !this.bubbleWindow.isVisible()) {
      return false
    }

    const x = Number(event.x)
    const y = Number(event.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return false
    }

    const bounds = this.bubbleWindow.getBounds()
    const right = bounds.x + bounds.width
    const bottom = bounds.y + bounds.height
    return x >= bounds.x && x <= right && y >= bounds.y && y <= bottom
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

  private async refreshSelectionWithRetries(
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

    let text = typeof snapshot.text === 'string' ? snapshot.text.trim() : ''

    if (!text && snapshot.needsClipboardFallback && snapshot.fallbackAppPid != null) {
      const menuText = await this.bridge.getTextByClipboardAsync(true, snapshot.fallbackAppPid)
      if (token !== this.refreshToken) return

      if (menuText?.trim()) {
        text = menuText.trim()
        snapshot.strategy = 'menu_copy'
      } else {
        const shortcutText = await this.bridge.getTextByClipboardAsync(false, -1)
        if (token !== this.refreshToken) return

        if (shortcutText?.trim()) {
          text = shortcutText.trim()
          snapshot.strategy = 'shortcut_copy'
        }
      }
      snapshot.text = text
    }

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
      this.pickedInfo = null
      this.hideBubble()
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
    anchor: AnchorPoint
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

    if (memPos) {
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

    this.currentAnchor = anchor

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
