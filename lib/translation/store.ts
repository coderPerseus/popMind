import { app } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { defaultTranslationSettings, mergeSettings } from './shared'
import type { TranslationSettings, TranslationSettingsPatch } from './types'

export class TranslationStore {
  private cache: TranslationSettings | null = null

  private createDefaultSettings() {
    return mergeSettings(defaultTranslationSettings, {})
  }

  private getFilePath() {
    return join(app.getPath('userData'), 'translation-settings.json')
  }

  private async persistSettings(settings: TranslationSettings) {
    const filePath = this.getFilePath()
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8')
  }

  async getSettings() {
    if (this.cache) {
      return this.cache
    }

    const filePath = this.getFilePath()

    try {
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<TranslationSettings>
      this.cache = mergeSettings(defaultTranslationSettings, parsed)
      return this.cache
    } catch {
      this.cache = this.createDefaultSettings()
      await this.persistSettings(this.cache)
      return this.cache
    }
  }

  async updateSettings(patch: TranslationSettingsPatch) {
    const previous = await this.getSettings()
    const next = mergeSettings(previous, patch)
    await this.persistSettings(next)

    this.cache = next
    return next
  }
}

export const translationStore = new TranslationStore()
