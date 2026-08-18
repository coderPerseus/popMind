import { screen } from 'electron'

export interface ScreenPoint {
  x: number
  y: number
}

// Native action events use Cocoa screen space (origin at the bottom-left of
// the primary display). Electron window bounds use top-left origin. Pick the
// representation that matches the live cursor so hit-testing stays aligned.
export const toElectronScreenPoint = (rawX?: number, rawY?: number): ScreenPoint => {
  const cursor = screen.getCursorScreenPoint()
  const x = Number(rawX)
  const y = Number(rawY)

  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return cursor
  }

  const primary = screen.getPrimaryDisplay()
  const converted = {
    x,
    y: primary.bounds.y + primary.bounds.height - y,
  }

  const rawDistance = Math.hypot(x - cursor.x, y - cursor.y)
  const convertedDistance = Math.hypot(converted.x - cursor.x, converted.y - cursor.y)

  return convertedDistance <= rawDistance ? converted : { x, y }
}
