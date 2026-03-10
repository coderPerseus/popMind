import { z } from 'zod'

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
  lastSearchedAt: z.number().optional(),
  storagePath: z.string(),
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
    args: z.tuple([]),
    return: searchHistorySummarySchema,
  },
  'search-history-export': {
    args: z.tuple([]),
    return: z.object({
      canceled: z.boolean(),
      filePath: z.string().optional(),
      count: z.number(),
    }),
  },
  'search-history-clear': {
    args: z.tuple([]),
    return: z.object({
      deletedCount: z.number(),
    }),
  },
}
