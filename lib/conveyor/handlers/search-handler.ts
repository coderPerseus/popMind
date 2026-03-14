import { handle } from '@/lib/main/shared'
import { searchHistoryService } from '@/lib/search-history/service'
import type { HistoryDataType, SearchHistoryRecordInput } from '@/lib/search-history/types'

export const registerSearchHandlers = () => {
  handle('search-history-record', (input: SearchHistoryRecordInput) => searchHistoryService.record(input))
  handle('search-history-summary', (type?: HistoryDataType) => searchHistoryService.getSummary(type))
  handle('search-history-list', (type: HistoryDataType, limit?: number) => searchHistoryService.listHistory(type, limit))
  handle('search-history-export', (type?: HistoryDataType) => searchHistoryService.exportHistory(type))
  handle('search-history-clear', (type?: HistoryDataType) => searchHistoryService.clearHistory(type))
}
