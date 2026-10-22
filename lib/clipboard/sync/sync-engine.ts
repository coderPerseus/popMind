// Manual Cloudflare R2 sync (docs/clipboard-sync.md §6): pull new remote items and pinboards, then push local
// items and pinboards that are not synced yet. Only adds content on either side; never deletes or overwrites.
import { readFile, stat } from 'node:fs/promises'
import type { ClipStore, ClipSyncIncoming, ClipSyncOutgoing } from '@/lib/clipboard/store/contract'
import { R2Client, R2Error } from '@/lib/clipboard/sync/r2-client'
import { deriveSyncKeys, remoteName, seal, unseal, type SyncKeys } from '@/lib/clipboard/sync/sync-crypto'
import type { SyncCredentials } from '@/lib/clipboard/sync/sync-key'
import {
  decodeItemPayload,
  decodePinboardPayload,
  encodeItemPayload,
  encodePinboardPayload,
  type DecodedItem,
} from '@/lib/clipboard/sync/sync-payload'
import type { ClipSyncErrorCode, ClipSyncPushResult, ClipSyncRange, ClipSyncSummary } from '@/lib/clipboard/types'
import { mainLogger } from '@/lib/main/logger'

export const ITEMS_PREFIX = 'items/'
export const BLOBS_PREFIX = 'blobs/'
export const PINBOARDS_PREFIX = 'pinboards/'
export const CHECK_KEY = 'meta/check'
const CHECK_PLAINTEXT = 'popmind-sync-check-v1'

const CONCURRENCY = 12
const IMPORT_BATCH = 60
const UPLOAD_BATCH = 48
const DAY_MS = 24 * 60 * 60 * 1000

const RANGE_DAYS: Record<ClipSyncRange, number | null> = { '7d': 7, '30d': 30, all: null, none: 0 }

/** Bucket operations the engine needs (R2Client in production, an in-memory fake in scripts). */
export type SyncRemote = Pick<R2Client, 'listAll' | 'get' | 'put'>

/** Store operations the engine needs (clipStore in production). */
export type SyncStore = Pick<
  ClipStore,
  | 'syncKnownKeys'
  | 'syncMarkSeen'
  | 'syncImportItems'
  | 'syncApplyPinboard'
  | 'syncPendingUploadIds'
  | 'syncLoadOutgoing'
  | 'syncMarkUploaded'
  | 'syncLocalPinboards'
  | 'syncMarkPinboardMembers'
>

export class SyncError extends Error {
  constructor(
    readonly code: ClipSyncErrorCode,
    message: string
  ) {
    super(message)
  }
}

/** Maps transport errors to user-facing codes. */
export const toSyncError = (error: unknown): SyncError => {
  if (error instanceof SyncError) return error
  if (error instanceof R2Error) {
    if (error.code === 'NoSuchBucket') return new SyncError('bucket_missing', error.message)
    if (error.status === 401 || error.status === 403) return new SyncError('auth_failed', error.message)
    return new SyncError('unknown', error.message)
  }
  const message = error instanceof Error ? error.message : String(error)
  if (error instanceof TypeError || /fetch failed|ENOTFOUND|ECONN|ETIMEDOUT|network/i.test(message)) {
    return new SyncError('network', message)
  }
  return new SyncError('unknown', message)
}

/** Runs `worker` over `items` with at most `limit` in flight; results keep the input order. */
const mapLimit = async <T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> => {
  const results = new Array<R>(items.length)
  let next = 0
  const run = async () => {
    while (next < items.length) {
      const index = next++
      results[index] = await worker(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run))
  return results
}

const chunk = <T>(values: T[], size: number) => {
  const chunks: T[][] = []
  for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size))
  return chunks
}

const objectName = (key: string, prefix: string) => key.slice(prefix.length)

/**
 * Checks credentials + bucket and that the bucket's data was encrypted with this key.
 * `initialize` writes the check object into an empty bucket (first device).
 */
export const verifyRemote = async <C extends Pick<R2Client, 'get' | 'put'> = R2Client>(
  credentials: SyncCredentials,
  options: { initialize: boolean; client?: C }
) => {
  const client: C | R2Client = options.client ?? new R2Client(credentials)
  const keys = deriveSyncKeys(credentials.encryptionKey)
  try {
    const check = await client.get(CHECK_KEY)
    if (check) {
      try {
        if (unseal(keys, check).toString('utf8') !== CHECK_PLAINTEXT) throw new Error('check mismatch')
      } catch {
        throw new SyncError('wrong_key', 'bucket data was encrypted with a different sync key')
      }
      return { client, keys, initialized: false }
    }
    if (options.initialize) {
      await client.put(CHECK_KEY, seal(keys, Buffer.from(CHECK_PLAINTEXT, 'utf8')))
      return { client, keys, initialized: true }
    }
    return { client, keys, initialized: false }
  } catch (error) {
    throw toSyncError(error)
  }
}

export type RunSyncOptions = {
  credentials: SyncCredentials
  store: SyncStore
  client?: SyncRemote
  range: ClipSyncRange
  maxImageBytes: number
  /** When sync was set up on this device. */
  startedAt: number
  now?: () => number
}

export const runSync = async (options: RunSyncOptions): Promise<ClipSyncSummary> => {
  const startedAt = performance.now()
  const now = options.now ?? Date.now
  const summary: ClipSyncSummary = {
    ok: false,
    received: 0,
    uploaded: 0,
    pinboardsChanged: 0,
    skipped: 0,
    finishedAt: 0,
    tookMs: 0,
  }

  try {
    const store = options.store
    const { client, keys } = await verifyRemote(options.credentials, { initialize: true, client: options.client })

    // ---- 1. pull items ----
    const [remoteItems, remoteBlobs] = await Promise.all([client.listAll(ITEMS_PREFIX), client.listAll(BLOBS_PREFIX)])
    const remoteItemNames = new Set(remoteItems.map((object) => objectName(object.key, ITEMS_PREFIX)))
    const remoteBlobNames = new Set(remoteBlobs.map((object) => objectName(object.key, BLOBS_PREFIX)))
    const known = new Set(await store.syncKnownKeys())
    const fresh = remoteItems
      .filter((object) => !known.has(objectName(object.key, ITEMS_PREFIX)))
      .sort((left, right) => left.lastModified - right.lastModified)

    mainLogger.info('[clip-sync] pull plan', {
      remoteItems: remoteItems.length,
      remoteBlobs: remoteBlobs.length,
      known: known.size,
      fresh: fresh.length,
    })

    // Newest upload ends up on top; received items count as new content, so they get "now"-based times.
    const baseTime = now() - fresh.length
    let order = 0
    for (const batch of chunk(fresh, IMPORT_BATCH)) {
      const downloaded = await mapLimit(batch, CONCURRENCY, (object) => downloadItem(client, keys, object.key))
      const incoming: ClipSyncIncoming[] = []
      const unusable: string[] = []

      downloaded.forEach((result, index) => {
        const name = objectName(batch[index].key, ITEMS_PREFIX)
        order += 1
        if (!result) {
          unusable.push(name)
          return
        }
        incoming.push({
          remoteKey: name,
          record: result.item.toRecord(baseTime + order, result.image),
          customTitle: result.item.customTitle,
        })
      })

      if (unusable.length > 0) await store.syncMarkSeen(unusable)
      if (incoming.length > 0) {
        const imported = await store.syncImportItems(incoming)
        summary.received += imported.added.length
      }
    }

    // ---- 2. pull pinboards ----
    const remotePinboardObjects = await client.listAll(PINBOARDS_PREFIX)
    const remotePinboards = new Map<string, { name: string; color: string; items: string[] }>()
    await mapLimit(remotePinboardObjects, CONCURRENCY, async (object) => {
      const data = await client.get(object.key)
      if (!data) return
      try {
        remotePinboards.set(objectName(object.key, PINBOARDS_PREFIX), decodePinboardPayload(unseal(keys, data)))
      } catch (error) {
        mainLogger.warn('[clip-sync] pinboard unreadable', { key: object.key, error: String(error) })
      }
    })
    for (const [pinboardKey, pinboard] of remotePinboards) {
      const applied = await store.syncApplyPinboard({ pinboardKey, ...pinboard, itemKeys: pinboard.items })
      if (applied.created || applied.added > 0) summary.pinboardsChanged += 1
    }

    // ---- 3. push items ----
    const days = RANGE_DAYS[options.range]
    const since = days === null ? 0 : options.startedAt - days * DAY_MS
    const pendingIds = await store.syncPendingUploadIds(since)
    mainLogger.info('[clip-sync] push plan', { pending: pendingIds.length, range: options.range, since })

    for (const ids of chunk(pendingIds, UPLOAD_BATCH)) {
      const outgoing = await store.syncLoadOutgoing(ids)
      const results = await mapLimit(outgoing, CONCURRENCY, (item) =>
        uploadItem(client, keys, item, {
          remoteItemNames,
          remoteBlobNames,
          maxImageBytes: options.maxImageBytes,
        })
      )
      const done = results.flatMap((result, index) =>
        result.status === 'skipped' ? [] : [{ itemId: outgoing[index].id, remoteKey: result.remoteKey }]
      )
      const skipped = results.flatMap((result, index) =>
        result.status === 'skipped' ? [{ itemId: outgoing[index].id, remoteKey: '' }] : []
      )
      summary.uploaded += results.filter((result) => result.status === 'uploaded').length
      summary.skipped += skipped.length
      if (done.length > 0) await store.syncMarkUploaded(done)
      if (skipped.length > 0) await store.syncMarkUploaded(skipped, 'skipped')
    }

    // ---- 4. push pinboards (union with what is remote; only ever grows) ----
    const localPinboards = await store.syncLocalPinboards()
    for (const local of localPinboards) {
      const pinboardKey = remoteName(keys, 'pinboard', local.name)
      const remote = remotePinboards.get(pinboardKey)
      const merged = [...(remote?.items ?? [])]
      const seen = new Set(merged)
      // Local order first for new members so the other device shows them at the front like here.
      const additions = local.itemKeys.filter((key) => !seen.has(key))
      const items = [...additions, ...merged]

      if (!remote || additions.length > 0) {
        await client.put(
          `${PINBOARDS_PREFIX}${pinboardKey}`,
          seal(keys, encodePinboardPayload({ name: local.name, color: remote?.color ?? local.color, items }))
        )
      }
      await store.syncMarkPinboardMembers(pinboardKey, local.itemKeys)
    }

    summary.ok = true
  } catch (error) {
    const syncError = toSyncError(error)
    summary.errorCode = syncError.code
    summary.errorMessage = syncError.message
    mainLogger.warn('[clip-sync] failed', { code: syncError.code, message: syncError.message })
  }

  summary.finishedAt = now()
  summary.tookMs = Math.round(performance.now() - startedAt)
  mainLogger.info('[clip-sync] done', { ...summary, errorMessage: summary.errorMessage?.slice(0, 200) })
  return summary
}

export type PushItemsOptions = {
  credentials: SyncCredentials
  store: Pick<ClipStore, 'syncLoadOutgoing' | 'syncMarkUploaded'>
  client?: Pick<R2Client, 'get' | 'put' | 'head'>
  ids: string[]
  maxImageBytes: number
}

/**
 * Uploads chosen items right away, whatever the sync range says (context menu "Sync to remote"). Checks each
 * object with HEAD instead of listing the whole bucket, so it stays fast with a large history.
 */
export const pushItems = async (options: PushItemsOptions): Promise<ClipSyncPushResult> => {
  const result: ClipSyncPushResult = { ok: false, uploaded: 0, existing: 0, skipped: 0 }
  const startedAt = performance.now()

  try {
    const remote = options.client ?? new R2Client(options.credentials)
    const { keys } = await verifyRemote(options.credentials, { initialize: true, client: remote })
    const outgoing = await options.store.syncLoadOutgoing(options.ids)
    result.skipped += options.ids.length - outgoing.length

    const remoteItemNames = new Set<string>()
    const remoteBlobNames = new Set<string>()
    const results = await mapLimit(outgoing, CONCURRENCY, async (item): Promise<UploadResult> => {
      if (item.kind === 'file') return { status: 'skipped' }
      const remoteKey = remoteName(keys, 'item', item.fingerprint)
      if (await remote.head(`${ITEMS_PREFIX}${remoteKey}`)) return { status: 'existing', remoteKey }
      if (item.imageHash) {
        const blobName = remoteName(keys, 'blob', item.imageHash)
        if (await remote.head(`${BLOBS_PREFIX}${blobName}`)) remoteBlobNames.add(blobName)
      }
      return uploadItem(remote, keys, item, { remoteItemNames, remoteBlobNames, maxImageBytes: options.maxImageBytes })
    })

    const done = results.flatMap((entry, index) =>
      entry.status === 'skipped' ? [] : [{ itemId: outgoing[index].id, remoteKey: entry.remoteKey }]
    )
    result.uploaded = results.filter((entry) => entry.status === 'uploaded').length
    result.existing = results.filter((entry) => entry.status === 'existing').length
    result.skipped += results.filter((entry) => entry.status === 'skipped').length
    if (done.length > 0) await options.store.syncMarkUploaded(done)
    result.ok = true
  } catch (error) {
    const syncError = toSyncError(error)
    result.errorCode = syncError.code
    result.errorMessage = syncError.message
  }

  mainLogger.info('[clip-sync] push items', {
    ids: options.ids.length,
    ...result,
    errorMessage: result.errorMessage?.slice(0, 200),
    tookMs: Math.round(performance.now() - startedAt),
  })
  return result
}

const downloadItem = async (
  client: SyncRemote,
  keys: SyncKeys,
  key: string
): Promise<{ item: DecodedItem; image?: Buffer } | null> => {
  const data = await client.get(key)
  if (!data) return null

  let item: DecodedItem
  try {
    item = decodeItemPayload(unseal(keys, data))
  } catch (error) {
    mainLogger.warn('[clip-sync] item unreadable, skipped', { key, error: String(error) })
    return null
  }

  if (!item.imageRef) return { item }

  const imageData = await client.get(`${BLOBS_PREFIX}${item.imageRef}`)
  if (!imageData) {
    mainLogger.warn('[clip-sync] image blob missing, skipped', { key })
    return null
  }
  try {
    return { item, image: unseal(keys, imageData) }
  } catch (error) {
    mainLogger.warn('[clip-sync] image unreadable, skipped', { key, error: String(error) })
    return null
  }
}

type UploadResult = { status: 'uploaded' | 'existing'; remoteKey: string } | { status: 'skipped' }

const uploadItem = async (
  client: Pick<R2Client, 'put'>,
  keys: SyncKeys,
  item: ClipSyncOutgoing,
  context: { remoteItemNames: Set<string>; remoteBlobNames: Set<string>; maxImageBytes: number }
): Promise<UploadResult> => {
  const remoteKey = remoteName(keys, 'item', item.fingerprint)
  if (context.remoteItemNames.has(remoteKey)) {
    // Same content was already uploaded by another device.
    return { status: 'existing', remoteKey }
  }

  let imageRef: string | undefined
  if (item.kind === 'image') {
    if (!item.imagePath || !item.imageHash) return { status: 'skipped' }
    const size = await stat(item.imagePath)
      .then((info) => info.size)
      .catch(() => -1)
    if (size <= 0 || size > context.maxImageBytes) {
      mainLogger.info('[clip-sync] image skipped', { id: item.id, bytes: size, limit: context.maxImageBytes })
      return { status: 'skipped' }
    }

    imageRef = remoteName(keys, 'blob', item.imageHash)
    if (!context.remoteBlobNames.has(imageRef)) {
      await client.put(`${BLOBS_PREFIX}${imageRef}`, seal(keys, await readFile(item.imagePath)))
      context.remoteBlobNames.add(imageRef)
    }
  }

  await client.put(`${ITEMS_PREFIX}${remoteKey}`, seal(keys, encodeItemPayload(item, imageRef)))
  context.remoteItemNames.add(remoteKey)
  return { status: 'uploaded', remoteKey }
}
