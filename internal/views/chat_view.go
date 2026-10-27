package views

import (
	"fmt"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"

	"popmind/internal/chat"
	"popmind/internal/i18n"
	"popmind/internal/settings"
	"popmind/internal/views/icons"
	"popmind/internal/websearch"
)

// Conversation draws a chat session: its messages, the selection they are about, and the composer. The explain
// window and the launcher's /ex card share it (SelectionChatPanel and ExplainCard of the Electron app).
type Conversation struct {
	Session *chat.Session
	draft   string
	input   ui.Handle
	list    ui.ListState
	md      markdown.Options
	sources map[string]bool
	copied  string
	shot    *ui.Bitmap
	shotFor *chat.Session
	// glow lights the window while a reply is written (glow.go).
	glow Glow
	// OnConfigureSearch opens the web search settings, for the "联网" switch without a provider set up.
	OnConfigureSearch func()
}

// StepGlow moves the glow on for this frame; call at the start of the window's view.
func (v *Conversation) StepGlow(c *ui.Context) {
	v.glow.Step(c, v.Session != nil && v.Session.Busy())
}

// Glow draws the window's glowing edge; call last in the window's root, radius its corner radius.
func (v *Conversation) Glow(c *ui.Context, radius float32) { v.glow.Edge(c, radius) }

func newConversation() *Conversation {
	c := &Conversation{sources: map[string]bool{}}
	c.md.OnLink = func(u string) { _ = mygo.Shell.OpenExternal(u) }
	c.list.FollowEnd = true
	c.list.FollowAnimation = &ui.Smooth
	return c
}

// Reset starts showing s.
func (v *Conversation) Reset(s *chat.Session) {
	v.Session, v.draft, v.copied = s, "", ""
	v.sources = map[string]bool{}
	v.list.FollowEnd = true
	v.list.ScrollToEnd()
}

// Focus gives the composer the keyboard.
func (v *Conversation) Focus() { v.input.Focus() }

// Title is "划词解释" or "问 AI".
func (v *Conversation) Title() string {
	if v.Session != nil && v.Session.Mode == "ask" {
		return i18n.T("chat.title.ask")
	}
	return i18n.T("selectionChat.title")
}

// Meta is "provider · model · search provider", or "就绪".
func (v *Conversation) Meta() string {
	s := v.Session
	if s == nil || s.Provider == "" {
		return i18n.T("selectionChat.status.ready")
	}
	meta := s.Provider + " · " + s.ModelID
	if s.SearchProvider != "" {
		meta += " · " + s.SearchProvider
	}
	return meta
}

// WebToggle is the "联网" switch. Without a web search provider set up it is a link to its settings instead,
// as a switch that turns nothing on would be.
func (v *Conversation) WebToggle(c *ui.Context) {
	if v.Session == nil {
		return
	}
	t := c.Theme()
	if p, _ := websearch.Configured(settings.Capabilities.Get()); p == "" {
		v.Session.WebSearch = false
		b := ui.ButtonBase(c.Key("web-setup")).Height(22).Gap(4).Padding(0, 6).Radius(6).AlignItems(ui.Center).
			Label(i18n.T("chat.web.setup.tip")).Tooltip(i18n.T("chat.web.setup.tip")).Transition(hoverColors)
		if b.Hovered() {
			b.Background(HoverFill(t))
		}
		b.Children(func() {
			ui.Icon(c, icons.Get("globe")).FontSize(12).TextColor(t.TextMuted)
			Muted(c, i18n.T("chat.web")).FontSize(11)
			ui.Text(c, i18n.T("chat.web.setup")).FontSize(11).TextColor(t.Accent)
		})
		if b.Clicked() && v.OnConfigureSearch != nil {
			go v.OnConfigureSearch()
		}
		return
	}
	ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
		Muted(c, i18n.T("chat.web")).FontSize(11)
		ui.Switch(c, &v.Session.WebSearch).Label(i18n.T("selectionChat.status.search")).Scale(0.8, 0.8)
	})
}

func (v *Conversation) visible() []*chat.Message {
	s := v.Session
	if s == nil {
		return nil
	}
	var out []*chat.Message
	for i, m := range s.Messages {
		if i == 0 && s.Mode == "explain" && m.Role == "user" && m.Text == s.SelectionText {
			continue
		}
		out = append(out, m)
	}
	return out
}

// Thread shows the messages, then the selection they are about.
func (v *Conversation) Thread(c *ui.Context) ui.Element {
	t := c.Theme()
	s := v.Session
	msgs := v.visible()
	latestAssistant := ""
	for _, m := range msgs {
		if m.Role == "assistant" {
			latestAssistant = m.ID
		}
	}
	n := len(msgs) + 2 // messages, the status line, the context card
	v.list.Key = func(i int) any {
		switch {
		case i < len(msgs):
			return msgs[i].ID
		case i == len(msgs):
			return "status"
		}
		return "context"
	}
	return ui.List(c, &v.list, n, func(i int) {
		switch {
		case i < len(msgs):
			v.message(c, msgs[i], msgs[i].ID == latestAssistant)
		case i == len(msgs):
			hasErr := false
			for _, m := range msgs {
				hasErr = hasErr || m.Err != ""
			}
			if s != nil && s.Status == chat.StatusError && !hasErr && s.Err != "" {
				ui.Text(c, s.Err).FontSize(12).TextColor(t.Danger).Selectable()
			} else {
				ui.Box(c).Height(0)
			}
		default:
			if s == nil || s.SelectionText == "" {
				ui.Box(c).Height(0)
				return
			}
			ui.Column(c).Gap(6).Children(func() {
				ui.Row(c).Radius(8).Background(HoverFill(t)).Padding(8, 12, 8, 8).Gap(8).Children(func() {
					ui.Box(c).Width(2.5).Radius(2).Background(t.Accent).AlignSelf(ui.Stretch)
					ui.Text(c, s.SelectionText).FontSize(12).TextColor(t.TextMuted).MaxLines(4).Grow(1).Selectable()
				})
				v.screenshotNote(c)
			})
		}
	}).Gap(10).Padding(10, 14)
}

func (v *Conversation) message(c *ui.Context, m *chat.Message, latest bool) {
	t := c.Theme()
	s := v.Session
	if m.Role == "user" {
		ui.Row(c.Key("msg-" + m.ID)).Transition(fadeIn).Children(func() {
			ui.Spacer(c)
			ui.Text(c, m.Text).Selectable().SelectionColor(ui.RGBA(255, 255, 255, 0.3)).TextColor(ui.RGB(255, 255, 255)).
				Padding(7, 11).Radius(12).Background(t.Accent).MaxWidthPercent(82)
		})
		return
	}
	v.md.Theme, v.md.Reveal = MarkdownTheme(t), mdReveal
	ui.Column(c.Key("msg-" + m.ID)).Transition(fadeIn).Gap(6).Children(func() {
		switch {
		case m.Text == "" && m.Err == "" && !m.Done:
			msg := i18n.T("selectionChat.loading")
			if s.Mode == chat.ModeChat {
				msg = i18n.T("chat.thinking")
			}
			if s.Status == chat.StatusSearching {
				msg = i18n.T("selectionChat.searching")
			}
			Shimmer(c, msg, 13)
		case m.Done:
			markdown.View(c, m.Text, &v.md)
		default:
			markdown.Stream(c, m.Text, &v.md)
		}
		if m.Stopped {
			Muted(c, i18n.T("selectionChat.stopped")).FontSize(11)
		}
		if m.Err != "" {
			ui.Text(c, m.Err).FontSize(12).TextColor(t.Danger).Selectable()
		}
		if len(m.Sources) > 0 {
			open := v.sources[m.ID]
			toggle := ui.ButtonBase(c.Key("src"+m.ID)).Gap(4).AlignItems(ui.Center).Justify(ui.Start).AlignSelf(ui.Start).Padding(2, 0)
			toggle.Children(func() {
				icon := "chevron-right"
				if open {
					icon = "chevron-down"
				}
				ui.Icon(c, icons.Get(icon)).FontSize(11).TextColor(t.TextMuted)
				Muted(c, fmt.Sprintf("%s (%d)", i18n.T("selectionChat.source.title"), len(m.Sources))).FontSize(11)
			})
			if toggle.Clicked() {
				v.sources[m.ID] = !open
			}
			if open {
				ui.Column(c.Key("src-list-"+m.ID)).Transition(ui.ElementTransition{Duration: motionBase,
					Enter: &ui.Motion{Collapse: true}, Exit: &ui.Motion{Collapse: true}}).Clip().Gap(6).Padding(0, 0, 0, 14).Children(func() {
					for _, src := range m.Sources {
						ui.Column(c).Gap(1).Children(func() {
							ui.Link(c, src.Title, src.URL).FontSize(12)
							if src.Snippet != "" {
								Muted(c, src.Snippet).FontSize(11).MaxLines(2)
							}
						})
					}
				})
			}
		}
		if latest && m.Done && m.Text != "" && !s.Busy() {
			ui.Row(c.Key("actions-" + m.ID)).Transition(fadeIn).Gap(2).Children(func() {
				icon, tip := "copy", i18n.T("common.copy")
				if v.copied == m.ID {
					icon, tip = "check", i18n.T("common.copied")
				}
				if IconButton(c, icon, tip).Clicked() {
					mygo.Clipboard.WriteText(m.Text)
					v.copied = m.ID
				}
				if IconButton(c, "refresh-cw", i18n.T("common.retry")).Clicked() {
					s.Regenerate()
					v.list.ScrollToEnd()
				}
			})
		}
	})
}

// Composer is the follow-up field with its send / stop button.
func (v *Conversation) Composer(c *ui.Context) {
	t := c.Theme()
	s := v.Session
	placeholder := i18n.T("selectionChat.inputPlaceholder")
	if s != nil && s.Mode == "ask" {
		placeholder = i18n.T("chat.askPlaceholder")
	}
	frame := ui.Row(c).Transition(hoverColors).Margin(0, 12, 12, 12).Padding(6, 6, 6, 10).Gap(6).AlignItems(ui.End).Radius(10).
		Background(CardFill(t)).Border(0.5, Hairline(t))
	if !v.glow.Glowing() && v.input.FocusWithin(c) {
		frame.Border(1, t.Accent.Alpha(0.6))
	}
	frame.Children(func() {
		v.glow.Outline(c, 10)
		in := ui.TextAreaBase(c.Key("draft"), &v.draft).Bind(&v.input).Lines(1, 5).Grow(1).Placeholder(placeholder).Padding(4, 0)
		in.OnTextKey(func(k ui.TextKey) bool {
			if k.Key == ui.KeyEnter && k.Mods == 0 {
				if s != nil && !s.Busy() && k.Text() != "" {
					s.Submit(k.Text())
					k.SetText("")
					v.list.FollowEnd = true
					v.list.ScrollToEnd()
				}
				return true
			}
			return false
		})
		btn := ui.ButtonBase(c.Key("send")).Size(26, 26).Radius(13).Center().Transition(hoverColors)
		if s != nil && s.Busy() {
			btn.Background(HoverFill(t).Alpha(0.16)).Label(i18n.T("common.stop")).Tooltip(i18n.T("common.stop"))
			btn.Children(func() { ui.Icon(c, icons.Get("square")).FontSize(11).TextColor(t.Text) })
			if btn.Clicked() {
				s.Stop()
			}
			return
		}
		enabled := s != nil && v.draft != ""
		bg := HoverFill(t)
		color := t.TextMuted
		if enabled {
			bg, color = t.Accent, t.AccentText
		}
		btn.Background(bg).Label(i18n.T("common.send")).Disabled(!enabled)
		btn.Children(func() { ui.Icon(c, icons.Get("send-horizontal")).FontSize(13).TextColor(color) })
		if btn.Clicked() {
			s.Submit(v.draft)
			v.draft = ""
			v.list.FollowEnd = true
			v.list.ScrollToEnd()
		}
	})
}

// screenshotNote tells whether the answer saw a capture of the source window, with a small thumbnail.
func (v *Conversation) screenshotNote(c *ui.Context) {
	s := v.Session
	if s == nil || !s.HasImage() {
		return
	}
	t := c.Theme()
	if v.shotFor != s {
		v.shotFor, v.shot = s, nil
		if b, err := ui.DecodeBitmap(s.Image()); err == nil {
			v.shot = b
		}
	}
	label, color := i18n.T("chat.ctx.image.pending"), Tertiary(t)
	switch s.ImageState {
	case "sent":
		label = i18n.T("chat.ctx.image.sent")
	case "unsupported":
		label, color = i18n.T("chat.ctx.image.unsupported"), t.Warning
	case "dropped":
		label, color = i18n.T("chat.ctx.image.dropped"), t.Warning
	}
	ui.Row(c).Gap(8).AlignItems(ui.Center).Padding(0, 2).Children(func() {
		if v.shot != nil {
			ui.Image(c, v.shot).Fit(ui.Cover).Size(44, 28).Radius(4).Border(0.5, Hairline(t))
		} else {
			ui.Icon(c, icons.Get("image")).FontSize(13).TextColor(color)
		}
		ui.Text(c, label).FontSize(11).TextColor(color)
	})
}
