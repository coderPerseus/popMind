import { randomUUID } from 'node:crypto'
import { screen } from 'electron'
import type { AppLanguage } from '@/lib/capability/types'
import { translateMessage } from '@/lib/i18n/shared'
import { normalizeSelectedLink } from '@/lib/text-picker/link-utils'
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
  MAX_RETRIES,
  RETRY_DELAY_MS,
  SelectionScene,
  SystemCommand,
  TOOLBAR_COMPACT_MIN_WIDTH,
  TOOLBAR_GAP,
  TOOLBAR_HEIGHT,
  TOOLBAR_MIN_WIDTH,
} from '@/lib/text-picker/shared'
import type { BubbleWindowPort } from './bubble-window'
import type { DismissContext } from '@/lib/windowing/auto-dismiss-controller'

interface ToolbarPositionMemory {
  offsetX: number
  offsetY: number
}

interface AnchorPoint {
  x: number
  topY: number
  bottomY: number
}

interface TextPickerManagerOptions {
  bubbleWindow: BubbleWindowPort
  bridge: SelectionBridge
  logger?: Console
  onSelectionShown?: (pickedInfo: PickedInfo) => void
  isSecondaryFloatingVisible?: () => boolean
  isEventInsideSecondaryFloating?: (event: SelectionActionEvent) => boolean
  hideSecondaryFloating?: () => void
  dispatchAutoDismiss?: (context: DismissContext) => void
}

const DISMISS_SCENES = new Set<SelectionSceneValue>([
  SelectionScene.OTHER_CLICK_DISMISS,
  SelectionScene.WINDOW_FRAME_DISMISS,
  SelectionScene.GESTURE_DISMISS,
  SelectionScene.APP_FOCUS_DISMISS,
  SelectionScene.KEY_DISMISS,
])

const APP_ACTIVATE_SUPPRESS_MS = 700
const PROGRAMMATIC_MOVE_GUARD_MS = 80
const NATIVE_DRAG_RELEASE_DELAY_MS = 140
const POST_DRAG_IGNORE_POINTER_MS = 260
const POST_SHOW_GESTURE_DISMISS_GUARD_MS = 300
const POST_SHOW_APP_FOCUS_DISMISS_GUARD_MS = 2500

const createDefaultSkills = (language: AppLanguage): SelectionSkill[] => [
  { commandId: SystemCommand.Translate, label: translateMessage(language, 'bubble.translate'), enabled: true },
  { commandId: SystemCommand.Explain, label: translateMessage(language, 'bubble.explain'), enabled: true },
  { commandId: SystemCommand.Copy, label: translateMessage(language, 'bubble.copy'), enabled: true },
  { commandId: SystemCommand.AskAI, label: translateMessage(language, 'bubble.ask'), enabled: true },
]

const createOpenLinkSkill = (language: AppLanguage): SelectionSkill => ({
  commandId: SystemCommand.OpenLink,
  label: translateMessage(language, 'bubble.open'),
  enabled: true,
})

export class TextPickerManager {
  private readonly bubbleWindow: BubbleWindowPort
  private readonly bridge: SelectionBridge
  private readonly logger: Console
  private readonly onSelectionShown?: (pickedInfo: PickedInfo) => void
  private readonly isSecondaryFloatingVisible?: () => boolean
  private readonly isEventInsideSecondaryFloating?: (event: SelectionActionEvent) => boolean
  private readonly hideSecondaryFloating?: () => void
  private readonly dispatchAutoDismiss?: (context: DismissContext) => void
  private readonly blockedApps = new Set<string>()
  private readonly blockedUrls = new Set<string>()
  private readonly positionMemory = new Map<string, ToolbarPositionMemory>()
  private readonly sceneEnable: SceneEnableMap = { ...DEFAULT_SCENE_ENABLE }

  private isRunning = false
  private globalEnabled = true
  private debounceTimer: NodeJS.Timeout | null = null
  private bubbleDragReleaseTimer: NodeJS.Timeout | null = null
  private readonly detachBubbleMoveListener: (() => void) | null
  private refreshToken = 0
  private isOverlayPolicyActive = false
  private isBubbleDragging = false
  private ignorePointerEventsUntil = 0
  private suppressAppActivationUntil = 0
  private ignoreBubbleMoveUntil = 0
  private ignoreGestureDismissUntil = 0
  private ignoreAppFocusDismissUntil = 0
  private currentAnchor: AnchorPoint | null = null
  private bubbleWidth = TOOLBAR_MIN_WIDTH
  private pickedInfo: PickedInfo | null = null
  private language: AppLanguage = 'zh-CN'
  private skills: SelectionSkill[] = createDefaultSkills('zh-CN')

  constructor({
    bubbleWindow,
    bridge,
    logger = console,
    onSelectionShown,
    isSecondaryFloatingVisible,
    isEventInsideSecondaryFloating,
    hideSecondaryFloating,
    dispatchAutoDismiss,
  }: TextPickerManagerOptions) {
    this.bubbleWindow = bubbleWindow
    this.bridge = bridge
    this.logger = logger
    this.onSelectionShown = onSelectionShown
    this.isSecondaryFloatingVisible = isSecondaryFloatingVisible
    this.isEventInsideSecondaryFloating = isEventInsideSecondaryFloating
    this.hideSecondaryFloating = hideSecondaryFloating
    this.dispatchAutoDismiss = dispatchAutoDismiss
    this.detachBubbleMoveListener = this.bubbleWindow.onMove((bounds) => {
      this.handleBubbleMoved(bounds)
    })
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
      this.syncDismissKeyMonitor()
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

    this.detachBubbleMoveListener?.()
  }

  isMonitoringActive() {
    return this.isRunning
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
    if (normalizeSelectedLink(this.pickedInfo?.text ?? '')) {
      return [createOpenLinkSkill(this.language)]
    }

    return this.skills.filter((skill) => skill.enabled)
  }

  setSkills(skills: SelectionSkill[]) {
    this.skills = skills
  }

  setLanguage(language: AppLanguage) {
    this.language = language
    this.skills = this.skills.map((skill) => ({
      ...skill,
      label:
        createDefaultSkills(language).find((item) => item.commandId === skill.commandId)?.label ?? skill.label,
    }))

    if (this.pickedInfo && this.bubbleWindow.isVisible()) {
      this.bubbleWindow.sendUpdate({
        sourceApp: this.pickedInfo.appName,
        sourceBundleId: this.pickedInfo.appId,
        selectionText: this.pickedInfo.text,
        scene: this.pickedInfo.scene,
        selectionId: this.pickedInfo.selectionId,
        skills: this.getSkills(),
      })
    }
  }

  syncDismissKeyMonitor() {
    if (!this.bridge.isSupported || !this.isRunning) {
      return false
    }

    const enabled = this.bubbleWindow.isVisible() || this.isSecondaryFloatingVisible?.() === true
    return this.bridge.setKeyMonitorEnabled(enabled)
  }

  getPickedInfo() {
    return this.pickedInfo
  }

  getCurrentSelectionText() {
    return this.pickedInfo?.text || ''
  }

  getCurrentAnchor() {
    return this.currentAnchor
  }

  hideBubble() {
    this.cancelPendingSelectionCheck('hide_bubble')

    if (this.bubbleDragReleaseTimer) {
      clearTimeout(this.bubbleDragReleaseTimer)
      this.bubbleDragReleaseTimer = null
    }

    this.isBubbleDragging = false

    if (!this.bubbleWindow.isDestroyed() && this.bubbleWindow.isVisible()) {
      this.bubbleWindow.hide()
    }

    this.currentAnchor = null
    this.leaveFullscreenOverlayMode()
    this.syncDismissKeyMonitor()
  }

  memorizePosition(appId: string, offsetX: number, offsetY: number) {
    this.positionMemory.set(appId || '__default__', {
      offsetX,
      offsetY,
    })
  }

  moveBubble(deltaX: number, deltaY: number) {
    if (this.bubbleWindow.isDestroyed() || !this.bubbleWindow.isVisible() || !this.currentAnchor || !this.pickedInfo) {
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
      Math.min(bounds.x + Math.round(deltaX), workArea.x + workArea.width - bounds.width)
    )
    const nextY = Math.max(
      workArea.y,
      Math.min(bounds.y + Math.round(deltaY), workArea.y + workArea.height - bounds.height)
    )

    this.setBubbleBounds({
      ...bounds,
      x: nextX,
      y: nextY,
    })

    this.memorizePosition(this.pickedInfo.appId, nextX - this.currentAnchor.x, nextY - this.currentAnchor.topY)

    this.bubbleWindow.orderFront()
  }

  resizeBubble(requestedWidth: number) {
    if (this.bubbleWindow.isDestroyed() || !this.currentAnchor || !Number.isFinite(requestedWidth)) {
      return
    }

    const minimumWidth = normalizeSelectedLink(this.pickedInfo?.text ?? '') ? TOOLBAR_COMPACT_MIN_WIDTH : TOOLBAR_MIN_WIDTH
    const nextWidth = Math.max(minimumWidth, Math.round(requestedWidth))
    if (nextWidth === this.bubbleWidth) {
      return
    }

    this.bubbleWidth = nextWidth

    if (!this.bubbleWindow.isVisible() || !this.pickedInfo) {
      return
    }

    const bounds = this.bubbleWindow.getBounds()
    const display = screen.getDisplayNearestPoint({
      x: Math.round(this.currentAnchor.x),
      y: Math.round(this.currentAnchor.topY),
    })
    const { workArea } = display
    const memKey = this.pickedInfo.appId || '__default__'
    const memPos = this.positionMemory.get(memKey)

    let x = memPos ? this.currentAnchor.x + memPos.offsetX : this.currentAnchor.x - nextWidth / 2
    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - nextWidth))

    this.setBubbleBounds({
      x: Math.round(x),
      y: bounds.y,
      width: nextWidth,
      height: bounds.height,
    })

    this.bubbleWindow.orderFront()
  }

  setBubbleDragging(isDragging: boolean) {
    this.noteBubbleInteraction()

    if (isDragging) {
      this.markBubbleDragging()
      return
    }

    this.scheduleBubbleDragRelease(0)
  }

  noteBubbleInteraction(durationMs = APP_ACTIVATE_SUPPRESS_MS) {
    this.suppressAppActivationUntil = Math.max(this.suppressAppActivationUntil, Date.now() + durationMs)
  }

  shouldSuppressAppActivation() {
    return Date.now() < this.suppressAppActivationUntil
  }

  triggerCommand(commandId: string, selectionId?: string) {
    this.noteBubbleInteraction()

    if (!this.pickedInfo) {
      return { ok: false, reason: 'no_selection' }
    }

    if (selectionId && this.pickedInfo.selectionId !== selectionId) {
      this.logger.warn(
        `[TextPickerManager] stale selection rejected: current=${this.pickedInfo.selectionId}, requested=${selectionId}`
      )
      return { ok: false, reason: 'stale_selection' }
    }

    return {
      ok: true,
      commandId,
      pickedInfo: this.pickedInfo,
    }
  }

  private onActionEvent(event: SelectionActionEvent) {
    if (event.scene !== SelectionScene.GESTURE_DISMISS) {
      this.logger.info('[TextPickerManager] action', event)
    }
    if (!this.globalEnabled) {
      return
    }

    if (this.isBubbleDragging || Date.now() < this.ignorePointerEventsUntil) {
      return
    }

    const scene = (event.scene || SelectionScene.NONE) as SelectionSceneValue | string
    const floatingVisible = this.bubbleWindow.isVisible() || this.isSecondaryFloatingVisible?.() === true
    const insideFloatingSurface = this.isEventInsideBubble(event) || this.isEventInsideSecondaryFloating?.(event) === true

    if (scene === SelectionScene.APP_FOCUS_DISMISS && Date.now() < this.ignoreAppFocusDismissUntil) {
      return
    }

    if (scene === SelectionScene.GESTURE_DISMISS && Date.now() < this.ignoreGestureDismissUntil) {
      return
    }

    if (scene === SelectionScene.GESTURE_DISMISS && floatingVisible && insideFloatingSurface) {
      return
    }

    if (scene === SelectionScene.KEY_DISMISS && floatingVisible && this.shouldSuppressAppActivation()) {
      return
    }

    if (DISMISS_SCENES.has(scene as SelectionSceneValue)) {
      this.cancelPendingSelectionCheck(`dismiss:${scene}`)
      this.noteBubbleInteraction()
      if (this.dispatchAutoDismiss) {
        this.dispatchAutoDismiss({
          reason: 'dismiss-scene',
          source: 'bubble',
        })
      } else {
        this.hideBubble()
        this.hideSecondaryFloating?.()
      }
      return
    }

    const isPointerScene =
      scene === SelectionScene.NONE ||
      scene === SelectionScene.BOX_SELECT ||
      scene === SelectionScene.MULTI_CLICK

    if (isPointerScene && (this.isEventInsideBubble(event) || this.isEventInsideSecondaryFloating?.(event))) {
      return
    }

    if (isPointerScene) {
      this.hideOnOutsideClickIfNeeded(event)
    }

    if (scene === SelectionScene.NONE) {
      this.cancelPendingSelectionCheck('pointer:none')
      return
    }

    if (!this.isSceneEnabled(scene)) {
      return
    }

    this.scheduleSelectionCheck(scene, CHECK_DELAY_MS)
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
    const bubbleVisible = !this.bubbleWindow.isDestroyed() && this.bubbleWindow.isVisible()
    const secondaryVisible = this.isSecondaryFloatingVisible?.() === true

    if (!event || (!bubbleVisible && !secondaryVisible)) {
      return
    }

    const x = Number(event.x)
    const y = Number(event.y)
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      return
    }

    const isInsideBubble = bubbleVisible ? this.isEventInsideBubble(event) : false
    const isInsideSecondary = this.isEventInsideSecondaryFloating?.(event) === true

    if (!isInsideBubble && !isInsideSecondary) {
      this.noteBubbleInteraction()
      if (this.dispatchAutoDismiss) {
        this.dispatchAutoDismiss({
          reason: 'outside-pointer',
          source: 'bubble',
          x,
          y,
        })
      } else {
        this.hideBubble()
        this.hideSecondaryFloating?.()
      }
    }
  }

  private scheduleSelectionCheck(scene: SelectionSceneValue | string, delay = CHECK_DELAY_MS) {
    this.logger.info('[TextPickerManager] scheduleSelectionCheck', { scene, delay })
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

  private cancelPendingSelectionCheck(reason: string) {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }

    this.refreshToken += 1
    if (reason !== `dismiss:${SelectionScene.GESTURE_DISMISS}`) {
      this.logger.info('[TextPickerManager] cancelPendingSelectionCheck', { reason, token: this.refreshToken })
    }
  }

  private async refreshSelectionWithRetries(token: number, scene: SelectionSceneValue | string, attempt: number) {
    if (token !== this.refreshToken || !this.bridge.isSupported) {
      return
    }

    const snapshot = this.bridge.getSelectionSnapshot(scene)
    this.logger.info('[TextPickerManager] selection snapshot', {
      token,
      scene,
      attempt,
      textLength: snapshot.text?.length ?? 0,
      strategy: snapshot.strategy,
      hasRect: snapshot.hasRect,
      needsClipboardFallback: snapshot.needsClipboardFallback,
      fallbackAppPid: snapshot.fallbackAppPid,
      sourceApp: snapshot.sourceApp,
      sourceBundleId: snapshot.sourceBundleId,
      error: snapshot.error,
    })
    if (token !== this.refreshToken) {
      return
    }

    let text = typeof snapshot.text === 'string' ? snapshot.text.trim() : ''

    if (!text && snapshot.needsClipboardFallback && snapshot.fallbackAppPid != null) {
      const menuText = await this.bridge.getTextByClipboardAsync(true, snapshot.fallbackAppPid)
      this.logger.info('[TextPickerManager] clipboard fallback menu', {
        token,
        scene,
        attempt,
        textLength: menuText?.trim().length ?? 0,
      })
      if (token !== this.refreshToken) return

      if (menuText?.trim()) {
        text = menuText.trim()
        snapshot.strategy = 'menu_copy'
      } else {
        const shortcutText = await this.bridge.getTextByClipboardAsync(false, -1)
        this.logger.info('[TextPickerManager] clipboard fallback shortcut', {
          token,
          scene,
          attempt,
          textLength: shortcutText?.trim().length ?? 0,
        })
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
        this.logger.info('[TextPickerManager] empty selection retry', { token, scene, attempt })
        setTimeout(() => {
          this.refreshSelectionWithRetries(token, scene, attempt + 1)
        }, RETRY_DELAY_MS)
        return
      }

      this.pickedInfo = null
      this.logger.warn('[TextPickerManager] no text after retries, hiding bubble', {
        token,
        scene,
        attempt,
      })
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
      sourceAppPid: Number.isFinite(snapshot.sourceAppPid) ? Number(snapshot.sourceAppPid) : -1,
      scene,
      selectionId: randomUUID(),
      strategy: snapshot.strategy || 'none',
      hasRect: snapshot.hasRect || false,
      rect: snapshot.rect || null,
    }
    this.logger.info('[TextPickerManager] selection resolved', {
      token,
      scene,
      attempt,
      textLength: text.length,
      strategy: snapshot.strategy,
      sourceApp: snapshot.sourceApp,
      sourceBundleId: snapshot.sourceBundleId,
      hasRect: snapshot.hasRect,
    })

    const cursorPoint = screen.getCursorScreenPoint()
    const anchor = this.resolveAnchor(snapshot, cursorPoint)

    this.showToolbar({
      anchor,
      pickedInfo: this.pickedInfo,
    })
    this.onSelectionShown?.(this.pickedInfo)
  }

  private showToolbar({ anchor, pickedInfo }: { anchor: AnchorPoint; pickedInfo: PickedInfo }) {
    if (this.bubbleWindow.isDestroyed()) {
      return
    }

    const display = screen.getDisplayNearestPoint({
      x: Math.round(anchor.x),
      y: Math.round(anchor.topY),
    })
    const { workArea } = display

    const memKey = pickedInfo.appId || '__default__'
    const memPos = this.positionMemory.get(memKey)

    let x = anchor.x - this.bubbleWidth / 2
    let y = anchor.topY - TOOLBAR_HEIGHT - TOOLBAR_GAP

    if (memPos) {
      x = anchor.x + memPos.offsetX
      y = anchor.topY + memPos.offsetY
    }

    x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - this.bubbleWidth))

    if (y < workArea.y) {
      y = Math.min(anchor.bottomY + TOOLBAR_GAP, workArea.y + workArea.height - TOOLBAR_HEIGHT)
    }

    this.setBubbleBounds({
      x: Math.round(x),
      y: Math.round(y),
      width: this.bubbleWidth,
      height: TOOLBAR_HEIGHT,
    })

    this.currentAnchor = anchor
    this.ignoreGestureDismissUntil = Date.now() + POST_SHOW_GESTURE_DISMISS_GUARD_MS
    this.ignoreAppFocusDismissUntil = Date.now() + POST_SHOW_APP_FOCUS_DISMISS_GUARD_MS

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
    this.syncDismissKeyMonitor()
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
    const fallback = { x: cursorPoint.x, topY: cursorPoint.y, bottomY: cursorPoint.y }

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
      Math.abs(topYAsIs - cursorPoint.y) <= Math.abs(topYFlipped - cursorPoint.y) ? topYAsIs : topYFlipped

    return {
      x: rawRect.x + rawRect.width / 2,
      topY: normalizedTopY,
      bottomY: normalizedTopY + rawRect.height,
    }
  }

  private setBubbleBounds(bounds: Parameters<BubbleWindowPort['setBounds']>[0]) {
    this.ignoreBubbleMoveUntil = Date.now() + PROGRAMMATIC_MOVE_GUARD_MS
    this.bubbleWindow.setBounds(bounds)
  }

  private handleBubbleMoved(bounds: ReturnType<BubbleWindowPort['getBounds']>) {
    if (
      Date.now() < this.ignoreBubbleMoveUntil ||
      this.bubbleWindow.isDestroyed() ||
      !this.bubbleWindow.isVisible() ||
      !this.currentAnchor ||
      !this.pickedInfo
    ) {
      return
    }

    this.markBubbleDragging()
    this.scheduleBubbleDragRelease(NATIVE_DRAG_RELEASE_DELAY_MS)
    this.noteBubbleInteraction(1000)
    this.memorizePosition(this.pickedInfo.appId, bounds.x - this.currentAnchor.x, bounds.y - this.currentAnchor.topY)
  }

  private markBubbleDragging() {
    if (this.bubbleDragReleaseTimer) {
      clearTimeout(this.bubbleDragReleaseTimer)
      this.bubbleDragReleaseTimer = null
    }

    this.isBubbleDragging = true
    this.ignorePointerEventsUntil = Number.POSITIVE_INFINITY
  }

  private scheduleBubbleDragRelease(delayMs: number) {
    if (this.bubbleDragReleaseTimer) {
      clearTimeout(this.bubbleDragReleaseTimer)
    }

    this.bubbleDragReleaseTimer = setTimeout(() => {
      this.isBubbleDragging = false
      this.ignorePointerEventsUntil = Date.now() + POST_DRAG_IGNORE_POINTER_MS
      this.bubbleDragReleaseTimer = null
    }, delayMs)
  }
}
