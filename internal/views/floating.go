package views

import (
	"github.com/egoist/mygo"

	"popmind/internal/textpicker"
)

const floatingGap = 14

// placeAbove puts a w×h window above anchor (or below it where there is no room), inside the work area of
// its display, as the Electron app places the bubble and the popups.
func placeAbove(anchor textpicker.Anchor, w, h, gap int) mygo.Rectangle {
	d := mygo.Screen.DisplayNearestPoint(mygo.Point{X: int(anchor.X), Y: int(anchor.TopY)})
	wa := d.WorkArea
	x := int(anchor.X) - w/2
	y := int(anchor.TopY) - h - gap
	x = max(wa.X, min(x, wa.X+wa.Width-w))
	if y < wa.Y {
		y = min(int(anchor.BottomY)+gap, wa.Y+wa.Height-h)
	}
	return mygo.Rectangle{X: x, Y: y, Width: w, Height: h}
}

func contains(r mygo.Rectangle, pt textpicker.Point) bool {
	return pt.X >= float64(r.X) && pt.X <= float64(r.X+r.Width) && pt.Y >= float64(r.Y) && pt.Y <= float64(r.Y+r.Height)
}
