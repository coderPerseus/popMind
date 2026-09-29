// Composition root of the clipboard feature (spec §4, §11.4-D):
// store -> capture -> retention / purge timers -> paste stack, plus the popmind-clip:// protocol, the IPC handlers
// and the (hidden, prewarmed) panel window.
import { net, protocol } from 'electron'
import { pathToFileURL } from 'node:url'
import { parseClipAssetUrl } from '@/lib/clipboard/asset-url'
import { startClipboardCapture, stopClipboardCapture, resolveClipAsset } from '@/lib/clipboard/capture'
import { clipStore } from '@/lib/clipboard/store'
import { CLIP_PROTOCOL } from '@/lib/clipboard/types'
import { clipboardPanel } from '@/lib/clipboard/window/clipboard-panel-window'
import { pasteStack } from '@/lib/clipboard/write'
import { disposeClipboardSettings, getClipboardSettings, initClipboardSettings } from '@/lib/clipboard/write/settings'
import { startTempImageSweeper, stopTempImageSweeper } from '@/lib/clipboard/write/writer'
import { registerClipboardHandlers } from '@/lib/conveyor/handlers/clipboard-handler'
import { mainLogger } from '@/lib/main/logger'

const PANEL_PREWARM_DELAY_MS = 3000
const RETENTION_FIRST_RUN_MS = 60_000
const RETENTION_INTERVAL_MS = 60 * 60 * 1000
const PURGE_INTERVAL_MS = 60_000
/** Soft-deleted items older than this can no longer be undone and are removed for good. */
const PURGE_OLDER_THAN_MS = 10_000
const SLOW_ASSET_MS = 150

let readyPromise: Promise<void> | null = null
let prewarmTimer: NodeJS.Timeout | null = null
let retentionStartTimer: NodeJS.Timeout | null = null
let retentionTimer: NodeJS.Timeout | null = null
let purgeTimer: NodeJS.Timeout | null = null

/**
 * Must run BEFORE the app `ready` event: makes `popmind-clip://` a standard, secure scheme that supports fetch and
 * streaming so the panel (dev http origin or packaged file origin) can load thumbnails and icons from it.
 */
export const registerClipboardScheme = () => {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: CLIP_PROTOCOL,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
    },
  ])
}

const registerClipboardProtocol = (ready: Promise<void>) => {
  protocol.handle(CLIP_PROTOCOL, async (request) => {
    const parsed = parseClipAssetUrl(request.url)
    if (!parsed) {
      return new Response('Bad request', { status: 400 })
    }

    const startedAt = performance.now()
    try {
      await ready
      const filePath = await resolveClipAsset(parsed.kind, parsed.id)
      if (!filePath) {
        return new Response('Not found', { status: 404 })
      }

      const fileResponse = await net.fetch(pathToFileURL(filePath).toString())
      const headers = new Headers(fileResponse.headers)
      headers.set('Access-Control-Allow-Origin', '*')

      const ms = Math.round(performance.now() - startedAt)
      if (ms > SLOW_ASSET_MS) {
        mainLogger.info('[clip-panel] slow asset', { kind: parsed.kind, ms })
      }

      return new Response(fileResponse.body, { status: fileResponse.status, headers })
    } catch (error) {
      mainLogger.warn('[clip-panel] asset request failed', { kind: parsed.kind, error: String(error) })
      return new Response('Asset unavailable', { status: 500 })
    }
  })
}

const startBackgroundJobs = () => {
  retentionStartTimer = setTimeout(() => {
    retentionStartTimer = null
    const runRetention = async () => {
      const settings = getClipboardSettings()
      const startedAt = performance.now()
      try {
        const { deletedCount } = await clipStore.runRetention({
          retention: settings.retention,
          maxStorageMb: settings.maxStorageMb,
        })
        mainLogger.info('[clip-store] retention done', {
          retention: settings.retention,
          maxStorageMb: settings.maxStorageMb,
          deletedCount,
          ms: Math.round(performance.now() - startedAt),
        })
      } catch (error) {
        mainLogger.error('[clip-store] retention failed', error)
      }
    }

    void runRetention()
    retentionTimer = setInterval(() => void runRetention(), RETENTION_INTERVAL_MS)
  }, RETENTION_FIRST_RUN_MS)

  purgeTimer = setInterval(() => {
    clipStore
      .purgeDeleted(PURGE_OLDER_THAN_MS)
      .then((count) => {
        if (count > 0) mainLogger.info('[clip-store] purged soft-deleted items', { count })
      })
      .catch((error) => mainLogger.error('[clip-store] purge failed', error))
  }, PURGE_INTERVAL_MS)
}

export const initializeClipboard = (): Promise<void> => {
  if (readyPromise) return readyPromise

  const startedAt = performance.now()
  const ready = (async () => {
    await initClipboardSettings()
    await clipStore.init()
    mainLogger.info('[clip-store] initialised', { ms: Math.round(performance.now() - startedAt) })

    startClipboardCapture({ getSettings: getClipboardSettings })
    startTempImageSweeper()
    startBackgroundJobs()
    mainLogger.info('[clip-capture] started', { totalMs: Math.round(performance.now() - startedAt) })
  })()

  readyPromise = ready
  // Handlers and the protocol are registered right away and wait on `ready`.
  registerClipboardProtocol(ready)
  registerClipboardHandlers({ whenReady: () => ready })

  ready.catch((error) => {
    mainLogger.error('[clip-store] initialisation failed', error)
  })

  prewarmTimer = setTimeout(() => {
    prewarmTimer = null
    clipboardPanel.prewarm()
  }, PANEL_PREWARM_DELAY_MS)

  return ready
}

export const disposeClipboard = () => {
  for (const timer of [prewarmTimer, retentionStartTimer]) {
    if (timer) clearTimeout(timer)
  }
  for (const timer of [retentionTimer, purgeTimer]) {
    if (timer) clearInterval(timer)
  }
  prewarmTimer = null
  retentionStartTimer = null
  retentionTimer = null
  purgeTimer = null

  pasteStack.dispose()
  stopClipboardCapture()
  stopTempImageSweeper()
  clipboardPanel.dispose()
  disposeClipboardSettings()

  const wasStarted = readyPromise !== null
  readyPromise = null
  if (wasStarted) {
    void clipStore.close().catch((error) => mainLogger.warn('[clip-store] close failed', { error: String(error) }))
  }
}
