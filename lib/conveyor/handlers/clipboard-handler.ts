import { handle } from '@/lib/main/shared'
import { clipboardHistoryService } from '@/lib/clipboard/service'

export const registerClipboardHandlers = () => {
  handle('clipboard-history-list', (input) => clipboardHistoryService.listEntries(input))
  handle('clipboard-history-get', (id: string) => clipboardHistoryService.getEntry(id))
  handle('clipboard-history-copy', (id: string) => clipboardHistoryService.copyEntry(id))
  handle('clipboard-history-paste', (id: string) => clipboardHistoryService.pasteEntry(id))
  handle('clipboard-history-delete', (id: string) => clipboardHistoryService.deleteEntry(id))
  handle('clipboard-history-clear', () => clipboardHistoryService.clearEntries())
  handle('clipboard-history-toggle-pin', (id: string) => clipboardHistoryService.togglePin(id))
}
