// Runtime wiring of write-back, direct paste and Paste Stack (the logic itself lives in the pure modules).
import { clipboardEvents } from '@/lib/clipboard/events'
import { clipboardNative } from '@/lib/clipboard/native-bridge'
import { clipStore } from '@/lib/clipboard/store'
import { clipboardPanel } from '@/lib/clipboard/window/clipboard-panel-window'
import { mainLogger } from '@/lib/main/logger'
import { createPasteService } from './paste-service'
import { createPasteStack } from './paste-stack'
import { getClipboardSettings } from './settings'
import { writeClipItems } from './writer'

/** Marker written for items the Paste Stack puts back on the pasteboard (capture must not treat it as a copy). */
export const PASTE_STACK_MARKER = 'paste-stack'

const log = (message: string, details?: Record<string, unknown>) => {
  if (details) {
    mainLogger.info(message, details)
  } else {
    mainLogger.info(message)
  }
}

export const pasteService = createPasteService({
  getSettings: getClipboardSettings,
  writeItems: (ids, mode) => writeClipItems(ids, mode),
  getTarget: () => clipboardPanel.getTarget(),
  hidePanel: (reason) => clipboardPanel.hideNow(reason),
  markUsed: (id) => clipStore.markUsed(id),
  native: {
    isAccessibilityTrusted: clipboardNative.isAccessibilityTrusted,
    isSecureInputEnabled: clipboardNative.isSecureInputEnabled,
    getFrontmostApp: clipboardNative.getFrontmostApp,
    postPasteKeystroke: clipboardNative.postPasteKeystroke,
    activateAppAndPaste: clipboardNative.activateAppAndPaste,
  },
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => performance.now(),
  log,
})

export const pasteStack = createPasteStack({
  getItemsByIds: (ids) => clipStore.getItemsByIds(ids),
  writeToPasteboard: async (id) => (await writeClipItems([id], 'default', { marker: PASTE_STACK_MARKER })).ok,
  startMonitor: (onUserPaste) =>
    clipboardNative.startPasteMonitor((event) => {
      if (event.type === 'user-paste') onUserPaste()
    }),
  stopMonitor: () => {
    clipboardNative.stopPasteMonitor()
  },
  subscribeItemsChanged: (handler) => {
    clipboardEvents.on('items-changed', handler)
    return () => {
      clipboardEvents.off('items-changed', handler)
    }
  },
  emitState: (state) => {
    clipboardEvents.emit('paste-stack', state)
  },
  setTimer: (callback, ms) => {
    const timer = setTimeout(callback, ms)
    return () => clearTimeout(timer)
  },
  now: () => Date.now(),
  log,
})

export { writeClipItems }
