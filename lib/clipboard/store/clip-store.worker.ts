// Worker thread that owns node:sqlite. Thin message-RPC shell over ClipDatabase; no Electron APIs here.
import { mkdirSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { parentPort, workerData } from 'node:worker_threads'
import { ClipDatabase, type ClipLogFn } from '@/lib/clipboard/store/clip-database'
import { importLegacyDatabase } from '@/lib/clipboard/store/legacy-import'
import { migrateClipDatabase } from '@/lib/clipboard/store/migrations'
import { getClipDirs, getLegacyDatabasePath } from '@/lib/clipboard/store/paths'
import {
  CLIP_WORKER_METHODS,
  type ClipWorkerData,
  type ClipWorkerLogMessage,
  type ClipWorkerRequest,
  type ClipWorkerResponse,
} from '@/lib/clipboard/store/worker-protocol'

const port = parentPort
if (!port) {
  throw new Error('clip-store.worker must run inside a worker thread')
}

const data = workerData as ClipWorkerData
const dirs = getClipDirs(data.userDataPath)

const log: ClipLogFn = (level, message, extra) => {
  const payload: ClipWorkerLogMessage = { type: 'log', level, message, data: extra }
  port.postMessage(payload)
}

let database: DatabaseSync | null = null
let clip: ClipDatabase | null = null

const open = async () => {
  if (clip) {
    return
  }

  const started = performance.now()
  mkdirSync(dirs.root, { recursive: true })
  mkdirSync(dirs.blobDir, { recursive: true })
  mkdirSync(dirs.thumbDir, { recursive: true })
  mkdirSync(dirs.appIconDir, { recursive: true })

  database = new DatabaseSync(dirs.dbPath)
  database.exec('PRAGMA journal_mode = WAL')
  database.exec('PRAGMA foreign_keys = ON')
  database.exec('PRAGMA synchronous = NORMAL')
  database.exec('PRAGMA busy_timeout = 5000')

  const applied = migrateClipDatabase(database)
  clip = new ClipDatabase(database, { dirs, log })
  clip.onOpen()

  try {
    await importLegacyDatabase(clip, getLegacyDatabasePath(data.userDataPath), log)
  } catch (error) {
    log('error', '[clip-store] legacy import crashed', { error: String(error) })
  }

  log('info', '[clip-store] ready', { migrations: applied, ms: Math.round(performance.now() - started) })
}

const close = () => {
  try {
    database?.exec('PRAGMA wal_checkpoint(TRUNCATE)')
    database?.close()
  } finally {
    database = null
    clip = null
  }
}

const methods = new Set<string>(CLIP_WORKER_METHODS)

const handle = async (request: ClipWorkerRequest): Promise<unknown> => {
  if (request.method === 'init') {
    await open()
    return undefined
  }

  if (request.method === 'close') {
    close()
    return undefined
  }

  if (!clip) {
    throw new Error('clip store is not open')
  }

  if (!methods.has(request.method)) {
    throw new Error(`unknown clip store method: ${request.method}`)
  }

  const target = clip as unknown as Record<string, (...args: unknown[]) => unknown>
  return target[request.method]?.(...request.args)
}

port.on('message', (request: ClipWorkerRequest) => {
  handle(request)
    .then((result) => {
      const response: ClipWorkerResponse = { id: request.id, ok: true, result }
      port.postMessage(response)
    })
    .catch((error: unknown) => {
      const response: ClipWorkerResponse = {
        id: request.id,
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      }
      port.postMessage(response)
    })
})
