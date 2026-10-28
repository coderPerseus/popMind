package views

import (
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo/ui"

	"popmind/internal/i18n"
)

// The disk image's window is dmgWidth × dmgHeight; Finder puts the app and the Applications link at these
// centers (packaging/dmg-settings.py uses the same numbers).
const (
	dmgWidth  = 640
	dmgHeight = 400
	dmgAppX   = 170
	dmgLinkX  = 470
	dmgIconY  = 200
)

// TestRenderDMGBackground writes the disk image's background, at 1× and 2×, to $POPMIND_DMG_BACKGROUND_DIR
// (packaging/): the logo and name at the top, an arrow from the app to Applications, and what to do.
func TestRenderDMGBackground(t *testing.T) {
	dir := os.Getenv("POPMIND_DMG_BACKGROUND_DIR")
	if dir == "" {
		t.Skip("set POPMIND_DMG_BACKGROUND_DIR to render")
	}
	view := func(c *ui.Context) {
		th := *c.Theme()
		th.Dark = false // Finder draws the icon labels dark on any background
		c.SetTheme(&th)
		tt := Look(c)
		c.Root().Background(ui.RGB(250, 250, 251))
		ui.Box(c).Fill().Draw(func(p *ui.Painter, r ui.Rect) {
			ink := inkColor(tt)
			// The logo, its strokes as the intro draws them, beside the name.
			const size = 30
			name := ui.Span{Text: "popMind", Size: 20, Weight: 600, Color: tt.Text}
			nw, nh := p.MeasureText(0, name)
			x0 := r.X + (r.W-(size+10+nw))/2
			logo := xform{s: size / 100.0, x: x0, y: r.Y + 34}
			var a, b ui.Path
			logoBubble().appendTo(&a, logo)
			logoM().appendTo(&b, logo)
			p.StrokePath(&a, logoStroke*size/100, ink)
			p.StrokePath(&b, logoStroke*size/100, ink)
			p.RichText(x0+size+10, r.Y+34+(size-nh)/2, 0, name)

			// The arrow, a gentle curve between the icons.
			from, to := r.X+dmgAppX+84, r.X+dmgLinkX-84
			y := r.Y + dmgIconY - 6
			arrowColor := ui.RGBA(0, 0, 0, 0.28)
			var arc ui.Path
			arc.MoveTo(from, y).CubeTo(from+50, y-26, to-50, y-26, to, y)
			p.StrokePath(&arc, 2.5, arrowColor)
			// The head along the curve's last direction, (50, 26).
			const dx, dy, nx, ny = 0.887, 0.461, -0.461, 0.887
			var head ui.Path
			head.MoveTo(to-dx*13+nx*7, y-dy*13+ny*7).LineTo(to, y).LineTo(to-dx*13-nx*7, y-dy*13-ny*7)
			p.StrokePath(&head, 2.5, arrowColor)

			// What to do, under the icons' labels.
			hint := ui.Span{Text: i18n.T("dmg.hint"), Size: 13, Color: tt.TextMuted}
			hw, _ := p.MeasureText(0, hint)
			p.RichText(r.X+(r.W-hw)/2, r.Y+316, 0, hint)
			en := ui.Span{Text: "Drag popMind to Applications to install", Size: 11, Color: Tertiary(tt)}
			ew, _ := p.MeasureText(0, en)
			p.RichText(r.X+(r.W-ew)/2, r.Y+338, 0, en)
		})
	}
	i18n.SetLanguage("zh-CN")
	for scale, name := range map[float32]string{1: "dmg-background.png", 2: "dmg-background@2x.png"} {
		img := ui.Render(view, dmgWidth, dmgHeight, scale)
		f, err := os.Create(filepath.Join(dir, name))
		if err != nil {
			t.Fatal(err)
		}
		if err := png.Encode(f, img); err != nil {
			t.Fatal(err)
		}
		f.Close()
	}
}
