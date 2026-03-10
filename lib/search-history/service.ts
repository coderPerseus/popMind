import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { DatabaseSync } from 'node:sqlite'
import { dirname, join } from 'node:path'
import { app, dialog } from 'electron'
import type {
  SearchHistoryClearResult,
  SearchHistoryEntry,
  SearchHistoryExportResult,
  SearchHistoryMetadata,
  SearchHistoryRecordInput,
  SearchHistorySummary,
} from './types'

const SEARCH_HISTORY_RETENTION_DAYS = 365
const SEARCH_HISTORY_RETENTION_MS = SEARCH_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000

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
  last_searched_at: number | null
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
    const threshold = Date.now() - SEARCH_HISTORY_RETENTION_MS
    database.prepare('DELETE FROM search_history WHERE created_at < ?').run(threshold)
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

  getSummary(): SearchHistorySummary {
    const database = this.getDatabase()
    this.cleanupExpiredEntries(database)

    const row = database
      .prepare('SELECT COUNT(*) AS total_count, MAX(created_at) AS last_searched_at FROM search_history')
      .get() as SearchHistorySummaryRow

    return {
      totalCount: Number(row.total_count ?? 0),
      retentionDays: SEARCH_HISTORY_RETENTION_DAYS,
      lastSearchedAt: row.last_searched_at ? Number(row.last_searched_at) : undefined,
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

    return this.getSummary()
  }

  async exportHistory(): Promise<SearchHistoryExportResult> {
    this.getDatabase()

    const defaultPath = join(
      app.getPath('downloads'),
      `popmind-search-history-${new Date().toISOString().slice(0, 10)}.json`,
    )

    const { canceled, filePath } = await dialog.showSaveDialog({
      title: '导出搜索历史',
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

    const entries = this.readEntries()

    await writeFile(
      filePath,
      JSON.stringify(
        {
          exportedAt: new Date().toISOString(),
          retentionDays: SEARCH_HISTORY_RETENTION_DAYS,
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

  async clearHistory(): Promise<SearchHistoryClearResult> {
    const result = this.getDatabase().prepare('DELETE FROM search_history').run()
    this.getDatabase().exec('VACUUM')

    return {
      deletedCount: Number(result.changes ?? 0),
    }
  }
}

export const searchHistoryService = new SearchHistoryService()
