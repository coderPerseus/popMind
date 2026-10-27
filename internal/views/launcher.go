package views

import (
	"math/rand/v2"
	"net/url"
	"slices"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/apps"
	"popmind/internal/calc"
	"popmind/internal/chat"
	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/views/assets"
	"popmind/internal/views/icons"
	"popmind/internal/windows"
)

const (
	launcherWidth  = 760
	launcherHeight = 500
)

// plugin is a launcher plugin (app/plugins/main-search).
type plugin struct {
	id       string
	titleKey string
	aliases  []string
	keywords []string
	mode     string // "link" opens something, "panel" shows a card in the launcher
	// runsWithoutQuery: a link plugin that runs with nothing typed (/clip).
	runsWithoutQuery bool
	logo             string // an asset, or "" for icon on a tile
	icon             string // lucide icon on a tile
	tile             [2]ui.Color
	typeKey          string
	run              func(l *Launcher, query string)
}

// command is a launcher command (translate, explain).
type command struct {
	id       string
	kind     string
	titleKey string
	subKey   string
	aliases  []string
	keywords []string
}

func openWithQuery(base, key string) func(*Launcher, string) {
	return func(l *Launcher, q string) {
		u, _ := url.Parse(base)
		values := u.Query()
		values.Set(key, q)
		u.RawQuery = values.Encode()
		mygo.Clipboard.WriteText(q)
		_ = mygo.Shell.OpenExternal(u.String())
	}
}

var launcherPlugins = []*plugin{
	{id: "tool.clipboard", titleKey: "plugin.clipboard.title", aliases: []string{"/clip", "/clipboard"},
		keywords: []string{"clipboard", "history", "paste", "copy", "剪切板", "剪贴板", "粘贴", "复制"},
		mode:     "link", runsWithoutQuery: true, icon: "clipboard-list", typeKey: "plugin.type.utility",
		tile: [2]ui.Color{ui.RGB(17, 24, 39), ui.RGB(107, 114, 128)},
		run:  func(l *Launcher, q string) { l.app.ShowClipboard(q) }},
	{id: "tool.calculator", titleKey: "plugin.calculator.title", aliases: []string{"/cal"},
		keywords: []string{"calculator", "calc", "math", "compute", "number", "计算器", "计算"},
		mode:     "panel", icon: "calculator", typeKey: "plugin.type.utility",
		tile: [2]ui.Color{ui.RGB(15, 23, 42), ui.RGB(8, 145, 178)}},
	{id: "ask.google", titleKey: "plugin.ask.google.title", aliases: []string{"/google"},
		keywords: []string{"google", "search", "web", "query"}, mode: "link", logo: "google-color",
		typeKey: "plugin.type.aiExtension", run: openWithQuery("https://www.google.com/search", "q")},
	{id: "ask.chatgpt", titleKey: "plugin.ask.chatgpt.title", aliases: []string{"/chatgpt"},
		keywords: []string{"chatgpt", "openai", "ask", "gpt"}, mode: "link", logo: "openai",
		typeKey: "plugin.type.aiExtension", run: openWithQuery("https://chatgpt.com", "q")},
	{id: "ask.grok", titleKey: "plugin.ask.grok.title", aliases: []string{"/grok"},
		keywords: []string{"grok", "xai", "ask"}, mode: "link", logo: "grok",
		typeKey: "plugin.type.aiExtension", run: openWithQuery("https://grok.com", "q")},
	{id: "ask.perplexity", titleKey: "plugin.ask.perplexity.title", aliases: []string{"/perplexity"},
		keywords: []string{"perplexity", "search", "answer", "ask"}, mode: "link", logo: "perplexity-color",
		typeKey: "plugin.type.aiExtension", run: openWithQuery("https://www.perplexity.ai/search/new", "q")},
}

var launcherCommands = []*command{
	{id: "command.translate", kind: "translate", titleKey: "launcher.command.translate.title",
		subKey: "launcher.command.translate.subtitle", aliases: []string{"/tr", "/translate", "/翻译"},
		keywords: []string{"translate", "tr", "translation", "command", "翻译"}},
	{id: "command.ai", kind: "ai", titleKey: "launcher.command.ai.title",
		subKey: "launcher.command.ai.subtitle", aliases: []string{"-ai", "/ai", "/问"},
		keywords: []string{"ai", "ask", "chat", "gpt", "command", "问", "提问", "聊天"}},
	{id: "command.explain", kind: "explain", titleKey: "launcher.command.explain.title",
		subKey: "launcher.command.explain.subtitle", aliases: []string{"/ex", "/explain", "/解释"},
		keywords: []string{"explain", "explanation", "command", "解释", "ex"}},
}

// parsed is what the query asks for: a slash alias and the text after it.
type parsed struct {
	plugin  *plugin
	command *command
	trigger string
	text    string
}

func parseQuery(raw string) parsed {
	q := strings.TrimSpace(raw)
	if !strings.HasPrefix(q, "/") && !strings.HasPrefix(q, "-") {
		return parsed{}
	}
	lower := strings.ToLower(q)
	type alias struct {
		p       *plugin
		c       *command
		trigger string
	}
	var all []alias
	for _, p := range launcherPlugins {
		for _, a := range p.aliases {
			all = append(all, alias{p: p, trigger: a})
		}
	}
	for _, c := range launcherCommands {
		for _, a := range c.aliases {
			all = append(all, alias{c: c, trigger: a})
		}
	}
	slices.SortStableFunc(all, func(a, b alias) int { return len(b.trigger) - len(a.trigger) })
	for _, a := range all {
		if lower == a.trigger || strings.HasPrefix(lower, a.trigger+" ") {
			return parsed{plugin: a.p, command: a.c, trigger: a.trigger, text: strings.TrimSpace(q[len(a.trigger):])}
		}
	}
	return parsed{}
}

// entry is a row of the launcher.
type entry struct {
	app     *apps.Result
	plugin  *plugin
	command *command
}

func (e entry) key() string {
	switch {
	case e.app != nil:
		return "app:" + e.app.Path
	case e.plugin != nil:
		return "plugin:" + e.plugin.id
	}
	return "command:" + e.command.id
}

// Launcher is the search panel (Alt+Space): apps, plugins, the calculator and the translate and explain
// commands.
type Launcher struct {
	// caretToEnd moves the caret after the text in the next frame (setQuery).
	caretToEnd bool
	app        *App
	panel      *mygo.Window

	query       string
	input       ui.Handle
	placeholder string
	chosen      int
	list        ui.ListState

	mu        sync.Mutex
	results   []apps.Result
	searching bool
	searchSeq int
	icons     map[string]*ui.Bitmap

	translator Translator
	lastTrText string

	// conv is the /ai conversation: while there is one, the launcher is a chat (startChat, endChat).
	conv      *Conversation
	focusConv bool
}

func newLauncher(app *App) *Launcher {
	l := &Launcher{app: app, icons: map[string]*ui.Bitmap{}}
	l.translator.Reset()
	l.placeholder = pickPlaceholder("")
	l.panel = mygo.NewWindow(mygo.WindowOptions{
		Title:         "popMind",
		Panel:         true,
		Hidden:        true,
		Frameless:     true,
		Transparent:   true,
		Vibrancy:      mygo.VibrancyPopover,
		Width:         launcherWidth,
		Height:        launcherHeight,
		DisableResize: true,
		Content:       ui.View(l.view),
	})
	l.translator.Update = l.panel.Update
	l.panel.OnClose(func(e *mygo.CloseEvent) {
		if quitting.Load() {
			return
		}
		e.PreventDefault()
		l.Hide()
	})
	l.panel.OnBlur(func() { windows.Dispatch(windows.DismissContext{Reason: windows.DismissBlur, Source: "main"}) })
	l.panel.OnShow(func() {
		native.RegisterSurfaceWindow(l.panel.NativeHandle())
		roundPanel(l.panel, 14)
	})
	windows.Register(&windows.Surface{
		ID:       "main",
		Priority: 100,
		Visible:  l.panel.IsVisible,
		Hide:     l.Hide,
		ShouldDismiss: func(ctx windows.DismissContext) bool {
			switch ctx.Reason {
			case windows.DismissEscape, windows.DismissBlur:
				return true
			case windows.DismissSurfaceOpened:
				return ctx.Target != "main"
			}
			return !l.panel.IsFocused() && (ctx.Reason == windows.DismissSelectionChanged || ctx.Reason == windows.DismissScene)
		},
	})
	return l
}

func pickPlaceholder(previous string) string {
	options := i18n.Placeholders()
	for range 4 {
		if p := options[rand.IntN(len(options))]; p != previous {
			return p
		}
	}
	return options[0]
}

// Show shows the launcher on the display with the pointer, a third of the way down, with query typed in.
func (l *Launcher) Show(query string) {
	windows.Dispatch(windows.DismissContext{Reason: windows.DismissSurfaceOpened, Target: "main"})
	if !l.panel.IsVisible() {
		d := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
		l.panel.SetPosition(d.WorkArea.X+(d.WorkArea.Width-launcherWidth)/2, d.WorkArea.Y+(d.WorkArea.Height-launcherHeight)/2)
	}
	l.panel.Update(func() {
		if query != "" {
			l.setQuery(query)
		}
		l.input.Focus()
	})
	showIn(l.panel, 90, 0, l.panel.Show)
	logx.Info("[launcher] shown", "query", query != "")
}

// Hide hides it and clears the query, as closing does.
func (l *Launcher) Hide() {
	l.panel.Update(func() {
		l.endChat()
		l.setQuery("")
		l.placeholder = pickPlaceholder(l.placeholder)
	})
	l.panel.Hide()
}

// Toggle shows or hides it.
func (l *Launcher) Toggle() {
	if l.panel.IsVisible() {
		l.Hide()
		return
	}
	l.Show("")
}

// Visible reports whether it shows.
func (l *Launcher) Visible() bool { return l.panel.IsVisible() }

// setQuery puts q in the field (a command chosen, a result, text brought from the bubble), with the caret
// after it, where the user goes on typing.
func (l *Launcher) setQuery(q string) {
	l.query = q
	l.caretToEnd = true
	l.queryChanged()
}

func (l *Launcher) queryChanged() {
	l.chosen = 0
	p := parseQuery(l.query)
	if p.command != nil && p.command.kind == "translate" {
		if p.text != l.lastTrText {
			l.lastTrText = p.text
			l.translator.Run(p.text, 350*time.Millisecond)
		}
	} else if l.lastTrText != "" {
		l.lastTrText = ""
		l.translator.Reset()
	}
	q := strings.TrimSpace(l.query)
	if q == "" || strings.HasPrefix(q, "/") {
		l.mu.Lock()
		l.results, l.searching = nil, false
		l.searchSeq++
		l.mu.Unlock()
		return
	}
	l.mu.Lock()
	l.searchSeq++
	seq := l.searchSeq
	l.searching = true
	l.mu.Unlock()
	go func() {
		results := apps.Default.Search(q, 8)
		l.panel.Update(func() {
			l.mu.Lock()
			defer l.mu.Unlock()
			if seq == l.searchSeq {
				l.results, l.searching = results, false
			}
		})
	}()
}

// entries are the rows the query shows.
func (l *Launcher) entries(p parsed) []entry {
	q := strings.TrimSpace(l.query)
	if p.plugin != nil || p.command != nil {
		return nil
	}
	if q != "" && !strings.HasPrefix(q, "/") {
		var out []entry
		l.mu.Lock()
		for i := range l.results {
			out = append(out, entry{app: &l.results[i]})
		}
		l.mu.Unlock()
		// After the apps: ask the web with what was typed.
		for _, pl := range launcherPlugins {
			if strings.HasPrefix(pl.id, "ask.") {
				out = append(out, entry{plugin: pl})
			}
		}
		return out
	}
	needle := strings.ToLower(q)
	matches := func(values ...[]string) bool {
		if needle == "" {
			return true
		}
		for _, list := range values {
			for _, v := range list {
				if strings.Contains(strings.ToLower(v), needle) {
					return true
				}
			}
		}
		return false
	}
	var out []entry
	for _, pl := range launcherPlugins {
		if matches([]string{i18n.T(pl.titleKey)}, pl.keywords, pl.aliases) {
			out = append(out, entry{plugin: pl})
		}
	}
	for _, cm := range launcherCommands {
		if matches([]string{i18n.T(cm.titleKey), i18n.T(cm.subKey)}, cm.keywords, cm.aliases) {
			out = append(out, entry{command: cm})
		}
	}
	return out
}

func (l *Launcher) activate(e entry) {
	q := strings.TrimSpace(l.query)
	switch {
	case e.app != nil:
		logx.Info("[launcher] open app", "path", e.app.Path)
		l.Hide()
		go apps.Default.Open(e.app.Path)
	case e.command != nil:
		l.setQuery(e.command.aliases[0] + " ")
		l.input.Focus()
	case e.plugin != nil && e.plugin.mode == "panel":
		text := q
		if strings.HasPrefix(text, "/") {
			text = ""
		}
		l.setQuery(strings.TrimSpace(e.plugin.aliases[0]+" "+text) + " ")
		l.input.Focus()
	case e.plugin != nil:
		text := q
		if strings.HasPrefix(text, "/") {
			text = ""
		}
		if text == "" && !e.plugin.runsWithoutQuery {
			l.setQuery(e.plugin.aliases[0] + " ")
			l.input.Focus()
			return
		}
		l.runPlugin(e.plugin, text)
	}
}

func (l *Launcher) runPlugin(p *plugin, text string) {
	logx.Info("[launcher] run plugin", "id", p.id)
	l.Hide()
	if p.run != nil {
		go p.run(l, text)
	}
}

// submit is Enter.
func (l *Launcher) submit(p parsed, list []entry) {
	switch {
	case p.command != nil && p.command.kind == "translate":
		if l.translator.Status == "success" {
			l.translator.Copy()
		} else {
			l.lastTrText = p.text
			l.translator.Run(p.text, 0)
		}
	case p.command != nil && p.command.kind == "ai":
		if p.text != "" && chat.Configured() {
			l.startChat(p.text)
		}
	case p.command != nil && p.command.kind == "explain":
		if p.text != "" {
			l.Hide()
			l.app.ShowExplain(p.text, nil)
		}
	case p.plugin != nil && p.plugin.mode == "panel":
		if r := calc.Eval(p.text); r.Err == "" && r.Formatted != "" {
			mygo.Clipboard.WriteText(strings.ReplaceAll(r.Formatted, ",", ""))
			l.setQuery(p.trigger + " " + strings.ReplaceAll(r.Formatted, ",", ""))
		}
	case p.plugin != nil:
		if p.text != "" || p.plugin.runsWithoutQuery {
			l.runPlugin(p.plugin, p.text)
		}
	default:
		if calc.LooksLikeMath(l.query) {
			if r := calc.Eval(l.query); r.Err == "" {
				mygo.Clipboard.WriteText(strings.ReplaceAll(r.Formatted, ",", ""))
				l.Hide()
				return
			}
		}
		if l.chosen < len(list) {
			l.activate(list[l.chosen])
		}
	}
}

func (l *Launcher) view(c *ui.Context) {
	t := Look(c)
	Panel(c)
	if l.conv != nil {
		l.chatView(c)
		return
	}
	p := parseQuery(l.query)
	list := l.entries(p)
	l.chosen = max(0, min(l.chosen, len(list)-1))

	c.OnShortcut(ui.Cmd, ui.KeyComma, func() { l.app.ShowSettings("") })
	if c.Shortcut(0, ui.KeyEscape) {
		if strings.TrimSpace(l.query) != "" {
			l.setQuery("")
		} else {
			l.Hide()
		}
	}
	if len(list) > 0 && c.Shortcut(0, ui.KeyDown) {
		l.chosen = (l.chosen + 1) % len(list)
		l.list.ScrollIntoView(l.chosen)
	}
	if len(list) > 0 && c.Shortcut(0, ui.KeyUp) {
		l.chosen = (l.chosen - 1 + len(list)) % len(list)
		l.list.ScrollIntoView(l.chosen)
	}

	ui.Column(c).Fill().Children(func() {
		// The search field.
		ui.Row(c).Height(56).Padding(0, 16).Gap(10).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icons.Get("search")).FontSize(18).TextColor(t.TextMuted)
			in := ui.TextInputBase(c.Key("query"), &l.query).Bind(&l.input).Grow(1).FontSize(18).
				Placeholder(l.placeholder).Label(i18n.T("common.search"))
			if l.caretToEnd {
				l.caretToEnd = false
				n := utf8.RuneCountInString(l.query)
				in.SetTextSelection(n, n)
			}
			if in.Changed() {
				l.queryChanged()
			}
			if in.Submitted() {
				l.submit(p, list)
			}
			if l.query != "" {
				clear := ui.ButtonBase(c.Key("clear")).Size(18, 18).Radius(9).Center().Label(i18n.T("main.clear")).Transition(popIn).
					Background(t.TextMuted.Alpha(0.35))
				if clear.Hovered() {
					clear.Background(t.TextMuted.Alpha(0.55))
				}
				clear.Children(func() { ui.Icon(c, icons.Get("x")).FontSize(11).TextColor(ui.RGB(255, 255, 255)) })
				if clear.Clicked() {
					l.setQuery("")
					l.placeholder = pickPlaceholder(l.placeholder)
					l.input.Focus()
				}
			}
		})
		ui.Box(c).Height(0.5).Background(Hairline(t))

		// What the query shows.
		body := ui.Column(c).Grow(1).Padding(2, 8)
		body.Children(func() {
			// A command's card fades in as the command is typed; the result list changes in place.
			mode := func(key string, fn func()) { ui.Column(c.Key(key)).Transition(fadeIn).Children(fn) }
			switch {
			case p.command != nil && p.command.kind == "translate":
				mode("cmd:translate", func() { l.translateCard(c, p) })
			case p.command != nil && p.command.kind == "ai":
				mode("cmd:ai", func() { l.aiCard(c, p) })
			case p.command != nil && p.command.kind == "explain":
				mode("cmd:explain", func() { l.explainCard(c, p) })
			case p.plugin != nil && p.plugin.mode == "panel":
				mode("cmd:calc", func() { calcCard(c, p.trigger, p.text) })
			case p.plugin != nil:
				mode("plugin:"+p.plugin.id, func() { l.pluginCard(c, p) })
			default:
				if calc.LooksLikeMath(l.query) {
					calcCard(c, "", l.query)
					ui.Box(c).Height(6)
				}
				l.results_(c, list)
			}
		})

		// The footer.
		ui.Box(c).Height(0.5).Background(Hairline(t))
		ui.Row(c).Height(40).Padding(0, 12, 0, 8).Gap(8).AlignItems(ui.Center).Children(func() {
			logo := ui.ButtonBase(c).Height(26).Gap(5).AlignItems(ui.Center).Padding(0, 6).Radius(6).Label(i18n.T("main.settingsAria")).
				Tooltip(i18n.T("main.settingsAria"))
			if logo.Hovered() {
				logo.Background(HoverFill(t))
			}
			if logo.Children(func() {
				name := "logo"
				if t.Dark {
					name = "logo-dark"
				}
				ui.Image(c, assets.Bitmap(name)).Size(18, 18)
				ui.Icon(c, icons.Get("settings")).FontSize(12).TextColor(t.TextMuted)
			}).Clicked() {
				l.app.ShowSettings("")
			}
			ui.Spacer(c)
			ui.Text(c, i18n.T("main.footer.open")).FontSize(12).FontWeight(500).TextColor(t.Text)
			Kbd(c, "↵")
			ui.Box(c).Width(0.5).Height(14).Margin(0, 4).Background(Hairline(t))
			ui.Text(c, i18n.T("main.footer.settings")).FontSize(12).TextColor(t.TextMuted)
			Kbd(c, "⌘")
			Kbd(c, ",")
		})
	})
}

func (l *Launcher) results_(c *ui.Context, list []entry) {
	t := c.Theme()
	q := strings.TrimSpace(l.query)
	if len(list) == 0 {
		title, desc := i18n.T("main.emptyTitle"), i18n.T("main.empty")
		l.mu.Lock()
		searching := l.searching
		l.mu.Unlock()
		if q != "" && !strings.HasPrefix(q, "/") {
			if searching {
				title, desc = i18n.T("main.searchingAppsTitle"), i18n.T("main.searchingAppsDesc")
			} else {
				title, desc = i18n.T("main.noAppsTitle"), i18n.T("main.noAppsDesc")
			}
		}
		ui.Column(c).Grow(1).Center().Gap(4).Children(func() {
			ui.Text(c, title).FontWeight(600)
			Muted(c, desc).TextAlign(ui.Center).MaxWidth(420)
		})
		return
	}
	l.list.Key = func(i int) any { return list[i].key() }
	sectionOf := func(i int) string {
		e := list[i]
		switch {
		case e.app != nil:
			return i18n.T("main.apps")
		case e.command != nil:
			return i18n.T("main.commands")
		case strings.HasPrefix(e.plugin.id, "ask.") && q != "" && !strings.HasPrefix(q, "/"):
			return i18n.T("launcher.askWeb")
		}
		return i18n.T("main.plugins")
	}
	ui.List(c, &l.list, len(list), func(i int) {
		ui.Column(c).Children(func() {
			if i == 0 || sectionOf(i) != sectionOf(i-1) {
				SectionTitle(c, sectionOf(i))
			}
			l.row(c, list[i], i, i == l.chosen)
		})
	}).Grow(1)
	_ = t
}

func (l *Launcher) row(c *ui.Context, e entry, index int, chosen bool) {
	t := c.Theme()
	row := ui.Row(c).MinHeight(42).Padding(6, 10).Gap(10).AlignItems(ui.Center).Radius(8).Transition(hoverColors)
	text, muted := t.Text, t.TextMuted.Alpha(0.75)
	if chosen || row.Hovered() {
		row.Background(t.Text.Alpha(0.08))
	}
	if row.Clicked() {
		l.chosen = index
		l.activate(e)
	}
	row.Children(func() {
		switch {
		case e.app != nil:
			if b := l.icon(e.app); b != nil {
				ui.Image(c, b).Size(28, 28)
			} else {
				ui.Avatar(c, e.app.Name, nil).Size(28, 28)
			}
			ui.Text(c, e.app.Name).FontSize(13.5).FontWeight(500).TextColor(text).SingleLine().Grow(1)
			ui.Text(c, i18n.T("main.resultType.app")).FontSize(11).TextColor(muted)
		case e.plugin != nil:
			pluginLogo(c, e.plugin, 24)
			title := i18n.T(e.plugin.titleKey)
			q := strings.TrimSpace(l.query)
			if strings.HasPrefix(e.plugin.id, "ask.") && q != "" && !strings.HasPrefix(q, "/") {
				title += " · " + q
			}
			ui.Text(c, title).FontSize(13.5).FontWeight(500).TextColor(text).SingleLine().Grow(1)
			ui.Text(c, e.plugin.aliases[0]).FontSize(11).TextColor(muted)
			ui.Text(c, i18n.T(e.plugin.typeKey)).FontSize(11).TextColor(muted)
		default:
			ui.Text(c, strings.TrimPrefix(e.command.aliases[0], "/")).FontSize(11).FontWeight(600).
				TextColor(t.Accent).Size(24, 24).TextAlign(ui.Center).Padding(5, 0).Radius(6).Background(t.Accent.Alpha(0.12))
			ui.Text(c, i18n.T(e.command.titleKey)).FontSize(13.5).FontWeight(500).TextColor(text).SingleLine()
			ui.Text(c, i18n.T(e.command.subKey)).FontSize(11).TextColor(muted).Grow(1)
			ui.Text(c, i18n.T("main.resultType.command")).FontSize(11).TextColor(muted)
		}
	})
}

func pluginLogo(c *ui.Context, p *plugin, size float32) {
	if p.logo != "" {
		ui.Box(c).Size(size, size).Radius(size * 0.28).Background(ui.RGB(255, 255, 255)).Center().Children(func() {
			ui.Image(c, assets.Bitmap(p.logo)).Size(size*0.7, size*0.7)
		})
		return
	}
	ui.Box(c).Size(size, size).Radius(size*0.28).Gradient(p.tile[0], p.tile[1], 135).Center().Children(func() {
		ui.Icon(c, icons.Get(p.icon)).FontSize(size * 0.55).TextColor(ui.RGB(255, 255, 255))
	})
}

func (l *Launcher) icon(r *apps.Result) *ui.Bitmap {
	if b, ok := l.icons[r.Path]; ok {
		return b
	}
	var b *ui.Bitmap
	if len(r.Icon) > 0 {
		b, _ = ui.DecodeBitmap(r.Icon)
	}
	l.icons[r.Path] = b
	return b
}

// card is the frame of the launcher's command cards.
func card(c *ui.Context, fn func()) ui.Element {
	t := c.Theme()
	return ui.Column(c).Padding(14, 16).Gap(12).Radius(10).Background(CardFill(t)).Border(0.5, Hairline(t)).Children(fn)
}

func chip(c *ui.Context, trigger, title string) {
	t := c.Theme()
	ui.Row(c).Gap(8).AlignItems(ui.Center).Padding(10, 6, 8, 6).Children(func() {
		ui.Text(c, trigger).FontSize(11.5).FontWeight(600).TextColor(t.Accent).Padding(2, 7).Radius(5).Background(t.Accent.Alpha(0.1))
		ui.Text(c, title).FontSize(12).FontWeight(500).TextColor(t.TextMuted)
	})
}

func calcCard(c *ui.Context, trigger, text string) {
	t := c.Theme()
	if trigger != "" {
		chip(c, trigger, i18n.T("calc.title"))
	}
	r := calc.Eval(text)
	switch {
	case strings.TrimSpace(text) == "":
		card(c, func() { Muted(c, i18n.T("calc.example", "trigger", "/cal")) })
		return
	case r.Err != "":
		card(c, func() { ui.Text(c, i18n.T(r.Err)).TextColor(t.Danger).FontSize(12) })
		return
	}
	// The expression and its result side by side, as Raycast's calculator.
	pane := func(value, caption string, strong bool) {
		ui.Column(c).Grow(1).Basis(0).Height(112).Radius(10).Background(CardFill(t)).Border(0.5, Hairline(t)).
			Center().Gap(6).Padding(0, 16).Children(func() {
			ui.Box(c).Height(40).Center().Children(func() {
				v := ui.Text(c, value).FontFeatures("tnum").SingleLine().Selectable()
				if strong {
					v.FontSize(28).FontWeight(600)
				} else {
					v.FontSize(20).TextColor(t.TextMuted)
				}
			})
			ui.Text(c, caption).FontSize(11).TextColor(Tertiary(t))
		})
	}
	ui.Row(c).Gap(10).AlignItems(ui.Center).Children(func() {
		pane(r.Expression, i18n.T("calc.expression"), false)
		ui.Icon(c, icons.Get("arrow-right")).FontSize(16).TextColor(Tertiary(t))
		pane(r.Formatted, i18n.T("calc.result"), true)
	})
	ui.Row(c).Padding(8, 4, 0, 4).Children(func() {
		ui.Spacer(c)
		ui.Text(c, i18n.T("calc.copy")).FontSize(11).TextColor(Tertiary(t))
	})
}

func (l *Launcher) translateCard(c *ui.Context, p parsed) {
	chip(c, p.trigger, i18n.T("launcher.command.translate.title"))
	card(c, func() {
		ui.Scroll(c).MaxHeight(300).Children(func() { l.translator.Body(c, false) })
		l.translator.Footer(c, true)
	})
}

func (l *Launcher) explainCard(c *ui.Context, p parsed) {
	chip(c, p.trigger, i18n.T("launcher.command.explain.title"))
	card(c, func() {
		if p.text == "" {
			Muted(c, i18n.T("launcher.explain.hint"))
			return
		}
		ui.Text(c, p.text).MaxLines(4)
		Muted(c, i18n.T("launcher.explain.enter"))
	})
}

func (l *Launcher) pluginCard(c *ui.Context, p parsed) {
	t := c.Theme()
	title := i18n.T(p.plugin.titleKey)
	chip(c, p.trigger, title)
	card(c, func() {
		ui.Row(c).Gap(10).AlignItems(ui.Center).Children(func() {
			pluginLogo(c, p.plugin, 28)
			ui.Column(c).Gap(2).Children(func() {
				ui.Text(c, title).FontWeight(600)
				if p.text != "" || p.plugin.runsWithoutQuery {
					Muted(c, i18n.T("main.plugin.openReady"))
				} else {
					Muted(c, i18n.T("main.plugin.openHint", "title", title))
				}
			})
		})
		if p.text != "" {
			ui.Text(c, p.text).TextColor(t.Text)
		} else if !p.plugin.runsWithoutQuery {
			Muted(c, i18n.T("main.plugin.example", "trigger", p.trigger))
		}
	})
}

// Capture returns a PNG of what the launcher shows (development checks).
func (l *Launcher) Capture() ([]byte, error) { return l.panel.CapturePage() }

// Bounds is where the launcher is on screen.
func (l *Launcher) Bounds() mygo.Rectangle { return l.panel.Bounds() }
