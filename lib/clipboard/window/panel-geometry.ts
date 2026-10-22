// Pure geometry helpers of the clipboard panel window.

export const PANEL_MIN_HEIGHT = 280
export const PANEL_MAX_HEIGHT = 900
export const PANEL_DEFAULT_HEIGHT = 340

type Rect = { x: number; y: number; width: number; height: number }

/** Clamps to 280–900 and never taller than the display work area. */
export const clampPanelHeight = (height: unknown, workAreaHeight = Number.POSITIVE_INFINITY) => {
  const value = typeof height === 'number' && Number.isFinite(height) ? Math.round(height) : PANEL_DEFAULT_HEIGHT
  const upper = Math.max(PANEL_MIN_HEIGHT, Math.min(PANEL_MAX_HEIGHT, workAreaHeight))
  return Math.min(upper, Math.max(PANEL_MIN_HEIGHT, value))
}

/** Full work-area width, glued to the bottom of the work area. */
export const computePanelBounds = (workArea: Rect, height: number): Rect => {
  const clamped = clampPanelHeight(height, workArea.height)
  return {
    x: workArea.x,
    y: workArea.y + workArea.height - clamped,
    width: workArea.width,
    height: clamped,
  }
}

/** New bounds after a height change, keeping the bottom edge where it is. */
export const resizePanelKeepingBottom = (bounds: Rect, height: number, workAreaHeight?: number): Rect => {
  const clamped = clampPanelHeight(height, workAreaHeight)
  return { ...bounds, y: bounds.y + bounds.height - clamped, height: clamped }
}

/** Bounding box of the windows that overlap `display`; null when none does. */
export const unionOnDisplay = (windows: Rect[], display: Rect): Rect | null => {
  const onDisplay = windows.filter(
    (window) =>
      window.x < display.x + display.width &&
      window.x + window.width > display.x &&
      window.y < display.y + display.height &&
      window.y + window.height > display.y
  )
  if (onDisplay.length === 0) return null
  const left = Math.min(...onDisplay.map((window) => window.x))
  const top = Math.min(...onDisplay.map((window) => window.y))
  const right = Math.max(...onDisplay.map((window) => window.x + window.width))
  const bottom = Math.max(...onDisplay.map((window) => window.y + window.height))
  return { x: left, y: top, width: right - left, height: bottom - top }
}

/**
 * A fullscreen app hides the Dock, but the display work area still leaves room for it; the panel would then float
 * above an empty strip. Pass the union of the app's windows on the display (apps such as Chrome put the fullscreen
 * page and its toolbar strip in separate windows). Fullscreen = spans the display width, reaches the display bottom
 * and starts at the top of the work area (on notched displays fullscreen windows start below the notch, not at 0).
 */
export const isFullscreenWindow = (
  windowBounds: Rect | null,
  display: { bounds: Rect; workArea: Rect },
  tolerance = 2
) => {
  if (!windowBounds) return false
  const { bounds, workArea } = display
  return (
    Math.abs(windowBounds.x - bounds.x) <= tolerance &&
    Math.abs(windowBounds.width - bounds.width) <= tolerance &&
    windowBounds.y <= workArea.y + tolerance &&
    Math.abs(windowBounds.y + windowBounds.height - (bounds.y + bounds.height)) <= tolerance
  )
}
