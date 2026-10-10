// Clipboard sync service (docs/clipboard-sync.md): configuration, manual runs and status for IPC handlers.
import { createHash } from 'node:crypto'
import { clipboard as electronClipboard } from 'electron'
import { clipboardEvents } from '@/lib/clipboard/events'
import { clipboardNative } from '@/lib/clipboard/native-bridge'
import { clipStore } from '@/lib/clipboard/store'
import { buildAgentPrompt } from '@/lib/clipboard/sync/agent-prompt'
import { CloudflareApiError, detectAccountId, ensureBucket, verifyToken } from '@/lib/clipboard/sync/cloudflare-api'
import { runSync, toSyncError, verifyRemote } from '@/lib/clipboard/sync/sync-engine'
import {
  DEFAULT_SYNC_BUCKET,
  encodeSyncKey,
  generateEncryptionKey,
  isValidAccountId,
  parseSyncKey,
  s3SecretFromToken,
  type SyncCredentials,
} from '@/lib/clipboard/sync/sync-key'
import { syncState } from '@/lib/clipboard/sync/sync-state'
import { getClipboardSettings } from '@/lib/clipboard/write/settings'
import type { AppLanguage } from '@/lib/capability/types'
import type { ClipSyncSetupResult, ClipSyncStatus, ClipSyncSummary } from '@/lib/clipboard/types'
import { mainLogger } from '@/lib/main/logger'

/** Pasteboard marker for our own writes: capture skips non-item markers, so the key never enters history. */
const SYNC_KEY_MARKER = 'sync-key'
const CONCEALED_TYPE = 'org.nspasteboard.ConcealedType'

let running: Promise<ClipSyncSummary> | null = null

const identityOf = (credentials: SyncCredentials) =>
  createHash('sha256')
    .update(`${credentials.accountId}\n${credentials.bucket}\n`)
    .update(credentials.encryptionKey)
    .digest('hex')

const getStatus = (): ClipSyncStatus => {
  const credentials = syncState.getCredentials()
  const key = credentials ? syncState.getSyncKey() : null
  return {
    configured: Boolean(credentials),
    running: Boolean(running),
    bucket: credentials?.bucket,
    keyHint: key ? `${key.slice(0, 14)}…` : undefined,
    lastSync: syncState.getLastSync(),
  }
}

const emitStatus = () => clipboardEvents.emit('sync-status', getStatus())

const failure = (error: unknown): ClipSyncSetupResult => {
  const syncError = toSyncError(error)
  return { ok: false, status: getStatus(), errorCode: syncError.code, errorMessage: syncError.message }
}

/** Saves verified credentials; a different bucket / key resets local bookkeeping so everything syncs afresh. */
const saveCredentials = async (credentials: SyncCredentials) => {
  const identity = identityOf(credentials)
  const previous = syncState.getIdentity()
  if (previous && previous !== identity) {
    await clipStore.syncReset()
    mainLogger.info('[clip-sync] different sync target, local bookkeeping reset')
  }
  syncState.saveSyncKey(encodeSyncKey(credentials), identity)
  emitStatus()
}

export const clipboardSync = {
  status: getStatus,

  /** Connects with a pasted `pmsync1.` key (any device). */
  async connect(input: string): Promise<ClipSyncSetupResult> {
    const credentials = parseSyncKey(input)
    if (!credentials) {
      return { ok: false, status: getStatus(), errorCode: 'invalid_key', errorMessage: 'malformed sync key' }
    }

    try {
      await verifyRemote(credentials, { initialize: true })
      await saveCredentials(credentials)
      mainLogger.info('[clip-sync] connected with sync key', { bucket: credentials.bucket })
      return { ok: true, status: getStatus() }
    } catch (error) {
      mainLogger.warn('[clip-sync] connect failed', { error: String(error) })
      return failure(error)
    }
  },

  /** First device, manual path: an R2 API token (+ account id) → bucket, credentials and a new sync key. */
  async setupWithToken(token: string, accountIdInput?: string): Promise<ClipSyncSetupResult> {
    const value = token.trim()
    if (!value) return { ok: false, status: getStatus(), errorCode: 'auth_failed', errorMessage: 'empty token' }

    try {
      // Accepts the bare id or anything containing it (e.g. the S3 endpoint URL shown next to the token).
      const accountId = accountIdInput?.match(/[0-9a-f]{32}/i)?.[0] || (await detectAccountId(value))
      if (!accountId || !isValidAccountId(accountId)) {
        return { ok: false, status: getStatus(), errorCode: 'account_required', errorMessage: 'account id required' }
      }

      const tokenId = await verifyToken(value, accountId)
      // Bucket-scoped "Object Read & Write" tokens cannot manage buckets; the S3 check below then reports a
      // missing bucket clearly.
      const bucketState = await ensureBucket(value, accountId, DEFAULT_SYNC_BUCKET).catch((error: unknown) => {
        mainLogger.info('[clip-sync] bucket check via API skipped', { error: String(error) })
        return 'unknown' as const
      })
      const credentials: SyncCredentials = {
        accountId,
        bucket: DEFAULT_SYNC_BUCKET,
        accessKeyId: tokenId,
        secretAccessKey: s3SecretFromToken(value),
        encryptionKey: generateEncryptionKey(),
      }

      // A bucket with an existing check object belongs to another device's key: that key must be reused.
      const remote = await verifyRemote(credentials, { initialize: true }).catch((error: unknown) => {
        throw toSyncError(error)
      })
      await saveCredentials(credentials)
      mainLogger.info('[clip-sync] set up with token', { bucket: bucketState, initialized: remote.initialized })
      return { ok: true, status: getStatus() }
    } catch (error) {
      mainLogger.warn('[clip-sync] token setup failed', { error: String(error) })
      if (error instanceof CloudflareApiError) {
        const code =
          error.status === 401 || error.status === 403 || error.codes.includes(1000) ? 'auth_failed' : 'unknown'
        return { ok: false, status: getStatus(), errorCode: code, errorMessage: error.message }
      }
      return failure(error)
    }
  },

  disconnect(): ClipSyncStatus {
    syncState.clearKey()
    mainLogger.info('[clip-sync] disconnected')
    emitStatus()
    return getStatus()
  },

  /** Puts the sync key on the clipboard without it entering popMind's (or other managers') history. */
  copySyncKey(): boolean {
    const key = syncState.getSyncKey()
    if (!key) return false

    const items = [
      {
        representations: [
          { type: 'public.utf8-plain-text', data: Buffer.from(key, 'utf8') },
          { type: CONCEALED_TYPE, data: Buffer.from('1', 'utf8') },
        ],
      },
    ]
    if (clipboardNative.write(items, SYNC_KEY_MARKER)) return true

    electronClipboard.writeText(key)
    return true
  },

  agentPrompt: (language: AppLanguage) => buildAgentPrompt(language),

  /** Manual sync; concurrent calls share the running one. */
  run(): Promise<ClipSyncSummary> {
    if (running) return running

    const credentials = syncState.getCredentials()
    if (!credentials) {
      const summary: ClipSyncSummary = {
        ok: false,
        received: 0,
        uploaded: 0,
        pinboardsChanged: 0,
        skipped: 0,
        errorCode: 'not_configured',
        finishedAt: Date.now(),
        tookMs: 0,
      }
      return Promise.resolve(summary)
    }

    const settings = getClipboardSettings().sync
    running = runSync({
      credentials,
      store: clipStore,
      range: settings.range,
      maxImageBytes: Math.max(1, settings.maxImageMb) * 1024 * 1024,
      startedAt: syncState.getStartedAt() ?? Date.now(),
    })
      .then((summary) => {
        syncState.saveLastSync(summary)
        return summary
      })
      .finally(() => {
        running = null
        emitStatus()
      })

    emitStatus()
    return running
  },
}
