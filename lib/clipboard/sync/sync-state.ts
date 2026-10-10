// Persisted sync state (userData/clipboard/sync-state.json). The sync key is encrypted with the macOS keychain
// (Electron safeStorage) and never written to the settings file the renderer can read.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { app, safeStorage } from 'electron'
import type { ClipSyncSummary } from '@/lib/clipboard/types'
import { parseSyncKey, type SyncCredentials } from '@/lib/clipboard/sync/sync-key'
import { mainLogger } from '@/lib/main/logger'

type StoredState = {
  /** base64 of safeStorage-encrypted sync key (or `plain:` + key when encryption is unavailable). */
  key?: string
  /** When sync was set up on this device; anchors the first-sync range. */
  startedAt?: number
  /** Hash of account + bucket + encryption key the local sync bookkeeping belongs to. */
  identity?: string
  lastSync?: ClipSyncSummary
}

const statePath = () => join(app.getPath('userData'), 'clipboard', 'sync-state.json')

const read = (): StoredState => {
  try {
    const path = statePath()
    return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as StoredState) : {}
  } catch (error) {
    mainLogger.warn('[clip-sync] state unreadable, starting fresh', { error: String(error) })
    return {}
  }
}

const write = (state: StoredState) => {
  const path = statePath()
  mkdirSync(dirname(path), { recursive: true })
  const temp = `${path}.tmp`
  writeFileSync(temp, JSON.stringify(state), { mode: 0o600 })
  renameSync(temp, path)
}

const protect = (syncKey: string) =>
  safeStorage.isEncryptionAvailable() ? safeStorage.encryptString(syncKey).toString('base64') : `plain:${syncKey}`

const reveal = (stored: string) =>
  stored.startsWith('plain:') ? stored.slice(6) : safeStorage.decryptString(Buffer.from(stored, 'base64'))

export const syncState = {
  getSyncKey(): string | null {
    const stored = read().key
    if (!stored) return null
    try {
      return reveal(stored)
    } catch (error) {
      mainLogger.warn('[clip-sync] sync key could not be decrypted', { error: String(error) })
      return null
    }
  },

  getCredentials(): SyncCredentials | null {
    const key = this.getSyncKey()
    return key ? parseSyncKey(key) : null
  },

  getIdentity(): string | undefined {
    return read().identity
  },

  /** Saves the key. A different identity (other bucket / key) restarts the first-sync range. */
  saveSyncKey(syncKey: string, identity: string, now = Date.now()) {
    const previous = read()
    const sameIdentity = previous.identity === identity
    write({
      key: protect(syncKey),
      identity,
      startedAt: sameIdentity ? (previous.startedAt ?? now) : now,
      lastSync: sameIdentity ? previous.lastSync : undefined,
    })
  },

  getStartedAt(): number | null {
    return read().startedAt ?? null
  },

  getLastSync(): ClipSyncSummary | undefined {
    return read().lastSync
  },

  saveLastSync(summary: ClipSyncSummary) {
    write({ ...read(), lastSync: summary })
  },

  /** Disconnects but keeps identity + start time, so reconnecting with the same key does not re-upload. */
  clearKey() {
    const previous = read()
    write({ identity: previous.identity, startedAt: previous.startedAt })
  },
}
