import { z } from 'zod'

const engineIds = z.enum(['google', 'deepl', 'bing', 'youdao', 'deepseek'])
const queryModeSchema = z.enum(['text', 'word'])

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

const wordEntrySchema = z.object({
  headword: z.string(),
  phonetics: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
    }),
  ),
  definitions: z.array(
    z.object({
      part: z.string().optional(),
      meaning: z.string(),
    }),
  ),
  forms: z.array(
    z.object({
      label: z.string(),
      value: z.string(),
    }),
  ),
  phrases: z.array(
    z.object({
      text: z.string(),
      meaning: z.string(),
    }),
  ),
  examples: z.array(
    z.object({
      source: z.string(),
      translated: z.string(),
    }),
  ),
})

const translationResultSchema = z.object({
  engineId: engineIds,
  queryMode: queryModeSchema,
  sourceLanguage: z.string(),
  targetLanguage: z.string(),
  sourceText: z.string(),
  translatedText: z.string(),
  detectedSourceLanguage: z.string().optional(),
  wordEntry: wordEntrySchema.optional(),
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
        queryMode: queryModeSchema.optional(),
        engineId: engineIds.optional(),
        selectionId: z.string().optional(),
        sourceAppId: z.string().optional(),
      }),
    ]),
    return: translationResultSchema,
  },
}
