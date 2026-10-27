package views

import (
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/native"
)

// Motion: short, quiet animations (AGENTS.md: at most 150 ms, never an empty frame first). Windows fade in as
// a whole through AppKit; inside them, colors ease on hover and things that come and go fade and slide a few
// points. macOS's Reduce Motion turns the movement off (myGo and the native fade both follow it).

const (
	motionFast = 100 * time.Millisecond
	motionBase = 140 * time.Millisecond
)

// showIn shows win with show, fading it in over ms (and sliding it up dy points) when it was hidden.
func showIn(win *mygo.Window, ms, dy int, show func()) {
	h := win.NativeHandle()
	appearing := !win.IsVisible()
	if appearing {
		native.PrepareWindowIn(h)
	}
	show()
	if appearing {
		native.AnimateWindowIn(h, ms, dy)
	}
}

// hoverColors eases an element's background and border colors as they change (hover, selection).
var hoverColors = ui.ElementTransition{Duration: motionFast, Colors: true}

// fadeIn is how content that replaces a placeholder appears: fading in from a few points below.
var fadeIn = ui.ElementTransition{Duration: motionBase, Enter: &ui.Motion{Y: 4}}

// popIn is how floating pieces (menus, toasts, dialogs) appear: fading in, slightly smaller.
var popIn = ui.ElementTransition{Duration: motionBase, Enter: &ui.Motion{Scale: 0.97}, Exit: &ui.Motion{Scale: 0.98}}

// listItem is how rows and cards come, go and move: new ones fade in, removed ones fold away and the others
// slide into their places.
var listItem = ui.ElementTransition{Duration: motionBase, Position: true,
	Enter: &ui.Motion{Scale: 0.96}, Exit: &ui.Motion{Collapse: true}}

// appear fades and grows e into place over its first frames, for panels shown over a backdrop (dialogs,
// Quick Look) whose parent is new as well, so an Enter transition would not run. *seen is reset when the panel
// is opened again.
func appear(c *ui.Context, e ui.Element, seen *bool) ui.Element {
	a := ui.Animation{Duration: motionBase, Ease: ui.EaseOut}
	if !*seen {
		*seen = true
		c.After(time.Millisecond)
		return e.AnimatePose(ui.Pose{Scale: 0.97, Fade: 1}, a)
	}
	return e.AnimatePose(ui.Pose{}, a)
}
