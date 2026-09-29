// Public entry of the store package: `clipStore` is the main-process proxy over the SQLite worker thread
// (clip-store.ts + clip-store.worker.ts). Keep the export name.
import type { ClipStore } from '@/lib/clipboard/store/contract'
import { clipStoreProxy } from '@/lib/clipboard/store/clip-store'

export type * from '@/lib/clipboard/store/contract'

export const clipStore: ClipStore = clipStoreProxy

/** Data directory layout (`clipboard/`, `blobs/`, `thumbs/`, `app-icons/`); requires Electron `app`. */
export const getClipStoreDirs = () => clipStoreProxy.getDirs()
