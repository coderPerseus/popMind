import { z } from 'zod'

const explainMessageSourceSchema = z.object({
  title: z.string(),
  url: z.string(),
  snippet: z.string(),
  provider: z.string(),
})

export const explainIpcSchema = {
  'explain-run': {
    args: z.tuple([
      z.object({
        text: z.string(),
      }),
    ]),
    return: z.object({
      text: z.string(),
      language: z.enum(['zh-CN', 'en']),
      aiProvider: z.enum(['openai', 'anthropic', 'google', 'kimi', 'deepseek']),
      modelId: z.string(),
      webSearchProvider: z.enum(['tavily', 'serper', 'brave', 'jina']).optional(),
      sources: z.array(explainMessageSourceSchema),
    }),
  },
}
