// Source-app metadata: 64 px icon file + dominant color for the card header (spec §2.1, Application.color).
import { existsSync } from 'node:fs'
import { nativeImage, type NativeImage } from 'electron'
import { clipboardNative } from '@/lib/clipboard/native-bridge'
import { appIconPathFor } from '@/lib/clipboard/store/paths'
import { clipStore, getClipStoreDirs } from '@/lib/clipboard/store'
import { mainLogger } from '@/lib/main/logger'

const ICON_SIZE = 64
const DARKEN_ABOVE_LUMINANCE = 0.75
const DARKEN_TARGET_LUMINANCE = 0.68

const toHex = (value: number) =>
  Math.max(0, Math.min(255, Math.round(value)))
    .toString(16)
    .padStart(2, '0')

/** Saturation-weighted average of the opaque pixels, ignoring near-white / near-black; darkened if too bright. */
export const computeDominantColor = (icon: NativeImage): string | undefined => {
  const bitmap = icon.toBitmap()
  let red = 0
  let green = 0
  let blue = 0
  let weightSum = 0
  let fallbackRed = 0
  let fallbackGreen = 0
  let fallbackBlue = 0
  let fallbackCount = 0

  // toBitmap() is BGRA on macOS.
  for (let index = 0; index + 3 < bitmap.length; index += 4) {
    if ((bitmap[index + 3] ?? 0) < 128) {
      continue
    }

    const b = bitmap[index] ?? 0
    const g = bitmap[index + 1] ?? 0
    const r = bitmap[index + 2] ?? 0
    fallbackRed += r
    fallbackGreen += g
    fallbackBlue += b
    fallbackCount += 1

    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    if (min > 235 || max < 25) {
      continue
    }

    const weight = 0.15 + (max === 0 ? 0 : (max - min) / max)
    red += r * weight
    green += g * weight
    blue += b * weight
    weightSum += weight
  }

  let r: number
  let g: number
  let b: number
  if (weightSum > 0) {
    r = red / weightSum
    g = green / weightSum
    b = blue / weightSum
  } else if (fallbackCount > 0) {
    r = fallbackRed / fallbackCount
    g = fallbackGreen / fallbackCount
    b = fallbackBlue / fallbackCount
  } else {
    return undefined
  }

  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  if (luminance > DARKEN_ABOVE_LUMINANCE) {
    const factor = DARKEN_TARGET_LUMINANCE / luminance
    r *= factor
    g *= factor
    b *= factor
  }

  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

const known = new Set<string>()
const inFlight = new Map<string, Promise<string | null>>()

export const markAppKnown = (bundleId: string) => {
  known.add(bundleId)
}

export const isAppKnown = (bundleId: string) => known.has(bundleId)

/** Writes the icon (if the app can be located) and stores icon path + color. Returns the icon path or null. */
export const ensureAppMeta = (app: { bundleId: string; name: string }): Promise<string | null> => {
  const running = inFlight.get(app.bundleId)
  if (running) {
    return running
  }

  const job = (async () => {
    const started = performance.now()
    const iconPath = appIconPathFor(getClipStoreDirs(), app.bundleId)

    try {
      if (!existsSync(iconPath)) {
        const appPath = clipboardNative.resolveAppPath(app.bundleId)
        if (!appPath) {
          await clipStore.upsertApp({ bundleId: app.bundleId, name: app.name })
          known.add(app.bundleId)
          return null
        }

        const [written] = await clipboardNative.writeAppIcons([{ appPath, outputPath: iconPath }], ICON_SIZE)
        if (!written) {
          await clipStore.upsertApp({ bundleId: app.bundleId, name: app.name })
          return null
        }
      }

      const color = computeDominantColor(nativeImage.createFromPath(iconPath))
      await clipStore.upsertApp({ bundleId: app.bundleId, name: app.name, iconPath, color })
      known.add(app.bundleId)
      mainLogger.info('[clip-enrich] app metadata ready', {
        bundleId: app.bundleId,
        color,
        ms: Math.round(performance.now() - started),
      })
      return iconPath
    } catch (error) {
      mainLogger.warn('[clip-enrich] app metadata failed', { bundleId: app.bundleId, error: String(error) })
      return null
    }
  })().finally(() => inFlight.delete(app.bundleId))

  inFlight.set(app.bundleId, job)
  return job
}
