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
  SHIFT_ARROW: 'shift_arrow_select',
  SHIFT_MOUSE_CLICK: 'shift_mouse_click',
  CTRL_A: 'ctrl_a_select',
  MANUAL: 'manual_trigger',
  GESTURE_DISMISS: 'gesture_dismiss',
  OTHER_CLICK_DISMISS: 'other_click_dismiss',
  KEY_DISMISS: 'key_dismiss',
  WINDOW_FRAME_DISMISS: 'window_frame_dismiss',
} as const

export type SelectionSceneValue = (typeof SelectionScene)[keyof typeof SelectionScene]

export const DEFAULT_SCENE_ENABLE = {
  [SelectionScene.BOX_SELECT]: true,
  [SelectionScene.MULTI_CLICK]: true,
  [SelectionScene.SHIFT_ARROW]: true,
  [SelectionScene.SHIFT_MOUSE_CLICK]: true,
  [SelectionScene.CTRL_A]: true,
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
  HideBubble: 'textPicker:hideBubble',
  BubbleUpdate: 'bubble:update',
} as const

export const CHECK_DELAY_MS = 70
export const RETRY_DELAY_MS = 65
export const MAX_RETRIES = 2
export const KEYBOARD_CHECK_DELAY_MS = 150
export const TOOLBAR_WIDTH = 460
export const TOOLBAR_HEIGHT = 50
export const TOOLBAR_GAP = 10

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
  triggerCommand(commandId: string): Promise<{ ok: boolean; reason?: string; commandId?: string }>
  hideBubble(): Promise<{ ok: boolean }>
  getPickedInfo(): Promise<PickedInfo | null>
  getGlobalEnabled(): Promise<{ isEnabled: boolean }>
  setGlobalEnabled(enabled: boolean): Promise<{ ok: boolean }>
  getBlockApps(): Promise<{ apps: string[] }>
  addBlockApp(bundleId: string): Promise<{ ok: boolean }>
  removeBlockApp(bundleId: string): Promise<{ ok: boolean }>
  getSkills(): Promise<{ skills: SelectionSkill[] }>
}
