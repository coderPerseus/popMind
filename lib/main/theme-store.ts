import { app, nativeTheme } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { ThemeMode } from '@/lib/theme/shared'

type ThemeSettings = {
  mode: ThemeMode
}

const DEFAULT_THEME_MODE: ThemeMode = 'system'

export class ThemeStore {
  private mode: ThemeMode = DEFAULT_THEME_MODE

  private getFilePath() {
    return join(app.getPath('userData'), 'theme-settings.json')
  }

  private async persist(mode: ThemeMode) {
    const filePath = this.getFilePath()
    await mkdir(dirname(filePath), { recursive: true })
    await writeFile(filePath, JSON.stringify({ mode }, null, 2), 'utf-8')
  }

  private apply(mode: ThemeMode) {
    this.mode = mode
    nativeTheme.themeSource = mode
  }

  async initialize() {
    const filePath = this.getFilePath()

    try {
      const raw = await readFile(filePath, 'utf-8')
      const parsed = JSON.parse(raw) as Partial<ThemeSettings>
      const nextMode = parsed.mode ?? DEFAULT_THEME_MODE
      this.apply(nextMode)
      return nextMode
    } catch {
      this.apply(DEFAULT_THEME_MODE)
      await this.persist(DEFAULT_THEME_MODE)
      return DEFAULT_THEME_MODE
    }
  }

  getThemeMode() {
    return this.mode
  }

  async setThemeMode(mode: ThemeMode) {
    this.apply(mode)
    await this.persist(mode)
    return this.mode
  }
}

export const themeStore = new ThemeStore()
