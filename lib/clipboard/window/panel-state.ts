// Tiny persisted state of the clipboard panel (remembered height), stored as JSON in userData.
import { app } from 'electron'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { mainLogger } from '@/lib/main/logger'
import { clampPanelHeight, PANEL_DEFAULT_HEIGHT } from './panel-geometry'

type PanelState = { height: number }

const getStateFilePath = () => join(app.getPath('userData'), 'clipboard', 'panel-state.json')

export const loadPanelHeight = (): number => {
  try {
    const parsed = JSON.parse(readFileSync(getStateFilePath(), 'utf-8')) as Partial<PanelState>
    return clampPanelHeight(parsed.height)
  } catch {
    return PANEL_DEFAULT_HEIGHT
  }
}

export const savePanelHeight = (height: number) => {
  try {
    const filePath = getStateFilePath()
    mkdirSync(dirname(filePath), { recursive: true })
    writeFileSync(filePath, JSON.stringify({ height } satisfies PanelState), 'utf-8')
  } catch (error) {
    mainLogger.warn('[clip-panel] failed to persist height', { error: String(error) })
  }
}
