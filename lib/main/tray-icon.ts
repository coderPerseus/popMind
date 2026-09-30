import { app, nativeImage, type NativeImage, type Tray } from 'electron'

const TRAY_ICON_SIZE = 18
// Dev badge geometry in points, relative to the 18pt icon.
const BADGE_RADIUS = 3.2
const BADGE_GAP = 1.3
const BADGE_CENTER = TRAY_ICON_SIZE - BADGE_RADIUS - 0.2

/** Unpackaged builds get a dot in the bottom-right corner so they are easy to tell apart from the installed app. */
export const isDevBuild = () => !app.isPackaged

const clamp01 = (value: number) => Math.min(1, Math.max(0, value))

// Cuts a transparent ring into the logo and fills a dot inside it. The icon is a template image, so only alpha
// matters: macOS tints the dot together with the logo for light / dark menu bars.
const drawBadge = (bitmap: Buffer, size: number, scale: number) => {
  const center = BADGE_CENTER * scale
  const dotRadius = BADGE_RADIUS * scale
  const clearRadius = (BADGE_RADIUS + BADGE_GAP) * scale

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center)
      const clearCoverage = clamp01(clearRadius - distance + 0.5)
      if (clearCoverage === 0) continue

      const offset = (y * size + x) * 4
      const dotCoverage = clamp01(dotRadius - distance + 0.5)
      const keptAlpha = (bitmap[offset + 3] / 255) * (1 - clearCoverage)
      const alpha = Math.max(dotCoverage, keptAlpha)
      // BGRA; black premultiplied pixels keep the template alpha intact.
      bitmap[offset] = 0
      bitmap[offset + 1] = 0
      bitmap[offset + 2] = 0
      bitmap[offset + 3] = Math.round(alpha * 255)
    }
  }
}

const renderAtScale = (source: NativeImage, scale: number, withBadge: boolean) => {
  const size = TRAY_ICON_SIZE * scale
  const resized = source.resize({ width: size, height: size, quality: 'best' })
  if (!withBadge) {
    return resized.toPNG()
  }

  const bitmap = Buffer.from(resized.toBitmap())
  drawBadge(bitmap, size, scale)
  return nativeImage.createFromBitmap(bitmap, { width: size, height: size }).toPNG()
}

export const createTrayIcon = (logoPath: string) => {
  const source = nativeImage.createFromPath(logoPath)
  const withBadge = isDevBuild()
  const icon = nativeImage.createEmpty()
  for (const scale of [1, 2]) {
    icon.addRepresentation({ scaleFactor: scale, buffer: renderAtScale(source, scale, withBadge) })
  }
  icon.setTemplateImage(true)
  return icon
}

let statusTray: Tray | null = null
let statusTitle = ''

/** The menu bar tray, so other features (focus timer) can show text next to the icon. */
export const registerStatusTray = (tray: Tray | null) => {
  statusTray = tray
  if (tray && statusTitle) tray.setTitle(statusTitle, { fontType: 'monospacedDigit' })
}

/** Text shown right of the menu bar icon (macOS); '' clears it. */
export const setStatusTrayTitle = (title: string) => {
  if (title === statusTitle) return
  statusTitle = title
  if (statusTray && !statusTray.isDestroyed()) statusTray.setTitle(title, { fontType: 'monospacedDigit' })
}
