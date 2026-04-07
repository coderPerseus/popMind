import { z } from 'zod'

const clipboardFilterSchema = z.enum(['all', 'text', 'image', 'file', 'link', 'color'])

const clipboardSourceAppSchema = z.object({
  name: z.string().optional(),
  bundleId: z.string().optional(),
  pid: z.number().optional(),
})

const clipboardImageSchema = z.object({
  width: z.number(),
  height: z.number(),
  thumbnailDataUrl: z.string().optional(),
})

const clipboardListItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'image', 'file', 'link', 'color']),
  title: z.string(),
  previewText: z.string(),
  primaryValue: z.string().optional(),
  sourceApp: clipboardSourceAppSchema.optional(),
  copiedAt: z.number(),
  createdAt: z.number(),
  updatedAt: z.number(),
  lastPastedAt: z.number().optional(),
  copyCount: z.number(),
  isPinned: z.boolean(),
  characterCount: z.number(),
  wordCount: z.number(),
  bytes: z.number(),
  fileCount: z.number(),
  image: clipboardImageSchema.optional(),
})

const clipboardEntrySchema = clipboardListItemSchema.extend({
  textContent: z.string().optional(),
  htmlContent: z.string().optional(),
  imageDataUrl: z.string().optional(),
  filePaths: z.array(z.string()),
})

export const clipboardIpcSchema = {
  'clipboard-history-list': {
    args: z.tuple([
      z
        .object({
          query: z.string().optional(),
          filter: clipboardFilterSchema.optional(),
          limit: z.number().optional(),
        })
        .optional(),
    ]),
    return: z.object({
      items: z.array(clipboardListItemSchema),
    }),
  },
  'clipboard-history-get': {
    args: z.tuple([z.string()]),
    return: clipboardEntrySchema.nullable(),
  },
  'clipboard-history-copy': {
    args: z.tuple([z.string()]),
    return: z.object({
      ok: z.boolean(),
      reason: z.enum(['not_found', 'write_failed', 'unsupported']).optional(),
    }),
  },
  'clipboard-history-paste': {
    args: z.tuple([z.string()]),
    return: z.object({
      ok: z.boolean(),
      reason: z.enum(['not_found', 'no_target', 'write_failed', 'paste_failed', 'unsupported']).optional(),
    }),
  },
  'clipboard-history-delete': {
    args: z.tuple([z.string()]),
    return: z.object({
      ok: z.boolean(),
      deletedCount: z.number(),
    }),
  },
  'clipboard-history-clear': {
    args: z.tuple([]),
    return: z.object({
      ok: z.boolean(),
      deletedCount: z.number(),
    }),
  },
  'clipboard-history-toggle-pin': {
    args: z.tuple([z.string()]),
    return: z.object({
      ok: z.boolean(),
      isPinned: z.boolean(),
    }),
  },
} as const
