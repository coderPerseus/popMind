// Message protocol between the main-process store proxy and the store worker thread.
import type { ClipLogLevel } from '@/lib/clipboard/store/clip-database'

export type ClipWorkerData = {
  userDataPath: string
}

export type ClipWorkerRequest = {
  id: number
  method: string
  args: unknown[]
}

export type ClipWorkerResponse = { id: number; ok: true; result: unknown } | { id: number; ok: false; error: string }

export type ClipWorkerLogMessage = {
  type: 'log'
  level: ClipLogLevel
  message: string
  data?: Record<string, unknown>
}

/** Methods the worker executes on ClipDatabase (init / close are handled by the worker itself). */
export const CLIP_WORKER_METHODS = [
  'ingest',
  'markUsed',
  'list',
  'getDetail',
  'getItemsByIds',
  'getWritePayload',
  'getAiCandidates',
  'listApps',
  'stats',
  'rename',
  'updateText',
  'createTextItem',
  'softDelete',
  'undoDelete',
  'purgeDeleted',
  'clearHistory',
  'listPinboards',
  'createPinboard',
  'updatePinboard',
  'deletePinboard',
  'reorderPinboards',
  'addToPinboard',
  'removeFromPinboard',
  'reorderPinboardItems',
  'upsertApp',
  'takeEnrichTasks',
  'completeEnrichTask',
  'resolveAsset',
  'runRetention',
] as const

export type ClipWorkerMethod = (typeof CLIP_WORKER_METHODS)[number]
