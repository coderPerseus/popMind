package views

import (
	"github.com/egoist/mygo/ui"

	"popmind/internal/ai"
	"popmind/internal/chat"
	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/settings"
	"popmind/internal/views/icons"
)

// The launcher's /ai (-ai) command: a quick conversation with the user's AI model, in the launcher itself. Enter
// on "-ai question" turns the launcher into a chat, the messages above and the composer below, as chat apps
// are; Esc stops a reply or goes back to the search, and hiding the launcher ends the chat.

// startChat starts a conversation with question. Call on the main thread.
func (l *Launcher) startChat(question string) {
	s := chat.Start(l.panel.Update, chat.ModeChat, "", "", nil)
	conv := newConversation()
	conv.OnConfigureSearch = func() { l.app.ShowSettings("ai-search") }
	conv.Reset(s)
	l.conv, l.focusConv = conv, true
	l.query, l.lastTrText = "", ""
	s.Submit(question)
	logx.Info("[launcher] ai chat", "provider", s.Provider, "model", s.ModelID, "web", s.WebSearch)
}

// endChat stops the reply under way and goes back to the search. Call on the main thread.
func (l *Launcher) endChat() {
	if l.conv == nil {
		return
	}
	if s := l.conv.Session; s != nil && s.Busy() {
		s.Stop()
	}
	l.conv = nil
}

// aiCard is what "-ai …" shows before Enter: the question and the model that will answer, or how to set one up.
func (l *Launcher) aiCard(c *ui.Context, p parsed) {
	t := c.Theme()
	chip(c, p.trigger, i18n.T("launcher.command.ai.title"))
	card(c, func() {
		m := ai.Resolve(settings.Capabilities.Get(), "")
		if m == nil {
			ui.Text(c, i18n.T("selectionChat.error.missingAiConfig")).FontSize(12).TextColor(t.Warning)
			b := ui.ButtonBase(c.Key("ai-setup")).Height(26).Padding(0, 10).Radius(6).AlignSelf(ui.Start).
				Border(0.5, Hairline(t)).Transition(hoverColors)
			if b.Hovered() {
				b.Background(HoverFill(t))
			}
			if b.Children(func() { ui.Text(c, i18n.T("launcher.ai.setup")).FontSize(12) }).Clicked() {
				l.app.ShowSettings("ai")
			}
			return
		}
		if p.text == "" {
			Muted(c, i18n.T("launcher.ai.hint"))
		} else {
			ui.Text(c, p.text).MaxLines(4)
		}
		ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icons.Get("sparkles")).FontSize(12).TextColor(t.TextMuted)
			Muted(c, m.Name+" · "+m.ModelID).FontSize(11).SingleLine()
		})
	})
}

// chatView is the launcher while it is a chat.
func (l *Launcher) chatView(c *ui.Context) {
	t := c.Theme()
	conv := l.conv
	s := conv.Session
	conv.StepGlow(c)
	c.OnShortcut(ui.Cmd, ui.KeyComma, func() { l.app.ShowSettings("") })
	if c.Shortcut(0, ui.KeyEscape) {
		if s != nil && s.Busy() {
			s.Stop()
		} else {
			// The search comes back in the next frame; this one still draws the chat.
			l.endChat()
			l.input.Focus()
		}
	}
	ui.Column(c).Fill().Children(func() {
		ui.Row(c).Height(52).Padding(0, 10, 0, 16).Gap(10).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icons.Get("sparkles")).FontSize(17).TextColor(t.Accent)
			ui.Column(c).Grow(1).Shrink(1).Children(func() {
				ui.Text(c, i18n.T("launcher.command.ai.title")).FontSize(13).FontWeight(600)
				Muted(c, conv.Meta()).FontSize(11).SingleLine()
			})
			conv.WebToggle(c)
			if IconButton(c.Key("ai-new"), "square-pen", i18n.T("launcher.ai.new")).Clicked() {
				l.endChat()
				l.setQuery("-ai ")
				l.input.Focus()
				return
			}
			if IconButton(c.Key("ai-back"), "x", i18n.T("launcher.ai.back")).Clicked() {
				l.endChat()
				l.input.Focus()
				return
			}
		})
		ui.Box(c).Height(0.5).Background(Hairline(t))
		conv.Thread(c).Grow(1)
		conv.Composer(c)
		conv.Glow(c, 14)
	})
	if l.focusConv {
		l.focusConv = false
		conv.Focus()
	}
}

// SubmitForTest presses Enter in the launcher (or sends the composer's question in a chat); for the dev self test.
func (l *Launcher) SubmitForTest(followUp string) {
	l.panel.Update(func() {
		if l.conv != nil {
			l.conv.Session.Submit(followUp)
			return
		}
		p := parseQuery(l.query)
		if p.command == nil || p.command.kind != "ai" {
			return // the chat ended (the launcher hid): press nothing else
		}
		l.submit(p, l.entries(p))
	})
}
