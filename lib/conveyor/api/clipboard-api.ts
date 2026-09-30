import { ConveyorApi } from '@/lib/preload/shared'
import { ClipboardChannel } from '@/lib/conveyor/schemas/clipboard-schema'
import type {
  ClipItemsChangedEvent,
  ClipPanelShowEvent,
  ClipPasteMode,
  ClipPasteStackState,
  ClipQuery,
  ClipboardSettings,
} from '@/lib/clipboard/types'

export class ClipboardApi extends ConveyorApi {
  list = (query: ClipQuery) => this.invoke('clip-list', query)
  getDetail = (id: string) => this.invoke('clip-get-detail', id)
  paste = (ids: string[], mode: ClipPasteMode = 'default') => this.invoke('clip-paste', ids, mode)
  copy = (ids: string[], mode: ClipPasteMode = 'default') => this.invoke('clip-copy', ids, mode)
  remove = (ids: string[]) => this.invoke('clip-delete', ids)
  undoDelete = (undoToken: string) => this.invoke('clip-undo-delete', undoToken)
  rename = (id: string, title: string | null) => this.invoke('clip-rename', id, title)
  updateText = (id: string, text: string) => this.invoke('clip-update-text', id, text)
  createText = (text: string) => this.invoke('clip-create-text', text)
  open = (id: string) => this.invoke('clip-open', id)
  reveal = (id: string) => this.invoke('clip-reveal', id)
  startDrag = (id: string) => this.invoke('clip-start-drag', id)
  listPinboards = () => this.invoke('clip-pinboards-list')
  createPinboard = (name: string, color: string) => this.invoke('clip-pinboard-create', name, color)
  updatePinboard = (id: string, patch: { name?: string; color?: string }) =>
    this.invoke('clip-pinboard-update', id, patch)
  deletePinboard = (id: string) => this.invoke('clip-pinboard-delete', id)
  reorderPinboards = (ids: string[]) => this.invoke('clip-pinboards-reorder', ids)
  addToPinboard = (pinboardId: string, itemIds: string[]) => this.invoke('clip-pinboard-add', pinboardId, itemIds)
  removeFromPinboard = (pinboardId: string, itemIds: string[]) =>
    this.invoke('clip-pinboard-remove', pinboardId, itemIds)
  reorderPinboardItems = (pinboardId: string, itemIds: string[]) =>
    this.invoke('clip-pinboard-reorder-items', pinboardId, itemIds)
  listApps = () => this.invoke('clip-list-apps')
  aiSearch = (text: string, filters: Pick<ClipQuery, 'kinds' | 'appBundleIds' | 'dateRange' | 'scope'>) =>
    this.invoke('clip-ai-search', { text, filters })
  aiCancel = () => this.invoke('clip-ai-cancel')
  aiTest = (settings: ClipboardSettings['ai']) => this.invoke('clip-ai-test', settings)
  stats = () => this.invoke('clip-stats')
  clearHistory = () => this.invoke('clip-clear-history')
  showPanel = (initialQuery?: string) => this.invoke('clip-panel-show', initialQuery)
  hidePanel = () => this.invoke('clip-panel-hide')
  setPanelHeight = (height: number) => this.invoke('clip-panel-set-height', height)
  togglePasteStack = () => this.invoke('clip-paste-stack-toggle')
  getPasteStack = () => this.invoke('clip-paste-stack-state')
  permissionStatus = () => this.invoke('clip-permission-status')
  openAccessibilitySettings = () => this.invoke('clip-open-accessibility-settings')

  onItemsChanged = (handler: (event: ClipItemsChangedEvent) => void) =>
    this.subscribe<ClipItemsChangedEvent>(ClipboardChannel.ItemsChanged, handler)
  onPanelShow = (handler: (event: ClipPanelShowEvent) => void) =>
    this.subscribe<ClipPanelShowEvent>(ClipboardChannel.PanelShow, handler)
  onPanelRequestHide = (handler: () => void) => this.subscribe<void>(ClipboardChannel.PanelRequestHide, handler)
  onPasteStack = (handler: (state: ClipPasteStackState) => void) =>
    this.subscribe<ClipPasteStackState>(ClipboardChannel.PasteStack, handler)

  private subscribe<T>(channel: string, handler: (payload: T) => void) {
    const listener = (_event: Electron.IpcRendererEvent, payload: T) => handler(payload)
    this.renderer.on(channel, listener)
    return () => {
      this.renderer.removeListener(channel, listener)
    }
  }
}
