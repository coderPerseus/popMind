// All clipboard database logic. Takes a DatabaseSync so it runs inside the store worker in production and can be
// instantiated directly in scripts. Synchronous by design: the worker is the only caller.
import { randomUUID } from 'node:crypto'
import { existsSync, rmSync, statSync } from 'node:fs'
import { basename } from 'node:path'
import type { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { buildTextIngestRecord, classifyText } from '@/lib/clipboard/capture/classify'
import { searchClips } from '@/lib/clipboard/search'
import type { ClipSearchContext } from '@/lib/clipboard/search'
import {
  BLOB_THRESHOLD_BYTES,
  BlobStore,
  IMAGE_UTIS,
  directoryBytes,
  extensionForUti,
  sweepHashedDirectory,
} from '@/lib/clipboard/store/blob-store'
import type {
  ClipAiCandidate,
  ClipAiCandidateQuery,
  ClipAssetKind,
  ClipEnrichJob,
  ClipEnrichTask,
  ClipIngestOutcome,
  ClipIngestRecord,
  ClipWritePayload,
} from '@/lib/clipboard/store/contract'
import { CLIP_SEARCH_BODY_MAX_CHARS } from '@/lib/clipboard/store/schema'
import { THUMB_EXTENSIONS, appIconPathFor, thumbBasePathFor, type ClipDirs } from '@/lib/clipboard/store/paths'
import {
  buildPreviewText,
  collapseWhitespace,
  deriveTitle,
  normalizeText,
  truncateText,
} from '@/lib/clipboard/store/text-utils'
import {
  CLIP_PROTOCOL,
  pinboardColors,
  type ClipDetail,
  type ClipKind,
  type ClipListItem,
  type ClipListResult,
  type ClipQuery,
  type ClipRetention,
  type ClipSourceApp,
  type ClipStats,
  type ClipSubKind,
  type Pinboard,
} from '@/lib/clipboard/types'
import type { NativePasteboardItem } from '@/lib/native/macos-addon'

export type ClipLogLevel = 'info' | 'warn' | 'error'
export type ClipLogFn = (level: ClipLogLevel, message: string, data?: Record<string, unknown>) => void

export type ClipDatabaseOptions = {
  dirs: ClipDirs
  log?: ClipLogFn
  now?: () => number
}

const MAX_ENRICH_ATTEMPTS = 3
const AI_TEXT_MAX_CHARS = 300
const DELETE_BATCH = 500
const FILE_NAMES_IN_LIST = 3
const DAY_MS = 24 * 60 * 60 * 1000
const HTML_COLUMN_MAX_CHARS = BLOB_THRESHOLD_BYTES

const RETENTION_MS: Record<ClipRetention, number | null> = {
  '1d': DAY_MS,
  '1w': 7 * DAY_MS,
  '1m': 30 * DAY_MS,
  '1y': 365 * DAY_MS,
  forever: null,
}

const LIST_COLUMNS = `
  i.id, i.kind, i.sub_kind, i.is_rich, i.custom_title, i.preview_text, substr(i.plain_text, 1, 200) AS text_head,
  i.url, i.color_value, i.file_count, i.image_width, i.image_height, i.image_blob_hash, i.byte_size, i.char_count,
  i.source_bundle_id, i.is_remote, i.created_at, i.last_copied_at, i.last_used_at, i.copy_count, i.use_count,
  (i.ocr_text IS NOT NULL AND length(i.ocr_text) > 0) AS has_ocr, a.name AS app_name, a.color AS app_color`

type Row = Record<string, unknown>

const placeholders = (count: number) => Array.from({ length: count }, () => '?').join(',')

const chunk = <T>(values: T[], size: number): T[][] => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size))
  }
  return chunks
}

const toBuffer = (value: Uint8Array): Buffer =>
  Buffer.isBuffer(value) ? value : Buffer.from(value.buffer, value.byteOffset, value.byteLength)

const asString = (value: unknown) => (typeof value === 'string' ? value : undefined)
const asNumber = (value: unknown) => (typeof value === 'number' ? value : undefined)

export class ClipDatabase {
  private readonly blobs: BlobStore
  private readonly log: ClipLogFn
  private readonly now: () => number
  private readonly undoTokens = new Map<string, string[]>()
  private transactionDepth = 0

  constructor(
    private readonly db: DatabaseSync,
    private readonly options: ClipDatabaseOptions
  ) {
    this.blobs = new BlobStore(options.dirs.blobDir)
    this.log = options.log ?? (() => {})
    this.now = options.now ?? Date.now
  }

  get dirs() {
    return this.options.dirs
  }

  /** Startup housekeeping: recover interrupted jobs and queue OCR for images that never got it. */
  onOpen() {
    const timestamp = this.now()
    this.db.prepare(`UPDATE enrich_jobs SET status = 'pending' WHERE status = 'running'`).run()
    const queued = this.db
      .prepare(
        `INSERT OR IGNORE INTO enrich_jobs (item_id, job, status, attempts, updated_at)
         SELECT id, 'ocr', 'pending', 0, ? FROM clip_items
         WHERE kind = 'image' AND deleted_at IS NULL AND ocr_status IN ('none', 'pending')`
      )
      .run(timestamp).changes
    this.db.prepare(`UPDATE clip_items SET ocr_status = 'pending' WHERE kind = 'image' AND ocr_status = 'none'`).run()
    this.log('info', '[clip-store] opened', { ocrBackfillQueued: Number(queued) })
  }

  // ---- helpers ----

  private transaction<T>(work: () => T): T {
    if (this.transactionDepth > 0) {
      return work()
    }

    this.db.exec('BEGIN IMMEDIATE')
    this.transactionDepth += 1
    try {
      const result = work()
      this.db.exec('COMMIT')
      return result
    } catch (error) {
      try {
        this.db.exec('ROLLBACK')
      } catch {
        // The connection may already have rolled back.
      }
      throw error
    } finally {
      this.transactionDepth -= 1
    }
  }

  private buildSearchContext(): ClipSearchContext {
    return {
      now: this.now(),
      apps: this.db.prepare('SELECT bundle_id AS bundleId, name FROM apps').all() as ClipSearchContext['apps'],
      pinboards: this.db.prepare('SELECT id, name FROM pinboards').all() as ClipSearchContext['pinboards'],
    }
  }

  // ---- search index ----

  /** Rewrites the clip_search row of one item (rowid = clip_items.rowid). */
  private syncSearchRow(rowid: number | bigint) {
    const row = this.db
      .prepare(
        `SELECT i.rowid AS rid, i.id, i.kind, i.custom_title, i.plain_text, i.url, i.color_value, i.file_count,
                i.image_width, i.image_height, i.ocr_text, i.tags, i.source_bundle_id, a.name AS app_name
         FROM clip_items i LEFT JOIN apps a ON a.bundle_id = i.source_bundle_id WHERE i.rowid = ?`
      )
      .get(rowid) as Row | undefined

    this.db.prepare('DELETE FROM clip_search WHERE rowid = ?').run(rowid)
    if (!row) {
      return
    }

    const filePaths = (
      this.db
        .prepare('SELECT path FROM clip_files WHERE item_id = ? ORDER BY position')
        .all(row['id'] as string) as Array<{
        path: string
      }>
    ).map((entry) => entry.path)
    const kind = row['kind'] as ClipKind
    const plainText = asString(row['plain_text'])
    const fileNames = filePaths.map((path) => basename(path))

    const title =
      asString(row['custom_title']) ||
      deriveTitle(kind, {
        plainText: plainText?.slice(0, 400),
        url: asString(row['url']),
        colorValue: asString(row['color_value']),
        filePaths,
        fileCount: asNumber(row['file_count']),
        imageWidth: asNumber(row['image_width']),
        imageHeight: asNumber(row['image_height']),
      })
    const body = truncateText([plainText ?? '', ...fileNames].filter(Boolean).join('\n'), CLIP_SEARCH_BODY_MAX_CHARS)
    const app = [asString(row['app_name']), asString(row['source_bundle_id'])].filter(Boolean).join(' ')

    this.db
      .prepare('INSERT INTO clip_search (rowid, title, body, ocr, tags, app, url) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(
        rowid,
        title,
        body,
        asString(row['ocr_text']) ?? '',
        asString(row['tags']) ?? '',
        app,
        asString(row['url']) ?? ''
      )
  }

  private syncSearchById(id: string) {
    const row = this.db.prepare('SELECT rowid AS rid FROM clip_items WHERE id = ?').get(id) as
      | { rid: number }
      | undefined
    if (row) {
      this.syncSearchRow(row.rid)
    }
  }

  /** Rebuilds the whole FTS table. Needed after VACUUM, which may renumber implicit rowids. */
  rebuildSearchIndex() {
    this.transaction(() => {
      this.db.exec('DELETE FROM clip_search')
      const rows = this.db.prepare('SELECT rowid AS rid FROM clip_items').all() as Array<{ rid: number }>
      for (const row of rows) {
        this.syncSearchRow(row.rid)
      }
    })
  }

  // ---- ingest ----

  ingest(record: ClipIngestRecord): ClipIngestOutcome {
    const started = performance.now()
    const existing = this.db
      .prepare('SELECT id, rowid AS rid, is_rich, html FROM clip_items WHERE fingerprint = ?')
      .get(record.fingerprint) as { id: string; rid: number; is_rich: number; html: string | null } | undefined

    const outcome = existing ? this.bumpExisting(existing, record) : this.insertNew(record)
    this.log('info', '[clip-store] ingest', {
      status: outcome.status,
      kind: record.kind,
      bytes: record.byteSize,
      ms: Math.round(performance.now() - started),
    })
    return outcome
  }

  private storeRepresentation(rep: ClipIngestRecord['representations'][number]) {
    const data = toBuffer(rep.data)
    const spill = data.length > BLOB_THRESHOLD_BYTES || IMAGE_UTIS.has(rep.uti)
    if (spill) {
      const hash = this.blobs.write(data, extensionForUti(rep.uti))
      return { data: null, blobHash: hash, size: data.length }
    }

    return { data, blobHash: null, size: data.length }
  }

  private upsertSourceApp(source: { bundleId: string; name: string }) {
    this.db
      .prepare(
        `INSERT INTO apps (bundle_id, name, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(bundle_id) DO UPDATE SET
           name = CASE WHEN apps.name = apps.bundle_id THEN excluded.name ELSE apps.name END,
           updated_at = excluded.updated_at`
      )
      .run(source.bundleId, source.name || source.bundleId, this.now())
  }

  private insertNew(record: ClipIngestRecord): ClipIngestOutcome {
    const id = randomUUID()
    const imageHash = record.imagePng ? this.blobs.write(toBuffer(record.imagePng), 'png') : null
    const reps = record.representations.map((rep) => ({ rep, stored: this.storeRepresentation(rep) }))
    const isImage = record.kind === 'image'
    const html = record.html && record.html.length <= HTML_COLUMN_MAX_CHARS ? record.html : null
    const timestamp = this.now()

    this.transaction(() => {
      if (record.source?.bundleId) {
        this.upsertSourceApp(record.source)
      }

      const result = this.db
        .prepare(
          `INSERT INTO clip_items (
             id, kind, sub_kind, is_rich, fingerprint, preview_text, plain_text, html, url, color_value, file_count,
             image_width, image_height, image_blob_hash, byte_size, char_count, source_bundle_id, is_remote,
             created_at, last_copied_at, copy_count, use_count, ocr_status, tags
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`
        )
        .run(
          id,
          record.kind,
          record.subKind ?? null,
          record.isRich ? 1 : 0,
          record.fingerprint,
          record.previewText,
          record.plainText ?? null,
          html,
          record.url ?? null,
          record.colorValue ?? null,
          record.filePaths.length,
          record.imageWidth ?? null,
          record.imageHeight ?? null,
          imageHash,
          record.byteSize,
          record.charCount,
          record.source?.bundleId ?? null,
          record.isRemote ? 1 : 0,
          timestamp,
          record.copiedAt,
          isImage ? 'pending' : 'none',
          record.tags.join(' ')
        )

      const insertRep = this.db.prepare(
        `INSERT OR IGNORE INTO clip_representations (item_id, item_index, uti, data, blob_hash, byte_size)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      for (const { rep, stored } of reps) {
        insertRep.run(id, rep.itemIndex, rep.uti, stored.data, stored.blobHash, stored.size)
      }

      const insertFile = this.db.prepare('INSERT OR IGNORE INTO clip_files (item_id, position, path) VALUES (?, ?, ?)')
      record.filePaths.forEach((path, position) => insertFile.run(id, position, path))

      this.syncSearchRow(result.lastInsertRowid)

      if (isImage) {
        this.enqueueJob(id, 'thumbnail')
        this.enqueueJob(id, 'ocr')
      }
    })

    return { id, status: 'inserted' }
  }

  private bumpExisting(
    existing: { id: string; rid: number; is_rich: number; html: string | null },
    record: ClipIngestRecord
  ): ClipIngestOutcome {
    const reps = record.representations.map((rep) => ({ rep, stored: this.storeRepresentation(rep) }))

    this.transaction(() => {
      if (record.source?.bundleId) {
        this.upsertSourceApp(record.source)
      }

      this.db
        .prepare(
          `UPDATE clip_items SET last_copied_at = MAX(last_copied_at, ?), copy_count = copy_count + 1,
             deleted_at = NULL, is_remote = ?, source_bundle_id = COALESCE(?, source_bundle_id)
           WHERE id = ?`
        )
        .run(record.copiedAt, record.isRemote ? 1 : 0, record.source?.bundleId ?? null, existing.id)

      // A richer copy of the same content completes the stored representations.
      const insertRep = this.db.prepare(
        `INSERT OR IGNORE INTO clip_representations (item_id, item_index, uti, data, blob_hash, byte_size)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      for (const { rep, stored } of reps) {
        insertRep.run(existing.id, rep.itemIndex, rep.uti, stored.data, stored.blobHash, stored.size)
      }

      if (record.isRich && !existing.is_rich && record.kind === 'text') {
        const html = record.html && record.html.length <= HTML_COLUMN_MAX_CHARS ? record.html : null
        this.db.prepare('UPDATE clip_items SET is_rich = 1, html = ? WHERE id = ?').run(html, existing.id)
      }

      this.syncSearchRow(existing.rid)
    })

    return { id: existing.id, status: 'bumped' }
  }

  /** Legacy import: carries over the original creation time, copy counter and last paste time. */
  applyImportedStats(id: string, stats: { createdAt: number; copyCount: number; lastUsedAt?: number }) {
    this.db
      .prepare('UPDATE clip_items SET created_at = ?, copy_count = ?, last_used_at = ? WHERE id = ?')
      .run(stats.createdAt, Math.max(1, stats.copyCount), stats.lastUsedAt ?? null, id)
  }

  markUsed(id: string) {
    const timestamp = this.now()
    const changes = this.db
      .prepare(
        `UPDATE clip_items SET last_copied_at = ?, last_used_at = ?, use_count = use_count + 1
         WHERE id = ? AND deleted_at IS NULL`
      )
      .run(timestamp, timestamp, id).changes
    return Number(changes) > 0
  }

  // ---- read ----

  private loadListItems(ids: string[]): ClipListItem[] {
    if (ids.length === 0) {
      return []
    }

    const rows = new Map<string, Row>()
    const pinboardsByItem = new Map<string, string[]>()
    const filesByItem = new Map<string, string[]>()

    for (const group of chunk(ids, 400)) {
      const marks = placeholders(group.length)
      const found = this.db
        .prepare(
          `SELECT ${LIST_COLUMNS} FROM clip_items i LEFT JOIN apps a ON a.bundle_id = i.source_bundle_id
           WHERE i.id IN (${marks})`
        )
        .all(...group) as Row[]
      for (const row of found) {
        rows.set(row['id'] as string, row)
      }

      const pins = this.db
        .prepare(`SELECT item_id, pinboard_id FROM pinboard_items WHERE item_id IN (${marks}) ORDER BY added_at`)
        .all(...group) as Array<{ item_id: string; pinboard_id: string }>
      for (const pin of pins) {
        pinboardsByItem.set(pin.item_id, [...(pinboardsByItem.get(pin.item_id) ?? []), pin.pinboard_id])
      }

      const files = this.db
        .prepare(
          `SELECT item_id, path FROM clip_files WHERE item_id IN (${marks}) AND position < ? ORDER BY item_id, position`
        )
        .all(...group, FILE_NAMES_IN_LIST) as Array<{ item_id: string; path: string }>
      for (const file of files) {
        filesByItem.set(file.item_id, [...(filesByItem.get(file.item_id) ?? []), file.path])
      }
    }

    const items: ClipListItem[] = []
    for (const id of ids) {
      const row = rows.get(id)
      if (row) {
        items.push(this.mapListItem(row, pinboardsByItem.get(id) ?? [], filesByItem.get(id) ?? []))
      }
    }
    return items
  }

  private mapListItem(row: Row, pinboardIds: string[], filePaths: string[]): ClipListItem {
    const id = row['id'] as string
    const kind = row['kind'] as ClipKind
    const customTitle = asString(row['custom_title'])
    const bundleId = asString(row['source_bundle_id'])
    const imageWidth = asNumber(row['image_width'])
    const imageHeight = asNumber(row['image_height'])

    return {
      id,
      kind,
      subKind: (asString(row['sub_kind']) as ClipSubKind | undefined) ?? undefined,
      isRich: row['is_rich'] === 1,
      title:
        customTitle ||
        deriveTitle(kind, {
          plainText: asString(row['text_head']),
          url: asString(row['url']),
          colorValue: asString(row['color_value']),
          filePaths,
          fileCount: asNumber(row['file_count']),
          imageWidth,
          imageHeight,
        }),
      customTitle: customTitle || undefined,
      previewText: row['preview_text'] as string,
      url: asString(row['url']),
      colorValue: asString(row['color_value']),
      fileCount: (row['file_count'] as number) ?? 0,
      // basename, not split('/'): folder paths end with a slash.
      fileNames: kind === 'file' ? filePaths.map((path) => basename(path)) : undefined,
      imageWidth,
      imageHeight,
      byteSize: (row['byte_size'] as number) ?? 0,
      charCount: (row['char_count'] as number) ?? 0,
      source: bundleId
        ? {
            bundleId,
            name: asString(row['app_name']) ?? bundleId,
            color: asString(row['app_color']),
            iconUrl: `${CLIP_PROTOCOL}://app-icon/${encodeURIComponent(bundleId)}`,
          }
        : undefined,
      isRemote: row['is_remote'] === 1,
      createdAt: row['created_at'] as number,
      lastCopiedAt: row['last_copied_at'] as number,
      lastUsedAt: asNumber(row['last_used_at']),
      copyCount: (row['copy_count'] as number) ?? 1,
      useCount: (row['use_count'] as number) ?? 0,
      pinboardIds,
      hasOcrText: row['has_ocr'] === 1,
      thumbnailUrl: kind === 'image' ? `${CLIP_PROTOCOL}://thumb/${id}` : undefined,
    }
  }

  list(query: ClipQuery): ClipListResult {
    const started = performance.now()
    const page = searchClips(this.db, query, this.buildSearchContext())
    const items = this.loadListItems(page.hits.map((hit) => hit.id))
    const matches = new Map(page.hits.map((hit) => [hit.id, hit.match]))
    for (const item of items) {
      const match = matches.get(item.id)
      if (match) {
        item.match = match
      }
    }

    const tookMs = Math.round(performance.now() - started)
    this.log('info', '[clip-store] list', { returned: items.length, hasQuery: Boolean(query.text), tookMs })
    return { items, nextCursor: page.nextCursor, parsed: page.parsed, tookMs }
  }

  getItemsByIds(ids: string[]): ClipListItem[] {
    const alive = new Set<string>()
    for (const group of chunk(ids, 400)) {
      const found = this.db
        .prepare(`SELECT id FROM clip_items WHERE deleted_at IS NULL AND id IN (${placeholders(group.length)})`)
        .all(...group) as Array<{ id: string }>
      found.forEach((row) => alive.add(row.id))
    }
    return this.loadListItems(ids.filter((id) => alive.has(id)))
  }

  private loadFilePaths(id: string) {
    return (
      this.db.prepare('SELECT path FROM clip_files WHERE item_id = ? ORDER BY position').all(id) as Array<{
        path: string
      }>
    ).map((row) => row.path)
  }

  getDetail(id: string): ClipDetail | null {
    const row = this.db.prepare('SELECT id FROM clip_items WHERE id = ? AND deleted_at IS NULL').get(id) as
      | { id: string }
      | undefined
    if (!row) {
      return null
    }

    const [item] = this.loadListItems([id])
    if (!item) {
      return null
    }

    const full = this.db
      .prepare('SELECT plain_text, html, ocr_text, tags, image_blob_hash FROM clip_items WHERE id = ?')
      .get(id) as Row
    let html = asString(full['html'])
    const reps = this.db
      .prepare('SELECT uti, data, blob_hash FROM clip_representations WHERE item_id = ?')
      .all(id) as Array<{ uti: string; data: Uint8Array | null; blob_hash: string | null }>

    if (!html) {
      const htmlRep = reps.find((rep) => rep.uti === 'public.html')
      const data = htmlRep?.data ?? (htmlRep?.blob_hash ? this.blobs.read(htmlRep.blob_hash) : null)
      html = data ? toBuffer(data).toString('utf8') : undefined
    }

    const filePaths = this.loadFilePaths(id)
    return {
      ...item,
      plainText: asString(full['plain_text']) ?? (filePaths.length > 0 ? filePaths.join('\n') : undefined),
      html,
      hasRtf: reps.some((rep) => rep.uti === 'public.rtf' || rep.uti === 'com.apple.flat-rtfd'),
      filePaths,
      ocrText: asString(full['ocr_text']) || undefined,
      tags: (asString(full['tags']) ?? '').split(' ').filter(Boolean),
      imageUrl: full['image_blob_hash'] ? `${CLIP_PROTOCOL}://image/${id}` : undefined,
    }
  }

  getWritePayload(id: string): ClipWritePayload | null {
    const row = this.db
      .prepare('SELECT id, kind, plain_text, image_blob_hash FROM clip_items WHERE id = ? AND deleted_at IS NULL')
      .get(id) as Row | undefined
    if (!row) {
      return null
    }

    const kind = row['kind'] as ClipKind
    const filePaths = this.loadFilePaths(id)
    const reps = this.db
      .prepare(
        'SELECT item_index, uti, data, blob_hash FROM clip_representations WHERE item_id = ? ORDER BY item_index, rowid'
      )
      .all(id) as Array<{ item_index: number; uti: string; data: Uint8Array | null; blob_hash: string | null }>

    const grouped = new Map<number, NativePasteboardItem>()
    for (const rep of reps) {
      const data = rep.data ? toBuffer(rep.data) : rep.blob_hash ? this.blobs.read(rep.blob_hash) : null
      if (!data) {
        this.log('warn', '[clip-store] representation data missing', { id, uti: rep.uti })
        continue
      }

      const item = grouped.get(rep.item_index) ?? { representations: [] }
      item.representations.push({ type: rep.uti, data })
      grouped.set(rep.item_index, item)
    }

    let items = [...grouped.entries()].sort((left, right) => left[0] - right[0]).map((entry) => entry[1])
    const plainText = asString(row['plain_text'])

    if (items.length === 0) {
      // Every stored representation is unreadable: rebuild the minimum from the semantic columns.
      if (kind === 'file' && filePaths.length > 0) {
        items = filePaths.map((path) => ({
          representations: [{ type: 'public.file-url', data: Buffer.from(pathToFileURL(path).href, 'utf8') }],
        }))
      } else if (plainText) {
        items = [{ representations: [{ type: 'public.utf8-plain-text', data: Buffer.from(plainText, 'utf8') }] }]
      }
    }

    const imageHash = asString(row['image_blob_hash'])
    const imagePath = imageHash ? (this.blobs.find(imageHash) ?? undefined) : undefined

    return {
      id,
      kind,
      items,
      plainText: plainText ?? (filePaths.length > 0 ? filePaths.join('\n') : undefined),
      filePaths,
      imagePath,
    }
  }

  getAiCandidates(query: ClipAiCandidateQuery): ClipAiCandidate[] {
    const ordered: string[] = []
    const seen = new Set<string>()
    const push = (id: string) => {
      if (!seen.has(id) && ordered.length < query.maxTotal) {
        seen.add(id)
        ordered.push(id)
      }
    }

    const page = searchClips(
      this.db,
      { ...query.keywordQuery, cursor: undefined, limit: Math.min(query.keywordLimit, 200) },
      this.buildSearchContext()
    )
    page.hits.slice(0, query.keywordLimit).forEach((hit) => push(hit.id))

    const { recent } = query
    const where = ['deleted_at IS NULL']
    const params: Array<string | number> = []
    if (recent.kinds?.length) {
      where.push(`kind IN (${placeholders(recent.kinds.length)})`)
      params.push(...recent.kinds)
    }
    if (recent.appBundleIds?.length) {
      where.push(`source_bundle_id IN (${placeholders(recent.appBundleIds.length)})`)
      params.push(...recent.appBundleIds)
    }
    if (recent.from !== undefined) {
      where.push('last_copied_at >= ?')
      params.push(recent.from)
    }
    if (recent.to !== undefined) {
      where.push('last_copied_at < ?')
      params.push(recent.to)
    }

    const recentRows = this.db
      .prepare(`SELECT id FROM clip_items WHERE ${where.join(' AND ')} ORDER BY last_copied_at DESC LIMIT ?`)
      .all(...params, recent.limit) as Array<{ id: string }>
    recentRows.forEach((row) => push(row.id))

    const candidates = new Map<string, ClipAiCandidate>()
    for (const group of chunk(ordered, 400)) {
      const rows = this.db
        .prepare(
          `SELECT i.id, i.kind, i.custom_title, i.preview_text, substr(i.plain_text, 1, 600) AS text_head,
                  substr(i.ocr_text, 1, 600) AS ocr_head, i.url, i.last_copied_at, a.name AS app_name
           FROM clip_items i LEFT JOIN apps a ON a.bundle_id = i.source_bundle_id
           WHERE i.deleted_at IS NULL AND i.id IN (${placeholders(group.length)})`
        )
        .all(...group) as Row[]
      for (const row of rows) {
        const kind = row['kind'] as ClipKind
        const title = asString(row['custom_title']) ?? ''
        const body =
          asString(row['text_head']) ??
          asString(row['ocr_head']) ??
          asString(row['url']) ??
          asString(row['preview_text']) ??
          ''
        candidates.set(row['id'] as string, {
          id: row['id'] as string,
          kind,
          appName: asString(row['app_name']),
          lastCopiedAt: row['last_copied_at'] as number,
          text: truncateText(collapseWhitespace(`${title} ${body}`), AI_TEXT_MAX_CHARS),
        })
      }
    }

    return ordered.flatMap((id) => {
      const candidate = candidates.get(id)
      return candidate ? [candidate] : []
    })
  }

  listApps(): ClipSourceApp[] {
    const rows = this.db
      .prepare(
        `SELECT a.bundle_id, a.name, a.color FROM apps a
         JOIN clip_items i ON i.source_bundle_id = a.bundle_id AND i.deleted_at IS NULL
         GROUP BY a.bundle_id ORDER BY MAX(i.last_copied_at) DESC`
      )
      .all() as Array<{ bundle_id: string; name: string; color: string | null }>
    return rows.map((row) => ({
      bundleId: row.bundle_id,
      name: row.name,
      color: row.color ?? undefined,
      iconUrl: `${CLIP_PROTOCOL}://app-icon/${encodeURIComponent(row.bundle_id)}`,
    }))
  }

  stats(): ClipStats {
    const count = (sql: string) => Number((this.db.prepare(sql).get() as { count: number }).count)
    const fileSize = (path: string) => (existsSync(path) ? statSync(path).size : 0)
    const { dbPath } = this.options.dirs

    return {
      itemCount: count('SELECT COUNT(*) AS count FROM clip_items WHERE deleted_at IS NULL'),
      pinnedItemCount: count(
        `SELECT COUNT(DISTINCT pi.item_id) AS count FROM pinboard_items pi
         JOIN clip_items i ON i.id = pi.item_id WHERE i.deleted_at IS NULL`
      ),
      databaseBytes: fileSize(dbPath) + fileSize(`${dbPath}-wal`),
      blobBytes: directoryBytes(this.options.dirs.blobDir) + directoryBytes(this.options.dirs.thumbDir),
      ocrPending: count(`SELECT COUNT(*) AS count FROM clip_items WHERE ocr_status = 'pending' AND deleted_at IS NULL`),
    }
  }

  // ---- edit ----

  rename(id: string, title: string | null): ClipListItem | null {
    const customTitle = title?.trim() ? title.trim() : null
    const changes = this.db
      .prepare('UPDATE clip_items SET custom_title = ? WHERE id = ? AND deleted_at IS NULL')
      .run(customTitle, id).changes
    if (Number(changes) === 0) {
      return null
    }

    this.syncSearchById(id)
    return this.loadListItems([id])[0] ?? null
  }

  updateText(id: string, text: string): ClipListItem | null {
    const row = this.db
      .prepare('SELECT id, kind, fingerprint FROM clip_items WHERE id = ? AND deleted_at IS NULL')
      .get(id) as { id: string; kind: ClipKind; fingerprint: string } | undefined
    const normalized = normalizeText(text)
    if (!row || !['text', 'link', 'color'].includes(row.kind) || !normalized) {
      return null
    }

    const classification = classifyText(normalized)
    const orphanCandidates = this.representationHashes([id])

    this.transaction(() => {
      const other = this.db
        .prepare('SELECT id, copy_count FROM clip_items WHERE fingerprint = ? AND id <> ?')
        .get(classification.fingerprint, id) as { id: string; copy_count: number } | undefined

      if (other) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO pinboard_items (pinboard_id, item_id, sort_order, added_at)
             SELECT pinboard_id, ?, sort_order, added_at FROM pinboard_items WHERE item_id = ?`
          )
          .run(id, other.id)
        this.db.prepare('UPDATE clip_items SET copy_count = copy_count + ? WHERE id = ?').run(other.copy_count, id)
        this.deleteItemsHard([other.id], { removeFiles: false })
      }

      this.db.prepare('DELETE FROM clip_representations WHERE item_id = ?').run(id)
      this.db
        .prepare(
          'INSERT INTO clip_representations (item_id, item_index, uti, data, blob_hash, byte_size) VALUES (?, 0, ?, ?, NULL, ?)'
        )
        .run(id, 'public.utf8-plain-text', Buffer.from(normalized, 'utf8'), Buffer.byteLength(normalized))
      this.db
        .prepare(
          `UPDATE clip_items SET kind = ?, sub_kind = ?, is_rich = 0, fingerprint = ?, preview_text = ?, plain_text = ?,
             html = NULL, url = ?, color_value = ?, byte_size = ?, char_count = ?, tags = ? WHERE id = ?`
        )
        .run(
          classification.kind,
          classification.subKind ?? null,
          classification.fingerprint,
          buildPreviewText(classification.kind, {
            plainText: normalized,
            url: classification.url,
            colorValue: classification.colorValue,
          }),
          normalized,
          classification.url ?? null,
          classification.colorValue ?? null,
          Buffer.byteLength(normalized),
          normalized.length,
          classification.tags.join(' '),
          id
        )
      this.syncSearchById(id)
    })

    this.removeUnreferencedHashes(orphanCandidates)
    return this.loadListItems([id])[0] ?? null
  }

  createTextItem(text: string): ClipListItem {
    const normalized = normalizeText(text)
    if (!normalized) {
      throw new Error('empty text')
    }

    const outcome = this.ingest(buildTextIngestRecord(normalized, this.now()))
    const [item] = this.loadListItems([outcome.id])
    if (!item) {
      throw new Error('created item not found')
    }
    return item
  }

  softDelete(ids: string[]): { deletedIds: string[]; undoToken: string } {
    const deletedIds: string[] = []
    const timestamp = this.now()
    this.transaction(() => {
      const mark = this.db.prepare('UPDATE clip_items SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL')
      for (const id of ids) {
        if (Number(mark.run(timestamp, id).changes) > 0) {
          deletedIds.push(id)
        }
      }
    })

    const undoToken = randomUUID()
    this.undoTokens.set(undoToken, deletedIds)
    return { deletedIds, undoToken }
  }

  undoDelete(undoToken: string): string[] {
    const ids = this.undoTokens.get(undoToken)
    if (!ids) {
      return []
    }

    this.undoTokens.delete(undoToken)
    const restored: string[] = []
    this.transaction(() => {
      const restore = this.db.prepare('UPDATE clip_items SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL')
      for (const id of ids) {
        if (Number(restore.run(id).changes) > 0) {
          restored.push(id)
        }
      }
    })
    return restored
  }

  /** Hard-deletes items that were soft-deleted at least `olderThanMs` ago (0 = all of them). */
  purgeDeleted(olderThanMs: number): number {
    const cutoff = this.now() - olderThanMs
    const ids = (
      this.db
        .prepare('SELECT id FROM clip_items WHERE deleted_at IS NOT NULL AND deleted_at <= ?')
        .all(cutoff) as Array<{ id: string }>
    ).map((row) => row.id)
    const removed = this.deleteItemsHard(ids)
    if (removed > 0) {
      this.log('info', '[clip-store] purged soft-deleted items', { removed })
    }
    return removed
  }

  clearHistory(): number {
    const started = performance.now()
    const ids = (
      this.db.prepare('SELECT id FROM clip_items WHERE id NOT IN (SELECT item_id FROM pinboard_items)').all() as Array<{
        id: string
      }>
    ).map((row) => row.id)
    const removed = this.deleteItemsHard(ids)
    this.undoTokens.clear()
    this.sweepOrphanFiles()

    // VACUUM is reserved for this explicit action (spec §5.3); it can renumber rowids, so rebuild the FTS table.
    this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    this.db.exec('VACUUM')
    this.rebuildSearchIndex()
    this.log('info', '[clip-store] history cleared', { removed, ms: Math.round(performance.now() - started) })
    return removed
  }

  // ---- deletion + blob cleanup ----

  private representationHashes(ids: string[]): string[] {
    const hashes = new Set<string>()
    for (const group of chunk(ids, 400)) {
      const marks = placeholders(group.length)
      const reps = this.db
        .prepare(`SELECT blob_hash FROM clip_representations WHERE blob_hash IS NOT NULL AND item_id IN (${marks})`)
        .all(...group) as Array<{ blob_hash: string }>
      reps.forEach((rep) => hashes.add(rep.blob_hash))
      const images = this.db
        .prepare(`SELECT image_blob_hash FROM clip_items WHERE image_blob_hash IS NOT NULL AND id IN (${marks})`)
        .all(...group) as Array<{ image_blob_hash: string }>
      images.forEach((image) => hashes.add(image.image_blob_hash))
    }
    return [...hashes]
  }

  private isHashReferenced(hash: string) {
    return Boolean(
      this.db
        .prepare(
          `SELECT 1 AS found FROM clip_representations WHERE blob_hash = ?
           UNION ALL SELECT 1 FROM clip_items WHERE image_blob_hash = ? LIMIT 1`
        )
        .get(hash, hash)
    )
  }

  private removeUnreferencedHashes(hashes: string[]) {
    for (const hash of hashes) {
      if (this.isHashReferenced(hash)) {
        continue
      }

      this.blobs.remove(hash)
      for (const extension of THUMB_EXTENSIONS) {
        const thumb = `${thumbBasePathFor(this.options.dirs, hash)}.${extension}`
        try {
          rmSync(thumb, { force: true })
        } catch {
          // Thumbnail removal is best effort; the sweep collects leftovers.
        }
      }
    }
  }

  /** Deletes rows in batches of 500, then removes files nothing references any more. */
  private deleteItemsHard(ids: string[], options: { removeFiles?: boolean } = {}): number {
    let removed = 0
    const orphanCandidates = new Set<string>()

    for (const group of chunk(ids, DELETE_BATCH)) {
      const marks = placeholders(group.length)
      this.representationHashes(group).forEach((hash) => orphanCandidates.add(hash))
      this.transaction(() => {
        this.db
          .prepare(`DELETE FROM clip_search WHERE rowid IN (SELECT rowid FROM clip_items WHERE id IN (${marks}))`)
          .run(...group)
        removed += Number(this.db.prepare(`DELETE FROM clip_items WHERE id IN (${marks})`).run(...group).changes)
      })
    }

    if (options.removeFiles !== false) {
      this.removeUnreferencedHashes([...orphanCandidates])
    }
    return removed
  }

  private referencedHashes() {
    const referenced = new Set<string>()
    const reps = this.db
      .prepare('SELECT DISTINCT blob_hash FROM clip_representations WHERE blob_hash IS NOT NULL')
      .all() as Array<{ blob_hash: string }>
    reps.forEach((rep) => referenced.add(rep.blob_hash))
    const images = this.db
      .prepare('SELECT DISTINCT image_blob_hash FROM clip_items WHERE image_blob_hash IS NOT NULL')
      .all() as Array<{ image_blob_hash: string }>
    images.forEach((image) => referenced.add(image.image_blob_hash))
    return referenced
  }

  /** Removes blob / thumbnail files that no row references (crash leftovers, out-of-band deletes). */
  sweepOrphanFiles() {
    const referenced = this.referencedHashes()
    const blobs = this.blobs.sweep(referenced)
    const thumbs = sweepHashedDirectory(this.options.dirs.thumbDir, referenced)
    if (blobs.removed + thumbs.removed > 0) {
      this.log('info', '[clip-store] swept orphan files', { blobs: blobs.removed, thumbs: thumbs.removed })
    }
    return blobs.removed + thumbs.removed
  }

  // ---- retention ----

  runRetention(settings: { retention: ClipRetention; maxStorageMb: number }): { deletedCount: number } {
    const started = performance.now()
    let deletedCount = 0
    const ageMs = RETENTION_MS[settings.retention]

    if (ageMs !== null) {
      const cutoff = this.now() - ageMs
      for (;;) {
        const batch = (
          this.db
            .prepare(
              `SELECT id FROM clip_items WHERE deleted_at IS NULL AND last_copied_at < ?
               AND id NOT IN (SELECT item_id FROM pinboard_items) LIMIT ?`
            )
            .all(cutoff, DELETE_BATCH) as Array<{ id: string }>
        ).map((row) => row.id)
        if (batch.length === 0) {
          break
        }
        deletedCount += this.deleteItemsHard(batch)
      }
    }

    if (settings.maxStorageMb > 0) {
      const capBytes = settings.maxStorageMb * 1024 * 1024
      let total = Number(
        (this.db.prepare('SELECT COALESCE(SUM(byte_size), 0) AS total FROM clip_items').get() as { total: number })
          .total
      )
      while (total > capBytes) {
        const batch = this.db
          .prepare(
            `SELECT id, byte_size FROM clip_items WHERE id NOT IN (SELECT item_id FROM pinboard_items)
             ORDER BY last_copied_at ASC LIMIT 200`
          )
          .all() as Array<{ id: string; byte_size: number }>
        if (batch.length === 0) {
          break
        }

        const picked: string[] = []
        for (const entry of batch) {
          picked.push(entry.id)
          total -= entry.byte_size
          if (total <= capBytes) {
            break
          }
        }
        deletedCount += this.deleteItemsHard(picked)
      }
    }

    const orphans = this.sweepOrphanFiles()
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE)')
    this.log('info', '[clip-store] retention', {
      retention: settings.retention,
      maxStorageMb: settings.maxStorageMb,
      deletedCount,
      orphanFiles: orphans,
      ms: Math.round(performance.now() - started),
    })
    return { deletedCount }
  }

  // ---- pinboards ----

  private mapPinboard(row: Row): Pinboard {
    return {
      id: row['id'] as string,
      name: row['name'] as string,
      color: row['color'] as string,
      sortOrder: row['sort_order'] as number,
      itemCount: Number(row['item_count'] ?? 0),
    }
  }

  private readonly pinboardSelect = `
    SELECT p.id, p.name, p.color, p.sort_order,
      (SELECT COUNT(*) FROM pinboard_items pi JOIN clip_items ci ON ci.id = pi.item_id
        WHERE pi.pinboard_id = p.id AND ci.deleted_at IS NULL) AS item_count
    FROM pinboards p`

  listPinboards(): Pinboard[] {
    return (this.db.prepare(`${this.pinboardSelect} ORDER BY p.sort_order, p.created_at`).all() as Row[]).map((row) =>
      this.mapPinboard(row)
    )
  }

  private getPinboard(id: string): Pinboard | null {
    const row = this.db.prepare(`${this.pinboardSelect} WHERE p.id = ?`).get(id) as Row | undefined
    return row ? this.mapPinboard(row) : null
  }

  createPinboard(name: string, color: string): Pinboard {
    const id = randomUUID()
    const safeColor = (pinboardColors as readonly string[]).includes(color) ? color : 'gray'
    const next = Number(
      (this.db.prepare('SELECT COALESCE(MAX(sort_order), -1) + 1 AS next FROM pinboards').get() as { next: number })
        .next
    )
    this.db
      .prepare('INSERT INTO pinboards (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(id, name.trim() || 'Pinboard', safeColor, next, this.now())
    return this.getPinboard(id) as Pinboard
  }

  updatePinboard(id: string, patch: { name?: string; color?: string }): Pinboard | null {
    const current = this.getPinboard(id)
    if (!current) {
      return null
    }

    const name = patch.name?.trim() ? patch.name.trim() : current.name
    const color =
      patch.color && (pinboardColors as readonly string[]).includes(patch.color) ? patch.color : current.color
    this.db.prepare('UPDATE pinboards SET name = ?, color = ? WHERE id = ?').run(name, color, id)
    return this.getPinboard(id)
  }

  deletePinboard(id: string) {
    this.db.prepare('DELETE FROM pinboards WHERE id = ?').run(id)
  }

  reorderPinboards(ids: string[]) {
    this.transaction(() => {
      const update = this.db.prepare('UPDATE pinboards SET sort_order = ? WHERE id = ?')
      ids.forEach((id, index) => update.run(index, id))
    })
  }

  /** Newly added items go to the front (lowest sort_order); pinboard order is ascending sort_order. */
  addToPinboard(pinboardId: string, itemIds: string[]) {
    this.transaction(() => {
      const exists = this.db.prepare('SELECT 1 AS found FROM pinboards WHERE id = ?').get(pinboardId)
      if (!exists) {
        return
      }

      const minRow = this.db
        .prepare('SELECT COALESCE(MIN(sort_order), 0) AS min FROM pinboard_items WHERE pinboard_id = ?')
        .get(pinboardId) as { min: number }
      let next = Number(minRow.min)
      const timestamp = this.now()
      const insert = this.db.prepare(
        `INSERT OR IGNORE INTO pinboard_items (pinboard_id, item_id, sort_order, added_at)
         SELECT ?, id, ?, ? FROM clip_items WHERE id = ?`
      )
      for (const itemId of [...itemIds].reverse()) {
        next -= 1
        insert.run(pinboardId, next, timestamp, itemId)
      }
    })
  }

  removeFromPinboard(pinboardId: string, itemIds: string[]) {
    this.transaction(() => {
      const remove = this.db.prepare('DELETE FROM pinboard_items WHERE pinboard_id = ? AND item_id = ?')
      itemIds.forEach((itemId) => remove.run(pinboardId, itemId))
    })
  }

  reorderPinboardItems(pinboardId: string, itemIds: string[]) {
    this.transaction(() => {
      const update = this.db.prepare('UPDATE pinboard_items SET sort_order = ? WHERE pinboard_id = ? AND item_id = ?')
      itemIds.forEach((itemId, index) => update.run(index, pinboardId, itemId))
    })
  }

  /** Legacy import helper: finds or creates a pinboard by name. */
  ensurePinboard(name: string, color: string): Pinboard {
    const row = this.db.prepare('SELECT id FROM pinboards WHERE name = ? LIMIT 1').get(name) as
      | { id: string }
      | undefined
    return row ? (this.getPinboard(row.id) as Pinboard) : this.createPinboard(name, color)
  }

  // ---- apps ----

  upsertApp(app: { bundleId: string; name: string; iconPath?: string; color?: string }) {
    this.transaction(() => {
      this.db
        .prepare(
          `INSERT INTO apps (bundle_id, name, icon_path, color, updated_at) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(bundle_id) DO UPDATE SET
             name = CASE WHEN excluded.name = excluded.bundle_id THEN apps.name ELSE excluded.name END,
             icon_path = COALESCE(excluded.icon_path, apps.icon_path),
             color = COALESCE(excluded.color, apps.color), updated_at = excluded.updated_at`
        )
        .run(app.bundleId, app.name || app.bundleId, app.iconPath ?? null, app.color ?? null, this.now())

      const rows = this.db
        .prepare('SELECT rowid AS rid FROM clip_items WHERE source_bundle_id = ?')
        .all(app.bundleId) as Array<{ rid: number }>
      // Keep the searchable app column in sync with the (possibly corrected) name.
      if (rows.length > 0 && rows.length <= 2000) {
        rows.forEach((row) => this.syncSearchRow(row.rid))
      }
    })
  }

  // ---- enrichment ----

  enqueueJob(itemId: string, job: ClipEnrichJob) {
    this.db
      .prepare(
        `INSERT OR IGNORE INTO enrich_jobs (item_id, job, status, attempts, updated_at) VALUES (?, ?, 'pending', 0, ?)`
      )
      .run(itemId, job, this.now())
  }

  takeEnrichTasks(job: ClipEnrichJob, limit: number): ClipEnrichTask[] {
    const rows = this.db
      .prepare(
        `SELECT j.item_id, j.attempts, i.kind, i.image_blob_hash, substr(i.plain_text, 1, 20000) AS plain_text
         FROM enrich_jobs j JOIN clip_items i ON i.id = j.item_id
         WHERE j.job = ? AND j.status = 'pending' AND i.deleted_at IS NULL
         ORDER BY i.last_copied_at DESC LIMIT ?`
      )
      .all(job, limit) as Row[]

    const mark = this.db.prepare(
      `UPDATE enrich_jobs SET status = 'running', updated_at = ? WHERE item_id = ? AND job = ?`
    )
    const timestamp = this.now()
    return rows.map((row) => {
      mark.run(timestamp, row['item_id'] as string, job)
      const hash = asString(row['image_blob_hash'])
      return {
        itemId: row['item_id'] as string,
        job,
        attempts: row['attempts'] as number,
        kind: row['kind'] as ClipKind,
        imagePath: hash ? (this.blobs.find(hash) ?? undefined) : undefined,
        plainText: asString(row['plain_text']),
      }
    })
  }

  /**
   * OCR: `ocrText` undefined = skipped (too small / unsupported), a string (even empty) = recognized.
   * Tags are merged into the item's existing tags.
   */
  completeEnrichTask(
    itemId: string,
    job: ClipEnrichJob,
    result: { ok: true; ocrText?: string; tags?: string[] } | { ok: false; error: string }
  ) {
    const timestamp = this.now()
    this.transaction(() => {
      if (!result.ok) {
        const row = this.db
          .prepare('SELECT attempts FROM enrich_jobs WHERE item_id = ? AND job = ?')
          .get(itemId, job) as { attempts: number } | undefined
        const attempts = (row?.attempts ?? 0) + 1
        const exhausted = attempts >= MAX_ENRICH_ATTEMPTS
        this.db
          .prepare('UPDATE enrich_jobs SET status = ?, attempts = ?, updated_at = ? WHERE item_id = ? AND job = ?')
          .run(exhausted ? 'failed' : 'pending', attempts, timestamp, itemId, job)
        if (exhausted && job === 'ocr') {
          this.db.prepare(`UPDATE clip_items SET ocr_status = 'failed' WHERE id = ?`).run(itemId)
        }
        this.log('warn', '[clip-store] enrich task failed', { itemId, job, attempts, exhausted, error: result.error })
        return
      }

      this.db
        .prepare(`UPDATE enrich_jobs SET status = 'done', updated_at = ? WHERE item_id = ? AND job = ?`)
        .run(timestamp, itemId, job)

      let changed = false
      if (job === 'ocr') {
        if (result.ocrText === undefined) {
          this.db.prepare(`UPDATE clip_items SET ocr_status = 'skipped' WHERE id = ?`).run(itemId)
        } else {
          this.db
            .prepare(`UPDATE clip_items SET ocr_text = ?, ocr_status = 'done' WHERE id = ?`)
            .run(result.ocrText, itemId)
          changed = true
        }
      }

      if (result.tags && result.tags.length > 0) {
        const row = this.db.prepare('SELECT tags FROM clip_items WHERE id = ?').get(itemId) as
          | { tags: string | null }
          | undefined
        const merged = [...new Set([...(row?.tags ?? '').split(' ').filter(Boolean), ...result.tags])]
        this.db.prepare('UPDATE clip_items SET tags = ? WHERE id = ?').run(merged.join(' '), itemId)
        changed = true
      }

      if (job === 'local_tags') {
        this.db.prepare('UPDATE clip_items SET enrich_version = 1 WHERE id = ?').run(itemId)
      }

      if (changed) {
        this.syncSearchById(itemId)
      }
    })
  }

  // ---- assets ----

  resolveAsset(kind: ClipAssetKind, id: string): string | null {
    if (kind === 'app-icon') {
      const path = appIconPathFor(this.options.dirs, id)
      return existsSync(path) ? path : null
    }

    const row = this.db.prepare('SELECT image_blob_hash FROM clip_items WHERE id = ?').get(id) as
      | { image_blob_hash: string | null }
      | undefined
    const hash = row?.image_blob_hash
    if (!hash) {
      return null
    }

    if (kind === 'image') {
      return this.blobs.find(hash)
    }

    for (const extension of THUMB_EXTENSIONS) {
      const path = `${thumbBasePathFor(this.options.dirs, hash)}.${extension}`
      if (existsSync(path)) {
        return path
      }
    }
    return null
  }

  checkpoint() {
    this.db.exec('PRAGMA wal_checkpoint(PASSIVE)')
  }
}
