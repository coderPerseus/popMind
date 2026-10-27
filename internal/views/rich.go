package views

import (
	"sync"
	"time"

	"github.com/egoist/mygo/ui"
	"github.com/egoist/mygo/ui/markdown"
	"github.com/egoist/mygo/ui/shader"

	"github.com/egoist/mygo/plugins/loading"
)

// Working is the "translating…" line: three dots lighting in turn (myGo's loading plugin, which holds still
// under Reduce Motion) and the muted label.
func Working(c *ui.Context, label string, size float32) ui.Element {
	t := c.Theme()
	return ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
		loading.LinearDots(c, loading.Options{Size: size - 2, Color: t.TextMuted}).Label(label)
		ui.Text(c, label).FontSize(size).TextColor(t.TextMuted)
	})
}

// The look of Markdown (AI replies, translated documents) and of the "thinking…" line, kept to the UI rules:
// body text at 13px, small headings without rules, hairlines, and motion of at most 150 ms.

var (
	mdThemeMu sync.Mutex
	mdThemes  = map[bool]*markdown.Theme{}
)

// mdReveal shows a streaming reply a word at a time, each fading in quickly.
var mdReveal = &markdown.Reveal{Unit: markdown.ByWord, CatchUp: 250 * time.Millisecond, Fade: 150 * time.Millisecond}

// MarkdownTheme is popMind's Markdown theme for the window theme t (one for light, one for dark).
func MarkdownTheme(t *ui.Theme) *markdown.Theme {
	mdThemeMu.Lock()
	defer mdThemeMu.Unlock()
	if th := mdThemes[t.Dark]; th != nil {
		return th
	}
	th := markdown.DefaultTheme(t)
	th.FontSize = 13
	th.LineHeight = 1.55
	th.BlockSpacing = 0.7
	sizes := [6]float32{1.2, 1.1, 1.02, 1, 1, 0.95}
	for i := range th.Headings {
		th.Headings[i].Size = sizes[i]
		th.Headings[i].Weight = 600
		th.Headings[i].Top = 1.1
		th.Headings[i].Bottom = 0.4
		th.Headings[i].Rule = false
	}
	th.Rule = Hairline(t)
	th.QuoteBar = t.TextMuted.Alpha(0.3)
	th.QuoteBarWidth = 2
	th.CodeBackground = t.Text.Alpha(0.06)
	th.CodeBlockBackground = t.Text.Alpha(0.03)
	th.CodeBlockBorder = Hairline(t)
	th.CodeBlockRadius = 8
	th.CodeBlockPadding = 0.75
	th.TableBorder = Hairline(t)
	th.TableHeader = t.Text.Alpha(0.03)
	mdThemes[t.Dark] = th
	return th
}

// shimmer sweeps a soft light across text from left to right, as the "thinking" line of chat apps: the text in
// Base, brightening to Shine under the light. Colors come in straight; the result is premultiplied.
var shimmer = shader.MustCompile(`package main

var Time float
var Base vec4
var Shine vec4

func Fragment(dst vec4, pos vec2) vec4 {
	band := 36.0
	span := rectSize().x + band*2
	x := mod(Time*110.0, span) - band
	k := 1.0 - smoothstep(0.0, band, abs(pos.x-x))
	c := mix(Base, Shine, k)
	return vec4(c.rgb*c.a, c.a)
}
`)

var shimmerStart = time.Now()

// Shimmer is a line of muted text with a light sweeping across it, for "thinking…" and "translating…". Where
// the GPU does not draw (the CPU renderer, tests) it is plain muted text.
func Shimmer(c *ui.Context, text string, size float32) ui.Element {
	t := c.Theme()
	w, h := c.MeasureText(0, ui.Span{Text: text, Size: size})
	return ui.Box(c).Size(w+1, h).Label(text).Draw(func(p *ui.Painter, r ui.Rect) {
		if !p.Accelerated() {
			p.RichText(r.X, r.Y, 0, ui.Span{Text: text, Size: size, Color: t.TextMuted})
			return
		}
		shimmer.Text(p, r.X, r.Y, text, size, shader.Options{Uniforms: map[string]any{
			"Time": p.Now().Sub(shimmerStart).Seconds(), "Base": t.TextMuted.Alpha(0.55), "Shine": t.Text}})
		p.AnimationFrame()
	})
}
