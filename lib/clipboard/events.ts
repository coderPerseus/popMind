// In-process event bus of the clipboard feature (main process only).
// Producers: store / capture / paste-stack. Consumer: the panel window, which forwards to the renderer.
import { EventEmitter } from 'node:events'
import type { ClipItemsChangedEvent, ClipPasteStackState, ClipSyncStatus } from '@/lib/clipboard/types'

type ClipboardEventMap = {
  'items-changed': [ClipItemsChangedEvent]
  'paste-stack': [ClipPasteStackState]
  'sync-status': [ClipSyncStatus]
}

export const clipboardEvents = new EventEmitter<ClipboardEventMap>()
