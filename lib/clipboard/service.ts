import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { basename, dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, clipboard, nativeImage } from 'electron'
import { selectionBridge } from '@/lib/text-picker/native/selection-bridge'
import { mainLogger } from '@/lib/main/logger'
import type {
  ClipboardHistoryClearResult,
  ClipboardHistoryDeleteResult,
  ClipboardHistoryEntry,
  ClipboardHistoryFilter,
  ClipboardHistoryKind,
  ClipboardHistoryListItem,
  ClipboardHistoryListResult,
  ClipboardHistoryPasteResult,
  ClipboardHistoryPinResult,
  ClipboardHistoryQueryInput,
  ClipboardHistoryWriteResult,
} from '@/lib/clipboard/types'

const CLIPBOARD_POLL_MS = 550
const CLIPBOARD_HISTORY_MAX_COUNT = 240
const CLIPBOARD_HISTORY_RETENTION_DAYS = 90
const CLIPBOARD_HISTORY_RETENTION_MS = CLIPBOARD_HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000
const CLIPBOARD_MAX_PAYLOAD_BYTES = 10 * 1024 * 1024
const THUMBNAIL_SIZE = 160
const CLIPBOARD_TEXT_PREVIEW_MAX = 180
const CLIPBOARD_TITLE_MAX = 72

type ClipboardSerializedType = {
  type: string
  data: string
}

type ClipboardSerializedItem = {
  types: ClipboardSerializedType[]
}

type ClipboardNativeType = {
  type: string
  data: Buffer
}

type ClipboardNativeItem = {
  types: ClipboardNativeType[]
}

type ClipboardBinary = Buffer | Uint8Array

type ClipboardSnapshotRow = {
  id: string
  kind: ClipboardHistoryKind
  title: string
  preview_text: string
  primary_value: string | null
  text_content: string | null
  html_content: string | null
  file_paths_json: string | null
  payload_json: string
  image_png: ClipboardBinary | null
  thumbnail_png: ClipboardBinary | null
  image_width: number | null
  image_height: number | null
  source_app_name: string | null
  source_bundle_id: string | null
  source_app_pid: number | null
  searchable_text: string
  copied_at: number
  created_at: number
  updated_at: number
  last_pasted_at: number | null
  copy_count: number
  is_pinned: number
  character_count: number
  word_count: number
  bytes: number
}

type ClipboardRecordInput = {
  kind: ClipboardHistoryKind
  contentHash: string
  title: string
  previewText: string
  primaryValue?: string
  textContent?: string
  htmlContent?: string
  filePaths: string[]
  payloadJson: string
  imagePng?: Buffer
  thumbnailPng?: Buffer
  imageWidth?: number
  imageHeight?: number
  sourceAppName?: string
  sourceBundleId?: string
  sourceAppPid?: number
  searchableText: string
  characterCount: number
  wordCount: number
  bytes: number
}

const textTypes = ['public.utf8-plain-text', 'public.plain-text', 'text/plain', 'NSStringPboardType']
const htmlTypes = ['public.html', 'text/html']
const urlTypes = ['public.url', 'public.url-name', 'text/uri-list']
const fileUrlTypes = ['public.file-url', 'CorePasteboardFlavorType 0x6675726c']

const normalizeWhitespace = (value: string) => value.replace(/\s+/g, ' ').trim()

const trimForPreview = (value: string, max = CLIPBOARD_TEXT_PREVIEW_MAX) => {
  const normalized = normalizeWhitespace(value)
  if (normalized.length <= max) {
    return normalized
  }

  return `${normalized.slice(0, Math.max(0, max - 1)).trimEnd()}…`
}

const decodeClipboardBuffer = (buffer: Buffer) => {
  if (buffer.length === 0) {
    return ''
  }

  const utf8 = buffer.toString('utf8').replaceAll('\u0000', '').trim()
  if (utf8) {
    return utf8
  }

  const utf16 = buffer.toString('utf16le').replaceAll('\u0000', '').trim()
  return utf16
}

const splitUriCandidates = (value: string) => {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
}

const tryParseFilePath = (value: string) => {
  if (!value) {
    return null
  }

  if (value.startsWith('file://')) {
    try {
      return fileURLToPath(value)
    } catch {
      return null
    }
  }

  if (value.startsWith('/')) {
    return value
  }

  return null
}

const dedupe = <T>(values: T[]) => [...new Set(values)]

const isLikelyHttpUrl = (value: string) => /^https?:\/\/\S+$/i.test(value.trim())

const isLikelyColor = (value: string) => {
  const candidate = value.trim()
  return (
    /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(candidate) ||
    /^rgba?\([^)]+\)$/i.test(candidate) ||
    /^hsla?\([^)]+\)$/i.test(candidate)
  )
}

const countWords = (value: string) => {
  const matches = value.trim().match(/[^\s]+/g)
  return matches?.length ?? 0
}

const toBuffer = (value: ClipboardBinary | null | undefined) => {
  if (!value || value.length === 0) {
    return undefined
  }

  return Buffer.isBuffer(value) ? value : Buffer.from(value)
}

const toDataUrl = (buffer: ClipboardBinary | null | undefined, mime = 'image/png') => {
  const normalizedBuffer = toBuffer(buffer)
  if (!normalizedBuffer) {
    return undefined
  }

  return `data:${mime};base64,${normalizedBuffer.toString('base64')}`
}

const parseFilePaths = (items: ClipboardNativeItem[], textContent: string) => {
  const resolved: string[] = []

  for (const item of items) {
    for (const typeRecord of item.types) {
      if (![...fileUrlTypes, ...urlTypes, ...textTypes].includes(typeRecord.type)) {
        continue
      }

      const decoded = decodeClipboardBuffer(typeRecord.data)
      if (!decoded) {
        continue
      }

      for (const candidate of splitUriCandidates(decoded)) {
        const filePath = tryParseFilePath(candidate)
        if (filePath) {
          resolved.push(filePath)
        }
      }
    }
  }

  for (const candidate of splitUriCandidates(textContent)) {
    const filePath = tryParseFilePath(candidate)
    if (filePath) {
      resolved.push(filePath)
    }
  }

  return dedupe(resolved)
}

const serializeNativeItems = (items: ClipboardNativeItem[]) => {
  return JSON.stringify(
    items.map((item) => ({
      types: item.types.map((typeRecord) => ({
        type: typeRecord.type,
        data: typeRecord.data.toString('base64'),
      })),
    }))
  )
}

const deserializeNativeItems = (payloadJson: string): ClipboardNativeItem[] => {
  const parsed = JSON.parse(payloadJson) as ClipboardSerializedItem[]
  return parsed.map((item) => ({
    types: item.types.map((typeRecord) => ({
      type: typeRecord.type,
      data: Buffer.from(typeRecord.data, 'base64'),
    })),
  }))
}

const computeItemsHash = (items: ClipboardNativeItem[]) => {
  const hash = createHash('sha256')

  for (const item of items) {
    for (const typeRecord of item.types) {
      hash.update(typeRecord.type)
      hash.update(typeRecord.data)
    }
  }

  return hash.digest('hex')
}

const makeThumbnail = (buffer: Buffer) => {
  try {
    const image = nativeImage.createFromBuffer(buffer)
    if (image.isEmpty()) {
      return undefined
    }

    return image.resize({ width: THUMBNAIL_SIZE }).toPNG()
  } catch {
    return undefined
  }
}

const buildEntryTitle = (
  kind: ClipboardHistoryKind,
  options: {
    textContent: string
    filePaths: string[]
    imageWidth?: number
    imageHeight?: number
  }
) => {
  if (kind === 'image') {
    return `Image (${options.imageWidth ?? 0}×${options.imageHeight ?? 0})`
  }

  if (kind === 'file') {
    if (options.filePaths.length === 1) {
      return basename(options.filePaths[0] ?? 'File')
    }

    return `${options.filePaths.length} files`
  }

  return trimForPreview(options.textContent, CLIPBOARD_TITLE_MAX) || 'Clipboard Item'
}

const mapKindFilter = (filter: ClipboardHistoryFilter = 'all') => (filter === 'all' ? null : filter)

const escapeLike = (value: string) => value.replaceAll('\\', '\\\\').replaceAll('%', '\\%').replaceAll('_', '\\_')

const mapRowToListItem = (row: ClipboardSnapshotRow): ClipboardHistoryListItem => ({
  id: row.id,
  kind: row.kind,
  title: row.title,
  previewText: row.preview_text,
  primaryValue: row.primary_value ?? undefined,
  sourceApp:
    row.source_app_name || row.source_bundle_id || row.source_app_pid
      ? {
          name: row.source_app_name ?? undefined,
          bundleId: row.source_bundle_id ?? undefined,
          pid: row.source_app_pid ?? undefined,
        }
      : undefined,
  copiedAt: row.copied_at,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
  lastPastedAt: row.last_pasted_at ?? undefined,
  copyCount: row.copy_count,
  isPinned: Boolean(row.is_pinned),
  characterCount: row.character_count,
  wordCount: row.word_count,
  bytes: row.bytes,
  fileCount: JSON.parse(row.file_paths_json ?? '[]').length,
  image:
    row.image_width && row.image_height
      ? {
          width: row.image_width,
          height: row.image_height,
          thumbnailDataUrl: toDataUrl(row.thumbnail_png ?? row.image_png ?? undefined),
        }
      : undefined,
})

const mapRowToEntry = (row: ClipboardSnapshotRow): ClipboardHistoryEntry => ({
  ...mapRowToListItem(row),
  textContent: row.text_content ?? undefined,
  htmlContent: row.html_content ?? undefined,
  imageDataUrl: toDataUrl(row.image_png ?? undefined),
  filePaths: JSON.parse(row.file_paths_json ?? '[]') as string[],
})

const getClipboardSnapshotByElectron = (): ClipboardNativeItem[] => {
  const items: ClipboardNativeItem[] = []
  const typeRecords: ClipboardNativeType[] = []

  const text = clipboard.readText()
  if (text) {
    typeRecords.push({
      type: 'public.utf8-plain-text',
      data: Buffer.from(text, 'utf8'),
    })
  }

  const html = clipboard.readHTML()
  if (html) {
    typeRecords.push({
      type: 'public.html',
      data: Buffer.from(html, 'utf8'),
    })
  }

  const image = clipboard.readImage()
  if (!image.isEmpty()) {
    typeRecords.push({
      type: 'public.png',
      data: image.toPNG(),
    })
  }

  if (typeRecords.length > 0) {
    items.push({ types: typeRecords })
  }

  return items
}

const buildRecordInput = (
  items: ClipboardNativeItem[],
  sourceApp?: { name?: string; bundleId?: string; pid?: number }
): ClipboardRecordInput | null => {
  const textCandidates: string[] = []
  const htmlCandidates: string[] = []

  for (const item of items) {
    for (const typeRecord of item.types) {
      if (textTypes.includes(typeRecord.type)) {
        const decoded = decodeClipboardBuffer(typeRecord.data)
        if (decoded) {
          textCandidates.push(decoded)
        }
      }

      if (htmlTypes.includes(typeRecord.type)) {
        const decoded = decodeClipboardBuffer(typeRecord.data)
        if (decoded) {
          htmlCandidates.push(decoded)
        }
      }
    }
  }

  const textContent = textCandidates.find(Boolean) ?? clipboard.readText()
  const htmlContent = htmlCandidates.find(Boolean) ?? clipboard.readHTML()
  const filePaths = parseFilePaths(items, textContent)
  const image = clipboard.readImage()
  const imagePng = image.isEmpty() ? undefined : image.toPNG()
  const imageSize = image.isEmpty() ? undefined : image.getSize()
  const payloadJson = serializeNativeItems(items)
  const payloadBytes = Buffer.byteLength(payloadJson, 'utf8')

  if (payloadBytes === 0 || payloadBytes > CLIPBOARD_MAX_PAYLOAD_BYTES) {
    return null
  }

  const normalizedText = textContent.trim()
  const primaryValue =
    filePaths[0] ?? (isLikelyHttpUrl(normalizedText) || isLikelyColor(normalizedText) ? normalizedText : undefined)
  const kind: ClipboardHistoryKind = imagePng
    ? 'image'
    : filePaths.length > 0
      ? 'file'
      : isLikelyColor(normalizedText)
        ? 'color'
        : isLikelyHttpUrl(normalizedText)
          ? 'link'
          : 'text'

  if (!imagePng && !normalizedText && !htmlContent && filePaths.length === 0) {
    return null
  }

  const searchableParts = [
    normalizedText,
    filePaths.join(' '),
    sourceApp?.name ?? '',
    sourceApp?.bundleId ?? '',
    kind,
  ].filter(Boolean)

  return {
    kind,
    contentHash: computeItemsHash(items),
    title: buildEntryTitle(kind, {
      textContent: normalizedText,
      filePaths,
      imageWidth: imageSize?.width,
      imageHeight: imageSize?.height,
    }),
    previewText:
      kind === 'file'
        ? filePaths
            .slice(0, 2)
            .map((item) => basename(item))
            .join(' · ')
        : normalizedText
          ? trimForPreview(normalizedText)
          : kind === 'image'
            ? 'Image copied'
            : 'Clipboard item',
    primaryValue,
    textContent: normalizedText || undefined,
    htmlContent: htmlContent || undefined,
    filePaths,
    payloadJson,
    imagePng,
    thumbnailPng: imagePng ? makeThumbnail(imagePng) : undefined,
    imageWidth: imageSize?.width,
    imageHeight: imageSize?.height,
    sourceAppName: sourceApp?.name,
    sourceBundleId: sourceApp?.bundleId,
    sourceAppPid: sourceApp?.pid,
    searchableText: searchableParts.join(' ').toLowerCase(),
    characterCount: normalizedText.length,
    wordCount: countWords(normalizedText),
    bytes: payloadBytes,
  }
}

export class ClipboardHistoryService {
  private database: DatabaseSync | null = null
  private pollTimer: NodeJS.Timeout | null = null
  private lastChangeToken = ''
  private ignoredHashes = new Set<string>()
  private pasteTarget: { pid?: number; bundleId?: string; name?: string } | null = null

  private getDatabaseFilePath() {
    return join(app.getPath('userData'), 'clipboard-history.sqlite')
  }

  private ensureStorageDirectory() {
    mkdirSync(dirname(this.getDatabaseFilePath()), { recursive: true })
  }

  private initializeDatabase(database: DatabaseSync) {
    database.exec(`
      CREATE TABLE IF NOT EXISTS clipboard_history (
        id TEXT PRIMARY KEY,
        content_hash TEXT NOT NULL UNIQUE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        preview_text TEXT NOT NULL,
        primary_value TEXT,
        text_content TEXT,
        html_content TEXT,
        file_paths_json TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        image_png BLOB,
        thumbnail_png BLOB,
        image_width INTEGER,
        image_height INTEGER,
        source_app_name TEXT,
        source_bundle_id TEXT,
        source_app_pid INTEGER,
        searchable_text TEXT NOT NULL,
        copied_at INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_pasted_at INTEGER,
        copy_count INTEGER NOT NULL DEFAULT 1,
        is_pinned INTEGER NOT NULL DEFAULT 0,
        character_count INTEGER NOT NULL DEFAULT 0,
        word_count INTEGER NOT NULL DEFAULT 0,
        bytes INTEGER NOT NULL DEFAULT 0
      );

      CREATE INDEX IF NOT EXISTS idx_clipboard_history_copied_at ON clipboard_history(copied_at DESC);
      CREATE INDEX IF NOT EXISTS idx_clipboard_history_kind ON clipboard_history(kind);
      CREATE INDEX IF NOT EXISTS idx_clipboard_history_pinned ON clipboard_history(is_pinned DESC, copied_at DESC);
    `)
  }

  private getDatabase() {
    if (this.database) {
      return this.database
    }

    this.ensureStorageDirectory()
    this.database = new DatabaseSync(this.getDatabaseFilePath())
    this.initializeDatabase(this.database)
    this.cleanup()
    return this.database
  }

  private cleanup(database: DatabaseSync = this.getDatabase()) {
    const expiration = Date.now() - CLIPBOARD_HISTORY_RETENTION_MS
    database.prepare('DELETE FROM clipboard_history WHERE is_pinned = 0 AND copied_at < ?').run(expiration)

    const overflow = (
      database.prepare('SELECT COUNT(*) AS count FROM clipboard_history WHERE is_pinned = 0').get() as { count: number }
    ).count

    if (overflow > CLIPBOARD_HISTORY_MAX_COUNT) {
      const overage = overflow - CLIPBOARD_HISTORY_MAX_COUNT
      database
        .prepare(
          `
            DELETE FROM clipboard_history
            WHERE id IN (
              SELECT id
              FROM clipboard_history
              WHERE is_pinned = 0
              ORDER BY copied_at ASC
              LIMIT ?
            )
          `
        )
        .run(overage)
    }
  }

  private buildListQuery(input: ClipboardHistoryQueryInput) {
    const clauses = ['1 = 1']
    const params: Array<string | number> = []
    const normalizedQuery = input.query?.trim().toLowerCase() ?? ''
    const kindFilter = mapKindFilter(input.filter)

    if (kindFilter) {
      clauses.push('kind = ?')
      params.push(kindFilter)
    }

    if (normalizedQuery) {
      clauses.push("searchable_text LIKE ? ESCAPE '\\\\'")
      params.push(`%${escapeLike(normalizedQuery)}%`)
    }

    const limit = Math.max(1, Math.min(input.limit ?? 120, 240))
    params.push(limit)

    return {
      sql: `
        SELECT
          id,
          kind,
          title,
          preview_text,
          primary_value,
          text_content,
          html_content,
          file_paths_json,
          '' AS payload_json,
          NULL AS image_png,
          thumbnail_png,
          image_width,
          image_height,
          source_app_name,
          source_bundle_id,
          source_app_pid,
          searchable_text,
          copied_at,
          created_at,
          updated_at,
          last_pasted_at,
          copy_count,
          is_pinned,
          character_count,
          word_count,
          bytes
        FROM clipboard_history
        WHERE ${clauses.join(' AND ')}
        ORDER BY is_pinned DESC, copied_at DESC
        LIMIT ?
      `,
      params,
    }
  }

  private readRawSnapshot() {
    if (selectionBridge.isSupported && typeof selectionBridge.getClipboardSnapshot === 'function') {
      const items = selectionBridge.getClipboardSnapshot()
      if (items.length > 0) {
        return items
      }
    }

    return getClipboardSnapshotByElectron()
  }

  private recordSnapshot(record: ClipboardRecordInput) {
    const database = this.getDatabase()
    const existing = database
      .prepare('SELECT id, copy_count, is_pinned, created_at FROM clipboard_history WHERE content_hash = ?')
      .get(record.contentHash) as { id: string; copy_count: number; is_pinned: number; created_at: number } | undefined
    const now = Date.now()

    if (existing) {
      database
        .prepare(
          `
            UPDATE clipboard_history
            SET kind = ?,
                title = ?,
                preview_text = ?,
                primary_value = ?,
                text_content = ?,
                html_content = ?,
                file_paths_json = ?,
                payload_json = ?,
                image_png = ?,
                thumbnail_png = ?,
                image_width = ?,
                image_height = ?,
                source_app_name = ?,
                source_bundle_id = ?,
                source_app_pid = ?,
                searchable_text = ?,
                copied_at = ?,
                updated_at = ?,
                copy_count = ?,
                character_count = ?,
                word_count = ?,
                bytes = ?
            WHERE id = ?
          `
        )
        .run(
          record.kind,
          record.title,
          record.previewText,
          record.primaryValue ?? null,
          record.textContent ?? null,
          record.htmlContent ?? null,
          JSON.stringify(record.filePaths),
          record.payloadJson,
          record.imagePng ?? null,
          record.thumbnailPng ?? null,
          record.imageWidth ?? null,
          record.imageHeight ?? null,
          record.sourceAppName ?? null,
          record.sourceBundleId ?? null,
          record.sourceAppPid ?? null,
          record.searchableText,
          now,
          now,
          existing.copy_count + 1,
          record.characterCount,
          record.wordCount,
          record.bytes,
          existing.id
        )

      return existing.id
    }

    const id = randomUUID()
    database
      .prepare(
        `
          INSERT INTO clipboard_history (
            id,
            content_hash,
            kind,
            title,
            preview_text,
            primary_value,
            text_content,
            html_content,
            file_paths_json,
            payload_json,
            image_png,
            thumbnail_png,
            image_width,
            image_height,
            source_app_name,
            source_bundle_id,
            source_app_pid,
            searchable_text,
            copied_at,
            created_at,
            updated_at,
            last_pasted_at,
            copy_count,
            is_pinned,
            character_count,
            word_count,
            bytes
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
      )
      .run(
        id,
        record.contentHash,
        record.kind,
        record.title,
        record.previewText,
        record.primaryValue ?? null,
        record.textContent ?? null,
        record.htmlContent ?? null,
        JSON.stringify(record.filePaths),
        record.payloadJson,
        record.imagePng ?? null,
        record.thumbnailPng ?? null,
        record.imageWidth ?? null,
        record.imageHeight ?? null,
        record.sourceAppName ?? null,
        record.sourceBundleId ?? null,
        record.sourceAppPid ?? null,
        record.searchableText,
        now,
        now,
        now,
        null,
        1,
        0,
        record.characterCount,
        record.wordCount,
        record.bytes
      )

    return id
  }

  private writeRawSnapshot(payloadJson: string) {
    const items = deserializeNativeItems(payloadJson)
    const contentHash = computeItemsHash(items)
    this.ignoredHashes.add(contentHash)

    const cleanupIgnore = () => {
      this.ignoredHashes.delete(contentHash)
    }

    setTimeout(cleanupIgnore, 1800).unref()

    if (selectionBridge.isSupported && typeof selectionBridge.restoreClipboardSnapshot === 'function') {
      const ok = selectionBridge.restoreClipboardSnapshot(items)
      return ok
    }

    clipboard.clear()
    const plainText = items.flatMap((item) => item.types).find((typeRecord) => textTypes.includes(typeRecord.type))
    const html = items.flatMap((item) => item.types).find((typeRecord) => htmlTypes.includes(typeRecord.type))
    const png = items.flatMap((item) => item.types).find((typeRecord) => typeRecord.type === 'public.png')

    clipboard.write({
      text: plainText ? decodeClipboardBuffer(plainText.data) : '',
      html: html ? decodeClipboardBuffer(html.data) : '',
      image: png ? nativeImage.createFromBuffer(png.data) : nativeImage.createEmpty(),
    })

    return true
  }

  private pollClipboard = () => {
    try {
      const nativeChangeCount =
        selectionBridge.isSupported && typeof selectionBridge.getClipboardChangeCount === 'function'
          ? selectionBridge.getClipboardChangeCount()
          : -1
      const changeToken = nativeChangeCount >= 0 ? String(nativeChangeCount) : computeItemsHash(this.readRawSnapshot())

      if (!changeToken || changeToken === this.lastChangeToken) {
        return
      }

      const sourceApp = selectionBridge.isSupported ? selectionBridge.getFrontmostAppInfo() : null
      const items = this.readRawSnapshot()
      const contentHash = computeItemsHash(items)

      this.lastChangeToken = changeToken
      if (this.ignoredHashes.has(contentHash)) {
        return
      }

      const record = buildRecordInput(items, sourceApp ?? undefined)
      if (!record) {
        return
      }

      this.recordSnapshot(record)
      this.cleanup()
    } catch (error) {
      mainLogger.warn('[clipboard-history] poll failed', error)
    }
  }

  initialize() {
    this.getDatabase()

    if (this.pollTimer) {
      return
    }

    this.pollClipboard()
    this.pollTimer = setInterval(() => this.pollClipboard(), CLIPBOARD_POLL_MS)
    this.pollTimer.unref()
    mainLogger.info('[clipboard-history] initialized', {
      storagePath: this.getDatabaseFilePath(),
    })
  }

  dispose() {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  capturePasteTarget() {
    if (!selectionBridge.isSupported) {
      return
    }

    const frontmostApp = selectionBridge.getFrontmostAppInfo()
    if (!frontmostApp?.pid || frontmostApp.pid === process.pid || frontmostApp.name === app.getName()) {
      return
    }

    this.pasteTarget = {
      pid: frontmostApp.pid,
      bundleId: frontmostApp.bundleId,
      name: frontmostApp.name,
    }
  }

  listEntries(input: ClipboardHistoryQueryInput = {}): ClipboardHistoryListResult {
    const database = this.getDatabase()
    this.cleanup(database)
    const { sql, params } = this.buildListQuery(input)
    const rows = database.prepare(sql).all(...params) as ClipboardSnapshotRow[]

    return {
      items: rows.map(mapRowToListItem),
    }
  }

  getEntry(id: string) {
    const row = this.getDatabase()
      .prepare(
        `
          SELECT
            id,
            kind,
            title,
            preview_text,
            primary_value,
            text_content,
            html_content,
            file_paths_json,
            payload_json,
            image_png,
            thumbnail_png,
            image_width,
            image_height,
            source_app_name,
            source_bundle_id,
            source_app_pid,
            searchable_text,
            copied_at,
            created_at,
            updated_at,
            last_pasted_at,
            copy_count,
            is_pinned,
            character_count,
            word_count,
            bytes
          FROM clipboard_history
          WHERE id = ?
        `
      )
      .get(id) as ClipboardSnapshotRow | undefined

    return row ? mapRowToEntry(row) : null
  }

  copyEntry(id: string): ClipboardHistoryWriteResult {
    const row = this.getDatabase().prepare('SELECT payload_json FROM clipboard_history WHERE id = ?').get(id) as
      | { payload_json: string }
      | undefined

    if (!row) {
      return { ok: false, reason: 'not_found' }
    }

    const ok = this.writeRawSnapshot(row.payload_json)
    return ok ? { ok: true } : { ok: false, reason: 'write_failed' }
  }

  pasteEntry(id: string): ClipboardHistoryPasteResult {
    const row = this.getDatabase().prepare('SELECT payload_json FROM clipboard_history WHERE id = ?').get(id) as
      | { payload_json: string }
      | undefined

    if (!row) {
      return { ok: false, reason: 'not_found' }
    }

    const wrote = this.writeRawSnapshot(row.payload_json)
    if (!wrote) {
      return { ok: false, reason: 'write_failed' }
    }

    if (!selectionBridge.isSupported || typeof selectionBridge.activateAppAndPaste !== 'function') {
      return { ok: false, reason: 'unsupported' }
    }

    const targetPid = this.pasteTarget?.pid
    if (!targetPid) {
      return { ok: false, reason: 'no_target' }
    }

    const pasted = selectionBridge.activateAppAndPaste(targetPid)
    if (!pasted) {
      return { ok: false, reason: 'paste_failed' }
    }

    this.getDatabase().prepare('UPDATE clipboard_history SET last_pasted_at = ? WHERE id = ?').run(Date.now(), id)

    return { ok: true }
  }

  deleteEntry(id: string): ClipboardHistoryDeleteResult {
    const result = this.getDatabase().prepare('DELETE FROM clipboard_history WHERE id = ?').run(id)
    return {
      ok: true,
      deletedCount: Number(result.changes ?? 0),
    }
  }

  clearEntries(): ClipboardHistoryClearResult {
    const result = this.getDatabase().prepare('DELETE FROM clipboard_history').run()
    this.getDatabase().exec('VACUUM')

    return {
      ok: true,
      deletedCount: Number(result.changes ?? 0),
    }
  }

  togglePin(id: string): ClipboardHistoryPinResult {
    const row = this.getDatabase().prepare('SELECT is_pinned FROM clipboard_history WHERE id = ?').get(id) as
      | { is_pinned: number }
      | undefined

    if (!row) {
      return {
        ok: false,
        isPinned: false,
      }
    }

    const nextValue = row.is_pinned ? 0 : 1
    this.getDatabase()
      .prepare('UPDATE clipboard_history SET is_pinned = ?, updated_at = ? WHERE id = ?')
      .run(nextValue, Date.now(), id)

    return {
      ok: true,
      isPinned: Boolean(nextValue),
    }
  }
}

export const clipboardHistoryService = new ClipboardHistoryService()
