// Pure geometry helpers of the clipboard panel window.

export const PANEL_MIN_HEIGHT = 160
export const PANEL_MAX_HEIGHT = 900
export const PANEL_DEFAULT_HEIGHT = 320

type Rect = { x: number; y: number; width: number; height: number }

/** Clamps to 160–900 and never taller than the display work area. */
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
