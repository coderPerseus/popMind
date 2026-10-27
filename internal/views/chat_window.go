package views

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/chat"
	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/textpicker"
	"popmind/internal/views/icons"
	"popmind/internal/windows"
)

const (
	chatWidth  = 460
	chatHeight = 540
)

// ChatWindow is the explain conversation.
type ChatWindow struct {
	app    *App
	win    *mygo.Window
	conv   *Conversation
	pinned bool
}

func newChatWindow(app *App) *ChatWindow {
	w := &ChatWindow{app: app, conv: newConversation()}
	w.win = mygo.NewWindow(mygo.WindowOptions{
		Title:       "popMind Explain",
		Panel:       true,
		Hidden:      true,
		Frameless:   true,
		Transparent: true,
		Vibrancy:    mygo.VibrancyPopover,
		Width:       chatWidth,
		Height:      chatHeight,
		MinWidth:    380,
		MinHeight:   320,
		Content:     ui.View(w.view),
	})
	w.win.OnShow(func() {
		native.RegisterSurfaceWindow(w.win.NativeHandle())
		roundPanel(w.win, 12)
	})
	w.win.OnClose(func(e *mygo.CloseEvent) {
		e.PreventDefault()
		w.Hide()
	})
	windows.Register(&windows.Surface{
		ID: "selection-chat", Priority: 320, Visible: w.win.IsVisible, Hide: w.Hide,
		ShouldDismiss: func(ctx windows.DismissContext) bool {
			switch {
			case ctx.Reason == windows.DismissEscape:
				return true
			case w.pinned:
				return false
			case ctx.Reason == windows.DismissSurfaceOpened:
				return ctx.Target != "selection-chat"
			}
			return ctx.Reason == windows.DismissSelectionChanged || ctx.Reason == windows.DismissScene ||
				ctx.Reason == windows.DismissOutside
		},
	})
	return w
}

// Open starts a conversation about text (mode "explain" or "ask") near anchor, or centered without one.
func (w *ChatWindow) Open(mode, text, sourceApp string, image []byte, anchor *textpicker.Anchor) {
	windows.Dispatch(windows.DismissContext{Reason: windows.DismissSurfaceOpened, Target: "selection-chat"})
	var r mygo.Rectangle
	if w.pinned && w.win.IsVisible() {
		r = w.win.Bounds()
	} else if anchor != nil {
		r = placeAbove(*anchor, chatWidth, chatHeight, floatingGap)
	} else {
		d := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
		r = mygo.Rectangle{X: d.WorkArea.X + (d.WorkArea.Width-chatWidth)/2, Y: d.WorkArea.Y + (d.WorkArea.Height-chatHeight)/3,
			Width: chatWidth, Height: chatHeight}
	}
	w.win.Update(func() {
		if w.conv.Session != nil {
			w.conv.Session.Stop()
		}
		w.conv.Reset(chat.Start(w.win.Update, mode, text, sourceApp, image))
		if mode == "ask" {
			w.conv.Focus()
		}
	})
	w.win.SetBounds(r)
	showIn(w.win, 130, 0, w.win.Show)
	logx.Info("[chat-window] opened", "mode", mode, "chars", len([]rune(text)), "image", len(image) > 0)
}

// Hide stops the reply and hides the window.
func (w *ChatWindow) Hide() {
	w.win.Update(func() {
		if w.conv.Session != nil {
			w.conv.Session.Stop()
		}
		w.pinned = false
	})
	w.win.Hide()
	w.app.afterFloatingChange()
}

// Visible reports whether it shows.
func (w *ChatWindow) Visible() bool { return w.win.IsVisible() }

// Bounds is where it is.
func (w *ChatWindow) Bounds() mygo.Rectangle { return w.win.Bounds() }

func (w *ChatWindow) view(c *ui.Context) {
	t := Look(c)
	Panel(c)
	s := w.conv.Session
	if c.Shortcut(0, ui.KeyEscape) {
		if s != nil && s.Busy() {
			s.Stop()
		} else {
			go w.Hide()
		}
	}
	ui.Column(c).Fill().Children(func() {
		ui.Row(c).Padding(8, 10).Gap(8).AlignItems(ui.Center).DragWindow().Children(func() {
			ui.Icon(c, icons.Get("grip-vertical")).FontSize(12).TextColor(t.TextMuted)
			ui.Column(c).Grow(1).Shrink(1).Children(func() {
				ui.Text(c, w.conv.Title()).FontSize(13).FontWeight(600)
				Muted(c, w.conv.Meta()).FontSize(11).SingleLine()
			})
			w.conv.WebToggle(c)
			tip := i18n.T("translate.pin")
			if w.pinned {
				tip = i18n.T("translate.unpin")
			}
			if ActiveIconButton(c, "pin", tip, w.pinned).Clicked() {
				w.pinned = !w.pinned
			}
			if IconButton(c, "x", i18n.T("common.close")).Clicked() {
				go w.Hide()
			}
		})
		ui.Box(c).Height(0.5).Background(Hairline(t))
		if s == nil {
			ui.Column(c).Grow(1).Center().Gap(4).Padding(20).Children(func() {
				ui.Text(c, i18n.T("chat.empty.title")).FontWeight(600)
				Muted(c, i18n.T("selectionChat.empty")).TextAlign(ui.Center)
			})
		} else {
			w.conv.Thread(c).Grow(1)
		}
		w.conv.Composer(c)
	})
}
