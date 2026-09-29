// Write-back: puts stored clipboard items (back) on the system pasteboard. Spec §5.5.
// Payload composition is pure and lives in compose.ts; this file adds the store, native and filesystem parts.
import { copyFile, mkdir, readdir, stat, unlink, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { clipboardNative } from '@/lib/clipboard/native-bridge'
import { clipStore } from '@/lib/clipboard/store'
import type { ClipWritePayload } from '@/lib/clipboard/store/contract'
import type { ClipPasteMode, ClipWriteResult } from '@/lib/clipboard/types'
import { mainLogger } from '@/lib/main/logger'
import { composeWriteItems, resolvePlainTextMode } from './compose'
import { getClipboardSettings } from './settings'

const TEMP_IMAGE_DIR = join(tmpdir(), 'popmind-clipboard')
const TEMP_IMAGE_MAX_AGE_MS = 60 * 60 * 1000
const TEMP_IMAGE_SWEEP_INTERVAL_MS = 15 * 60 * 1000

/** Copies the stored PNG to a temp file and returns its `file://` URL (terminals paste images by path). */
const ensureTempImage = async (payload: ClipWritePayload): Promise<string | undefined> => {
  if (payload.kind !== 'image' || !payload.imagePath) return undefined

  try {
    await mkdir(TEMP_IMAGE_DIR, { recursive: true })
    const destination = join(TEMP_IMAGE_DIR, `${payload.id}.png`)
    await copyFile(payload.imagePath, destination)
    const now = new Date()
    await utimes(destination, now, now)
    return pathToFileURL(destination).toString()
  } catch (error) {
    mainLogger.warn('[clip-paste] temp image copy failed', { id: payload.id, error: String(error) })
    return undefined
  }
}

export type WriteClipItemsOptions = {
  /** Marker written on the pasteboard. Defaults to the first item id (capture uses it to bump instead of re-adding). */
  marker?: string
}

export type WriteClipItemsResult = ClipWriteResult & { strategy?: string }

export const writeClipItems = async (
  ids: string[],
  mode: ClipPasteMode,
  options: WriteClipItemsOptions = {}
): Promise<WriteClipItemsResult> => {
  const startedAt = performance.now()
  const settings = getClipboardSettings()
  const plain = resolvePlainTextMode(mode, settings.alwaysPlainText)

  const loaded = await Promise.all(ids.map((id) => clipStore.getWritePayload(id)))
  const payloads = loaded.filter((payload): payload is ClipWritePayload => payload !== null)
  const loadMs = Math.round(performance.now() - startedAt)

  if (payloads.length === 0) {
    mainLogger.warn('[clip-paste] write: nothing found', { ids, loadMs })
    return { ok: false, reason: 'not_found' }
  }

  const imageUrls = new Map<string, string>()
  await Promise.all(
    payloads.map(async (payload) => {
      const url = await ensureTempImage(payload)
      if (url) imageUrls.set(payload.id, url)
    })
  )

  const composed = composeWriteItems(payloads, {
    plain,
    imageFileUrl: (payload) => imageUrls.get(payload.id),
  })

  if (composed.items.length === 0) {
    mainLogger.warn('[clip-paste] write: empty composition', { ids, strategy: composed.strategy })
    return { ok: false, reason: 'write_failed', strategy: composed.strategy }
  }

  const marker = options.marker ?? payloads[0].id
  const ok = clipboardNative.write(composed.items, marker)

  mainLogger.info('[clip-paste] write', {
    ok,
    ids: ids.length,
    found: payloads.length,
    mode,
    plain,
    strategy: composed.strategy,
    marker,
    pasteboardItems: composed.items.length,
    loadMs,
    totalMs: Math.round(performance.now() - startedAt),
  })

  return ok
    ? { ok: true, strategy: composed.strategy }
    : { ok: false, reason: 'write_failed', strategy: composed.strategy }
}

/** Removes temp image copies older than an hour. */
export const sweepTempImages = async (now = Date.now()) => {
  let names: string[]
  try {
    names = await readdir(TEMP_IMAGE_DIR)
  } catch {
    return 0
  }

  let removed = 0
  for (const name of names) {
    const filePath = join(TEMP_IMAGE_DIR, name)
    try {
      const info = await stat(filePath)
      if (now - info.mtimeMs > TEMP_IMAGE_MAX_AGE_MS) {
        await unlink(filePath)
        removed += 1
      }
    } catch {
      // Already gone or unreadable; nothing to clean.
    }
  }

  if (removed > 0) {
    mainLogger.info('[clip-paste] swept temp images', { removed })
  }
  return removed
}

let sweepTimer: NodeJS.Timeout | null = null

export const startTempImageSweeper = () => {
  if (sweepTimer) return
  void sweepTempImages()
  sweepTimer = setInterval(() => void sweepTempImages(), TEMP_IMAGE_SWEEP_INTERVAL_MS)
  sweepTimer.unref()
}

export const stopTempImageSweeper = () => {
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
}
