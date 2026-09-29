// Main-process side of the clipboard store: implements ClipStore by posting messages to the worker thread that
// owns the SQLite connection, and emits `items-changed` after every mutation.
import { Worker } from 'node:worker_threads'
import { app } from 'electron'
import { clipboardEvents } from '@/lib/clipboard/events'
import type {
  ClipAiCandidate,
  ClipAiCandidateQuery,
  ClipAssetKind,
  ClipEnrichJob,
  ClipEnrichTask,
  ClipIngestOutcome,
  ClipIngestRecord,
  ClipStore,
  ClipWritePayload,
} from '@/lib/clipboard/store/contract'
import { getClipDirs, type ClipDirs } from '@/lib/clipboard/store/paths'
import {
  type ClipWorkerData,
  type ClipWorkerLogMessage,
  type ClipWorkerRequest,
  type ClipWorkerResponse,
} from '@/lib/clipboard/store/worker-protocol'
import type {
  ClipDetail,
  ClipItemsChangedEvent,
  ClipListItem,
  ClipListResult,
  ClipQuery,
  ClipSourceApp,
  ClipStats,
  ClipboardSettings,
  Pinboard,
} from '@/lib/clipboard/types'
import { mainLogger } from '@/lib/main/logger'
import workerPath from './clip-store.worker?modulePath'

const SLOW_CALL_MS = 250

type PendingCall = {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  method: string
  startedAt: number
}

class ClipStoreProxy implements ClipStore {
  private worker: Worker | null = null
  private ready: Promise<void> | null = null
  private nextRequestId = 1
  private readonly pending = new Map<number, PendingCall>()
  private closing = false

  /** Data directory layout (needs `app` to be ready when first used). */
  getDirs(): ClipDirs {
    return getClipDirs(app.getPath('userData'))
  }

  // ---- lifecycle ----

  init(): Promise<void> {
    this.ready ??= this.start().catch((error: unknown) => {
      this.ready = null
      throw error
    })
    return this.ready
  }

  private async start() {
    this.closing = false
    const data: ClipWorkerData = { userDataPath: app.getPath('userData') }
    const worker = new Worker(workerPath, { workerData: data })
    this.worker = worker

    worker.on('message', (message: ClipWorkerResponse | ClipWorkerLogMessage) => this.handleMessage(message))
    worker.on('error', (error) => {
      mainLogger.error('[clip-store] worker error', error)
    })
    worker.on('exit', (code) => {
      if (this.worker === worker) {
        this.worker = null
        this.ready = null
      }

      const error = new Error(`clip store worker exited (code ${code})`)
      if (!this.closing) {
        mainLogger.error('[clip-store] worker exited unexpectedly', { code })
      }
      for (const [id, call] of this.pending) {
        this.pending.delete(id)
        call.reject(error)
      }
    })

    await this.send('init', [])
  }

  async close(): Promise<void> {
    const worker = this.worker
    if (!worker) {
      return
    }

    this.closing = true
    try {
      await this.send('close', [])
    } finally {
      this.ready = null
      this.worker = null
      await worker.terminate()
    }
  }

  private handleMessage(message: ClipWorkerResponse | ClipWorkerLogMessage) {
    if ('type' in message && message.type === 'log') {
      const logger = mainLogger[message.level] ?? mainLogger.info
      logger.call(mainLogger, message.message, message.data ?? '')
      return
    }

    const response = message as ClipWorkerResponse
    const call = this.pending.get(response.id)
    if (!call) {
      return
    }

    this.pending.delete(response.id)
    const elapsed = Math.round(performance.now() - call.startedAt)
    if (elapsed > SLOW_CALL_MS) {
      mainLogger.warn('[clip-store] slow call', { method: call.method, ms: elapsed })
    }

    if (response.ok) {
      call.resolve(response.result)
    } else {
      call.reject(new Error(response.error))
    }
  }

  private send(method: string, args: unknown[]): Promise<unknown> {
    const worker = this.worker
    if (!worker) {
      return Promise.reject(new Error('clip store worker is not running'))
    }

    return new Promise((resolve, reject) => {
      const id = this.nextRequestId++
      this.pending.set(id, { resolve, reject, method, startedAt: performance.now() })
      const request: ClipWorkerRequest = { id, method, args }
      worker.postMessage(request)
    })
  }

  private async call<T>(method: string, ...args: unknown[]): Promise<T> {
    await this.init()
    return (await this.send(method, args)) as T
  }

  private emit(reason: ClipItemsChangedEvent['reason'], ids: string[] = []) {
    clipboardEvents.emit('items-changed', { reason, ids })
  }

  // ---- capture ----

  async ingest(record: ClipIngestRecord): Promise<ClipIngestOutcome> {
    const outcome = await this.call<ClipIngestOutcome>('ingest', record)
    this.emit(outcome.status === 'inserted' ? 'added' : 'bumped', [outcome.id])
    return outcome
  }

  async markUsed(id: string): Promise<void> {
    const changed = await this.call<boolean>('markUsed', id)
    if (changed) {
      this.emit('bumped', [id])
    }
  }

  // ---- read ----

  list(query: ClipQuery): Promise<ClipListResult> {
    return this.call('list', query)
  }

  getDetail(id: string): Promise<ClipDetail | null> {
    return this.call('getDetail', id)
  }

  getItemsByIds(ids: string[]): Promise<ClipListItem[]> {
    return this.call('getItemsByIds', ids)
  }

  async getWritePayload(id: string): Promise<ClipWritePayload | null> {
    const payload = await this.call<ClipWritePayload | null>('getWritePayload', id)
    if (!payload) {
      return null
    }

    // Structured clone turns Buffers into plain Uint8Arrays; the native writer expects Buffers.
    return {
      ...payload,
      items: payload.items.map((item) => ({
        representations: item.representations.map((rep) => ({
          type: rep.type,
          data: Buffer.from(rep.data.buffer, rep.data.byteOffset, rep.data.byteLength),
        })),
      })),
    }
  }

  getAiCandidates(query: ClipAiCandidateQuery): Promise<ClipAiCandidate[]> {
    return this.call('getAiCandidates', query)
  }

  listApps(): Promise<ClipSourceApp[]> {
    return this.call('listApps')
  }

  stats(): Promise<ClipStats> {
    return this.call('stats')
  }

  // ---- edit ----

  async rename(id: string, title: string | null): Promise<ClipListItem | null> {
    const item = await this.call<ClipListItem | null>('rename', id, title)
    if (item) {
      this.emit('updated', [id])
    }
    return item
  }

  async updateText(id: string, text: string): Promise<ClipListItem | null> {
    const item = await this.call<ClipListItem | null>('updateText', id, text)
    if (item) {
      this.emit('updated', [id])
    }
    return item
  }

  async createTextItem(text: string): Promise<ClipListItem> {
    const item = await this.call<ClipListItem>('createTextItem', text)
    this.emit('added', [item.id])
    return item
  }

  async softDelete(ids: string[]): Promise<{ deletedIds: string[]; undoToken: string }> {
    const result = await this.call<{ deletedIds: string[]; undoToken: string }>('softDelete', ids)
    if (result.deletedIds.length > 0) {
      this.emit('deleted', result.deletedIds)
    }
    return result
  }

  async undoDelete(undoToken: string): Promise<string[]> {
    const ids = await this.call<string[]>('undoDelete', undoToken)
    if (ids.length > 0) {
      this.emit('added', ids)
    }
    return ids
  }

  purgeDeleted(olderThanMs: number): Promise<number> {
    return this.call('purgeDeleted', olderThanMs)
  }

  async clearHistory(): Promise<number> {
    const removed = await this.call<number>('clearHistory')
    this.emit('cleared')
    return removed
  }

  // ---- pinboards ----

  listPinboards(): Promise<Pinboard[]> {
    return this.call('listPinboards')
  }

  async createPinboard(name: string, color: string): Promise<Pinboard> {
    const pinboard = await this.call<Pinboard>('createPinboard', name, color)
    this.emit('pinboards')
    return pinboard
  }

  async updatePinboard(id: string, patch: { name?: string; color?: string }): Promise<Pinboard | null> {
    const pinboard = await this.call<Pinboard | null>('updatePinboard', id, patch)
    this.emit('pinboards')
    return pinboard
  }

  async deletePinboard(id: string): Promise<void> {
    await this.call('deletePinboard', id)
    this.emit('pinboards')
  }

  async reorderPinboards(ids: string[]): Promise<void> {
    await this.call('reorderPinboards', ids)
    this.emit('pinboards')
  }

  async addToPinboard(pinboardId: string, itemIds: string[]): Promise<void> {
    await this.call('addToPinboard', pinboardId, itemIds)
    this.emit('pinboards', itemIds)
  }

  async removeFromPinboard(pinboardId: string, itemIds: string[]): Promise<void> {
    await this.call('removeFromPinboard', pinboardId, itemIds)
    this.emit('pinboards', itemIds)
  }

  async reorderPinboardItems(pinboardId: string, itemIds: string[]): Promise<void> {
    await this.call('reorderPinboardItems', pinboardId, itemIds)
    this.emit('pinboards', itemIds)
  }

  // ---- apps / enrichment / assets ----

  async upsertApp(app: { bundleId: string; name: string; iconPath?: string; color?: string }): Promise<void> {
    await this.call('upsertApp', app)
  }

  takeEnrichTasks(job: ClipEnrichJob, limit: number): Promise<ClipEnrichTask[]> {
    return this.call('takeEnrichTasks', job, limit)
  }

  async completeEnrichTask(
    itemId: string,
    job: ClipEnrichJob,
    result: { ok: true; ocrText?: string; tags?: string[] } | { ok: false; error: string }
  ): Promise<void> {
    await this.call('completeEnrichTask', itemId, job, result)
    // OCR text changes search results and the "text match" badge.
    if (result.ok && job === 'ocr' && result.ocrText) {
      this.emit('updated', [itemId])
    }
  }

  resolveAsset(kind: ClipAssetKind, id: string): Promise<string | null> {
    return this.call('resolveAsset', kind, id)
  }

  // ---- maintenance ----

  async runRetention(
    settings: Pick<ClipboardSettings, 'retention' | 'maxStorageMb'>
  ): Promise<{ deletedCount: number }> {
    const result = await this.call<{ deletedCount: number }>('runRetention', {
      retention: settings.retention,
      maxStorageMb: settings.maxStorageMb,
    })
    if (result.deletedCount > 0) {
      this.emit('deleted')
    }
    return result
  }
}

export const clipStoreProxy = new ClipStoreProxy()
