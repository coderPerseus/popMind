import { handle } from '@/lib/main/shared'
import { translationService } from '@/lib/translation/service'
import type { TranslateInput, TranslationSettingsPatch } from '@/lib/translation/types'

export const registerTranslationHandlers = () => {
  handle('translation-get-settings', () => translationService.getSettings())
  handle('translation-update-settings', (patch: TranslationSettingsPatch) => translationService.updateSettings(patch))
  handle('translation-translate', (input: TranslateInput) => translationService.translate(input))
}
