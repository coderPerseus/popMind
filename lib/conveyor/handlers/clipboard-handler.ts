import { existsSync } from 'node:fs'
import { app, nativeImage, shell, type NativeImage } from 'electron'
import appIcon from '@/resources/build/icon.png?asset'
import { clipboardNative } from '@/lib/clipboard/native-bridge'
import { runAiSearch, testJevConnection } from '@/lib/clipboard/search/ai'
import type { ClipAiSearchPort } from '@/lib/clipboard/search/ai/contract'
import { clipStore } from '@/lib/clipboard/store'
import { clipboardPanel } from '@/lib/clipboard/window/clipboard-panel-window'
import { pasteService, pasteStack, writeClipItems } from '@/lib/clipboard/write'
import { getClipboardSettings, recordClipboardAiUsage } from '@/lib/clipboard/write/settings'
import type { ClipAiSearchResult } from '@/lib/clipboard/types'
import { clipIpcSchema } from '@/lib/conveyor/schemas/clipboard-schema'
import type { ChannelArgs, ChannelReturn } from '@/lib/conveyor/schemas'
import { mainLogger } from '@/lib/main/logger'
import { handle } from '@/lib/main/shared'
import { hideMainWindow } from '@/lib/main/window-manager'

type ClipChannel = keyof typeof clipIpcSchema

const ACCESSIBILITY_SETTINGS_URL = 'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility'
const OPENABLE_URL_PROTOCOLS = new Set(['http:', 'https:', 'mailto:'])
const MAX_FILES_TO_OPEN = 10
const DRAG_ICON_HEIGHT = 96

export type ClipboardHandlerDeps = {
  /** Resolves once the store is initialised; every handler waits for it. */
  whenReady: () => Promise<void>
}

const openLink = async (rawUrl: string) => {
  try {
    const parsed = new URL(rawUrl)
    if (!OPENABLE_URL_PROTOCOLS.has(parsed.protocol)) return false
    await shell.openExternal(parsed.toString())
    return true
  } catch {
    return false
  }
}

/** Icon shown under the cursor while dragging an item out of the panel. */
const resolveDragIcon = async (id: string, filePath: string): Promise<NativeImage> => {
  const thumbPath = await clipStore.resolveAsset('thumb', id).catch(() => null)
  if (thumbPath) {
    const thumb = nativeImage.createFromPath(thumbPath)
    if (!thumb.isEmpty()) return thumb.resize({ height: DRAG_ICON_HEIGHT })
  }

  const fileIcon = await app.getFileIcon(filePath).catch(() => null)
  if (fileIcon && !fileIcon.isEmpty()) return fileIcon

  return nativeImage.createFromPath(appIcon).resize({ height: 64 })
}

export const registerClipboardHandlers = ({ whenReady }: ClipboardHandlerDeps) => {
  const on = <T extends ClipChannel>(
    channel: T,
    handler: (...args: ChannelArgs<T>) => ChannelReturn<T> | Promise<ChannelReturn<T>>
  ) => {
    handle(channel, async (...args) => {
      await whenReady()
      return handler(...args)
    })
  }

  // ---- reading ----
  on('clip-list', async (query) => {
    const result = await clipStore.list(query)
    if (result.tookMs > 80) {
      mainLogger.info('[clip-search] slow list', {
        tookMs: result.tookMs,
        count: result.items.length,
        hasText: Boolean(query.text),
      })
    }
    return result
  })
  on('clip-get-detail', (id) => clipStore.getDetail(id))
  on('clip-list-apps', () => clipStore.listApps())
  on('clip-stats', () => clipStore.stats())

  // ---- paste / copy ----
  on('clip-paste', (ids, mode) => pasteService.paste(ids, mode))
  on('clip-copy', async (ids, mode) => {
    const result = await writeClipItems(ids, mode)
    return { ok: result.ok, reason: result.reason }
  })

  // ---- editing ----
  on('clip-delete', async (ids) => {
    const { deletedIds, undoToken } = await clipStore.softDelete(ids)
    return { ok: deletedIds.length > 0, deletedIds, undoToken }
  })
  on('clip-undo-delete', async (undoToken) => {
    const restoredIds = await clipStore.undoDelete(undoToken)
    return { ok: restoredIds.length > 0, restoredIds }
  })
  on('clip-rename', (id, title) => clipStore.rename(id, title))
  on('clip-update-text', (id, text) => clipStore.updateText(id, text))
  on('clip-create-text', (text) => clipStore.createTextItem(text))
  on('clip-clear-history', async () => {
    const deletedCount = await clipStore.clearHistory()
    mainLogger.info('[clip-store] history cleared', { deletedCount })
    return { ok: true, deletedCount }
  })

  // ---- open / reveal / drag ----
  on('clip-open', async (id) => {
    const detail = await clipStore.getDetail(id)
    if (!detail) return { ok: false }

    if (detail.kind === 'link' && detail.url) {
      return { ok: await openLink(detail.url) }
    }

    if (detail.kind === 'file') {
      const paths = detail.filePaths.slice(0, MAX_FILES_TO_OPEN)
      const errors = await Promise.all(paths.map((path) => shell.openPath(path)))
      return { ok: paths.length > 0 && errors.every((error) => error === '') }
    }

    if (detail.kind === 'image') {
      const imagePath = await clipStore.resolveAsset('image', id)
      return { ok: Boolean(imagePath) && (await shell.openPath(imagePath!)) === '' }
    }

    const text = detail.plainText?.trim()
    if (text && /^https?:\/\/\S+$/i.test(text)) {
      return { ok: await openLink(text) }
    }

    return { ok: false }
  })

  on('clip-reveal', async (id) => {
    const detail = await clipStore.getDetail(id)
    if (!detail) return { ok: false }

    if (detail.kind === 'file' && detail.filePaths[0]) {
      shell.showItemInFolder(detail.filePaths[0])
      return { ok: true }
    }

    if (detail.kind === 'image') {
      const imagePath = await clipStore.resolveAsset('image', id)
      if (imagePath) {
        shell.showItemInFolder(imagePath)
        return { ok: true }
      }
    }

    return { ok: false }
  })

  on('clip-start-drag', async (id) => {
    const detail = await clipStore.getDetail(id)
    if (!detail) return { ok: false }

    let files: string[] = []
    if (detail.kind === 'file') {
      files = detail.filePaths.filter((path) => existsSync(path))
    } else if (detail.kind === 'image') {
      const imagePath = await clipStore.resolveAsset('image', id)
      files = imagePath ? [imagePath] : []
    }

    if (files.length === 0) {
      mainLogger.info('[clip-panel] drag not supported for item', { id, kind: detail.kind })
      return { ok: false }
    }

    const icon = await resolveDragIcon(id, files[0])
    const ok = clipboardPanel.startDrag({ file: files[0], files, icon })
    mainLogger.info('[clip-panel] drag started', { id, kind: detail.kind, files: files.length, ok })
    return { ok }
  })

  // ---- pinboards ----
  on('clip-pinboards-list', () => clipStore.listPinboards())
  on('clip-pinboard-create', (name, color) => clipStore.createPinboard(name, color))
  on('clip-pinboard-update', (id, patch) => clipStore.updatePinboard(id, patch))
  on('clip-pinboard-delete', async (id) => {
    await clipStore.deletePinboard(id)
    return { ok: true }
  })
  on('clip-pinboards-reorder', async (ids) => {
    await clipStore.reorderPinboards(ids)
    return { ok: true }
  })
  on('clip-pinboard-add', async (pinboardId, itemIds) => {
    await clipStore.addToPinboard(pinboardId, itemIds)
    return { ok: true }
  })
  on('clip-pinboard-remove', async (pinboardId, itemIds) => {
    await clipStore.removeFromPinboard(pinboardId, itemIds)
    return { ok: true }
  })
  on('clip-pinboard-reorder-items', async (pinboardId, itemIds) => {
    await clipStore.reorderPinboardItems(pinboardId, itemIds)
    return { ok: true }
  })

  // ---- AI search ----
  const aiPort: ClipAiSearchPort = {
    listApps: () => clipStore.listApps(),
    getAiCandidates: (query) => clipStore.getAiCandidates(query),
    getItemsByIds: (ids) => clipStore.getItemsByIds(ids),
  }
  let aiController: AbortController | null = null

  on('clip-ai-search', async ({ text, filters }) => {
    // Only the latest search matters.
    aiController?.abort()
    const controller = new AbortController()
    aiController = controller

    const startedAt = performance.now()
    const settings = getClipboardSettings().ai
    mainLogger.info('[clip-ai] search start', {
      textLength: text.length,
      kinds: filters.kinds?.length ?? 0,
      apps: filters.appBundleIds?.length ?? 0,
      hasDateRange: Boolean(filters.dateRange),
      model: settings.model,
    })

    let result: ClipAiSearchResult
    try {
      result = await runAiSearch({
        text,
        filters,
        settings,
        port: aiPort,
        now: Date.now(),
        signal: controller.signal,
      })
    } catch (error) {
      const cancelled = controller.signal.aborted
      result = {
        status: 'error',
        items: [],
        scores: [],
        tookMs: Math.round(performance.now() - startedAt),
        errorMessage: cancelled ? 'cancelled' : error instanceof Error ? error.message : String(error),
      }
    } finally {
      if (aiController === controller) aiController = null
    }

    mainLogger.info('[clip-ai] search done', {
      status: result.status,
      count: result.items.length,
      inputTokens: result.inputTokens ?? 0,
      tookMs: result.tookMs,
      totalMs: Math.round(performance.now() - startedAt),
      error: result.errorMessage,
    })

    if (result.inputTokens) {
      void recordClipboardAiUsage(result.inputTokens)
    }

    return result
  })

  handle('clip-ai-cancel', () => {
    const active = aiController !== null
    aiController?.abort()
    aiController = null
    if (active) mainLogger.info('[clip-ai] search cancelled')
    return { ok: true }
  })

  on('clip-ai-test', async (settings) => {
    const startedAt = performance.now()
    const result = await testJevConnection(settings)
    mainLogger.info('[clip-ai] test connection', {
      ok: result.ok,
      model: result.model,
      error: result.errorMessage,
      ms: Math.round(performance.now() - startedAt),
    })
    return result
  })

  // ---- panel window ----
  // These do not touch the store, so they must keep working even if it failed to initialise.
  handle('clip-panel-show', async (initialQuery) => {
    // Opened from the launcher: hide it first so it does not fight the panel for focus.
    hideMainWindow()
    await clipboardPanel.show({ initialQuery, source: 'launcher' })
    return { ok: true }
  })
  handle('clip-panel-hide', () => {
    clipboardPanel.hideNow('renderer')
    return { ok: true }
  })
  handle('clip-panel-set-height', (height) => {
    clipboardPanel.setHeight(height)
    return { ok: true }
  })

  // ---- paste stack / permissions ----
  on('clip-paste-stack-toggle', () => pasteStack.toggle())
  on('clip-paste-stack-state', () => pasteStack.getState())
  handle('clip-permission-status', () => ({
    accessibility: clipboardNative.isAccessibilityTrusted(),
    secureInput: clipboardNative.isSecureInputEnabled(),
  }))
  handle('clip-open-accessibility-settings', async () => {
    try {
      await shell.openExternal(ACCESSIBILITY_SETTINGS_URL)
      return { ok: true }
    } catch (error) {
      mainLogger.warn('[clip-panel] failed to open accessibility settings', { error: String(error) })
      return { ok: false }
    }
  })
}
