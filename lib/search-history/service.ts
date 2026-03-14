import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { app, dialog } from 'electron'
import type {
  SearchHistoryClearResult,
  SearchHistoryEntry,
  ExplainHistoryEntry,
  ExplainHistoryRecordInput,
  SearchHistoryExportResult,
  HistoryDataType,
  SearchHistoryMetadata,
  SearchHistoryRecordInput,
  SearchHistorySummary,
} from './types'

const SEARCH_HISTORY_RETENTION_DAYS = 365
const SEARCH_HISTORY_RETENTION_MS = SEARCH_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000
const EXPLAIN_HISTORY_RETENTION_DAYS = 180
const EXPLAIN_HISTORY_RETENTION_MS = EXPLAIN_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000
const EXPLAIN_HISTORY_MAX_COUNT = 300

type SearchHistoryRow = {
  id: string
  kind: SearchHistoryEntry['kind']
  query: string
  action_id: string
  action_label: string
  metadata_json: string | null
  created_at: number
}

type SearchHistorySummaryRow = {
  total_count: number
  last_activity_at: number | null
}

type ExplainHistoryRow = {
  id: string
  selection_text: string
  messages_json: string
  ai_provider: string
  web_search_provider: string | null
  language: string
  created_at: number
  updated_at: number
}

const parseMetadata = (raw: string | null): SearchHistoryMetadata | undefined => {
  if (!raw) {
    return undefined
  }

  try {
    return JSON.parse(raw) as SearchHistoryMetadata
  } catch {
    return undefined
  }
}

const mapEntryRow = (row: SearchHistoryRow): SearchHistoryEntry => ({
  id: row.id,
  kind: row.kind,
  query: row.query,
  actionId: row.action_id,
  actionLabel: row.action_label,
  metadata: parseMetadata(row.metadata_json),
  createdAt: row.created_at,
})

const mapExplainRow = (row: ExplainHistoryRow): ExplainHistoryEntry => ({
  id: row.id,
  selectionText: row.selection_text,
  messages: JSON.parse(row.messages_json),
  aiProvider: row.ai_provider,
  webSearchProvider: row.web_search_provider ?? undefined,
  language: row.language,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
})

export class SearchHistoryService {
  private database: DatabaseSync | null = null

  private getDatabaseFilePath() {
    return join(app.getPath('userData'), 'search-history.sqlite')
  }

  private initializeDatabase(database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS search_history (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        query TEXT NOT NULL,
        action_id TEXT NOT NULL,
        action_label TEXT NOT NULL,
        metadata_json TEXT,
        created_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_search_history_created_at ON search_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_search_history_kind ON search_history(kind);

      CREATE TABLE IF NOT EXISTS explain_history (
        id TEXT PRIMARY KEY,
        selection_text TEXT NOT NULL,
        messages_json TEXT NOT NULL,
        ai_provider TEXT NOT NULL,
        web_search_provider TEXT,
        language TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE INDEX IF NOT EXISTS idx_explain_history_created_at ON explain_history(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_explain_history_updated_at ON explain_history(updated_at DESC);
    `)
  }

  private getDatabase() {
    if (this.database) {
      return this.database
    }

    const filePath = this.getDatabaseFilePath()
    this.ensureStorageDirectory()
    this.database = new DatabaseSync(filePath)
    this.initializeDatabase(this.database)
    this.cleanupExpiredEntries(this.database)
    return this.database
  }

  private cleanupExpiredEntries(database: DatabaseSync = this.getDatabase()) {
    const searchThreshold = Date.now() - SEARCH_HISTORY_RETENTION_MS
    const explainThreshold = Date.now() - EXPLAIN_HISTORY_RETENTION_MS

    database.prepare('DELETE FROM search_history WHERE created_at < ?').run(searchThreshold)
    database.prepare('DELETE FROM explain_history WHERE updated_at < ?').run(explainThreshold)
    const explainOverflow = (
      database.prepare('SELECT COUNT(*) AS count FROM explain_history').get() as { count: number }
    ).count

    if (explainOverflow > EXPLAIN_HISTORY_MAX_COUNT) {
      const overage = explainOverflow - EXPLAIN_HISTORY_MAX_COUNT
      database
        .prepare(
          `
          DELETE FROM explain_history
          WHERE id IN (
            SELECT id FROM explain_history
            ORDER BY updated_at ASC
            LIMIT ?
          )
        `
        )
        .run(overage)
    }
  }

  private ensureStorageDirectory() {
    mkdirSync(dirname(this.getDatabaseFilePath()), { recursive: true })
  }

  private readEntries() {
    const database = this.getDatabase()
    this.cleanupExpiredEntries(database)

    const rows = database
      .prepare(
        'SELECT id, kind, query, action_id, action_label, metadata_json, created_at FROM search_history ORDER BY created_at DESC',
      )
      .all() as SearchHistoryRow[]

    return rows.map(mapEntryRow)
  }

  private readExplainEntries(limit = 100) {
    const database = this.getDatabase()
    this.cleanupExpiredEntries(database)

    const rows = database
      .prepare(
        `
        SELECT id, selection_text, messages_json, ai_provider, web_search_provider, language, created_at, updated_at
        FROM explain_history
        ORDER BY updated_at DESC
        LIMIT ?
      `
      )
      .all(limit) as ExplainHistoryRow[]

    return rows.map(mapExplainRow)
  }

  getSummary(type: HistoryDataType = 'search'): SearchHistorySummary {
    const database = this.getDatabase()
    this.cleanupExpiredEntries(database)

    const row =
      type === 'search'
        ? (database
            .prepare('SELECT COUNT(*) AS total_count, MAX(created_at) AS last_activity_at FROM search_history')
            .get() as SearchHistorySummaryRow)
        : (database
            .prepare('SELECT COUNT(*) AS total_count, MAX(updated_at) AS last_activity_at FROM explain_history')
            .get() as SearchHistorySummaryRow)

    return {
      totalCount: Number(row.total_count ?? 0),
      retentionDays: type === 'search' ? SEARCH_HISTORY_RETENTION_DAYS : EXPLAIN_HISTORY_RETENTION_DAYS,
      lastActivityAt: row.last_activity_at ? Number(row.last_activity_at) : undefined,
      storagePath: this.getDatabaseFilePath(),
    }
  }

  async record(input: SearchHistoryRecordInput) {
    const query = input.query.trim()
    if (!query) {
      return this.getSummary()
    }

    const database = this.getDatabase()
    this.cleanupExpiredEntries(database)

    database
      .prepare(
        `
        INSERT INTO search_history (
          id,
          kind,
          query,
          action_id,
          action_label,
          metadata_json,
          created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `,
      )
      .run(
        randomUUID(),
        input.kind,
        query,
        input.actionId,
        input.actionLabel,
        input.metadata ? JSON.stringify(input.metadata) : null,
        Date.now(),
      )

    return this.getSummary('search')
  }

  async recordExplain(input: ExplainHistoryRecordInput) {
    const selectionText = input.selectionText.trim()
    if (!selectionText || input.messages.length === 0) {
      return this.getSummary('explain')
    }

    const database = this.getDatabase()
    this.cleanupExpiredEntries(database)
    const now = Date.now()

    database
      .prepare(
        `
        INSERT INTO explain_history (
          id,
          selection_text,
          messages_json,
          ai_provider,
          web_search_provider,
          language,
          created_at,
          updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          selection_text = excluded.selection_text,
          messages_json = excluded.messages_json,
          ai_provider = excluded.ai_provider,
          web_search_provider = excluded.web_search_provider,
          language = excluded.language,
          updated_at = excluded.updated_at
      `
      )
      .run(
        input.id,
        selectionText,
        JSON.stringify(input.messages),
        input.aiProvider,
        input.webSearchProvider ?? null,
        input.language,
        now,
        now,
      )

    this.cleanupExpiredEntries(database)
    return this.getSummary('explain')
  }

  listHistory(type: HistoryDataType, limit = 100) {
    return type === 'search' ? this.readEntries().slice(0, limit) : this.readExplainEntries(limit)
  }

  async exportHistory(type: HistoryDataType = 'search'): Promise<SearchHistoryExportResult> {
    this.getDatabase()

    const defaultPath = join(
      app.getPath('downloads'),
      `popmind-${type}-history-${new Date().toISOString().slice(0, 10)}.json`,
    )

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: type === 'search' ? '导出搜索历史' : '导出解释历史',
      defaultPath,
      filters: [
        { name: 'JSON', extensions: ['json'] },
      ],
    })

    if (canceled || !filePath) {
      return {
        canceled: true,
        count: 0,
      }
    }

    const entries = type === 'search' ? this.readEntries() : this.readExplainEntries(1000)

    await writeFile(
      filePath,
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          type,
          retentionDays: type === 'search' ? SEARCH_HISTORY_RETENTION_DAYS : EXPLAIN_HISTORY_RETENTION_DAYS,
          items: entries,
        },
        null,
        2,
      ),
      'utf-8',
    )

    return {
      canceled: false,
      filePath,
      count: entries.length,
    }
  }

  async clearHistory(type: HistoryDataType = 'search'): Promise<SearchHistoryClearResult> {
    const result =
      type === 'search'
        ? this.getDatabase().prepare('DELETE FROM search_history').run()
        : this.getDatabase().prepare('DELETE FROM explain_history').run()
    this.getDatabase().exec('VACUUM')

    return {
      deletedCount: Number(result.changes ?? 0),
    }
  }
}

export const searchHistoryService = new SearchHistoryService()
