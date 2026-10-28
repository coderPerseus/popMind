package views

import (
	"fmt"
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo/ui"
)

// TestRenderOnboarding writes frames of the first-run intro to $POPMIND_RENDER_DIR, to look at.
func TestRenderOnboarding(t *testing.T) {
	dir := os.Getenv("POPMIND_RENDER_DIR")
	if dir == "" {
		t.Skip("set POPMIND_RENDER_DIR to render")
	}
	o := newOnboardingModel()
	o.forceGlow = true
	for _, dark := range []bool{false, true} {
		for _, ms := range []float32{2500, 2650, 2800, 2950, 3100, 3300} {
			view := func(c *ui.Context) {
				th := *c.Theme()
				th.Dark = dark
				c.SetTheme(&th)
				tt := Look(c)
				c.Root().Background(ui.RGB(96, 118, 150))
				ui.Box(c).Fill().Draw(func(p *ui.Painter, r ui.Rect) { o.paint(p, r, tt, ms) })
			}
			img := ui.Render(view, 1440, 900, 1)
			name := fmt.Sprintf("onboarding-%s-%04.0f.png", map[bool]string{false: "light", true: "dark"}[dark], ms)
			f, err := os.Create(filepath.Join(dir, name))
			if err != nil {
				t.Fatal(err)
			}
			_ = png.Encode(f, img)
			f.Close()
		}
	}
	// The logo strokes alone, beside the icon, to compare their shapes.
	logo := func(c *ui.Context) {
		c.Root().Background(ui.RGB(255, 255, 255))
		ui.Box(c).Fill().Draw(func(p *ui.Painter, r ui.Rect) {
			f := xform{s: 4, x: 50, y: 50}
			var a, b ui.Path
			logoBubble().appendTo(&a, f)
			logoM().appendTo(&b, f)
			p.StrokePath(&a, logoStroke*4, ui.RGB(0, 0, 0))
			p.StrokePath(&b, logoStroke*4, ui.RGB(0, 0, 0))
		})
	}
	img := ui.Render(logo, 500, 500, 1)
	f, _ := os.Create(filepath.Join(dir, "onboarding-logo.png"))
	_ = png.Encode(f, img)
	f.Close()
}
