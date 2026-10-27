package views

import (
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/textpicker"
	"popmind/internal/views/assets"
	"popmind/internal/views/icons"
)

const (
	bubbleHeight = 36
	bubbleGap    = 12
)

// skill is a button of the bubble.
type skill struct {
	command string
	icon    string
	label   string
}

func skillsFor(text string) []skill {
	block := skill{"block", "ban", i18n.T("bubble.blockCurrentApp")}
	if textpicker.NormalizeLink(text) != "" {
		return []skill{{"open", "external-link", i18n.T("bubble.open")}, block}
	}
	return []skill{
		{"translate", "languages", i18n.T("bubble.translate")},
		{"explain", "circle-question-mark", i18n.T("bubble.explain")},
		{"copy", "copy", i18n.T("bubble.copy")},
		{"ask", "message-square", i18n.T("bubble.ask")},
		block,
	}
}

// Bubble is the toolbar shown above a selection.
type Bubble struct {
	app    *App
	win    *mygo.Window
	picked textpicker.Picked
	skills []skill

	tip      *mygo.Window
	tipText  string
	hovered  string
	hoverAt  time.Time
	tipShown bool
	pressed  string
}

// bubbleWidth: padding, the grip, the buttons, a divider before the block button, a divider and the logo.
func bubbleWidth(n int) int { return 4 + 14 + 2 + n*32 + 2*(1+4) + 28 + 4 }

func newBubble(app *App) *Bubble {
	b := &Bubble{app: app}
	b.win = mygo.NewWindow(mygo.WindowOptions{
		Title:         "popMind Bubble",
		Panel:         true,
		Hidden:        true,
		Frameless:     true,
		Transparent:   true,
		Vibrancy:      mygo.VibrancyPopover,
		Width:         bubbleWidth(5),
		Height:        bubbleHeight,
		DisableResize: true,
		Content:       ui.View(b.view),
	})
	b.win.OnShow(func() {
		roundPanel(b.win, 10)
		native.ConfigureBubbleWindow(b.win.NativeHandle(), 0)
	})
	b.win.OnClose(func(e *mygo.CloseEvent) {
		e.PreventDefault()
		b.Hide()
	})
	return b
}

// Show shows the bubble for p, above the pointer, without taking the keyboard from the app the text is in.
func (b *Bubble) Show(p textpicker.Picked) {
	skills := skillsFor(p.Text)
	w := bubbleWidth(len(skills))
	anchor := textpicker.Anchor{X: p.Cursor.X, TopY: p.Cursor.Y, BottomY: p.Cursor.Y}
	r := placeAbove(anchor, w, bubbleHeight, bubbleGap)
	b.win.Update(func() {
		b.picked, b.skills, b.hovered = p, skills, ""
	})
	b.win.SetBounds(r)
	showIn(b.win, 100, 0, func() {
		b.win.ShowInactive()
		native.ConfigureBubbleWindow(b.win.NativeHandle(), 0)
		native.OrderWindowFront(b.win.NativeHandle())
	})
	logx.Info("[bubble] shown", "x", r.X, "y", r.Y, "skills", len(skills), "app", p.AppName)
}

// Hide hides the bubble and its tooltip.
func (b *Bubble) Hide() {
	b.hideTip()
	if b.win.IsVisible() {
		b.win.Hide()
	}
}

// Visible reports whether it shows.
func (b *Bubble) Visible() bool { return b.win.IsVisible() }

// Bounds is where it is.
func (b *Bubble) Bounds() mygo.Rectangle { return b.win.Bounds() }

func (b *Bubble) run(command string) {
	p := b.picked
	b.Hide()
	b.app.RunCommand(command, p)
}

func (b *Bubble) view(c *ui.Context) {
	t := Look(c)
	Panel(c)
	if c.Shortcut(0, ui.KeyEscape) {
		go b.Hide()
	}
	fg := t.Text.Alpha(0.62)
	hovered, pressedNow := "", ""
	divider := func() { ui.Box(c).Width(1).Height(16).Background(Hairline(t)).Margin(0, 2) }
	button := func(id, icon, label string, w float32) {
		btn := ui.ButtonBase(c.Key(id)).Size(w, 28).Radius(7).Center().Label(label).Transition(hoverColors)
		color := fg
		switch {
		case btn.Pressed():
			btn.Background(HoverFill(t).Alpha(0.16))
			pressedNow = id
		case btn.Hovered():
			btn.Background(HoverFill(t))
			color = t.Text
		}
		if btn.Hovered() {
			hovered = id
		}
		btn.Children(func() { ui.Icon(c, icons.Get(icon)).FontSize(16).TextColor(color) })
	}
	ui.Row(c).Fill().Padding(0, 4).Gap(2).AlignItems(ui.Center).Children(func() {
		grip := ui.Box(c.Key("grip")).Size(14, 24).Radius(5).Center().DragWindow()
		if grip.Hovered() {
			grip.Background(HoverFill(t))
			hovered = "grip"
		}
		grip.Children(func() { ui.Icon(c, icons.Get("grip-vertical")).FontSize(12).TextColor(fg) })
		for _, s := range b.skills {
			if s.command == "block" {
				divider()
			}
			button(s.command, s.icon, s.label, 30)
		}
		divider()
		logo := ui.ButtonBase(c.Key("logo")).Size(28, 28).Radius(7).Center().Label(i18n.T("bubble.openHome")).Transition(hoverColors)
		if logo.Pressed() {
			pressedNow = "logo"
		}
		if logo.Hovered() {
			logo.Background(HoverFill(t))
			hovered = "logo"
		}
		logo.Children(func() {
			name := "logo"
			if t.Dark {
				name = "logo-dark"
			}
			ui.Image(c, assets.Bitmap(name)).Size(18, 18)
		})
	})
	// A button acts as it is pressed, as the Electron bubble did, so the first click is never lost to the app the
	// text is in taking the focus back.
	if pressedNow != "" && pressedNow != b.pressed {
		cmd, text := pressedNow, b.picked.Text
		if cmd == "logo" {
			go func() {
				b.Hide()
				b.app.ShowLauncher(text)
			}()
		} else {
			go b.run(cmd)
		}
	}
	b.pressed = pressedNow
	b.trackHover(c, hovered)
}

// trackHover shows the hovered button's label in a tooltip flyout below the bubble after a short rest.
func (b *Bubble) trackHover(c *ui.Context, hovered string) {
	if hovered != b.hovered {
		b.hovered, b.hoverAt, b.tipShown = hovered, time.Now(), false
		if hovered == "" {
			go b.hideTip()
		}
	}
	if hovered == "" || b.tipShown {
		return
	}
	if wait := 380*time.Millisecond - time.Since(b.hoverAt); wait > 0 {
		c.After(wait)
		return
	}
	label, x := i18n.T("bubble.openHome"), bubbleWidth(len(b.skills))-4-14
	if hovered == "grip" {
		label, x = i18n.T("bubble.drag"), 4+7
	}
	offset := 4 + 14 + 2
	for _, s := range b.skills {
		if s.command == "block" {
			offset += 5
		}
		if s.command == hovered {
			label, x = s.label, offset+15
		}
		offset += 32
	}
	b.tipShown = true
	go b.showTip(label, x)
}

func (b *Bubble) showTip(label string, x int) {
	width := int(float64(len([]rune(label)))*12.5) + 20
	anchor := mygo.Rectangle{X: x, Y: 0, Width: 0, Height: bubbleHeight}
	if b.tip == nil {
		b.tipText = label
		b.tip = mygo.NewFlyout(mygo.FlyoutOptions{
			Parent: b.win, Anchor: anchor, Placement: mygo.PlacementBottom, Gap: 6,
			Width: width, Height: 24, CornerRadius: 6, Content: ui.View(b.tipView),
		})
		b.tip.OnClosed(func() { b.tip = nil })
		return
	}
	b.tip.Update(func() { b.tipText = label })
	b.tip.SetSize(width, 24)
	b.tip.SetAnchor(anchor)
}

func (b *Bubble) hideTip() {
	b.tipShown = false
	if b.tip != nil {
		b.tip.Close()
		b.tip = nil
	}
}

func (b *Bubble) tipView(c *ui.Context) {
	t := Look(c)
	c.Root().Background(t.Inverse)
	ui.Box(c).Fill().Center().Children(func() {
		ui.Text(c, b.tipText).FontSize(12).TextColor(t.InverseText).SingleLine()
	})
}
