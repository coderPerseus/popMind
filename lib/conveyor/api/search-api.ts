import { ConveyorApi } from '@/lib/preload/shared'
import type { SearchHistoryRecordInput } from '@/lib/search-history/types'

export class SearchApi extends ConveyorApi {
  recordHistory = (input: SearchHistoryRecordInput) => this.invoke('search-history-record', input)
  getHistorySummary = () => this.invoke('search-history-summary')
  exportHistory = () => this.invoke('search-history-export')
  clearHistory = () => this.invoke('search-history-clear')
}
