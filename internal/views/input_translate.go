package views

import (
	"context"
	"strings"
	"sync"
	"unicode/utf8"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/settings"
	"popmind/internal/translation"
	"popmind/internal/views/icons"
	"popmind/internal/windows"
)

const (
	inputTrWidth  = 440
	inputTrHeight = 124
	inputTrGap    = 14
)

// InputTranslation is the box of the input translation shortcut: the user types, Enter translates into the
// chosen language, and the translation takes the place of the text and goes on the clipboard, ready to paste.
// Edits made to the translation are copied too.
type InputTranslation struct {
	app *App
	win *mygo.Window

	draft      string
	input      ui.Handle
	caretToEnd bool
	focusNext  bool

	engine string // "" for the preferred one
	target string
	status string // "idle", "loading", "success", "error"
	err    string

	menuOpen bool // a menu of the toolbar is open: the box keeps its place when it loses the focus to it

	mu     sync.Mutex
	seq    int
	cancel context.CancelFunc
}

func newInputTranslation(app *App) *InputTranslation {
	p := &InputTranslation{app: app, status: "idle"}
	prefs := settings.LoadInputTranslation()
	p.engine, p.target = prefs.Engine, prefs.TargetLanguage
	p.win = mygo.NewWindow(mygo.WindowOptions{
		Title:         "popMind Input Translation",
		Panel:         true,
		Hidden:        true,
		Frameless:     true,
		Transparent:   true,
		Vibrancy:      mygo.VibrancyPopover,
		Width:         inputTrWidth,
		Height:        inputTrHeight,
		DisableResize: true,
		Content:       ui.View(p.view),
	})
	p.win.OnClose(func(e *mygo.CloseEvent) {
		if quitting.Load() {
			return
		}
		e.PreventDefault()
		p.Hide()
	})
	p.win.OnBlur(func() {
		if !p.menuOpen {
			windows.Dispatch(windows.DismissContext{Reason: windows.DismissBlur, Source: "inputTranslation"})
		}
	})
	p.win.OnShow(func() {
		native.RegisterSurfaceWindow(p.win.NativeHandle())
		roundPanel(p.win, 12)
	})
	windows.Register(&windows.Surface{
		ID:       "inputTranslation",
		Priority: 110,
		Visible:  p.win.IsVisible,
		Hide:     p.Hide,
		ShouldDismiss: func(ctx windows.DismissContext) bool {
			switch ctx.Reason {
			case windows.DismissEscape:
				return true
			case windows.DismissBlur:
				return ctx.Source == "inputTranslation" && !p.menuOpen
			case windows.DismissSurfaceOpened:
				return ctx.Target != "inputTranslation"
			}
			return false
		},
	})
	return p
}

// Show opens an empty box by the pointer, below it where there is room.
func (p *InputTranslation) Show() {
	windows.Dispatch(windows.DismissContext{Reason: windows.DismissSurfaceOpened, Target: "inputTranslation"})
	pt := mygo.Screen.CursorScreenPoint()
	r := placeBelow(pt, inputTrWidth, inputTrHeight, inputTrGap)
	p.win.Update(func() {
		p.stop()
		p.draft, p.status, p.err = "", "idle", ""
		p.focusNext = true
	})
	p.win.SetBounds(r)
	showIn(p.win, 90, 0, p.win.Show)
	logx.Info("[input-translation] shown", "x", r.X, "y", r.Y, "engine", p.engine, "target", p.target)
}

// Bounds is where the box is.
func (p *InputTranslation) Bounds() mygo.Rectangle { return p.win.Bounds() }

// Hide hides the box and stops a translation under way.
func (p *InputTranslation) Hide() {
	p.win.Update(func() { p.stop() })
	if p.win.IsVisible() {
		p.win.Hide()
	}
}

// TranslateForTest types text into the box and translates it, as Enter would; for the dev self test.
func (p *InputTranslation) TranslateForTest(text string) {
	p.win.Update(func() {
		p.draft = text
		p.translate()
	})
}

// Toggle shows the box, or hides it when it shows.
func (p *InputTranslation) Toggle() {
	if p.win.IsVisible() {
		p.Hide()
		return
	}
	p.Show()
}

// placeBelow puts a w×h box centered under the point, above it where the display has no room below.
func placeBelow(pt mygo.Point, w, h, gap int) mygo.Rectangle {
	wa := mygo.Screen.DisplayNearestPoint(pt).WorkArea
	x := max(wa.X, min(pt.X-w/2, wa.X+wa.Width-w))
	y := pt.Y + gap
	if y+h > wa.Y+wa.Height {
		y = max(wa.Y, pt.Y-gap-h)
	}
	return mygo.Rectangle{X: x, Y: y, Width: w, Height: h}
}

func (p *InputTranslation) stop() {
	p.mu.Lock()
	if p.cancel != nil {
		p.cancel()
		p.cancel = nil
	}
	p.seq++
	p.mu.Unlock()
}

// translate translates the draft; the result replaces it and is copied. Call on the main thread.
func (p *InputTranslation) translate() {
	text := p.draft
	if p.status == "loading" || strings.TrimSpace(text) == "" {
		return
	}
	p.stop()
	p.mu.Lock()
	seq := p.seq
	ctx, cancel := context.WithCancel(context.Background())
	p.cancel = cancel
	p.mu.Unlock()
	p.status, p.err = "loading", ""
	in := translation.Input{Text: text, TargetLanguage: p.target, Engine: p.engine, QueryMode: "text"}
	logx.Info("[input-translation] translate", "chars", utf8.RuneCountInString(text), "engine", p.engine, "target", p.target)
	go func() {
		res, err := translation.Translate(ctx, in)
		if ctx.Err() != nil {
			return
		}
		p.win.Update(func() {
			p.mu.Lock()
			current := seq == p.seq
			p.mu.Unlock()
			if !current {
				return
			}
			if err != nil {
				logx.Warn("[input-translation] failed", "err", err)
				p.status, p.err = "error", err.Error()
				return
			}
			p.draft = res.TranslatedText
			p.caretToEnd = true
			p.status = "success"
			mygo.Clipboard.WriteText(res.TranslatedText)
			logx.Info("[input-translation] done", "engine", res.Engine, "target", res.TargetLanguage,
				"chars", utf8.RuneCountInString(res.TranslatedText))
		})
	}()
}

func (p *InputTranslation) savePrefs() {
	prefs := settings.InputTranslationPrefs{Engine: p.engine, TargetLanguage: p.target}
	go func() {
		if err := settings.SaveInputTranslation(prefs); err != nil {
			logx.Warn("[input-translation] save choices failed", "err", err)
		}
	}()
}

// chooseFrom opens a native menu of options under the pointer; picking one sets *value and translates again
// when there is a translation to redo.
func (p *InputTranslation) chooseFrom(options []Option, value *string) {
	current := *value
	var items []*mygo.MenuItem
	for _, o := range options {
		o := o
		items = append(items, &mygo.MenuItem{Label: o.Label, Type: mygo.MenuItemRadio, Checked: o.Value == current,
			Click: func(*mygo.MenuItem, *mygo.Window) {
				p.win.Update(func() {
					if *value == o.Value {
						return
					}
					*value = o.Value
					p.savePrefs()
					logx.Info("[input-translation] choice", "engine", p.engine, "target", p.target)
					p.input.Focus()
				})
			}})
	}
	p.menuOpen = true
	go func() {
		mygo.NewMenu(items).Popup(p.win)
		p.win.Update(func() {
			p.menuOpen = false
			p.input.Focus()
		})
	}()
}

func (p *InputTranslation) view(c *ui.Context) {
	t := Look(c)
	Panel(c)
	if c.Shortcut(0, ui.KeyEscape) {
		go p.Hide()
	}
	engine := translation.PreferredEngine(settings.Capabilities.Get(), p.engine)
	ui.Column(c).Fill().Children(func() {
		ui.Box(c).Grow(1).Padding(12, 14, 8, 14).Children(func() {
			in := ui.TextAreaBase(c.Key("draft"), &p.draft).Bind(&p.input).Lines(3, 3).Fill().FontSize(14).
				Placeholder(i18n.T("inputTr.placeholder")).Label(i18n.T("settings.shortcuts.action.inputTranslation"))
			if p.focusNext {
				p.focusNext = false
				p.input.Focus()
			}
			if p.caretToEnd {
				p.caretToEnd = false
				n := utf8.RuneCountInString(p.draft)
				in.SetTextSelection(n, n)
			}
			in.OnTextKey(func(k ui.TextKey) bool {
				if k.Key == ui.KeyEnter && k.Mods == 0 {
					p.translate()
					return true
				}
				return false
			})
			// The translation, edited, is what the user wants to paste: keep the clipboard in step with it.
			if in.Changed() && p.status == "success" {
				mygo.Clipboard.WriteText(p.draft)
			}
		})
		ui.Box(c).Height(0.5).Background(Hairline(t))
		ui.Row(c).Height(34).Padding(0, 6).Gap(2).AlignItems(ui.Center).Children(func() {
			label := translation.EngineLabels[engine]
			if inputTrMenuButton(c, "engine", i18n.T("inputTr.engine"), label, p.status == "loading").Clicked() {
				opts := engineOptions()
				p.chooseFrom(opts, &p.engine)
			}
			if inputTrMenuButton(c, "target", i18n.T("inputTr.target"), translation.LanguageLabel(p.target), p.status == "loading").Clicked() {
				p.chooseFrom(languageOptions(false), &p.target)
			}
			// The empty middle of the toolbar moves the box.
			ui.Box(c.Key("drag")).Grow(1).Height(28).DragWindow()
			switch p.status {
			case "loading":
				ui.Row(c.Key("st-loading")).Padding(0, 4).Children(func() { Working(c, i18n.T("tr.loading"), 12) })
			case "success":
				ui.Row(c.Key("st-done")).Gap(4).AlignItems(ui.Center).Padding(0, 4).Transition(fadeIn).Children(func() {
					ui.Icon(c, icons.Get("check")).FontSize(12).TextColor(t.Success)
					ui.Text(c, i18n.T("inputTr.copied")).FontSize(12).TextColor(t.TextMuted)
				})
			case "error":
				ui.Text(c.Key("st-error"), i18n.T("inputTr.failed")).FontSize(12).TextColor(t.Danger).Padding(0, 4).Tooltip(p.err)
			}
			if IconButton(c.Key("close"), "x", i18n.T("inputTr.close")).Clicked() {
				go p.Hide()
			}
		})
	})
}

// inputTrMenuButton is a toolbar button showing a choice, which opens a menu of the others.
func inputTrMenuButton(c *ui.Context, key, label, value string, disabled bool) ui.Element {
	t := c.Theme()
	b := ui.ButtonBase(c.Key(key)).Height(24).Padding(0, 8).Gap(4).Radius(6).AlignItems(ui.Center).Label(label).Tooltip(label).
		Transition(hoverColors).Disabled(disabled)
	if b.Hovered() && !disabled {
		b.Background(HoverFill(t))
	}
	color := t.Text
	if disabled {
		color = t.TextMuted
	}
	return b.Children(func() {
		ui.Text(c, value).FontSize(12).TextColor(color).SingleLine()
		ui.Icon(c, icons.Get("chevron-down")).FontSize(11).TextColor(t.TextMuted)
	})
}
