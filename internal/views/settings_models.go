package views

import (
	"context"
	"strings"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo/ui"

	"popmind/internal/ai"
	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/views/icons"
)

// modelList is what a provider's /models said, for the model field's suggestions.
type modelList struct {
	key     string // provider|baseURL|apiKey the list is for
	models  []string
	err     string
	loading bool
	seq     int
	latest  *atomic.Int64
}

func (s *SettingsWindow) modelKey() string {
	d := s.ui.aiDraft
	return s.ui.aiProvider + "|" + d.Format + "|" + strings.TrimSpace(d.BaseURL) + "|" + strings.TrimSpace(d.APIKey)
}

// canFetchModels: a key is needed, except for a local server (Gemma, or a base URL on this machine).
func (s *SettingsWindow) canFetchModels() bool {
	d := s.ui.aiDraft
	local := strings.Contains(d.BaseURL, "127.0.0.1") || strings.Contains(d.BaseURL, "localhost")
	if s.ui.aiProvider == ai.Custom && strings.TrimSpace(d.BaseURL) == "" {
		return false // a relay is its address
	}
	return strings.TrimSpace(d.APIKey) != "" || local
}

// scheduleModels fetches the models a moment after the base URL or key stop changing (immediately when
// asked by the button).
func (s *SettingsWindow) scheduleModels(delay time.Duration) {
	if s.win == nil || !s.canFetchModels() {
		return
	}
	l := &s.ui.models
	if l.latest == nil {
		l.latest = new(atomic.Int64)
	}
	l.seq++
	seq := l.seq
	l.latest.Store(int64(seq))
	key, provider, d := s.modelKey(), s.ui.aiProvider, s.ui.aiDraft
	go func() {
		time.Sleep(delay)
		if l.latest.Load() != int64(seq) {
			return // typed on: a later call fetches
		}
		s.win.Update(func() {
			if l.seq == seq {
				l.loading = true
			}
		})
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		models, err := ai.ListModels(ctx, ai.APIFormat(provider, d.Format), d.APIKey, d.BaseURL)
		cancel()
		logx.Info("[settings] models", "provider", provider, "count", len(models), "err", err)
		s.win.Update(func() {
			if l.seq != seq {
				return
			}
			l.loading, l.key = false, key
			if err != nil {
				l.err, l.models = err.Error(), nil
				return
			}
			l.models, l.err = models, ""
		})
	}()
}

// modelStatus is the line under the model field's name.
func (s *SettingsWindow) modelStatus() string {
	l := &s.ui.models
	switch {
	case l.loading:
		return i18n.T("settings.ai.models.loading")
	case l.err != "" && l.key == s.modelKey():
		reason := l.err
		if len([]rune(reason)) > 80 {
			reason = string([]rune(reason)[:80]) + "…"
		}
		return i18n.T("settings.ai.models.failed", "reason", reason)
	case len(l.models) > 0 && l.key == s.modelKey():
		return i18n.T("settings.ai.models.count", "count", len(l.models))
	}
	return i18n.T("settings.ai.models.hint")
}

// modelField is the model name: typed, or chosen from the fetched list, which filters as one types.
func (s *SettingsWindow) modelField(c *ui.Context, save func()) {
	t := c.Theme()
	l := &s.ui.models
	if l.key != s.modelKey() && !l.loading && l.seq == 0 {
		// First time on this provider: fetch at once.
		s.scheduleModels(0)
	}
	ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
		cb := ui.ComboboxBase(c.Key("model-"+s.ui.aiProvider), &s.ui.aiDraft.Model)
		cb.Input.Width(284).Height(24).Padding(0, 8).Radius(6).Border(0.5, Hairline(t)).Background(t.Surface).
			Placeholder(i18n.T("settings.ai.models.placeholder")).Label(i18n.T("settings.capability.ai.model"))
		if cb.Input.Changed() {
			save()
		}
		models := l.models
		if l.key != s.modelKey() {
			models = nil
		}
		if len(models) > 0 {
			q := strings.ToLower(strings.TrimSpace(s.ui.aiDraft.Model))
			var shown []string
			exact := false
			for _, m := range models {
				exact = exact || strings.ToLower(m) == q
			}
			for _, m := range models {
				// The whole list while the field holds a model of it; else what matches what is typed.
				if exact || q == "" || strings.Contains(strings.ToLower(m), q) {
					shown = append(shown, m)
				}
			}
			cb.Popup(func(panel ui.Element) {
				_, h := c.Size()
				panel.Transition(popIn).TransformOrigin(0.5, 0).Margin(4, 0, 0, 0).Radius(8).Background(t.Background).
					Border(0.5, Hairline(t)).Shadow(0, 6, 18, 0, ui.RGBA(0, 0, 0, 0.18)).Clip().MinWidth(284)
				ui.Scroll(c).MaxHeight(max(120, min(300, h-200))).Children(func() {
					ui.Column(c).Padding(4).Children(func() {
						if len(shown) == 0 {
							ui.Text(c, i18n.T("settings.ai.models.none")).FontSize(12).TextColor(t.TextMuted).Padding(6, 10)
						}
						for _, m := range shown {
							item := cb.Item(m).Padding(5, 10).Radius(5).Transition(hoverColors)
							color := t.Text
							if item.Highlighted() {
								item.Background(t.Accent)
								color = t.AccentText
							}
							item.Children(func() {
								ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
									ui.Text(c, m).FontSize(12).TextColor(color).Grow(1).SingleLine()
									if m == s.ui.aiDraft.Model {
										ui.Icon(c, icons.Get("check")).FontSize(12).TextColor(color)
									}
								})
							})
						}
					})
				})
			})
			if m, ok := cb.Chosen(); ok {
				s.ui.aiDraft.Model = m
				save()
			}
		}
		tip := i18n.T("settings.ai.models.fetch")
		if l.loading {
			ui.Spinner(c).Size(14, 14).Margin(0, 6)
		} else if IconButton(c, "refresh-cw", tip).Disabled(!s.canFetchModels()).Clicked() {
			s.scheduleModels(0)
		}
	})
}
