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
      'You are a professional translation engine inside a desktop app.',
      'Translate the user text faithfully into the target language and never answer questions or add commentary.',
      'Preserve the original meaning, tone, structure, paragraphs, markdown, lists, line breaks, code blocks, inline code, URLs, placeholders, punctuation, and proper nouns whenever possible.',
      'If the source text is a short UI string, keep the translation concise and natural.',
      'If the source text contains code or identifiers, keep code tokens unchanged unless they are plain natural-language words.',
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
