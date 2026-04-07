import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { resolve } from 'node:path'
import { app } from 'electron'
import { mainLogger } from '@/lib/main/logger'
import type { SelectionActionEvent, SelectionSceneValue, SelectionSnapshot } from '@/lib/text-picker/shared'

type ClipboardSnapshotType = {
  type: string
  data: Buffer
}

type ClipboardSnapshotItem = {
  types: ClipboardSnapshotType[]
}

export interface NativeMacOSAddon {
  checkPermission(prompt?: boolean): boolean
  getSelectionSnapshot(options?: { scene?: SelectionSceneValue | string }): SelectionSnapshot
  getTextByClipboardAsync(useMenu: boolean, pid: number): Promise<string>
  copySelectionAsync(useMenu: boolean, pid: number, expectedText?: string): Promise<boolean>
  captureFrontmostWindowImage(pid?: number): Buffer | null
  startActionMonitor(callback: (event: SelectionActionEvent) => void): boolean
  stopActionMonitor(): boolean
  setKeyMonitorEnabled(enabled: boolean): boolean
  getCursorPosition(): { x: number; y: number }
  getFrontmostAppInfo(): { bundleId: string; name: string; pid: number }
  getClipboardChangeCount(): number
  getClipboardSnapshot(): ClipboardSnapshotItem[]
  restoreClipboardSnapshot(items: ClipboardSnapshotItem[]): boolean
  activateAppAndPaste(pid: number): boolean
  configureBubbleWindow(nativeHandle: Buffer): boolean
  orderBubbleFront(nativeHandle: Buffer): boolean
  setActivationPolicy(policy: number): boolean
  recognizeTextInImageAsync(imagePath: string): Promise<string>
}

const require = createRequire(import.meta.url)

const resolveAddonPath = (): string | null => {
  const candidates = [
    resolve(process.cwd(), 'build/Release/selection_bridge.node'),
    resolve(process.resourcesPath, 'app.asar.unpacked/build/Release/selection_bridge.node'),
  ]

  try {
    candidates.push(resolve(app.getAppPath(), 'build/Release/selection_bridge.node'))
  } catch {
    // App path is unavailable before Electron finishes bootstrapping.
  }

  return candidates.find((candidate) => existsSync(candidate)) ?? null
}

const loadNativeModule = (): NativeMacOSAddon | null => {
  if (process.platform !== 'darwin') {
    return null
  }

  const addonPath = resolveAddonPath()
  if (!addonPath) {
    mainLogger.error('[macos-addon] native addon not found')
    return null
  }

  mainLogger.info('[macos-addon] resolved native addon', { addonPath })

  try {
    return require(addonPath) as NativeMacOSAddon
  } catch (error) {
    mainLogger.error('[macos-addon] failed to load native addon:', error)
    return null
  }
}

export const nativeMacOSAddon = loadNativeModule()
