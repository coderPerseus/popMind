import { handle } from '@/lib/main/shared'
import { searchHistoryService } from '@/lib/search-history/service'
import type { SearchHistoryRecordInput } from '@/lib/search-history/types'

export const registerSearchHandlers = () => {
  handle('search-history-record', (input: SearchHistoryRecordInput) => searchHistoryService.record(input))
  handle('search-history-summary', () => searchHistoryService.getSummary())
  handle('search-history-export', () => searchHistoryService.exportHistory())
  handle('search-history-clear', () => searchHistoryService.clearHistory())
}
