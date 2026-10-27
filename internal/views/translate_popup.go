package views

import (
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/textpicker"
	"popmind/internal/views/icons"
	"popmind/internal/windows"
)

const (
	translateWidth     = 420
	translateHeight    = 320
	translateMinHeight = 220
	translateMaxHeight = 680
)

// TranslatePopup shows the translation of a selection above it.
type TranslatePopup struct {
	app    *App
	win    *mygo.Window
	tr     Translator
	pinned bool
	// above is whether the popup sits above the selection: it then grows upward.
	above   bool
	resized time.Time
}

func newTranslatePopup(app *App) *TranslatePopup {
	p := &TranslatePopup{app: app}
	p.tr.Reset()
	p.win = mygo.NewWindow(mygo.WindowOptions{
		Title:       "popMind Translate",
		Panel:       true,
		Hidden:      true,
		Frameless:   true,
		Transparent: true,
		Vibrancy:    mygo.VibrancyPopover,
		Width:       translateWidth,
		Height:      translateHeight,
		MinWidth:    360,
		MinHeight:   200,
		Content:     ui.View(p.view),
	})
	p.tr.Update = p.win.Update
	p.win.OnShow(func() {
		native.RegisterSurfaceWindow(p.win.NativeHandle())
		roundPanel(p.win, 12)
	})
	p.win.OnClose(func(e *mygo.CloseEvent) {
		e.PreventDefault()
		p.Hide()
	})
	windows.Register(&windows.Surface{
		ID: "translation", Priority: 300, Visible: p.win.IsVisible, Hide: p.Hide,
		ShouldDismiss: func(ctx windows.DismissContext) bool {
			switch {
			case ctx.Reason == windows.DismissEscape:
				return true
			case p.pinned:
				return false
			case ctx.Reason == windows.DismissSurfaceOpened:
				return ctx.Target != "translation"
			}
			return ctx.Reason == windows.DismissSelectionChanged || ctx.Reason == windows.DismissScene ||
				ctx.Reason == windows.DismissOutside
		},
	})
	return p
}

// Show translates text and shows the result above anchor.
func (p *TranslatePopup) Show(text string, anchor textpicker.Anchor) {
	windows.Dispatch(windows.DismissContext{Reason: windows.DismissSurfaceOpened, Target: "translation"})
	r := placeAbove(anchor, translateWidth, translateMinHeight, floatingGap)
	if p.pinned && p.win.IsVisible() {
		r = p.win.Bounds()
	}
	above := float64(r.Y) < anchor.TopY
	p.win.Update(func() {
		p.tr.Source, p.tr.Target, p.tr.Engine = "auto", "auto", ""
		p.above = above
		p.tr.Run(text, 0)
	})
	p.win.SetBounds(r)
	showIn(p.win, 120, 0, p.win.Show)
	logx.Info("[translate-popup] shown", "chars", len([]rune(text)), "x", r.X, "y", r.Y)
}

// Hide hides it and stops the translation.
func (p *TranslatePopup) Hide() {
	p.win.Update(func() { p.pinned = false })
	p.win.Hide()
	p.app.afterFloatingChange()
}

// Visible reports whether it shows.
func (p *TranslatePopup) Visible() bool { return p.win.IsVisible() }

// Bounds is where it is.
func (p *TranslatePopup) Bounds() mygo.Rectangle { return p.win.Bounds() }

func (p *TranslatePopup) view(c *ui.Context) {
	t := Look(c)
	Panel(c)
	if c.Shortcut(0, ui.KeyEscape) {
		go p.Hide()
	}
	if c.Shortcut(ui.Cmd, ui.KeyC) && !c.Root().FocusWithin() {
		p.tr.Copy()
	}
	ui.Column(c).Fill().Children(func() {
		ui.Row(c).Padding(8, 10, 6, 8).Gap(4).AlignItems(ui.Center).DragWindow().Children(func() {
			ui.Icon(c, icons.Get("grip-horizontal")).FontSize(12).TextColor(t.TextMuted).Margin(0, 4, 0, 2)
			p.tr.Toolbar(c)
			ui.Spacer(c)
			tip := i18n.T("translate.pin")
			if p.pinned {
				tip = i18n.T("translate.unpin")
			}
			if ActiveIconButton(c, "pin", tip, p.pinned).Clicked() {
				p.pinned = !p.pinned
			}
			if IconButton(c, "x", i18n.T("common.close")).Clicked() {
				go p.Hide()
			}
		})
		ui.Box(c).Height(0.5).Background(Hairline(t))
		var body ui.Element
		ui.Scroll(c).Grow(1).Children(func() {
			body = ui.Column(c).Padding(12, 14).Children(func() { p.tr.Body(c, true) })
		})
		p.fit(c, body)
		ui.Box(c).Height(0.5).Background(Hairline(t))
		ui.Box(c).Padding(6, 10).Children(func() { p.tr.Footer(c, false) })
	})
}

// fit resizes the popup to what it shows, between 220 and 680 DIPs, growing away from the selection.
func (p *TranslatePopup) fit(c *ui.Context, body ui.Element) {
	h := body.Bounds().H
	if h <= 0 {
		return
	}
	want := int(h) + 44 + 44 + 2
	want = max(translateMinHeight, min(translateMaxHeight, want))
	_, cur := c.Size()
	if abs(want-int(cur)) <= 2 {
		return
	}
	above := p.above
	go func() {
		b := p.win.Bounds()
		if above {
			b.Y += b.Height - want
		}
		b.Height = want
		d := mygo.Screen.DisplayMatching(b)
		b.Y = max(d.WorkArea.Y, min(b.Y, d.WorkArea.Y+d.WorkArea.Height-want))
		p.win.SetBounds(b)
	}()
}

func abs(v int) int {
	if v < 0 {
		return -v
	}
	return v
}
