package views

import (
	"math"
	"sync"
	"time"
	"unicode"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/settings"
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
	// A button with its icon alone, and the logo's; a labelled one has padding, the icon, a gap and the label.
	bubbleIconW    = 30
	bubbleLogoW    = 28
	bubbleLabelPad = 8
	bubbleLabelGap = 4
	bubbleLabelPt  = 12
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

// Bubble is the toolbar shown above a selection. A button shows its icon and its label until the user has
// clicked it once (settings.BubbleUsed), and its icon alone from then on, with the label in a tooltip.
type Bubble struct {
	app     *App
	win     *mygo.Window
	picked  textpicker.Picked
	skills  []skill
	buttons []bubbleButton
	used    map[string]bool // the buttons showing their icon alone, as of the last Show
	width   int

	textMu sync.Mutex
	textW  map[string]float32 // label widths, as measured while building

	tip      *mygo.Window
	tipText  string
	hovered  string
	hoverAt  time.Time
	tipShown bool
	pressed  string
	centers  map[string]int // the middle of each button, for the tooltip
}

// labelWidth is the measured width of a label, or an estimate before it has been measured.
func (b *Bubble) labelWidth(label string) float32 {
	b.textMu.Lock()
	w, ok := b.textW[label]
	b.textMu.Unlock()
	if ok {
		return w
	}
	for _, r := range label {
		if r > 0x2e80 || unicode.Is(unicode.Han, r) {
			w += bubbleLabelPt
		} else {
			w += bubbleLabelPt * 0.56
		}
	}
	return w
}

func (b *Bubble) buttonWidth(btn bubbleButton, used map[string]bool) float32 {
	switch {
	case used[btn.id] && btn.logo:
		return bubbleLogoW
	case used[btn.id]:
		return bubbleIconW
	}
	icon := float32(16)
	if btn.logo {
		icon = 18
	}
	return bubbleLabelPad + icon + bubbleLabelGap + b.labelWidth(btn.label) + bubbleLabelPad
}

// rowWidth is the bubble's width: padding, the grip, then each button after a gap, and the dividers.
func (b *Bubble) rowWidth(buttons []bubbleButton, used map[string]bool) int {
	w := float32(2*bubblePad + bubbleGripW)
	for _, btn := range buttons {
		if btn.dividerBefore {
			w += bubbleRowGap + bubbleDivider
		}
		w += bubbleRowGap + b.buttonWidth(btn, used)
	}
	return int(math.Ceil(float64(w)))
}

func newBubble(app *App) *Bubble {
	b := &Bubble{app: app, textW: map[string]float32{}, centers: map[string]int{}}
	b.skills = skillsFor("")
	b.buttons = buttonsFor(b.skills)
	b.width = b.rowWidth(b.buttons, nil)
	b.win = mygo.NewWindow(mygo.WindowOptions{
		Title:         "popMind Bubble",
		Panel:         true,
		Hidden:        true,
		Frameless:     true,
		Transparent:   true,
		Vibrancy:      mygo.VibrancyPopover,
		Width:         b.width,
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
	used := map[string]bool{}
	for _, btn := range buttons {
		used[btn.id] = settings.BubbleUsed.Has(btn.id)
	}
	w := b.rowWidth(buttons, used)
	b.win.Update(func() {
		b.picked, b.skills, b.buttons, b.used, b.hovered, b.width = p, skills, buttons, used, "", w
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
	// Labels are measured as they are drawn; a bubble shown before its labels were measured takes their
	// width now.
	if b.textW == nil {
		b.textW, b.centers = map[string]float32{}, map[string]int{}
	}
	if b.buttons == nil {
		b.buttons = buttonsFor(b.skills)
	}
	measured := false
	for _, btn := range b.buttons {
		b.textMu.Lock()
		_, ok := b.textW[btn.label]
		b.textMu.Unlock()
		if !ok && !b.used[btn.id] {
			w, _ := c.MeasureText(0, ui.Span{Text: btn.label, Size: bubbleLabelPt})
			b.textMu.Lock()
			b.textW[btn.label] = float32(math.Ceil(float64(w)))
			b.textMu.Unlock()
			measured = true
		}
	}
	if w := b.rowWidth(b.buttons, b.used); measured && w != b.width && b.win != nil {
		b.width = w
		go b.win.SetSize(w, bubbleHeight)
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
			w := b.buttonWidth(btn, b.used)
			b.centers[btn.id] = int(x + bubbleRowGap + w/2)
			x += bubbleRowGap + w
			el := ui.ButtonBase(c.Key(btn.id)).Size(w, 28).Radius(7).Center().Gap(bubbleLabelGap).Label(btn.label).Transition(hoverColors)
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
				if !b.used[btn.id] {
					ui.Text(c, btn.label).FontSize(bubbleLabelPt).TextColor(color).SingleLine()
				}
			})
		}
	})
	// A button acts as it is pressed, as the Electron bubble did, so the first click is never lost to the app the
	// text is in taking the focus back.
	if pressedNow != "" && pressedNow != b.pressed {
		cmd, text := pressedNow, b.picked.Text
		go settings.BubbleUsed.Add(cmd)
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

// trackHover shows the label of a hovered button that shows its icon alone in a tooltip flyout below the
// bubble after a short rest.
func (b *Bubble) trackHover(c *ui.Context, hovered string) {
	if hovered != b.hovered {
		b.hovered, b.hoverAt, b.tipShown = hovered, time.Now(), false
		go b.hideTip()
	}
	if hovered == "" || b.tipShown {
		return
	}
	label := i18n.T("bubble.drag")
	if hovered != "grip" {
		label = ""
		for _, btn := range b.buttons {
			if btn.id == hovered && b.used[btn.id] {
				label = btn.label
			}
		}
	}
	if label == "" {
		return // its label shows on it
	}
	if wait := 380*time.Millisecond - time.Since(b.hoverAt); wait > 0 {
		c.After(wait)
		return
	}
	b.tipShown = true
	go b.showTip(label, b.centers[hovered])
}

func (b *Bubble) showTip(label string, x int) {
	width := int(float64(len([]rune(label)))*12.5) + 20
	anchor := mygo.Rectangle{X: x, Y: 0, Width: 0, Height: bubbleHeight}
	if b.tip == nil {
		b.tipText = label
		b.tip = mygo.NewFlyout(mygo.FlyoutOptions{
			Parent: b.win, Anchor: anchor, Placement: mygo.PlacementBottom, Gap: 6,
			Width: width, Height: 24, Content: ui.View(b.tipView),
		})
		b.tip.OnClosed(func() { b.tip = nil })
		// A flyout keeps the normal window level, under the windows of the app in front (popMind is never
		// active while the bubble shows): lift it to the bubble's level.
		native.ConfigureBubbleWindow(b.tip.NativeHandle(), 0)
		native.OrderWindowFront(b.tip.NativeHandle())
		roundPanel(b.tip, 6)
		return
	}
	b.tip.Update(func() { b.tipText = label })
	b.tip.SetSize(width, 24)
	b.tip.SetAnchor(anchor)
}

// ShowTipForTest shows the tooltip of the button id as hovering it would; for the dev self test.
func (b *Bubble) ShowTipForTest(id string) {
	label := i18n.T("bubble.drag")
	for _, btn := range b.buttons {
		if btn.id == id {
			label = btn.label
		}
	}
	b.showTip(label, b.centers[id])
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
	c.Root().Background(TooltipFill(t))
	ui.Box(c).Fill().Center().Children(func() {
		ui.Text(c, b.tipText).FontSize(12).TextColor(TooltipText(t)).SingleLine()
	})
}
