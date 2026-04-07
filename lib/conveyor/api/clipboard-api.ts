import { ConveyorApi } from '@/lib/preload/shared'
import type { ClipboardHistoryQueryInput } from '@/lib/clipboard/types'

export class ClipboardApi extends ConveyorApi {
  listHistory = (input?: ClipboardHistoryQueryInput) => this.invoke('clipboard-history-list', input)
  getHistoryEntry = (id: string) => this.invoke('clipboard-history-get', id)
  copyHistoryEntry = (id: string) => this.invoke('clipboard-history-copy', id)
  pasteHistoryEntry = (id: string) => this.invoke('clipboard-history-paste', id)
  deleteHistoryEntry = (id: string) => this.invoke('clipboard-history-delete', id)
  clearHistory = () => this.invoke('clipboard-history-clear')
  togglePinHistoryEntry = (id: string) => this.invoke('clipboard-history-toggle-pin', id)
}
