import { z } from 'zod'
import { themeModes } from '@/lib/theme/shared'

const installedAppSchema = z.object({
  name: z.string(),
  fileName: z.string(),
  bundleId: z.string(),
  path: z.string(),
  iconDataUrl: z.string().nullable(),
})

const permissionStatusSchema = z.object({
  granted: z.boolean(),
  supported: z.boolean(),
})

const permissionDiagnosticsSchema = z.object({
  supported: z.boolean(),
  isPackaged: z.boolean(),
  issue: z.enum(['adhoc_signature']).nullable(),
  isAdhocSigned: z.boolean().nullable(),
  appPath: z.string().nullable(),
  identifier: z.string().nullable(),
  signature: z.string().nullable(),
  teamIdentifier: z.string().nullable(),
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
      })
      .nullable(),
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
  resetMacPermissionHistory: {
    args: z.tuple([]),
    return: z.boolean(),
  },
  getPermissionDiagnostics: {
    args: z.tuple([]),
    return: permissionDiagnosticsSchema,
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
}
