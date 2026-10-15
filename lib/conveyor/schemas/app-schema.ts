import { z } from 'zod'
import { shortcutActionIds } from '@/lib/shortcuts/shared'
import { themeModes } from '@/lib/theme/shared'

const installedAppSchema = z.object({
  name: z.string(),
  fileName: z.string(),
  bundleId: z.string(),
  path: z.string(),
  iconDataUrl: z.string().nullable(),
})

const shortcutStatusSchema = z.object({
  id: z.enum(shortcutActionIds),
  accelerator: z.string(),
  state: z.enum(['registered', 'disabled', 'failed', 'conflict', 'suspended']),
})

const updateDownloadStateSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('idle') }),
  z.object({
    status: z.literal('downloading'),
    version: z.string(),
    receivedBytes: z.number(),
    totalBytes: z.number().nullable(),
  }),
  z.object({ status: z.literal('installing'), version: z.string(), filePath: z.string() }),
  z.object({ status: z.literal('failed'), version: z.string().nullable(), message: z.string() }),
])

const permissionStatusSchema = z.object({
  granted: z.boolean(),
  supported: z.boolean(),
})

export const appIpcSchema = {
  version: {
    args: z.tuple([]),
    return: z.string(),
  },
  latestRelease: {
    args: z.tuple([]),
    return: z
      .object({
        version: z.string(),
        url: z.string(),
        downloadUrl: z.string(),
        downloadSize: z.number().nullable(),
      })
      .nullable(),
  },
  downloadAndInstallUpdate: {
    args: z.tuple([]),
    return: updateDownloadStateSchema,
  },
  getUpdateDownloadState: {
    args: z.tuple([]),
    return: updateDownloadStateSchema,
  },
  checkAccessibility: {
    args: z.tuple([]),
    return: permissionStatusSchema,
  },
  openAccessibilitySettings: {
    args: z.tuple([]),
    return: z.boolean(),
  },
  checkScreenRecording: {
    args: z.tuple([]),
    return: permissionStatusSchema,
  },
  openScreenRecordingSettings: {
    args: z.tuple([]),
    return: z.boolean(),
  },
  exportLogs: {
    args: z.tuple([]),
    return: z.object({ canceled: z.boolean(), filePath: z.string().optional() }),
  },
  getThemeMode: {
    args: z.tuple([]),
    return: z.enum(themeModes),
  },
  setThemeMode: {
    args: z.tuple([z.enum(themeModes)]),
    return: z.enum(themeModes),
  },
  searchInstalledApps: {
    args: z.tuple([z.string(), z.number().int().min(1).max(20)]),
    return: z.array(installedAppSchema),
  },
  openInstalledApp: {
    args: z.tuple([z.string()]),
    return: z.boolean(),
  },
  getBlockedSelectionApps: {
    args: z.tuple([]),
    return: z.array(z.string()),
  },
  removeBlockedSelectionApp: {
    args: z.tuple([z.string()]),
    return: z.boolean(),
  },
  getShortcutStatus: {
    args: z.tuple([]),
    return: z.array(shortcutStatusSchema),
  },
  setShortcutRecording: {
    args: z.tuple([z.boolean()]),
    return: z.boolean(),
  },
}
