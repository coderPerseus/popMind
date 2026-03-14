import { app, BrowserWindow } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  defaultCapabilitySettings,
  getCapabilitySettingsFilePath,
  getLegacyTranslationSettingsFilePath,
  mergeCapabilitySettings,
  migrateLegacyTranslationSettings,
} from './shared'
import type { CapabilitySettings, CapabilitySettingsPatch, LegacyTranslationSettings } from './types'

export const CapabilityChannel = {
  State: 'capability:state',
  GetSettings: 'capability:getSettings',
  UpdateSettings: 'capability:updateSettings',
} as const

export class CapabilityStore {
  private cache: CapabilitySettings | null = null
  private listeners = new Set<(settings: CapabilitySettings) => void>()

  private async persistSettings(settings: CapabilitySettings) {
    const filePath = getCapabilitySettingsFilePath()
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify(settings, null, 2), 'utf-8')
  }

  private broadcast(settings: CapabilitySettings) {
    for (const listener of this.listeners) {
      listener(settings)
    }

    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(CapabilityChannel.State, settings)
      }
    }
  }

  private createDefaultSettings() {
    return mergeCapabilitySettings(defaultCapabilitySettings, {
      appLanguage: app.getLocale().toLowerCase().startsWith('en') ? 'en' : 'zh-CN',
    })
  }

  async getSettings() {
    if (this.cache) {
      return this.cache
    }

    const filePath = getCapabilitySettingsFilePath()

    try {
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<CapabilitySettings>
      this.cache = mergeCapabilitySettings(defaultCapabilitySettings, parsed)
      return this.cache
    } catch {
      const settings = await this.migrateOrCreate()
      this.cache = settings
      return settings
    }
  }

  private async migrateOrCreate() {
    const legacyPath = getLegacyTranslationSettingsFilePath()

    try {
      const raw = await readFile(legacyPath, 'utf-8')
      const parsed = JSON.parse(raw) as LegacyTranslationSettings
      const migrated = migrateLegacyTranslationSettings(parsed, app.getLocale())
      await this.persistSettings(migrated)
      return migrated
    } catch {
      const created = mergeCapabilitySettings(this.createDefaultSettings(), {
        appLanguage: app.getLocale().toLowerCase().startsWith('en') ? 'en' : 'zh-CN',
      })
      await this.persistSettings(created)
      return created
    }
  }

  async updateSettings(patch: CapabilitySettingsPatch) {
    const previous = await this.getSettings()
    const next = mergeCapabilitySettings(previous, patch)
    await this.persistSettings(next)
    this.cache = next
    this.broadcast(next)
    return next
  }

  subscribe(listener: (settings: CapabilitySettings) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }
}

export const capabilityStore = new CapabilityStore()
