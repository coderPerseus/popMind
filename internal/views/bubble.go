package views

import (
	"math"
	"sync/atomic"
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

	// The bubble's row: its padding, the gap between its children, the grip and a divider (with its margins).
	bubblePad     = 4
	bubbleRowGap  = 2
	bubbleGripW   = 14
	bubbleDivider = 1 + 2*2
	// A button (its icon) and the logo.
	bubbleIconW = 30
	bubbleLogoW = 28

	// The tooltip shows after the pointer rests this long on a button, and at once while moving from one button
	// to the next within tipWarm of the last tooltip, as macOS's toolbars do.
	tipDelay = 380 * time.Millisecond
	tipWarm  = 500 * time.Millisecond
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

// bubbleButton is a button of the bubble's row: a skill, or the logo after them.
type bubbleButton struct {
	id, icon, label string
	logo            bool
	dividerBefore   bool
}

func buttonsFor(skills []skill) []bubbleButton {
	var out []bubbleButton
	for _, s := range skills {
		out = append(out, bubbleButton{id: s.command, icon: s.icon, label: s.label, dividerBefore: s.command == "block"})
	}
	return append(out, bubbleButton{id: "logo", label: i18n.T("bubble.openHome"), logo: true, dividerBefore: true})
}

// Bubble is the toolbar shown above a selection: icons, whose labels show in a tooltip below the bubble (a
// flyout, outside the bubble's window) as the pointer rests on them.
type Bubble struct {
	app     *App
	win     *mygo.Window
	picked  textpicker.Picked
	skills  []skill
	buttons []bubbleButton

	// The tooltip: one flyout, made once and shown and hidden as the pointer moves. Everything done to it runs
	// in order on one goroutine (tipOps), never on the main thread, which its window calls wait for.
	tipOps   chan func()
	tip      *mygo.Window
	tipText  string
	tipSeen  atomic.Int64 // when a tooltip last showed or went (unix ns), for tipWarm
	hovered  string
	hoverAt  time.Time
	tipShown bool
	pressed  string
	centers  map[string]int // the middle of each button, for the tooltip
}

func buttonWidth(btn bubbleButton) float32 {
	if btn.logo {
		return bubbleLogoW
	}
	return bubbleIconW
}

// rowWidth is the bubble's width: padding, the grip, then each button after a gap, and the dividers.
func rowWidth(buttons []bubbleButton) int {
	w := float32(2*bubblePad + bubbleGripW)
	for _, btn := range buttons {
		if btn.dividerBefore {
			w += bubbleRowGap + bubbleDivider
		}
		w += bubbleRowGap + buttonWidth(btn)
	}
	return int(math.Ceil(float64(w)))
}

func newBubble(app *App) *Bubble {
	b := &Bubble{app: app, centers: map[string]int{}, tipOps: make(chan func(), 32)}
	go func() {
		for op := range b.tipOps {
			op()
		}
	}()
	b.skills = skillsFor("")
	b.buttons = buttonsFor(b.skills)
	b.win = mygo.NewWindow(mygo.WindowOptions{
		Title:         "popMind Bubble",
		Panel:         true,
		Hidden:        true,
		Frameless:     true,
		Transparent:   true,
		Vibrancy:      mygo.VibrancyPopover,
		Width:         rowWidth(b.buttons),
		Height:        bubbleHeight,
		DisableResize: true,
		Content:       ui.View(b.view),
	})
	b.win.OnShow(func() {
		roundPanel(b.win, 10)
		native.ConfigureBubbleWindow(b.win.NativeHandle(), 0)
	})
	b.win.OnClose(func(e *mygo.CloseEvent) {
		if quitting.Load() {
			return
		}
		e.PreventDefault()
		b.Hide()
	})
	return b
}

// Show shows the bubble for p, above the pointer, without taking the keyboard from the app the text is in.
func (b *Bubble) Show(p textpicker.Picked) {
	skills := skillsFor(p.Text)
	buttons := buttonsFor(skills)
	w := rowWidth(buttons)
	b.tipDo(b.hideTipNow)
	b.win.Update(func() {
		b.picked, b.skills, b.buttons, b.hovered = p, skills, buttons, ""
	})
	anchor := textpicker.Anchor{X: p.Cursor.X, TopY: p.Cursor.Y, BottomY: p.Cursor.Y}
	r := placeAbove(anchor, w, bubbleHeight, bubbleGap)
	b.win.SetBounds(r)
	showIn(b.win, 100, 0, func() {
		b.win.ShowInactive()
		native.ConfigureBubbleWindow(b.win.NativeHandle(), 0)
		native.OrderWindowFront(b.win.NativeHandle())
	})
	logx.Info("[bubble] shown", "x", r.X, "y", r.Y, "width", w, "skills", len(skills), "app", p.AppName)
}

// Hide hides the bubble and its tooltip.
func (b *Bubble) Hide() {
	b.tipDo(b.hideTipNow)
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
	if b.centers == nil {
		b.centers = map[string]int{}
	}
	if b.buttons == nil {
		b.buttons = buttonsFor(b.skills)
	}

	fg := t.Text.Alpha(0.62)
	hovered, pressedNow := "", ""
	x := float32(bubblePad + bubbleGripW)
	divider := func() { ui.Box(c).Width(1).Height(16).Background(Hairline(t)).Margin(0, 2) }
	ui.Row(c).Fill().Padding(0, bubblePad).Gap(bubbleRowGap).AlignItems(ui.Center).Children(func() {
		grip := ui.Box(c.Key("grip")).Size(bubbleGripW, 24).Radius(5).Center().DragWindow()
		if grip.Hovered() {
			grip.Background(HoverFill(t))
			hovered = "grip"
		}
		grip.Children(func() { ui.Icon(c, icons.Get("grip-vertical")).FontSize(12).TextColor(fg) })
		b.centers["grip"] = bubblePad + bubbleGripW/2
		for _, btn := range b.buttons {
			if btn.dividerBefore {
				divider()
				x += bubbleRowGap + bubbleDivider
			}
			w := buttonWidth(btn)
			b.centers[btn.id] = int(x + bubbleRowGap + w/2)
			x += bubbleRowGap + w
			el := ui.ButtonBase(c.Key(btn.id)).Size(w, 28).Radius(7).Center().Label(btn.label).Transition(hoverColors)
			color := fg
			switch {
			case el.Pressed():
				el.Background(HoverFill(t).Alpha(0.16))
				pressedNow = btn.id
			case el.Hovered():
				el.Background(HoverFill(t))
				color = t.Text
			}
			if el.Hovered() {
				hovered = btn.id
			}
			el.Children(func() {
				if btn.logo {
					name := "logo"
					if t.Dark {
						name = "logo-dark"
					}
					ui.Image(c, assets.Bitmap(name)).Size(18, 18)
				} else {
					ui.Icon(c, icons.Get(btn.icon)).FontSize(16).TextColor(color)
				}
			})
		}
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

// trackHover shows the hovered button's label in the tooltip below the bubble once the pointer rests on it,
// and moves it along as the pointer goes from one button to the next.
func (b *Bubble) trackHover(c *ui.Context, hovered string) {
	if hovered != b.hovered {
		logx.Info("[bubble] hover", "on", hovered)
		b.hovered, b.hoverAt, b.tipShown = hovered, time.Now(), false
		if hovered == "" {
			b.tipDo(b.hideTipNow)
		}
	}
	if hovered == "" || b.tipShown {
		return
	}
	label := i18n.T("bubble.drag")
	for _, btn := range b.buttons {
		if btn.id == hovered {
			label = btn.label
		}
	}
	seen := b.tipSeen.Load()
	warm := seen != 0 && time.Since(time.Unix(0, seen)) < tipWarm
	if wait := tipDelay - time.Since(b.hoverAt); wait > 0 && !warm {
		c.After(wait)
		return
	}
	w, _ := c.MeasureText(0, ui.Span{Text: label, Size: 12})
	b.tipShown = true
	x, width := b.centers[hovered], int(math.Ceil(float64(w)))+20
	b.tipDo(func() { b.showTipNow(label, x, width) })
}

// tipDo queues op for the tooltip's goroutine.
func (b *Bubble) tipDo(op func()) {
	select {
	case b.tipOps <- op:
	default: // nil (tests) or full: the next move of the pointer queues it again
	}
}

// showTipNow shows label in the tooltip under x (the middle of a button, in the bubble), width DIPs wide. On the
// tooltip's goroutine.
func (b *Bubble) showTipNow(label string, x, width int) {
	anchor := mygo.Rectangle{X: x, Y: 0, Width: 0, Height: bubbleHeight}
	if !b.win.IsVisible() {
		return
	}
	b.tipSeen.Store(time.Now().UnixNano())
	if b.tip == nil {
		b.tipText = label
		b.tip = mygo.NewFlyout(mygo.FlyoutOptions{
			Parent: b.win, Anchor: anchor, Placement: mygo.PlacementBottom, Gap: 6,
			Width: width, Height: 24, Content: ui.View(b.tipView),
		})
		// A flyout keeps the normal window level, under the windows of the app in front (popMind is never
		// active while the bubble shows): lift it to the bubble's level.
		native.ConfigureBubbleWindow(b.tip.NativeHandle(), 0)
		native.OrderWindowFront(b.tip.NativeHandle())
		roundPanel(b.tip, 6)
		logx.Info("[bubble] tip", "label", label)
		return
	}
	tip := b.tip
	tip.Update(func() { b.tipText = label })
	tip.SetSize(width, 24)
	tip.SetAnchor(anchor)
	if !tip.IsVisible() {
		tip.ShowInactive()
		native.OrderWindowFront(tip.NativeHandle())
	}
	logx.Info("[bubble] tip", "label", label)
}

// ShowTipForTest shows the tooltip of the button id as hovering it would; for the dev self test.
func (b *Bubble) ShowTipForTest(id string) {
	label := i18n.T("bubble.drag")
	for _, btn := range b.buttons {
		if btn.id == id {
			label = btn.label
		}
	}
	x, width := b.centers[id], len([]rune(label))*13+20
	b.tipDo(func() { b.showTipNow(label, x, width) })
}

// hideTipNow hides the tooltip, kept for the next one. On the tooltip's goroutine.
func (b *Bubble) hideTipNow() {
	if b.tip != nil && b.tip.IsVisible() {
		b.tip.Hide()
		b.tipSeen.Store(time.Now().UnixNano())
	}
}

func (b *Bubble) tipView(c *ui.Context) {
	t := Look(c)
	c.Root().Background(TooltipFill(t))
	ui.Box(c).Fill().Center().Children(func() {
		ui.Text(c, b.tipText).FontSize(12).TextColor(TooltipText(t)).SingleLine()
	})
}
