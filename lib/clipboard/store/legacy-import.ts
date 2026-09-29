// One-off import of the pre-redesign history (userData/clipboard-history.sqlite), spec §5.3.
// Rows go through the normal record builder + ingest path, so the result is indistinguishable from new captures.
import { existsSync, renameSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { pathToFileURL } from 'node:url'
import { buildIngestRecord, extractCandidate } from '@/lib/clipboard/capture/normalize'
import { UTI_FILE_URL, UTI_PNG, UTI_TEXT_UTF8 } from '@/lib/clipboard/capture/pasteboard-types'
import { ClipDatabase, type ClipLogFn } from '@/lib/clipboard/store/clip-database'
import { parsePngSize } from '@/lib/clipboard/store/png'
import type { NativePasteboardItem } from '@/lib/native/macos-addon'

const LEGACY_PAGE_SIZE = 50
const DEFAULT_PINBOARD_NAME = '已收藏'
const DEFAULT_PINBOARD_COLOR = 'yellow'

type LegacyRow = {
  id: string
  kind: string
  primary_value: string | null
  text_content: string | null
  html_content: string | null
  file_paths_json: string | null
  payload_json: string | null
  image_png: Uint8Array | null
  source_app_name: string | null
  source_bundle_id: string | null
  copied_at: number
  created_at: number
  last_pasted_at: number | null
  copy_count: number
  is_pinned: number
}

export type LegacyImportResult = { imported: number; merged: number; skipped: number; pinned: number }

const parsePayload = (payloadJson: string | null): NativePasteboardItem[] => {
  if (!payloadJson) {
    return []
  }

  try {
    const parsed = JSON.parse(payloadJson) as Array<{ types?: Array<{ type: string; data: string }> }>
    return parsed.map((item) => ({
      representations: (item.types ?? []).map((entry) => ({
        type: entry.type,
        data: Buffer.from(entry.data, 'base64'),
      })),
    }))
  } catch {
    return []
  }
}

const parsePaths = (json: string | null): string[] => {
  try {
    const parsed = JSON.parse(json ?? '[]') as unknown
    return Array.isArray(parsed) ? parsed.filter((path): path is string => typeof path === 'string') : []
  } catch {
    return []
  }
}

const buildLegacyItems = (row: LegacyRow, filePaths: string[]): NativePasteboardItem[] => {
  const items = parsePayload(row.payload_json)
  const hasType = (type: string) => items.some((item) => item.representations.some((rep) => rep.type === type))

  if (row.kind === 'file') {
    // The old payload may not carry every path (some were recovered from plain text); add the missing ones.
    const known = new Set(extractCandidate(items).filePaths)
    for (const path of filePaths.filter((entry) => !known.has(entry))) {
      items.push({ representations: [{ type: UTI_FILE_URL, data: Buffer.from(pathToFileURL(path).href, 'utf8') }] })
    }
  }

  if (row.kind === 'image' && row.image_png && row.image_png.length > 0 && !hasType(UTI_PNG)) {
    const png = Buffer.from(row.image_png)
    if (items.length === 0) {
      items.push({ representations: [] })
    }
    items[0]?.representations.push({ type: UTI_PNG, data: png })
  }

  const text = row.text_content?.trim() || row.primary_value?.trim()
  if (text && !hasType(UTI_TEXT_UTF8) && row.kind !== 'image' && row.kind !== 'file') {
    if (items.length === 0) {
      items.push({ representations: [] })
    }
    items[0]?.representations.push({ type: UTI_TEXT_UTF8, data: Buffer.from(text, 'utf8') })
  }

  return items
}

const backupPath = (path: string) => {
  let candidate = `${path}.bak`
  if (existsSync(candidate)) {
    candidate = `${path}.${Date.now()}.bak`
  }
  return candidate
}

/** Returns null when there is nothing to import. Renames the old database to `.bak` when finished. */
export const importLegacyDatabase = async (
  clip: ClipDatabase,
  legacyPath: string,
  log: ClipLogFn
): Promise<LegacyImportResult | null> => {
  if (!existsSync(legacyPath)) {
    return null
  }

  const started = performance.now()
  const result: LegacyImportResult = { imported: 0, merged: 0, skipped: 0, pinned: 0 }
  let legacy: DatabaseSync | null = null

  try {
    legacy = new DatabaseSync(legacyPath)
    const select = legacy.prepare(
      `SELECT id, kind, primary_value, text_content, html_content, file_paths_json, payload_json, image_png,
              source_app_name, source_bundle_id, copied_at, created_at, last_pasted_at, copy_count, is_pinned
       FROM clipboard_history ORDER BY copied_at ASC LIMIT ? OFFSET ?`
    )

    let pinboardId: string | null = null
    for (let offset = 0; ; offset += LEGACY_PAGE_SIZE) {
      const rows = select.all(LEGACY_PAGE_SIZE, offset) as LegacyRow[]
      if (rows.length === 0) {
        break
      }

      for (const row of rows) {
        const filePaths = parsePaths(row.file_paths_json)
        const items = buildLegacyItems(row, filePaths)
        const png = row.image_png && row.image_png.length > 0 ? Buffer.from(row.image_png) : null
        const built = await buildIngestRecord(extractCandidate(items), {
          copiedAt: row.copied_at,
          source: row.source_bundle_id
            ? { bundleId: row.source_bundle_id, name: row.source_app_name || row.source_bundle_id }
            : undefined,
          isRemote: false,
          maxBytes: Number.MAX_SAFE_INTEGER,
          decodeImage: async (reps) => {
            const rep = reps.find((entry) => entry.type === UTI_PNG)
            const data = rep?.data ?? png
            const size = data ? parsePngSize(data) : null
            return data && size
              ? { png: data, width: size.width, height: size.height, itemIndex: rep?.itemIndex ?? 0 }
              : null
          },
        })

        if (!built.ok) {
          result.skipped += 1
          continue
        }

        const outcome = clip.ingest(built.record)
        if (outcome.status === 'inserted') {
          result.imported += 1
          clip.applyImportedStats(outcome.id, {
            createdAt: row.created_at,
            copyCount: row.copy_count,
            lastUsedAt: row.last_pasted_at ?? undefined,
          })
          if (built.record.kind === 'text' || built.record.kind === 'link') {
            clip.enqueueJob(outcome.id, 'local_tags')
          }
        } else {
          result.merged += 1
        }

        if (row.is_pinned === 1) {
          pinboardId ??= clip.ensurePinboard(DEFAULT_PINBOARD_NAME, DEFAULT_PINBOARD_COLOR).id
          clip.addToPinboard(pinboardId, [outcome.id])
          result.pinned += 1
        }
      }
    }

    legacy.close()
    legacy = null
    for (const suffix of ['', '-wal', '-shm', '-journal']) {
      const source = `${legacyPath}${suffix}`
      if (existsSync(source)) {
        renameSync(source, backupPath(source))
      }
    }

    log('info', '[clip-store] legacy history imported', { ...result, ms: Math.round(performance.now() - started) })
    return result
  } catch (error) {
    log('error', '[clip-store] legacy import failed', { ...result, error: String(error) })
    try {
      legacy?.close()
    } catch {
      // Already closed.
    }

    // Keep the data but stop retrying on every start; ingest dedupes, so a manual retry is safe.
    try {
      renameSync(legacyPath, `${legacyPath}.failed.bak`)
    } catch {
      // Leave the file where it is.
    }
    return result
  }
}
