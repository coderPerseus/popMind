import { capabilityStore } from '@/lib/capability/store'
import type { TranslationSettings, TranslationSettingsPatch } from './types'

export class TranslationStore {
  async getSettings() {
    return capabilityStore.getSettings() as Promise<TranslationSettings>
  }

  async updateSettings(patch: TranslationSettingsPatch) {
    return capabilityStore.updateSettings(patch) as Promise<TranslationSettings>
  }
}

export const translationStore = new TranslationStore()
