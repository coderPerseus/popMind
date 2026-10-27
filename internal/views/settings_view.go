package views

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/ai"
	"popmind/internal/clipboard"
	"popmind/internal/i18n"
	"popmind/internal/jsonx"
	"popmind/internal/native"
	"popmind/internal/settings"
	"popmind/internal/translation"
	"popmind/internal/views/icons"
	"popmind/internal/websearch"
)

// ShortcutState is a global shortcut and whether it is registered (main's shortcut manager).
type ShortcutState struct {
	ID          string
	Accelerator string
	State       string // "registered", "disabled", "failed", "conflict", "suspended"
}

// settingsUI is the editing state of the settings window.
type settingsUI struct {
	aiProvider  string
	aiDraft     settings.AIProviderConfig
	aiTest      string
	aiTesting   bool
	searchTest  map[string]string
	recording   string
	themeMode   string
	ignoredNew  string
	loadedDraft bool
	models      modelList
	sync        syncUI
}

func (s *SettingsWindow) save(patch map[string]any) {
	go func() {
		if _, err := settings.Capabilities.Update(patch); err != nil {
			s.win.Update(func() { s.err = err.Error() })
		}
	}()
}

func (s *SettingsWindow) view(c *ui.Context) {
	t := Look(c)
	if c.Vibrancy() {
		c.Root().Background(ui.Transparent)
	}
	if c.Shortcut(ui.Cmd, ui.KeyW) {
		go s.Hide()
	}
	bar := c.TitleBar()
	ui.Row(c).Fill().AlignItems(ui.Stretch).Children(func() {
		side := ui.Column(c).Width(200).Padding(bar.Height+8, 10, 10, 10).Gap(2)
		if !c.Vibrancy() {
			side.Background(t.Surface)
		}
		side.Children(func() {
			ui.Box(c).Height(0).DragWindow()
			for _, sec := range []struct{ id, icon, label string }{
				{"general", "settings", i18n.T("settings.nav.general")},
				{"selection", "type", i18n.T("settings.nav.selection")},
				{"translation", "languages", i18n.T("settings.nav.translation")},
				{"ai", "sparkles", i18n.T("settings.nav.ai")},
				{"shortcuts", "keyboard", i18n.T("settings.nav.shortcuts")},
				{"clipboard", "clipboard", i18n.T("clip.settings.nav")},
			} {
				row := ui.ButtonBase(c.Key(sec.id)).Gap(8).Padding(6, 10).Radius(7).AlignItems(ui.Center).Justify(ui.Start).
					Transition(hoverColors)
				color := t.Text
				selected := s.section == sec.id
				if selected {
					row.Background(t.Accent)
					color = t.AccentText
				} else if row.Hovered() {
					row.Background(HoverFill(t))
				}
				row.Children(func() {
					ui.Icon(c, icons.Get(sec.icon)).FontSize(14).TextColor(color)
					ui.Text(c, sec.label).TextColor(color)
				})
				if row.Clicked() {
					s.section = sec.id
				}
			}
		})
		ui.Column(c).Grow(1).Background(t.Background).Children(func() {
			ui.Row(c).Height(max(bar.Height, 44)).Padding(0, 24).AlignItems(ui.Center).DragWindow().Children(func() {
				ui.Text(c, s.title()).FontSize(15).FontWeight(600)
			})
			ui.Scroll(c).Grow(1).Children(func() {
				ui.Column(c.Key("section-"+s.section)).Transition(fadeIn).Padding(4, 24, 24, 24).Gap(18).MaxWidth(720).Children(func() {
					if s.err != "" {
						ui.Text(c, s.err).TextColor(t.Danger).FontSize(12)
					}
					switch s.section {
					case "selection":
						s.selectionSection(c)
					case "translation":
						s.translationSection(c)
					case "ai":
						s.aiSection(c)
					case "shortcuts":
						s.shortcutsSection(c)
					case "clipboard":
						s.clipboardSection(c)
					default:
						s.generalSection(c)
					}
				})
			})
		})
	})
}

func (s *SettingsWindow) title() string {
	switch s.section {
	case "selection":
		return i18n.T("settings.nav.selection")
	case "translation":
		return i18n.T("settings.title.translation")
	case "ai":
		return i18n.T("settings.capability.ai.title")
	case "shortcuts":
		return i18n.T("settings.nav.shortcuts")
	case "clipboard":
		return i18n.T("clip.settings.nav")
	}
	return i18n.T("settings.title.general")
}

// group is a titled box of rows separated by hairlines.
func group(c *ui.Context, title string, rows func()) {
	t := c.Theme()
	ui.Column(c).Gap(6).Children(func() {
		if title != "" {
			ui.Text(c, title).FontSize(12).FontWeight(600).TextColor(t.TextMuted).Padding(0, 4)
		}
		ui.Column(c).Radius(10).Background(CardFill(t)).Border(0.5, Hairline(t)).Dividers(0.5, Hairline(t)).Children(rows)
	})
}

// footnote explains the group above it, in small gray text under the box (System Settings' style).
func footnote(c *ui.Context, text string) {
	ui.Text(c, text).FontSize(11).TextColor(Tertiary(c.Theme())).Padding(0, 6).Margin(-12, 0, 0, 0)
}

// row is a setting: its name and description on the left, its control on the right.
func row(c *ui.Context, label, desc string, control func()) {
	ui.Row(c).Padding(10, 14).Gap(16).AlignItems(ui.Center).Children(func() {
		ui.Column(c).Grow(1).Shrink(1).Gap(2).Children(func() {
			ui.Text(c, label)
			if desc != "" {
				Muted(c, desc).FontSize(11)
			}
		})
		if control != nil {
			control()
		}
	})
}

func (s *SettingsWindow) generalSection(c *ui.Context) {
	cap := settings.Capabilities.Get()
	if s.ui.themeMode == "" {
		s.ui.themeMode = settings.ThemeMode()
	}
	group(c, i18n.T("settings.group.appearance"), func() {
		row(c, i18n.T("settings.theme.title"), "", func() {
			mode := s.ui.themeMode
			if Picker(c.Key("theme"), &mode, []Option{{"system", i18n.T("settings.theme.system")}, {"light", i18n.T("settings.theme.light")},
				{"dark", i18n.T("settings.theme.dark")}}, "theme").Changed() {
				s.ui.themeMode = mode
				_ = settings.SetThemeMode(mode)
				switch mode {
				case "light":
					mygo.Theme.SetSource(mygo.ThemeLight)
				case "dark":
					mygo.Theme.SetSource(mygo.ThemeDark)
				default:
					mygo.Theme.SetSource(mygo.ThemeSystem)
				}
			}
		})
		row(c, i18n.T("common.language"), "", func() {
			lang := cap.AppLanguage
			if Picker(c.Key("lang"), &lang, []Option{{"zh-CN", "简体中文"}, {"en", "English"}}, "language").Changed() {
				s.save(map[string]any{"appLanguage": lang})
			}
		})
	})
	group(c, i18n.T("settings.nav.permissions"), func() {
		granted := native.CheckPermission(false)
		row(c, i18n.T("settings.accessibility.title"), i18n.T("settings.accessibility.desc"), func() {
			status := i18n.T("common.disabled")
			if granted {
				status = i18n.T("common.enabled")
			}
			Muted(c, status)
			if !granted && ui.Button(c, i18n.T("common.openSettings")).Clicked() {
				go func() {
					native.CheckPermission(true)
					native.OpenAccessibilitySettings()
				}()
			}
		})
		s.legacyRow(c)
		row(c, i18n.T("settings.advanced.version"), "", func() { Muted(c, mygo.App.Version()) })
	})
}

func (s *SettingsWindow) selectionSection(c *ui.Context) {
	cap := settings.Capabilities.Get()
	group(c, i18n.T("settings.selection.behavior"), func() {
		row(c, i18n.T("settings.selection.defaultAction"), i18n.T("settings.selection.defaultActionDesc"), func() {
			action := cap.Selection.DefaultAction
			if Picker(c.Key("action"), &action, []Option{{"bubble", i18n.T("settings.selection.action.bubble")},
				{"translate", i18n.T("settings.selection.action.translate")}, {"explain", i18n.T("settings.selection.action.explain")}}, "action").Changed() {
				s.save(map[string]any{"selection": map[string]any{"defaultAction": action}})
			}
		})
		if s.app != nil && s.app.Picker != nil {
			row(c, i18n.T("tray.disableSelection"), "", func() {
				on := s.app.Picker.Enabled()
				if ui.Switch(c, &on).Changed() {
					s.app.Picker.SetEnabled(on)
				}
			})
		}
	})
	group(c, i18n.T("settings.explain.group"), func() {
		row(c, i18n.T("settings.aiGlow.title"), i18n.T("settings.aiGlow.desc"), func() {
			on := cap.AIGlowOn()
			if ui.Switch(c.Key("ai-glow"), &on).Changed() {
				s.save(map[string]any{"appearance": map[string]any{"aiGlow": on}})
			}
		})
		row(c, i18n.T("settings.explain.screenshot.title"), i18n.T("settings.explain.screenshot.desc"), func() {
			on := cap.ExplainScreenshotOn()
			if ui.Switch(c.Key("explain-shot"), &on).Changed() {
				s.save(map[string]any{"selection": map[string]any{"explainScreenshot": on}})
			}
		})
		if cap.ExplainScreenshotOn() {
			granted := native.ScreenCaptureAccess(false)
			row(c, i18n.T("settings.screen.title"), i18n.T("settings.screen.desc"), func() {
				status := i18n.T("common.disabled")
				if granted {
					status = i18n.T("common.enabled")
				}
				Muted(c, status)
				if !granted && ui.Button(c.Key("screen-perm"), i18n.T("common.openSettings")).Clicked() {
					go func() {
						if !native.ScreenCaptureAccess(true) {
							native.OpenScreenRecordingSettings()
						}
					}()
				}
			})
		}
	})
	group(c, i18n.T("settings.selection.blocked"), func() {
		apps := settings.Blocked.All()
		if len(apps) == 0 {
			row(c, i18n.T("settings.selection.blockedEmpty"), i18n.T("settings.selection.blockedDesc"), nil)
		}
		for _, id := range apps {
			row(c, id, "", func() {
				if ui.Button(c.Key(id), i18n.T("settings.selection.restore")).Clicked() {
					settings.Blocked.Remove(id)
				}
			})
		}
	})
}

func (s *SettingsWindow) translationSection(c *ui.Context) {
	cap := settings.Capabilities.Get()
	group(c, i18n.T("settings.translation.engines"), func() {
		for _, id := range translation.VisibleEngines(cap) {
			on := cap.EnabledEngines[id]
			desc := ""
			if id == translation.AI && ai.Resolve(cap, "") == nil {
				desc = i18n.T("settings.capability.ai.testMissingConfig")
			}
			row(c, translation.EngineLabels[id], desc, func() {
				if ui.Switch(c.Key(id), &on).Changed() {
					s.save(map[string]any{"enabledEngines": map[string]any{id: on}})
				}
			})
		}
	})
	footnote(c, i18n.T("settings.translation.enginesDesc"))
	group(c, i18n.T("settings.translation.languages"), func() {
		for _, f := range []struct{ key, label, value string }{
			{"firstLanguage", i18n.T("settings.translation.first"), cap.FirstLanguage},
			{"secondLanguage", i18n.T("settings.translation.second"), cap.SecondLanguage},
		} {
			row(c, f.label, "", func() {
				v := f.value
				if Picker(c.Key(f.key), &v, languageOptions(false), f.key).Changed() {
					s.save(map[string]any{f.key: v})
				}
			})
		}
	})
}

func (s *SettingsWindow) aiSection(c *ui.Context) {
	t := c.Theme()
	cap := settings.Capabilities.Get()
	active := ""
	if cap.AIService.ActiveProvider != nil {
		active = *cap.AIService.ActiveProvider
	}
	if s.ui.aiProvider == "" {
		s.ui.aiProvider = active
		if s.ui.aiProvider == "" {
			s.ui.aiProvider = ai.OpenAI
		}
	}
	if !s.ui.loadedDraft {
		s.ui.aiDraft = cap.AIService.Providers[s.ui.aiProvider]
		s.ui.loadedDraft = true
	}
	group(c, i18n.T("settings.capability.ai.title"), func() {
		row(c, i18n.T("settings.capability.ai.provider"), i18n.T("settings.capability.ai.desc"), func() {
			p := s.ui.aiProvider
			var opts []Option
			for _, id := range ai.ProviderOrder {
				switch id {
				case ai.Gemma:
				case ai.Custom:
					label := i18n.T("settings.ai.custom.label")
					if n := strings.TrimSpace(cap.AIService.Providers[ai.Custom].Name); n != "" {
						label += " · " + n
					}
					opts = append(opts, Option{id, label})
				default:
					opts = append(opts, Option{id, ai.ProviderLabels[id]})
				}
			}
			if Picker(c.Key("provider"), &p, opts, "provider").Changed() {
				s.ui.aiProvider, s.ui.aiDraft, s.ui.aiTest = p, cap.AIService.Providers[p], ""
				s.ui.models = modelList{}
				s.save(map[string]any{"aiService": map[string]any{"activeProvider": p}})
			}
		})
		field := func(key, label string, value *string, secret bool) {
			desc := ""
			if key == "baseURL" && s.ui.aiProvider == ai.Custom {
				desc = i18n.T("settings.ai.custom.baseDesc")
			}
			row(c, label, desc, func() {
				in := ui.TextInput(c.Key(s.ui.aiProvider+key), value).Width(320)
				if secret {
					in.Password()
				}
				if in.Changed() {
					s.save(map[string]any{"aiService": map[string]any{"providers": map[string]any{s.ui.aiProvider: map[string]any{key: *value}}}})
					// A new address or key: ask for its models once the typing stops.
					s.scheduleModels(700 * time.Millisecond)
				}
			})
		}
		if s.ui.aiProvider == ai.Custom {
			saveCustom := func(key, value string) {
				s.save(map[string]any{"aiService": map[string]any{"providers": map[string]any{ai.Custom: map[string]any{key: value}}}})
			}
			row(c, i18n.T("settings.ai.custom.name"), i18n.T("settings.ai.custom.nameDesc"), func() {
				if ui.TextInput(c.Key("custom-name"), &s.ui.aiDraft.Name).Placeholder(i18n.T("settings.ai.custom.namePlaceholder")).
					Width(320).Changed() {
					saveCustom("name", s.ui.aiDraft.Name)
				}
			})
			row(c, i18n.T("settings.ai.custom.format"), i18n.T("settings.ai.custom.formatDesc"), func() {
				format := s.ui.aiDraft.Format
				if format == "" {
					format = ai.FormatOpenAI
				}
				if Picker(c.Key("custom-format"), &format, []Option{
					{ai.FormatOpenAI, i18n.T("settings.ai.custom.format.openai")},
					{ai.FormatAnthropic, i18n.T("settings.ai.custom.format.anthropic")},
					{ai.FormatGoogle, i18n.T("settings.ai.custom.format.google")},
				}, "format").Changed() {
					s.ui.aiDraft.Format = format
					saveCustom("format", format)
					s.ui.models = modelList{}
				}
			})
		}
		field("apiKey", i18n.T("settings.capability.ai.apiKey"), &s.ui.aiDraft.APIKey, true)
		field("baseURL", i18n.T("settings.capability.ai.baseUrl"), &s.ui.aiDraft.BaseURL, false)
		row(c, i18n.T("settings.capability.ai.model"), s.modelStatus(), func() {
			s.modelField(c, func() {
				s.save(map[string]any{"aiService": map[string]any{"providers": map[string]any{s.ui.aiProvider: map[string]any{"model": s.ui.aiDraft.Model}}}})
			})
		})
		row(c, "", s.ui.aiTest, func() {
			label := i18n.T("settings.capability.ai.test")
			if s.ui.aiTesting {
				label = i18n.T("settings.capability.ai.testing")
			}
			if ui.Button(c, label).Disabled(s.ui.aiTesting).Clicked() {
				s.testAI()
			}
		})
	})
	// Opened from a conversation's "联网 · 去配置": scroll to web search.
	searchAnchor := ui.Box(c.Key("search-anchor")).Height(1)
	if s.revealSearch {
		s.revealSearch = false
		searchAnchor.ScrollIntoView()
	}
	group(c, i18n.T("settings.capability.search.title"), func() {
		row(c, i18n.T("settings.capability.search.enabled"), i18n.T("settings.capability.search.priority"), func() {
			on := cap.WebSearch.Enabled
			if ui.Switch(c, &on).Changed() {
				s.save(map[string]any{"webSearch": map[string]any{"enabled": on}})
			}
		})
		for _, id := range websearch.Order {
			key := cap.WebSearch.Providers[id].APIKey
			row(c, strings.ToUpper(id[:1])+id[1:], s.ui.searchTest[id], func() {
				if ui.TextInput(c.Key("ws"+id), &key).Password().Width(260).Changed() {
					s.save(map[string]any{"webSearch": map[string]any{"providers": map[string]any{id: map[string]any{"apiKey": key}}}})
				}
				if ui.Button(c.Key("wst"+id), i18n.T("settings.capability.ai.test")).Disabled(key == "").Clicked() {
					s.testSearch(id, key)
				}
			})
		}
	})
	_ = t
}

func (s *SettingsWindow) testAI() {
	s.ui.aiTesting, s.ui.aiTest = true, ""
	cap := settings.Capabilities.Get()
	cfg := s.ui.aiDraft
	cap.AIService.Providers[s.ui.aiProvider] = cfg
	p := s.ui.aiProvider
	cap.AIService.ActiveProvider = &p
	m := ai.Resolve(cap, p)
	go func() {
		msg := i18n.T("settings.capability.ai.testMissingConfig")
		if m != nil {
			if d, err := ai.Test(context.Background(), m); err != nil {
				msg = "✗ " + err.Error()
			} else {
				msg = fmt.Sprintf("✓ %s · %d ms", m.ModelID, d.Milliseconds())
			}
		}
		s.win.Update(func() { s.ui.aiTest, s.ui.aiTesting = msg, false })
	}()
}

func (s *SettingsWindow) testSearch(id, key string) {
	if s.ui.searchTest == nil {
		s.ui.searchTest = map[string]string{}
	}
	s.ui.searchTest[id] = i18n.T("settings.capability.ai.testing") + "…"
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		n, err := websearch.Test(ctx, id, key)
		msg := fmt.Sprintf("✓ %d", n)
		if err != nil {
			msg = "✗ " + err.Error()
		}
		s.win.Update(func() { s.ui.searchTest[id] = msg })
	}()
}

var shortcutOrder = []string{"toggleHome", "clipboardHistory", "inputTranslation", "hideBubble"}

func (s *SettingsWindow) shortcutsSection(c *ui.Context) {
	t := c.Theme()
	cap := settings.Capabilities.Get()
	states := map[string]ShortcutState{}
	if s.app != nil && s.app.ShortcutStatus != nil {
		for _, st := range s.app.ShortcutStatus() {
			states[st.ID] = st
		}
	}
	Muted(c, i18n.T("settings.shortcuts.intro"))
	group(c, "", func() {
		for _, id := range shortcutOrder {
			acc := cap.Shortcuts[id]
			desc := i18n.T("settings.shortcuts.action." + id + "Desc")
			switch states[id].State {
			case "failed":
				desc = i18n.T("settings.shortcuts.failed")
			case "conflict":
				desc = i18n.T("settings.shortcuts.conflict", "name", "")
			}
			row(c, i18n.T("settings.shortcuts.action."+id), desc, func() {
				recording := s.ui.recording == id
				label := keysLabel(acc)
				if recording {
					label = i18n.T("settings.shortcuts.recording")
				} else if acc == "" {
					label = i18n.T("settings.shortcuts.off")
				}
				b := ui.ButtonBase(c.Key("rec"+id)).Padding(4, 12).Radius(6).MinWidth(120).Center().Border(0.5, Hairline(t)).Focusable()
				if recording {
					b.Border(2, t.Accent)
				} else if b.Hovered() {
					b.Background(HoverFill(t))
				}
				b.Children(func() { ui.Text(c, label).FontSize(12) })
				if b.Clicked() {
					s.ui.recording = id
					if s.app.SetShortcutRecording != nil {
						s.app.SetShortcutRecording(true)
					}
				}
				if recording {
					b.HandleInput(func(ev ui.InputEvent) bool {
						if ev.Kind != ui.InputKeyDown {
							return false
						}
						switch ev.Key {
						case ui.KeyEscape:
							s.stopRecording()
							return true
						case ui.KeyBackspace, ui.KeyDelete:
							s.stopRecording()
							s.save(map[string]any{"shortcuts": map[string]any{id: ""}})
							return true
						}
						if acc := accelerator(ev); acc != "" {
							s.stopRecording()
							s.save(map[string]any{"shortcuts": map[string]any{id: acc}})
						}
						return true
					})
				}
				if acc != settings.DefaultShortcuts()[id] && IconButton(c.Key("reset"+id), "refresh-cw", i18n.T("settings.shortcuts.reset")).Clicked() {
					s.save(map[string]any{"shortcuts": map[string]any{id: settings.DefaultShortcuts()[id]}})
				}
			})
		}
	})
}

func (s *SettingsWindow) stopRecording() {
	s.ui.recording = ""
	if s.app.SetShortcutRecording != nil {
		s.app.SetShortcutRecording(false)
	}
}

// accelerator spells a key press as Electron's accelerators ("Alt+Space"); "" without ⌘, ⌃ or ⌥ (function keys
// excepted).
func accelerator(ev ui.InputEvent) string {
	var key string
	switch {
	case ev.Key >= ui.KeyA && ev.Key <= ui.KeyZ:
		key = string(rune('A' + int(ev.Key-ui.KeyA)))
	case ev.Key >= ui.Key0 && ev.Key <= ui.Key9:
		key = string(rune('0' + int(ev.Key-ui.Key0)))
	case ev.Key >= ui.KeyF1 && ev.Key <= ui.KeyF12:
		key = fmt.Sprintf("F%d", int(ev.Key-ui.KeyF1)+1)
	case ev.Key == ui.KeySpace:
		key = "Space"
	default:
		names := map[ui.Key]string{ui.KeyComma: ",", ui.KeyPeriod: ".", ui.KeySlash: "/", ui.KeySemicolon: ";",
			ui.KeyQuote: "'", ui.KeyMinus: "-", ui.KeyEqual: "="}
		key = names[ev.Key]
	}
	if key == "" {
		return ""
	}
	var mods []string
	if ev.Mods&ui.Ctrl != 0 {
		mods = append(mods, "Control")
	}
	if ev.Mods&ui.Alt != 0 {
		mods = append(mods, "Alt")
	}
	if ev.Mods&ui.Shift != 0 {
		mods = append(mods, "Shift")
	}
	if ev.Mods&ui.Super != 0 {
		mods = append(mods, "Command")
	}
	if !strings.HasPrefix(key, "F") || len(key) == 1 {
		if ev.Mods&(ui.Ctrl|ui.Alt|ui.Super) == 0 {
			return ""
		}
	}
	return strings.Join(append(mods, key), "+")
}

// keysLabel shows an accelerator as macOS does: ⌥Space.
func keysLabel(acc string) string {
	return strings.NewReplacer("CommandOrControl+", "⌘", "CmdOrCtrl+", "⌘", "Command+", "⌘", "Cmd+", "⌘",
		"Control+", "⌃", "Ctrl+", "⌃", "Alt+", "⌥", "Option+", "⌥", "Shift+", "⇧").Replace(acc)
}

func (s *SettingsWindow) clipboardSection(c *ui.Context) {
	raw := settings.Capabilities.Raw()
	var cs clipboard.Settings
	_ = jsonx.Convert(raw["clipboard"], &cs)
	patch := func(v map[string]any) { s.save(map[string]any{"clipboard": v}) }
	group(c, i18n.T("clip.settings.group.record"), func() {
		row(c, i18n.T("clip.settings.capture.title"), i18n.T("clip.settings.capture.desc"), func() {
			on := cs.Enabled
			if ui.Switch(c, &on).Changed() {
				patch(map[string]any{"enabled": on})
			}
		})
		row(c, i18n.T("clip.settings.retention.title"), i18n.T("clip.settings.retention.desc"), func() {
			v := cs.Retention
			var opts []Option
			for _, r := range []string{"1d", "1w", "1m", "1y", "forever"} {
				opts = append(opts, Option{r, i18n.T("clip.settings.retention." + r)})
			}
			if Picker(c.Key("ret"), &v, opts, "retention").Changed() {
				patch(map[string]any{"retention": v})
			}
		})
		if s.app != nil && s.app.Clips != nil {
			row(c, i18n.T("clip.panel.count.total", "count", s.app.Clips.Count()), "", nil)
		}
	})
	group(c, i18n.T("clip.settings.group.appearance"), func() {
		row(c, i18n.T("clip.settings.appearance.title"), i18n.T("clip.settings.appearance.desc"), func() {
			v := cs.Appearance
			if Picker(c.Key("appearance"), &v, []Option{{"dark", i18n.T("clip.settings.appearance.dark")},
				{"light", i18n.T("clip.settings.appearance.light")}, {"app", i18n.T("clip.settings.appearance.app")}}, "appearance").Changed() {
				patch(map[string]any{"appearance": v})
			}
		})
	})
	group(c, i18n.T("clip.settings.group.paste"), func() {
		row(c, i18n.T("clip.settings.enter.title"), i18n.T("clip.settings.enter.desc"), func() {
			v := "copy"
			if cs.DirectPaste {
				v = "paste"
			}
			if Picker(c.Key("enter"), &v, []Option{{"paste", i18n.T("clip.settings.enter.paste")}, {"copy", i18n.T("clip.settings.enter.copy")}}, "enter").Changed() {
				patch(map[string]any{"directPaste": v == "paste"})
			}
		})
		row(c, i18n.T("clip.settings.plain.title"), i18n.T("clip.settings.plain.desc"), func() {
			on := cs.AlwaysPlainText
			if ui.Switch(c, &on).Changed() {
				patch(map[string]any{"alwaysPlainText": on})
			}
		})
	})
	group(c, i18n.T("clip.settings.group.ignoredApps"), func() {
		for _, id := range cs.Privacy.IgnoredBundleIDs {
			row(c, id, "", func() {
				if IconButton(c.Key("rm"+id), "x", i18n.T("clip.settings.ignoredApps.remove", "name", id)).Clicked() {
					next := slices.DeleteFunc(slices.Clone(cs.Privacy.IgnoredBundleIDs), func(v string) bool { return v == id })
					patch(map[string]any{"privacy": map[string]any{"ignoredBundleIds": next}})
				}
			})
		}
		row(c, i18n.T("clip.settings.ignoredApps.manual"), "", func() {
			if ui.TextInput(c.Key("ignNew"), &s.ui.ignoredNew).Placeholder("com.example.app").Width(220).Submitted() &&
				strings.Contains(s.ui.ignoredNew, ".") {
				next := append(slices.Clone(cs.Privacy.IgnoredBundleIDs), strings.TrimSpace(s.ui.ignoredNew))
				s.ui.ignoredNew = ""
				patch(map[string]any{"privacy": map[string]any{"ignoredBundleIds": next}})
			}
		})
	})
	footnote(c, i18n.T("clip.settings.ignoredApps.desc"))
	_ = c.Theme()
	s.syncSection(c)
}
