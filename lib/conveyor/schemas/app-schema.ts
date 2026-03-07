import { z } from 'zod'

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
}
