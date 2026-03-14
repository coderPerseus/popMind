import { z } from 'zod'
import { capabilityRuntimeSchema } from './capability-schema'

const engineIds = z.enum(['google', 'deepl', 'bing', 'youdao', 'ai'])
const queryModeSchema = z.enum(['text', 'word'])

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
    return: capabilityRuntimeSchema.capabilitySettingsSchema,
  },
  'translation-update-settings': {
    args: z.tuple([capabilityRuntimeSchema.capabilitySettingsPatchSchema]),
    return: capabilityRuntimeSchema.capabilitySettingsSchema,
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
