import { z } from 'zod'
import type {
  ClipAiSearchResult,
  ClipAiTestResult,
  ClipDeleteResult,
  ClipDetail,
  ClipListItem,
  ClipListResult,
  ClipPasteResult,
  ClipPasteStackState,
  ClipSourceApp,
  ClipStats,
  ClipWriteResult,
  Pinboard,
} from '@/lib/clipboard/types'

/** Main → renderer push channels of the clipboard panel. */
export const ClipboardChannel = {
  /** ClipItemsChangedEvent */
  ItemsChanged: 'clip:items-changed',
  /** ClipPanelShowEvent — panel is about to slide in. */
  PanelShow: 'clip:panel-show',
  /** No payload — main wants the panel closed (blur, shortcut toggle); renderer animates out then calls clip-panel-hide. */
  PanelRequestHide: 'clip:panel-request-hide',
  /** ClipPasteStackState */
  PasteStack: 'clip:paste-stack',
} as const

const clipKindSchema = z.enum(['text', 'link', 'image', 'file', 'color'])
const clipDateRangeSchema = z.object({ from: z.number().optional(), to: z.number().optional() })
const clipScopeSchema = z.union([
  z.object({ type: z.literal('history') }),
  z.object({ type: z.literal('pinboard'), pinboardId: z.string() }),
])
const clipQuerySchema = z.object({
  text: z.string().optional(),
  scope: clipScopeSchema.optional(),
  kinds: z.array(clipKindSchema).optional(),
  appBundleIds: z.array(z.string()).optional(),
  dateRange: clipDateRangeSchema.optional(),
  cursor: z.string().optional(),
  limit: z.number().int().positive().max(200).optional(),
})
const clipPasteModeSchema = z.enum(['default', 'plainText'])
const clipIdsSchema = z.array(z.string()).min(1)
const okSchema = z.object({ ok: z.boolean() })
const clipAiSettingsSchema = z.object({
  enabled: z.boolean(),
  provider: z.literal('jev'),
  apiKey: z.string(),
  model: z.string(),
  trigger: z.enum(['manual', 'auto']),
  usage: z.object({ month: z.string(), inputTokens: z.number() }),
})

// Return values are produced by our own main process; validate their shape loosely.
const clipListResultSchema = z.custom<ClipListResult>()
const clipListItemSchema = z.custom<ClipListItem>()
const clipDetailSchema = z.custom<ClipDetail>()
const pinboardSchema = z.custom<Pinboard>()

/** Clipboard channels (docs/clipboard-paste-redesign.md). */
export const clipIpcSchema = {
  'clip-list': { args: z.tuple([clipQuerySchema]), return: clipListResultSchema },
  'clip-get-detail': { args: z.tuple([z.string()]), return: clipDetailSchema.nullable() },
  /** Paste one or more items into the frontmost app (multi-select joins text with newlines). */
  'clip-paste': { args: z.tuple([clipIdsSchema, clipPasteModeSchema]), return: z.custom<ClipPasteResult>() },
  /** Only put items on the clipboard. */
  'clip-copy': { args: z.tuple([clipIdsSchema, clipPasteModeSchema]), return: z.custom<ClipWriteResult>() },
  'clip-delete': { args: z.tuple([clipIdsSchema]), return: z.custom<ClipDeleteResult>() },
  'clip-undo-delete': {
    args: z.tuple([z.string()]),
    return: z.object({ ok: z.boolean(), restoredIds: z.array(z.string()) }),
  },
  'clip-rename': { args: z.tuple([z.string(), z.string().nullable()]), return: clipListItemSchema.nullable() },
  'clip-update-text': { args: z.tuple([z.string(), z.string()]), return: clipListItemSchema.nullable() },
  'clip-create-text': { args: z.tuple([z.string().min(1)]), return: clipListItemSchema },
  /** Open link in browser / file with default app. */
  'clip-open': { args: z.tuple([z.string()]), return: okSchema },
  'clip-reveal': { args: z.tuple([z.string()]), return: okSchema },
  /** Start a native drag of an image / file item out of the panel. */
  'clip-start-drag': { args: z.tuple([z.string()]), return: okSchema },
  'clip-pinboards-list': { args: z.tuple([]), return: z.array(pinboardSchema) },
  'clip-pinboard-create': { args: z.tuple([z.string().min(1), z.string()]), return: pinboardSchema },
  'clip-pinboard-update': {
    args: z.tuple([z.string(), z.object({ name: z.string().min(1).optional(), color: z.string().optional() })]),
    return: pinboardSchema.nullable(),
  },
  'clip-pinboard-delete': { args: z.tuple([z.string()]), return: okSchema },
  'clip-pinboards-reorder': { args: z.tuple([z.array(z.string())]), return: okSchema },
  'clip-pinboard-add': { args: z.tuple([z.string(), clipIdsSchema]), return: okSchema },
  'clip-pinboard-remove': { args: z.tuple([z.string(), clipIdsSchema]), return: okSchema },
  'clip-pinboard-reorder-items': { args: z.tuple([z.string(), z.array(z.string())]), return: okSchema },
  'clip-list-apps': { args: z.tuple([]), return: z.custom<ClipSourceApp[]>() },
  'clip-ai-search': {
    args: z.tuple([
      z.object({
        text: z.string(),
        filters: clipQuerySchema.pick({ kinds: true, appBundleIds: true, dateRange: true, scope: true }),
      }),
    ]),
    return: z.custom<ClipAiSearchResult>(),
  },
  'clip-ai-cancel': { args: z.tuple([]), return: okSchema },
  'clip-ai-test': { args: z.tuple([clipAiSettingsSchema]), return: z.custom<ClipAiTestResult>() },
  'clip-stats': { args: z.tuple([]), return: z.custom<ClipStats>() },
  'clip-clear-history': { args: z.tuple([]), return: z.object({ ok: z.boolean(), deletedCount: z.number() }) },
  /** Open the clipboard panel (e.g. from the launcher's `/clip`), optionally with an initial search text. */
  'clip-panel-show': { args: z.tuple([z.string().optional()]), return: okSchema },
  /** Renderer finished its exit animation (or wants to close); main hides the window. */
  'clip-panel-hide': { args: z.tuple([]), return: okSchema },
  /** Renderer drag-resized the panel's top edge. */
  'clip-panel-set-height': { args: z.tuple([z.number().int().min(280).max(900)]), return: okSchema },
  'clip-paste-stack-toggle': { args: z.tuple([]), return: z.custom<ClipPasteStackState>() },
  'clip-paste-stack-state': { args: z.tuple([]), return: z.custom<ClipPasteStackState>() },
  'clip-permission-status': {
    args: z.tuple([]),
    return: z.object({ accessibility: z.boolean(), secureInput: z.boolean() }),
  },
  'clip-open-accessibility-settings': { args: z.tuple([]), return: okSchema },
} as const

export const clipboardIpcSchema = clipIpcSchema
