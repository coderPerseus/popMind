import { z } from 'zod'

const historyTypeSchema = z.enum(['search', 'explain'])

const searchHistoryMetadataSchema = z.object({
  pluginType: z.string().optional(),
  resultText: z.string().optional(),
  sourceLanguage: z.string().optional(),
  targetLanguage: z.string().optional(),
  detectedSourceLanguage: z.string().optional(),
  engineId: z.string().optional(),
})

const searchHistorySummarySchema = z.object({
  totalCount: z.number(),
  retentionDays: z.number(),
  lastActivityAt: z.number().optional(),
  storagePath: z.string(),
})

const explainMessageSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  provider: z.string(),
})

const explainHistoryMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  createdAt: z.number(),
  sources: z.array(explainMessageSourceSchema).optional(),
  errorMessage: z.string().optional(),
})

const searchHistoryEntrySchema = z.object({
  id: z.string(),
  kind: z.enum(['plugin', 'command']),
  query: z.string(),
  actionId: z.string(),
  actionLabel: z.string(),
  metadata: searchHistoryMetadataSchema.optional(),
  createdAt: z.number(),
})

const explainHistoryEntrySchema = z.object({
  id: z.string(),
  selectionText: z.string(),
  messages: z.array(explainHistoryMessageSchema),
  aiProvider: z.string(),
  webSearchProvider: z.string().optional(),
  language: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
})

export const searchIpcSchema = {
  'search-history-record': {
    args: z.tuple([
      z.object({
        kind: z.enum(['plugin', 'command']),
        query: z.string(),
        actionId: z.string(),
        actionLabel: z.string(),
        metadata: searchHistoryMetadataSchema.optional(),
      }),
    ]),
    return: searchHistorySummarySchema,
  },
  'search-history-summary': {
    args: z.tuple([historyTypeSchema.optional()]),
    return: searchHistorySummarySchema,
  },
  'search-history-list': {
    args: z.tuple([historyTypeSchema, z.number().optional()]),
    return: z.array(z.union([searchHistoryEntrySchema, explainHistoryEntrySchema])),
  },
  'search-history-export': {
    args: z.tuple([historyTypeSchema.optional()]),
    return: z.object({
      canceled: z.boolean(),
      filePath: z.string().optional(),
      count: z.number(),
    }),
  },
  'search-history-clear': {
    args: z.tuple([historyTypeSchema.optional()]),
    return: z.object({
      deletedCount: z.number(),
    }),
  },
}
