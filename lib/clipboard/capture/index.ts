// Public entry of capture + enrichment. FOUNDATION STUB — replaced by the data work package.
import type { ClipAssetKind } from '@/lib/clipboard/store/contract'
import type { ClipboardSettings } from '@/lib/clipboard/types'

export type ClipCaptureDeps = {
  getSettings: () => ClipboardSettings
}

/** Starts polling the pasteboard and the background enrichment queue (thumbnails, OCR, local tags). */
export const startClipboardCapture = (_deps: ClipCaptureDeps): void => {}

export const stopClipboardCapture = (): void => {}

/** Absolute file path for the popmind-clip:// protocol; generates thumbnails lazily. */
export const resolveClipAsset = async (_kind: ClipAssetKind, _id: string): Promise<string | null> => null
