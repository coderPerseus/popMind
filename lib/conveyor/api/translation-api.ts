import { ConveyorApi } from '@/lib/preload/shared'
import type { TranslateInput, TranslationSettingsPatch } from '@/lib/translation/types'

export class TranslationApi extends ConveyorApi {
  getSettings = () => this.invoke('translation-get-settings')
  updateSettings = (patch: TranslationSettingsPatch) => this.invoke('translation-update-settings', patch)
  translate = (input: TranslateInput) => this.invoke('translation-translate', input)
}
