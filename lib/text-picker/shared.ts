export const SystemCommand = {
  HideTextPicker: '-1',
  Translate: '1',
  Search: '2',
  Rewrite: '3',
  Summary: '4',
  Explain: '5',
  Grammar: '6',
  Copy: '7',
  AskAI: '8',
  TextToSpeech: 'TextToSpeech',
} as const

export type SystemCommandId = (typeof SystemCommand)[keyof typeof SystemCommand]

export const SelectionScene = {
  NONE: 'none',
  BOX_SELECT: 'box_select',
  MULTI_CLICK: 'multi_click_select',
  GESTURE_DISMISS: 'gesture_dismiss',
  OTHER_CLICK_DISMISS: 'other_click_dismiss',
  APP_FOCUS_DISMISS: 'app_focus_dismiss',
  KEY_DISMISS: 'key_dismiss',
  WINDOW_FRAME_DISMISS: 'window_frame_dismiss',
} as const

export type SelectionSceneValue = (typeof SelectionScene)[keyof typeof SelectionScene]

export const DEFAULT_SCENE_ENABLE = {
  [SelectionScene.BOX_SELECT]: true,
  [SelectionScene.MULTI_CLICK]: true,
} as const

export type EnabledSelectionScene = keyof typeof DEFAULT_SCENE_ENABLE
export type SceneEnableMap = Record<EnabledSelectionScene, boolean>

export const TextPickerChannel = {
  Command: 'textPicker:command',
  GetPickedInfo: 'textPicker:getPickedInfo',
  GetGlobalEnabled: 'textPicker:getGlobalEnabled',
  SetGlobalEnabled: 'textPicker:setGlobalEnabled',
  GetBlockApps: 'textPicker:getBlockApps',
  AddBlockApp: 'textPicker:addBlockApp',
  RemoveBlockApp: 'textPicker:removeBlockApp',
  GetSkills: 'textPicker:getSkills',
  OpenMainWindow: 'textPicker:openMainWindow',
  HideBubble: 'textPicker:hideBubble',
  DismissTopmost: 'textPicker:dismissTopmost',
  MoveBubble: 'bubble:move',
  ResizeBubble: 'bubble:resize',
  SetBubbleDragging: 'bubble:setDragging',
  NotifyBubbleInteraction: 'bubble:interaction',
  BubbleUpdate: 'bubble:update',
} as const

export const CHECK_DELAY_MS = 70
export const RETRY_DELAY_MS = 65
export const MAX_RETRIES = 2
export const TOOLBAR_MIN_WIDTH = 350
export const TOOLBAR_HEIGHT = 36
export const TOOLBAR_GAP = 12

export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface SelectionActionEvent {
  scene?: SelectionSceneValue | string
  x?: number
  y?: number
}

export interface SelectionSnapshot {
  text: string
  sourceApp: string
  sourceBundleId: string
  sourceAppPid?: number
  scene?: SelectionSceneValue | string
  hasRect: boolean
  rect?: SelectionRect | null
  strategy?: string
  error?: string
  needsClipboardFallback?: boolean
  fallbackAppPid?: number
}

export interface PickedInfo {
  text: string
  appName: string
  appId: string
  sourceAppPid?: number
  scene: SelectionSceneValue | string
  selectionId: string
  strategy: string
  hasRect: boolean
  rect: SelectionRect | null
}

export interface SelectionSkill {
  commandId: string
  label: string
  enabled: boolean
}

export interface BubbleUpdatePayload {
  sourceApp: string
  sourceBundleId: string
  selectionText: string
  scene: SelectionSceneValue | string
  selectionId: string
  skills: SelectionSkill[]
}

export interface SelectionBridge {
  isSupported: boolean
  checkPermission(prompt?: boolean): boolean
  getSelectionSnapshot(scene?: SelectionSceneValue | string | null): SelectionSnapshot
  getTextByClipboardAsync(useMenu: boolean, pid: number): Promise<string>
  copySelectionAsync(useMenu: boolean, pid: number, expectedText?: string): Promise<boolean>
  startActionMonitor(callback: (event: SelectionActionEvent) => void): boolean
  stopActionMonitor(): boolean
  getCursorPosition(): { x: number; y: number }
  getFrontmostAppInfo(): { bundleId: string; name: string; pid: number }
  configureBubbleWindow(nativeHandle: Buffer): boolean
  orderBubbleFront(nativeHandle: Buffer): boolean
  setActivationPolicy(policy: number): boolean
}

export interface BubblePreloadApi {
  onUpdate(handler: (payload: BubbleUpdatePayload) => void): () => void
  triggerCommand(commandId: string, selectionId: string): Promise<{ ok: boolean; reason?: string; commandId?: string }>
  openMainWindow(): Promise<{ ok: boolean }>
  hideBubble(): Promise<{ ok: boolean }>
  dismissTopmost(): Promise<{ ok: boolean }>
  moveBubble(deltaX: number, deltaY: number): void
  resizeBubble(width: number): void
  setBubbleDragging(isDragging: boolean): void
  notifyBubbleInteraction(): void
  getPickedInfo(): Promise<PickedInfo | null>
  getGlobalEnabled(): Promise<{ isEnabled: boolean }>
  setGlobalEnabled(enabled: boolean): Promise<{ ok: boolean }>
  getBlockApps(): Promise<{ apps: string[] }>
  addBlockApp(bundleId: string): Promise<{ ok: boolean }>
  removeBlockApp(bundleId: string): Promise<{ ok: boolean }>
  getSkills(): Promise<{ skills: SelectionSkill[] }>
}
