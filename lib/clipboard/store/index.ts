// Public entry of the store package. FOUNDATION STUB — the data work package replaces the body with the
// real worker-backed implementation (clip-store.ts + clip-store.worker.ts). Keep the export name.
import type { ClipStore } from '@/lib/clipboard/store/contract'

export type * from '@/lib/clipboard/store/contract'

const notImplemented = (name: string) => () => Promise.reject(new Error(`clipStore.${name} not implemented`))

export const clipStore: ClipStore = new Proxy({} as ClipStore, {
  get: (_target, property) => notImplemented(String(property)),
})
