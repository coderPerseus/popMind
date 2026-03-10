export type SearchHistoryEntryKind = 'plugin' | 'command'

export type SearchHistoryMetadata = {
  pluginType?: string
  resultText?: string
  sourceLanguage?: string
  targetLanguage?: string
  detectedSourceLanguage?: string
  engineId?: string
}

export type SearchHistoryRecordInput = {
  kind: SearchHistoryEntryKind
  query: string
  actionId: string
  actionLabel: string
  metadata?: SearchHistoryMetadata
}

export type SearchHistoryEntry = SearchHistoryRecordInput & {
  id: string
  createdAt: number
}

export type SearchHistorySummary = {
  totalCount: number
  retentionDays: number
  lastSearchedAt?: number
  storagePath: string
}

export type SearchHistoryExportResult = {
  canceled: boolean
  filePath?: string
  count: number
}

export type SearchHistoryClearResult = {
  deletedCount: number
}
