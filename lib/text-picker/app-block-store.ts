import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const fileName = 'text-picker-blocked-apps.json'

class TextPickerAppBlockStore {
  private apps = new Set<string>()

  constructor() {
    this.load()
  }

  getAll() {
    return [...this.apps]
  }

  add(bundleId: string) {
    const value = bundleId.trim()
    if (!value) return
    this.apps.add(value)
    this.save()
  }

  remove(bundleId: string) {
    this.apps.delete(bundleId.trim())
    this.save()
  }

  private get filePath() {
    return join(app.getPath('userData'), fileName)
  }

  private load() {
    try {
      if (!existsSync(this.filePath)) return
      const parsed = JSON.parse(readFileSync(this.filePath, 'utf8'))
      if (Array.isArray(parsed)) {
        this.apps = new Set(parsed.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())))
      }
    } catch {
      this.apps = new Set()
    }
  }

  private save() {
    try {
      writeFileSync(this.filePath, JSON.stringify(this.getAll(), null, 2), 'utf8')
    } catch {
      // A failed save should not interrupt the selection flow.
    }
  }
}

export const textPickerAppBlockStore = new TextPickerAppBlockStore()
