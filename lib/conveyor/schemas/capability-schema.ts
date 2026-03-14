import { z } from 'zod'

const appLanguageSchema = z.enum(['zh-CN', 'en'])
const translationEngineIdSchema = z.enum(['google', 'deepl', 'bing', 'youdao', 'ai'])
const aiProviderSchema = z.enum(['openai', 'anthropic', 'google', 'kimi', 'deepseek'])
const webSearchProviderSchema = z.enum(['tavily', 'serper', 'brave', 'jina'])

const aiProviderConfigSchema = z.object({
  apiKey: z.string(),
  baseURL: z.string().optional(),
  model: z.string().optional(),
})

const webSearchProviderConfigSchema = z.object({
  apiKey: z.string(),
})

const capabilitySettingsSchema = z.object({
  appLanguage: appLanguageSchema,
  enabledEngines: z.object({
    google: z.boolean(),
    deepl: z.boolean(),
    bing: z.boolean(),
    youdao: z.boolean(),
    ai: z.boolean(),
  }),
  firstLanguage: z.string(),
  secondLanguage: z.string(),
  defaultSourceLanguage: z.string(),
  aiService: z.object({
    activeProvider: aiProviderSchema.nullable(),
    providers: z.object({
      openai: aiProviderConfigSchema,
      anthropic: aiProviderConfigSchema,
      google: aiProviderConfigSchema,
      kimi: aiProviderConfigSchema,
      deepseek: aiProviderConfigSchema,
    }),
  }),
  webSearch: z.object({
    enabled: z.boolean(),
    providers: z.object({
      tavily: webSearchProviderConfigSchema,
      serper: webSearchProviderConfigSchema,
      brave: webSearchProviderConfigSchema,
      jina: webSearchProviderConfigSchema,
    }),
  }),
})

const capabilitySettingsPatchSchema = z.object({
  appLanguage: appLanguageSchema.optional(),
  enabledEngines:
    z
      .object({
        google: z.boolean(),
        deepl: z.boolean(),
        bing: z.boolean(),
        youdao: z.boolean(),
        ai: z.boolean(),
      })
      .partial()
      .optional(),
  firstLanguage: z.string().optional(),
  secondLanguage: z.string().optional(),
  defaultSourceLanguage: z.string().optional(),
  aiService: z
    .object({
      activeProvider: aiProviderSchema.nullable().optional(),
      providers: z
        .object({
          openai: aiProviderConfigSchema.partial().optional(),
          anthropic: aiProviderConfigSchema.partial().optional(),
          google: aiProviderConfigSchema.partial().optional(),
          kimi: aiProviderConfigSchema.partial().optional(),
          deepseek: aiProviderConfigSchema.partial().optional(),
        })
        .partial()
        .optional(),
    })
    .optional(),
  webSearch: z
    .object({
      enabled: z.boolean().optional(),
      providers: z
        .object({
          tavily: webSearchProviderConfigSchema.partial().optional(),
          serper: webSearchProviderConfigSchema.partial().optional(),
          brave: webSearchProviderConfigSchema.partial().optional(),
          jina: webSearchProviderConfigSchema.partial().optional(),
        })
        .partial()
        .optional(),
    })
    .optional(),
})

const aiServiceTestResultSchema = z.object({
  ok: z.boolean(),
  providerId: aiProviderSchema.nullable(),
  modelId: z.string().nullable(),
  errorCode: z.enum(['missing-config', 'request-failed']).optional(),
  errorMessage: z.string().optional(),
})

const webSearchServiceTestResultSchema = z.object({
  ok: z.boolean(),
  providerId: webSearchProviderSchema,
  resultCount: z.number(),
  errorCode: z.enum(['missing-config', 'request-failed']).optional(),
  errorMessage: z.string().optional(),
})

export const capabilityIpcSchema = {
  'capability-get-settings': {
    args: z.tuple([]),
    return: capabilitySettingsSchema,
  },
  'capability-update-settings': {
    args: z.tuple([capabilitySettingsPatchSchema]),
    return: capabilitySettingsSchema,
  },
  'capability-test-ai-service': {
    args: z.tuple([capabilitySettingsSchema]),
    return: aiServiceTestResultSchema,
  },
  'capability-test-web-search-provider': {
    args: z.tuple([capabilitySettingsSchema, webSearchProviderSchema]),
    return: webSearchServiceTestResultSchema,
  },
}

export const capabilityRuntimeSchema = {
  appLanguageSchema,
  translationEngineIdSchema,
  aiProviderSchema,
  webSearchProviderSchema,
  capabilitySettingsSchema,
  capabilitySettingsPatchSchema,
  aiServiceTestResultSchema,
  webSearchServiceTestResultSchema,
}
