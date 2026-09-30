// Main-process wrapper over the clipboard part of the native addon. Every caller goes through here,
// so a missing / older addon degrades to "unsupported" instead of throwing.
import {
  nativeMacOSAddon,
  type NativeOcrOptions,
  type NativePasteboardItem,
  type NativePasteboardReadOptions,
  type NativePasteboardReadResult,
  type NativePasteKeystrokeResult,
  type NativePasteMonitorEvent,
} from '@/lib/native/macos-addon'

const addon = nativeMacOSAddon

export const clipboardNative = {
  isSupported: () => Boolean(addon?.readPasteboard && addon?.writePasteboard),

  getChangeCount: (): number => addon?.getClipboardChangeCount() ?? -1,

  isSelectionFallbackActive: (): boolean => Boolean(addon?.isClipboardFallbackActive?.()),

  read: (options: NativePasteboardReadOptions): NativePasteboardReadResult | null =>
    addon?.readPasteboard?.(options) ?? null,

  /** null when the addon is missing or the data cannot be decoded. */
  convertImageToPng: async (data: Buffer): Promise<{ png: Buffer; width: number; height: number } | null> => {
    if (!addon?.convertImageToPngAsync) return null
    try {
      return await addon.convertImageToPngAsync(data)
    } catch {
      return null
    }
  },

  write: (items: NativePasteboardItem[], marker: string): boolean =>
    Boolean(addon?.writePasteboard?.(items, { marker })),

  postPasteKeystroke: (): NativePasteKeystrokeResult =>
    addon?.postPasteKeystroke?.() ?? { ok: false, reason: 'no_permission' },

  isSecureInputEnabled: (): boolean => Boolean(addon?.isSecureInputEnabled?.()),

  isAccessibilityTrusted: (): boolean => Boolean(addon?.checkPermission(false)),

  getFrontmostApp: () => addon?.getFrontmostAppInfo() ?? null,

  /** Fallback path when the panel could not keep the target app active. */
  activateAppAndPaste: (pid: number): boolean => Boolean(addon?.activateAppAndPaste(pid)),

  setWindowAppearance: (nativeHandle: Buffer, mode: 'dark' | 'light' | 'inherit'): boolean =>
    Boolean(addon?.setWindowAppearance?.(nativeHandle, mode)),

  setVibrancyTopCornerRadius: (nativeHandle: Buffer, radius: number): boolean =>
    Boolean(addon?.setVibrancyTopCornerRadius?.(nativeHandle, radius)),

  presentPanelWithoutActivation: (nativeHandle: Buffer): boolean =>
    Boolean(addon?.presentPanelWithoutActivation?.(nativeHandle)),

  startPasteMonitor: (callback: (event: NativePasteMonitorEvent) => void): boolean =>
    Boolean(addon?.startPasteMonitor?.(callback)),

  stopPasteMonitor: (): boolean => Boolean(addon?.stopPasteMonitor?.()),

  resolveAppPath: (bundleId: string): string | null => addon?.resolveAppPathByBundleId?.(bundleId) ?? null,

  writeAppIcons: (items: Array<{ appPath: string; outputPath: string }>, size: number) =>
    addon?.writeApplicationIconsAsync?.(items, size) ?? Promise.resolve(items.map(() => false)),

  recognizeText: (imagePath: string, options: NativeOcrOptions = {}): Promise<string> => {
    if (addon?.recognizeTextInImageWithOptionsAsync) {
      return addon.recognizeTextInImageWithOptionsAsync(imagePath, options)
    }
    if (addon?.recognizeTextInImageAsync) {
      return addon.recognizeTextInImageAsync(imagePath)
    }
    return Promise.reject(new Error('unsupported'))
  },
}
