// Package windows creates popMind's windows and decides which of the floating ones goes away when: Escape,
// a click elsewhere, a new selection, or another surface opening (the Electron app's auto-dismiss controller).
package windows

import (
	"slices"
	"sync"

	"popmind/internal/logx"
)

// DismissReason says why surfaces are asked to go away.
type DismissReason string

const (
	DismissEscape           DismissReason = "escape"
	DismissBlur             DismissReason = "blur"
	DismissSurfaceOpened    DismissReason = "surface-opened"
	DismissSelectionChanged DismissReason = "selection-changed"
	DismissScene            DismissReason = "dismiss-scene"
	DismissOutside          DismissReason = "outside-pointer"
)

// DismissContext describes one dismiss request.
type DismissContext struct {
	Reason DismissReason
	// Target is the surface that opened (DismissSurfaceOpened).
	Target string
	// Source is the surface that lost focus (DismissBlur).
	Source string
	// X and Y are where the pointer went down, in Cocoa coordinates, for dismiss scenes.
	X, Y float64
}

// Surface is a floating window that can be dismissed.
type Surface struct {
	ID       string
	Priority int
	Visible  func() bool
	Hide     func()
	// ShouldDismiss decides for everything but DismissEscape on the topmost surface. Nil: never.
	ShouldDismiss func(ctx DismissContext) bool
}

var (
	surfacesMu sync.Mutex
	surfaces   []*Surface
)

// Register adds or replaces a surface.
func Register(s *Surface) {
	surfacesMu.Lock()
	defer surfacesMu.Unlock()
	surfaces = slices.DeleteFunc(surfaces, func(o *Surface) bool { return o.ID == s.ID })
	surfaces = append(surfaces, s)
	slices.SortStableFunc(surfaces, func(a, b *Surface) int { return b.Priority - a.Priority })
}

func snapshot() []*Surface {
	surfacesMu.Lock()
	defer surfacesMu.Unlock()
	return slices.Clone(surfaces)
}

// Dispatch hides every visible surface that wants to go away in ctx.
func Dispatch(ctx DismissContext) {
	for _, s := range snapshot() {
		if s.Visible() && s.ShouldDismiss != nil && s.ShouldDismiss(ctx) {
			logx.Info("[dismiss] hide", "surface", s.ID, "reason", ctx.Reason, "target", ctx.Target, "source", ctx.Source)
			s.Hide()
		}
	}
}

// DismissTopmost hides the visible surface of highest priority (Escape).
func DismissTopmost(reason DismissReason) bool {
	for _, s := range snapshot() {
		if s.Visible() {
			logx.Info("[dismiss] topmost", "surface", s.ID, "reason", reason)
			s.Hide()
			return true
		}
	}
	return false
}

// AnyVisible reports whether a surface other than except shows.
func AnyVisible(except ...string) bool {
	for _, s := range snapshot() {
		if !slices.Contains(except, s.ID) && s.Visible() {
			return true
		}
	}
	return false
}
