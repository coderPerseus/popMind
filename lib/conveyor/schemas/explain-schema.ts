import { z } from 'zod'

const explainMessageSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  provider: z.string(),
})

const explainSessionMessageSchema = z.object({
  id: z.string(),
  role: z.enum(['user', 'assistant']),
  text: z.string(),
  createdAt: z.number(),
  sources: z.array(explainMessageSourceSchema).optional(),
  errorMessage: z.string().optional(),
})

const explainSessionSchema = z.object({
  id: z.string(),
  mode: z.enum(['explain', 'chat']),
  providerId: z.enum(['openai', 'anthropic', 'google', 'kimi', 'deepseek', 'gemma']).optional(),
  selectionText: z.string(),
  messages: z.array(explainSessionMessageSchema),
  status: z.enum(['idle', 'searching', 'streaming', 'ready', 'error']),
  language: z.enum(['zh-CN', 'en']),
  aiProvider: z.enum(['openai', 'anthropic', 'google', 'kimi', 'deepseek', 'gemma']).optional(),
  modelId: z.string().optional(),
  webSearchEnabled: z.boolean(),
  webSearchProvider: z.enum(['tavily', 'serper', 'brave', 'jina']).optional(),
  errorMessage: z.string().optional(),
  loadingMessage: z.string().optional(),
})

const explainStateSchema = z.object({
  session: explainSessionSchema.nullable(),
})

export const explainIpcSchema = {
  'explain-get-state': {
    args: z.tuple([]),
    return: explainStateSchema,
  },
  'explain-start': {
    args: z.tuple([
      z.string(),
      z.enum(['explain', 'chat']).optional(),
      z.enum(['openai', 'anthropic', 'google', 'kimi', 'deepseek', 'gemma']).optional(),
      z.boolean().optional(),
    ]),
    return: z.object({ ok: z.boolean() }),
  },
  'explain-submit': {
    args: z.tuple([z.string()]),
    return: z.object({ ok: z.boolean() }),
  },
  'explain-regenerate': {
    args: z.tuple([]),
    return: z.object({ ok: z.boolean() }),
  },
  'explain-stop': {
    args: z.tuple([]),
    return: z.object({ ok: z.boolean() }),
  },
  'explain-reset': {
    args: z.tuple([]),
    return: z.object({ ok: z.boolean() }),
  },
  'explain-set-web-search': {
    args: z.tuple([z.boolean()]),
    return: z.object({ ok: z.boolean(), enabled: z.boolean() }),
  },
  'explain-set-provider': {
    args: z.tuple([z.enum(['openai', 'anthropic', 'google', 'kimi', 'deepseek', 'gemma'])]),
    return: z.object({ ok: z.boolean(), providerId: z.enum(['openai', 'anthropic', 'google', 'kimi', 'deepseek', 'gemma']) }),
  },
}
