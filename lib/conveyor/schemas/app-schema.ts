import { z } from 'zod'
import { themeModes } from '@/lib/theme/shared'

export const appIpcSchema = {
  version: {
    args: z.tuple([]),
    return: z.string(),
  },
  checkAccessibility: {
    args: z.tuple([]),
    return: z.object({ granted: z.boolean(), supported: z.boolean() }),
  },
  openAccessibilitySettings: {
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
}
