import { Output, generateText, type LanguageModel } from 'ai'
import { z } from 'zod'
import { getLanguageLabel, trimTranslationText } from '@/lib/translation/shared'

const translationOutputSchema = z.object({
  translatedText: z.string().min(1),
  detectedSourceLanguage: z.string().min(1),
})

export const translateWithAi = async ({
  model,
  text,
  sourceLanguage,
  targetLanguage,
}: {
  model: LanguageModel
  text: string
  sourceLanguage: string
  targetLanguage: string
}) => {
  const { output } = await generateText({
    model,
    temperature: 0.1,
    output: Output.object({
      schema: translationOutputSchema,
    }),
    system: [
      'You are a professional translation engine.',
      'Translate the user text faithfully into the target language.',
      'Do not explain, annotate, or answer questions.',
      'Preserve the original meaning, formatting, line breaks, punctuation, names, and code blocks whenever possible.',
      'Return only the requested JSON fields.',
      'detectedSourceLanguage must be a language code such as en, zh-CN, ja, ko, fr, de, es, ru, it, pt, or auto only when detection truly fails.',
    ].join(' '),
    prompt: [
      `sourceLanguage: ${sourceLanguage} (${getLanguageLabel(sourceLanguage)})`,
      `targetLanguage: ${targetLanguage} (${getLanguageLabel(targetLanguage)})`,
      'text:',
      text,
    ].join('\n'),
  })

  return {
    translatedText: trimTranslationText(output.translatedText),
    detectedSourceLanguage: output.detectedSourceLanguage.trim(),
  }
}
