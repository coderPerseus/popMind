import { z } from 'zod'
import { themeModes } from '@/lib/theme/shared'

const installedAppSchema = z.object({
  name: z.string(),
  fileName: z.string(),
  bundleId: z.string(),
  path: z.string(),
  iconDataUrl: z.string().nullable(),
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
    return: z.object({ granted: z.boolean(), supported: z.boolean() }),
  },
  openAccessibilitySettings: {
    args: z.tuple([]),
    return: z.boolean(),
  },
  checkScreenRecording: {
    args: z.tuple([]),
    return: z.object({ granted: z.boolean(), supported: z.boolean() }),
  },
  openScreenRecordingSettings: {
    args: z.tuple([]),
    return: z.boolean(),
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
