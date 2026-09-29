// Public entry of capture + enrichment.
import { ClipboardWatcher } from '@/lib/clipboard/capture/watcher'
import { ensureAppMeta } from '@/lib/clipboard/enrich/app-meta'
import { enrichQueue } from '@/lib/clipboard/enrich/queue'
import { ensureThumbnail } from '@/lib/clipboard/enrich/thumbnail'
import { clipStore } from '@/lib/clipboard/store'
import type { ClipAssetKind } from '@/lib/clipboard/store/contract'
import type { ClipboardSettings } from '@/lib/clipboard/types'
import { mainLogger } from '@/lib/main/logger'

export type ClipCaptureDeps = {
  getSettings: () => ClipboardSettings
}

const watcher = new ClipboardWatcher()

/** Starts polling the pasteboard and the background enrichment queue (thumbnails, OCR, local tags). */
export const startClipboardCapture = (deps: ClipCaptureDeps): void => {
  watcher.start(deps)
  enrichQueue.start(deps.getSettings)
}

export const stopClipboardCapture = (): void => {
  watcher.stop()
  enrichQueue.stop()
}

/** Absolute file path for the popmind-clip:// protocol; generates thumbnails / app icons lazily. */
export const resolveClipAsset = async (kind: ClipAssetKind, id: string): Promise<string | null> => {
  try {
    const existing = await clipStore.resolveAsset(kind, id)
    if (existing) {
      return existing
    }

    if (kind === 'thumb') {
      const imagePath = await clipStore.resolveAsset('image', id)
      return imagePath ? await ensureThumbnail(imagePath) : null
    }

    if (kind === 'app-icon') {
      return await ensureAppMeta({ bundleId: id, name: id })
    }

    return null
  } catch (error) {
    mainLogger.warn('[clip-store] resolve asset failed', { kind, id, error: String(error) })
    return null
  }
}
