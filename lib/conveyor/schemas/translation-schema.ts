import { z } from 'zod'

const engineIds = z.enum(['google', 'deepl', 'bing', 'youdao', 'deepseek'])

const enabledEnginesSchema = z.object({
  google: z.boolean(),
  deepl: z.boolean(),
  bing: z.boolean(),
  youdao: z.boolean(),
  deepseek: z.boolean(),
})

const translationSettingsSchema = z.object({
  enabledEngines: enabledEnginesSchema,
  firstLanguage: z.string(),
  secondLanguage: z.string(),
  defaultSourceLanguage: z.string(),
  ai: z.object({
    deepseekApiKey: z.string(),
    deepseekBaseUrl: z.string().optional(),
    deepseekModel: z.string().optional(),
  }),
})

const translationSettingsPatchSchema = z.object({
  enabledEngines: enabledEnginesSchema.partial().optional(),
  firstLanguage: z.string().optional(),
  secondLanguage: z.string().optional(),
  defaultSourceLanguage: z.string().optional(),
  ai: z
    .object({
      deepseekApiKey: z.string().optional(),
      deepseekBaseUrl: z.string().optional(),
      deepseekModel: z.string().optional(),
    })
    .optional(),
})

const translationResultSchema = z.object({
  engineId: engineIds,
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  sourceText: z.string(),
  translatedText: z.string(),
  detectedSourceLanguage: z.string().optional(),
})

export const translationIpcSchema = {
  'translation-get-settings': {
    args: z.tuple([]),
    return: translationSettingsSchema,
  },
  'translation-update-settings': {
    args: z.tuple([translationSettingsPatchSchema]),
    return: translationSettingsSchema,
  },
  'translation-translate': {
    args: z.tuple([
      z.object({
        text: z.string(),
        sourceLanguage: z.string().optional(),
        targetLanguage: z.string().optional(),
        engineId: engineIds.optional(),
        selectionId: z.string().optional(),
        sourceAppId: z.string().optional(),
      }),
    ]),
    return: translationResultSchema,
  },
}
