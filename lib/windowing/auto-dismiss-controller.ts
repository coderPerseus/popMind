export type SurfaceId = 'bubble' | 'translation' | 'main'

export type DismissReason =
  | 'outside-pointer'
  | 'dismiss-scene'
  | 'selection-changed'
  | 'surface-opened'
  | 'blur'
  | 'escape'
  | 'explicit-close'

export interface DismissContext {
  reason: DismissReason
  x?: number
  y?: number
  source?: SurfaceId
  target?: SurfaceId
}

export interface DismissibleSurface {
  id: SurfaceId
  priority: number
  isVisible(): boolean
  hide(reason: DismissReason): void
  shouldDismiss(context: DismissContext): boolean
}

export class AutoDismissController {
  private readonly surfaces = new Map<SurfaceId, DismissibleSurface>()

  register(surface: DismissibleSurface) {
    this.surfaces.set(surface.id, surface)
  }

  unregister(id: SurfaceId) {
    this.surfaces.delete(id)
  }

  dispatch(context: DismissContext) {
    const surfaces = this.getVisibleSurfaces()

    for (const surface of surfaces) {
      if (!surface.shouldDismiss(context)) {
        continue
      }

      surface.hide(context.reason)
    }
  }

  dismissTopmost(reason: Extract<DismissReason, 'escape' | 'explicit-close'> = 'escape') {
    const surfaces = this.getVisibleSurfaces()

    for (const surface of surfaces) {
      const context: DismissContext = { reason, target: surface.id }

      if (!surface.shouldDismiss(context)) {
        continue
      }

      surface.hide(reason)
      return true
    }

    return false
  }

  private getVisibleSurfaces() {
    return [...this.surfaces.values()]
      .filter((surface) => surface.isVisible())
      .sort((left, right) => right.priority - left.priority)
  }
}

export const autoDismissController = new AutoDismissController()
