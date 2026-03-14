import { ConveyorApi } from '@/lib/preload/shared'
import type { HistoryDataType, SearchHistoryRecordInput } from '@/lib/search-history/types'

export class SearchApi extends ConveyorApi {
  recordHistory = (input: SearchHistoryRecordInput) => this.invoke('search-history-record', input)
  getHistorySummary = (type: HistoryDataType = 'search') => this.invoke('search-history-summary', type)
  listHistory = (type: HistoryDataType, limit?: number) => this.invoke('search-history-list', type, limit)
  exportHistory = (type: HistoryDataType = 'search') => this.invoke('search-history-export', type)
  clearHistory = (type: HistoryDataType = 'search') => this.invoke('search-history-clear', type)
}
