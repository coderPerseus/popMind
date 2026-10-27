package views

import (
	"context"
	"fmt"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"

	"popmind/internal/ai"
	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/settings"
	"popmind/internal/speech"
	"popmind/internal/translation"
	"popmind/internal/views/icons"
)

// Translator is the state of one translation surface: the text, the languages and engine chosen, and the
// result. Run starts a translation on a goroutine and hands the result to the view through Update.
type Translator struct {
	// Update runs fn on the main thread and redraws (Window.Update of the window showing it).
	Update func(fn func())

	Text   string
	Source string // "auto" or a code
	Target string // "auto" or a code
	Engine string // "" for the preferred one

	Status string // "idle", "loading", "success", "error"
	Result translation.Result
	Err    string

	mu       sync.Mutex
	seq      int
	cancel   context.CancelFunc
	copiedAt time.Time
	md       *markdown.Options
}

// markdownOptions renders translated markdown: links open in the browser, code wraps in the narrow popup.
func (t *Translator) markdownOptions() *markdown.Options {
	if t.md == nil {
		t.md = &markdown.Options{WrapCode: true, LoadImage: webImages,
			OnLink: func(u string) { _ = mygo.Shell.OpenExternal(u) }}
	}
	return t.md
}

// Reset clears the result and the choices, for a new text.
func (t *Translator) Reset() {
	t.stop()
	t.Text, t.Source, t.Target, t.Engine, t.Status, t.Err = "", "auto", "auto", "", "idle", ""
	t.Result = translation.Result{}
}

func (t *Translator) stop() {
	t.mu.Lock()
	if t.cancel != nil {
		t.cancel()
		t.cancel = nil
	}
	t.seq++
	t.mu.Unlock()
}

// Run translates text with the current choices (after delay, so typing does not send a request per key).
func (t *Translator) Run(text string, delay time.Duration) {
	text = strings.TrimSpace(text)
	t.stop()
	t.Text = text
	if text == "" {
		t.Status, t.Err = "idle", ""
		t.Result = translation.Result{}
		return
	}
	t.Status, t.Err = "loading", ""
	t.mu.Lock()
	seq := t.seq
	ctx, cancel := context.WithCancel(context.Background())
	t.cancel = cancel
	t.mu.Unlock()
	in := translation.Input{Text: text, SourceLanguage: t.Source, TargetLanguage: t.Target, Engine: t.Engine}
	go func() {
		if delay > 0 {
			select {
			case <-time.After(delay):
			case <-ctx.Done():
				return
			}
		}
		res, err := translation.Translate(ctx, in)
		if ctx.Err() != nil {
			return
		}
		t.Update(func() {
			t.mu.Lock()
			current := seq == t.seq
			t.mu.Unlock()
			if !current {
				return
			}
			if err != nil {
				logx.Warn("[translate-view] failed", "err", err)
				t.Status, t.Err = "error", err.Error()
				return
			}
			t.Status, t.Result = "success", res
		})
	}()
}

// Retranslate runs again with the current choices.
func (t *Translator) Retranslate() { t.Run(t.Text, 0) }

// Copy puts the translation on the clipboard.
func (t *Translator) Copy() {
	if t.Status != "success" {
		return
	}
	mygo.Clipboard.WriteText(t.Result.TranslatedText)
	t.copiedAt = time.Now()
}

func (t *Translator) justCopied() bool { return time.Since(t.copiedAt) < 1500*time.Millisecond }

func languageOptions(withAuto bool) []Option {
	var out []Option
	for _, l := range translation.Languages() {
		if l.Code == "auto" && !withAuto {
			continue
		}
		out = append(out, Option{l.Code, l.Label})
	}
	return out
}

func engineOptions() []Option {
	c := settings.Capabilities.Get()
	enabled := translation.EnabledEngines(c)
	out := []Option{}
	for _, id := range enabled {
		out = append(out, Option{id, translation.EngineLabels[id]})
	}
	for _, id := range translation.VisibleEngines(c) {
		if !slices.Contains(enabled, id) && (id != translation.AI || ai.Resolve(c, "") != nil) {
			out = append(out, Option{id, translation.EngineLabels[id]})
		}
	}
	return out
}

// Toolbar shows the languages and the engine, which retranslate as they change.
func (t *Translator) Toolbar(c *ui.Context) {
	th := c.Theme()
	source := t.Source
	if source == "" {
		source = "auto"
	}
	target := t.Target
	if target == "auto" || target == "" {
		if t.Status == "success" {
			target = t.Result.TargetLanguage
		} else {
			guess := t.Source
			if guess == "auto" || guess == "" {
				guess = translation.GuessSourceLanguage(t.Text)
			}
			target = translation.AutoTarget(settings.Capabilities.Get(), guess)
		}
	}
	ui.Row(c).Gap(2).AlignItems(ui.Center).Children(func() {
		word := t.Status == "success" && t.Result.Word != nil
		if Picker(c.Key("source"), &source, languageOptions(true), "source").Disabled(word).Changed() {
			t.Source = source
			t.Retranslate()
		}
		ui.Text(c, "→").FontSize(12).TextColor(th.TextMuted).Padding(0, 2)
		if Picker(c.Key("target"), &target, languageOptions(false), "target").Disabled(word).Changed() {
			t.Target = target
			t.Retranslate()
		}
	})
}

// Footer shows the engine and the actions: read aloud, copy, retranslate.
func (t *Translator) Footer(c *ui.Context, languages bool) {
	th := c.Theme()
	engine := t.Engine
	if engine == "" {
		if t.Status == "success" {
			engine = t.Result.Engine
		} else {
			engine = translation.PreferredEngine(settings.Capabilities.Get(), "")
		}
	}
	word := t.Status == "success" && t.Result.Word != nil
	ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
		if Picker(c.Key("engine"), &engine, engineOptions(), "engine").Disabled(word).Changed() {
			t.Engine = engine
			t.Retranslate()
		}
		if languages {
			// The launcher's card keeps the languages next to the engine, in one row.
			ui.Box(c).Width(0.5).Height(14).Margin(0, 4).Background(Hairline(th))
			t.Toolbar(c)
		}
		ui.Spacer(c)
		if !word {
			payload := t.speechPayload()
			speaking := speech.Speaking() != ""
			icon, label := "volume-2", i18n.T("tr.speak")
			if speaking {
				icon, label = "square", i18n.T("tr.stopSpeak")
			}
			if actionButton(c, "speak", icon, label, false).Disabled(payload == nil || t.Status == "loading").Clicked() {
				t.toggleSpeak(payload)
			}
		}
		icon, label := "copy", i18n.T("tr.copy")
		if t.justCopied() {
			icon, label = "check", i18n.T("tr.copied")
			c.After(1500 * time.Millisecond)
		}
		if actionButton(c, "copy", icon, label, false).Disabled(t.Status != "success").Clicked() {
			t.Copy()
		}
		if actionButton(c, "retranslate", "refresh-cw", i18n.T("tr.retranslate"), true).Disabled(t.Status == "loading" || t.Text == "").Clicked() {
			t.Retranslate()
		}
	})
	_ = th
}

// actionButton is a small labeled button of a footer; primary is in the accent color.
func actionButton(c *ui.Context, key, icon, label string, primary bool) ui.Element {
	t := c.Theme()
	b := ui.ButtonBase(c.Key(key)).Gap(4).Padding(4, 8).Radius(6).AlignItems(ui.Center).Transition(hoverColors)
	color := t.TextMuted
	if primary {
		color = t.Accent
		b.Background(t.Accent.Alpha(0.1))
	}
	if b.Hovered() {
		b.Background(HoverFill(t))
		if !primary {
			color = t.Text
		}
	}
	return b.Children(func() {
		ui.Icon(c, icons.Get(icon)).FontSize(13).TextColor(color)
		ui.Text(c, label).FontSize(12).TextColor(color)
	})
}

type speechPayload struct{ text, lang, role string }

// speechPayload is what "read aloud" reads: English source text, else an English translation
// (resolveEnglishSpeechPayload).
func (t *Translator) speechPayload() *speechPayload {
	if t.Status != "success" {
		return nil
	}
	r := t.Result
	src := translation.Trim(r.SourceText)
	detected := r.DetectedSourceLanguage
	if detected == "" {
		detected = r.SourceLanguage
	}
	if src != "" && (translation.Family(detected) == "en" || translation.GuessSourceLanguage(src) == "en") {
		return &speechPayload{src, "en-US", "source"}
	}
	if out := translation.Trim(r.TranslatedText); out != "" && translation.Family(r.TargetLanguage) == "en" {
		return &speechPayload{out, "en-US", "translated"}
	}
	return nil
}

func (t *Translator) toggleSpeak(p *speechPayload) {
	if speech.Speaking() != "" {
		speech.Stop()
		return
	}
	if p != nil {
		speech.Speak(p.text, p.lang, p.role, func() { t.Update(func() {}) })
	}
}

// Body shows the result: loading, an error, a dictionary entry or the translated text.
func (t *Translator) Body(c *ui.Context, showSource bool) {
	th := c.Theme()
	switch t.Status {
	case "idle":
		Muted(c, i18n.T("translate.placeholder"))
	case "loading":
		ui.Row(c.Key("tr-loading")).Children(func() { Working(c, i18n.T("tr.loading")+"…", 12) })
	case "error":
		ui.Column(c).Gap(4).Children(func() {
			ui.Text(c, i18n.T("translation.error.generic")).TextColor(th.Danger).FontWeight(600)
			ui.Text(c, t.Err).FontSize(12).TextColor(th.TextMuted).Selectable()
		})
	case "success":
		if w := t.Result.Word; w != nil {
			ui.Column(c.Key(fmt.Sprint("tr-word-", t.seq))).Transition(fadeIn).Children(func() { wordEntry(c, w) })
			return
		}
		// Each new result fades in where the "translating…" line was.
		ui.Column(c.Key(fmt.Sprint("tr-result-", t.seq))).Transition(fadeIn).Gap(8).Selectable().Children(func() {
			if t.Result.Markdown {
				opts := t.markdownOptions()
				opts.Theme = MarkdownTheme(th)
				markdown.View(c, t.Result.TranslatedText, opts)
			} else {
				ui.Text(c, t.Result.TranslatedText).FontSize(15).FontWeight(500).LineHeight(1.55)
			}
			if showSource && t.Result.SourceText != "" {
				ui.Divider(c).Background(Hairline(th))
				src := ui.Text(c, t.Result.SourceText).FontSize(12).TextColor(th.TextMuted).LineHeight(1.45)
				if t.Result.Markdown {
					src.MaxLines(6)
				}
			}
		})
	}
}

func wordEntry(c *ui.Context, w *translation.WordEntry) {
	th := c.Theme()
	ui.Column(c).Gap(10).Selectable().Children(func() {
		ui.Row(c).Gap(10).AlignItems(ui.Baseline).Wrap().Children(func() {
			ui.Text(c, w.Headword).FontSize(18).FontWeight(600)
			if translation.IsEnglishWord(w.Headword) {
				icon := "volume-2"
				if speech.Speaking() == "headword" {
					icon = "square"
				}
				if IconButton(c, icon, i18n.T("tr.speak")).Clicked() {
					if speech.Speaking() != "" {
						speech.Stop()
					} else {
						speech.Speak(w.Headword, "en-US", "headword", nil)
					}
				}
			}
			for _, p := range w.Phonetics {
				ui.RichText(c,
					ui.Span{Text: p.Label + " ", Color: th.TextMuted, Size: 11},
					ui.Span{Text: "/" + p.Value + "/", Size: 12})
			}
		})
		ui.Column(c).Gap(4).Children(func() {
			for _, d := range w.Definitions {
				ui.Row(c).Gap(6).AlignItems(ui.Start).Children(func() {
					if d.Part != "" {
						ui.Text(c, d.Part).FontSize(11).TextColor(th.Accent).Padding(1, 5).Radius(4).Background(th.Accent.Alpha(0.12))
					}
					ui.Text(c, d.Meaning).Grow(1)
				})
			}
		})
		if len(w.Forms) > 0 {
			wordSection(c, i18n.T("translate.word.forms"), func() {
				ui.Row(c).Gap(6).Wrap().Children(func() {
					for _, f := range w.Forms {
						ui.Text(c, f.Label+" "+f.Value).FontSize(11).Padding(2, 6).Radius(4).Background(HoverFill(th))
					}
				})
			})
		}
		if len(w.Phrases) > 0 {
			wordSection(c, i18n.T("translate.word.phrases"), func() {
				for _, p := range w.Phrases {
					ui.Row(c).Gap(8).Children(func() {
						ui.Text(c, p.Text).FontSize(12).FontWeight(500)
						ui.Text(c, p.Meaning).FontSize(12).TextColor(th.TextMuted).Grow(1)
					})
				}
			})
		}
		if len(w.Examples) > 0 {
			wordSection(c, i18n.T("translate.word.examples"), func() {
				for _, e := range w.Examples {
					ui.Column(c).Gap(1).Children(func() {
						ui.Text(c, e.Source).FontSize(12)
						ui.Text(c, e.Translated).FontSize(12).TextColor(th.TextMuted)
					})
				}
			})
		}
	})
}

func wordSection(c *ui.Context, title string, body func()) {
	ui.Column(c).Gap(4).Children(func() {
		ui.Text(c, title).FontSize(11).FontWeight(600).TextColor(c.Theme().TextMuted)
		body()
	})
}
