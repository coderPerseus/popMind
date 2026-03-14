export type SearchHistoryEntryKind = 'plugin' | 'command'
export type HistoryDataType = 'search' | 'explain'

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
  lastActivityAt?: number
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

export type ExplainMessageSource = {
  title: string
  url: string
  snippet: string
  provider: string
}

export type ExplainHistoryMessage = {
  id: string
  role: 'user' | 'assistant'
  text: string
  createdAt: number
  sources?: ExplainMessageSource[]
  errorMessage?: string
}

export type ExplainHistoryRecordInput = {
  id: string
  selectionText: string
  messages: ExplainHistoryMessage[]
  aiProvider: string
  webSearchProvider?: string
  language: string
}

export type ExplainHistoryEntry = ExplainHistoryRecordInput & {
  id: string
  createdAt: number
  updatedAt: number
}

export type SearchHistoryListItem = SearchHistoryEntry
export type ExplainHistoryListItem = ExplainHistoryEntry
