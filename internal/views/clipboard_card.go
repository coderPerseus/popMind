package views

import (
	"fmt"
	"math"
	"net/url"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/clipboard"
	"popmind/internal/i18n"
	"popmind/internal/native"
	"popmind/internal/views/icons"
)

// ---- formatting (panel-utils.ts) ----

func relTime(ms int64) string {
	now := time.Now()
	d := now.Sub(time.UnixMilli(ms))
	switch {
	case d < time.Minute:
		return i18n.T("clip.panel.time.justNow")
	case d < time.Hour:
		return i18n.T("clip.panel.time.minutes", "count", int(d.Minutes()))
	case d < 24*time.Hour:
		return i18n.T("clip.panel.time.hours", "count", int(d.Hours()))
	}
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, now.Location())
	days := int(math.Ceil(float64(today.UnixMilli()-ms) / float64(24*time.Hour/time.Millisecond)))
	switch {
	case days <= 1:
		return i18n.T("clip.panel.time.yesterday")
	case days < 7:
		return i18n.T("clip.panel.time.days", "count", days)
	}
	t := time.UnixMilli(ms)
	if i18n.IsEnglish() {
		if t.Year() == now.Year() {
			return t.Format("Jan 2")
		}
		return t.Format("Jan 2, 2006")
	}
	if t.Year() == now.Year() {
		return fmt.Sprintf("%d月%d日", t.Month(), t.Day())
	}
	return fmt.Sprintf("%d年%d月%d日", t.Year(), t.Month(), t.Day())
}

func fullTime(ms int64) string {
	t := time.UnixMilli(ms)
	if i18n.IsEnglish() {
		return t.Format("Jan 2, 2006, 15:04:05")
	}
	return t.Format("2006年1月2日 15:04:05")
}

func formatBytes(v int64) string {
	switch {
	case v < 1024:
		return fmt.Sprintf("%d B", v)
	case v < 1024*1024:
		return fmt.Sprintf("%.1f KB", float64(v)/1024)
	}
	return fmt.Sprintf("%.1f MB", float64(v)/(1024*1024))
}

func domainOf(raw string) string {
	u, err := url.Parse(raw)
	if err != nil || u.Hostname() == "" {
		return raw
	}
	return strings.TrimPrefix(u.Hostname(), "www.")
}

// middleEllipsis shortens a file name in the middle so its extension stays.
func middleEllipsis(name string, max int) string {
	r := []rune(name)
	if len(r) <= max {
		return name
	}
	tail := min(14, int(float64(max)/2.4))
	return string(r[:max-tail-1]) + "…" + string(r[len(r)-tail:])
}

func parseColor(s string) ui.Color {
	s = strings.TrimSpace(s)
	if strings.HasPrefix(s, "#") && (len(s) == 4 || len(s) == 7 || len(s) == 9) {
		return ui.Hex(s)
	}
	return ui.RGB(128, 128, 128)
}

// readableOn is white or near black, whichever reads better on bg.
func readableOn(bg ui.Color) ui.Color {
	lin := func(v uint8) float64 {
		x := float64(v) / 255
		if x <= 0.03928 {
			return x / 12.92
		}
		return math.Pow((x+0.055)/1.055, 2.4)
	}
	if 0.2126*lin(bg.R)+0.7152*lin(bg.G)+0.0722*lin(bg.B) > 0.42 {
		return ui.RGBA(0, 0, 0, 0.82)
	}
	return ui.RGB(255, 255, 255)
}

func kindLabel(it clipboard.Item) string {
	if it.Kind == clipboard.KindText && it.SubKind != "" {
		return i18n.T("clip.panel.subKind." + it.SubKind)
	}
	if it.Kind == clipboard.KindText && it.IsRich {
		return i18n.T("clip.panel.kind.richText")
	}
	return i18n.T("clip.panel.kind." + it.Kind)
}

func isMono(it clipboard.Item) bool { return it.SubKind == "code" || it.SubKind == "json" }

func cardBg(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.Hex("#2c2c2e")
	}
	return ui.RGB(255, 255, 255)
}

func cardHeadBg(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.06).Over(cardBg(t))
	}
	return ui.RGBA(0, 0, 0, 0.05).Over(cardBg(t))
}

func imageBackdrop(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.05)
	}
	return ui.RGBA(0, 0, 0, 0.045)
}

// ---- the strip ----

func (p *ClipboardPanel) strip(c *ui.Context) {
	t := c.Theme()
	if len(p.items) == 0 {
		ui.Column(c).Grow(1).Center().Gap(6).Children(func() {
			switch {
			case p.loading:
				ui.Spinner(c).Size(20, 20)
				Muted(c, i18n.T("clip.panel.state.loading")).FontSize(13)
			case p.query != "" || p.kind != "" || p.date != "" || len(p.appIDs) > 0:
				ui.Icon(c, icons.Get("search-x")).FontSize(26).TextColor(t.TextMuted.Alpha(0.5))
				Muted(c, i18n.T("clip.panel.state.noResults")).FontSize(13)
			default:
				ui.Icon(c, icons.Get("clipboard-list")).FontSize(26).TextColor(t.TextMuted.Alpha(0.5))
				Muted(c, i18n.T("clip.panel.state.empty")).FontSize(13)
				ui.Text(c, i18n.T("clip.panel.state.emptyHint")).FontSize(12).TextColor(macTertiary(t))
			}
		})
		return
	}
	reveal := p.reveal
	p.reveal = false
	w, _ := c.Size()
	cmdHeld := c.Modifiers()&ui.Cmd != 0 && !p.dialog.open
	// The ⌘ numbers count from the first card fully on screen.
	first, count := -1, 0
	for i, it := range p.items {
		r, ok := p.cardRects[it.ID]
		if !ok || r.X < 4 {
			continue
		}
		if r.X+r.W > w+4 {
			break
		}
		if first < 0 {
			first = i
		}
		count++
	}
	ui.ScrollHorizontal(c.Key("strip")).Grow(1).Padding(8, 16, 14, 16).Gap(clipCardGap).AlignItems(ui.Stretch).Children(func() {
		for i := range p.items {
			badge := 0
			if cmdHeld && first >= 0 && i >= first && i-first < min(9, count) {
				badge = i - first + 1
			}
			card := p.card(c, i, badge)
			if reveal && p.items[i].ID == p.active {
				card.ScrollIntoView()
			}
		}
	})
}

func (p *ClipboardPanel) card(c *ui.Context, i, badge int) ui.Element {
	t := c.Theme()
	it := p.items[i]
	selected := p.selected[it.ID]
	active := p.active == it.ID
	bg, head := cardBg(t), cardHeadBg(t)
	card := ui.Column(c.Key(it.ID)).Width(clipCardWidth).Radius(10).Clip().TransformOrigin(0.5, 1).
		Transition(ui.ElementTransition{Duration: motionBase, Position: true, Colors: true,
			Enter: &ui.Motion{Scale: 0.96}, Exit: &ui.Motion{Collapse: true, Scale: 0.96}})
	lift := float32(0)
	hairline := ui.RGBA(0, 0, 0, 0.1)
	if t.Dark {
		hairline = ui.RGBA(255, 255, 255, 0.1)
	}
	shadowColor := ui.RGBA(0, 0, 0, 0.08)
	if t.Dark {
		shadowColor = ui.RGBA(0, 0, 0, 0.4)
	}
	labelColor := t.TextMuted
	switch {
	case selected:
		tint, headTint := float32(0.07), float32(0.16)
		if t.Dark {
			tint, headTint = 0.14, 0.26
		}
		bg, head = bg.Mix(t.Accent, tint), bg.Mix(t.Accent, headTint)
		ring := t.Accent.Alpha(0.55)
		if active {
			ring = t.Accent
		}
		card.Border(2, ring).Shadow(0, 8, 20, 0, t.Accent.Alpha(0.16))
		lift = -3
		labelColor = t.Accent
	case it.HasSecret:
		mix := float32(0.14)
		if t.Dark {
			mix = 0.22
		}
		head = bg.Mix(macOrange, mix)
		card.Border(1, macOrange.Alpha(0.6)).Shadow(0, 1, 2, 0, shadowColor)
	default:
		card.Border(0.5, hairline).Shadow(0, 1, 2, 0, shadowColor)
	}
	if card.Hovered() && !selected {
		ink, a, b := t.Text, float32(0.03), float32(0.09)
		if t.Dark {
			ink, a, b = ui.RGB(255, 255, 255), 0.05, 0.11
		}
		if !it.HasSecret {
			head = bg.Mix(ink, b)
		}
		bg = bg.Mix(ink, a)
		card.Shadow(0, 6, 16, 0, ui.RGBA(0, 0, 0, 0.12))
		lift = -2
	}
	card.Background(bg)
	// Hover and selection lift the card a little, smoothly.
	card.AnimatePose(ui.Pose{Y: lift}, ui.Animation{Duration: motionFast, Ease: ui.EaseOut})
	p.cardRects[it.ID] = card.Bounds()

	// Pointer: click chooses (⌘ adds, ⇧ extends), a double click pastes, a right click opens the menu, a drag
	// carries the selection onto a pinboard tab.
	if card.Clicked() {
		p.click(it.ID, card.ClickModifiers())
		p.input.Focus()
		if p.quickLook {
			p.loadDetail()
		}
	}
	if card.DoubleClicked() {
		p.paste([]clipboard.Item{it}, false)
	}
	if card.RightClicked() && !selected {
		p.selectOnly(it.ID)
	}
	dragIDs := []string{it.ID}
	if selected {
		dragIDs = nil
		for _, x := range p.items {
			if p.selected[x.ID] {
				dragIDs = append(dragIDs, x.ID)
			}
		}
	}
	card.Drag(dragIDs)
	card.ContextMenu(func(m *ui.Menu) { p.cardMenu(m) })

	pins := it.Pinboards
	if len(pins) > 3 {
		pins = pins[:3]
	}
	lengthInHead := it.Kind == clipboard.KindText || it.Kind == clipboard.KindLink
	card.Children(func() {
		// Head: kind · time · length, the source app's icon.
		ui.Row(c).Height(30).Padding(0, 8, 0, 10).Gap(6).AlignItems(ui.Center).Background(head).Children(func() {
			ui.Row(c).Grow(1).Shrink(1).AlignItems(ui.Center).Clip().Children(func() {
				ui.Text(c, kindLabel(it)).FontSize(12.5).FontWeight(600).TextColor(labelColor).SingleLine()
				if it.IsRemote {
					ui.Icon(c, icons.Get("smartphone")).FontSize(10).TextColor(t.TextMuted).Margin(0, 0, 0, 3)
				}
				if it.HasSecret {
					ui.Icon(c, icons.Get("key-round")).FontSize(11).TextColor(macOrange).Margin(0, 0, 0, 4).
						Tooltip(i18n.T("clip.panel.card.secret"))
				}
				meta := " · " + relTime(it.LastCopiedAt)
				if lengthInHead {
					meta += " · " + i18n.T("clip.panel.card.charsShort", "count", it.CharCount)
				}
				ui.Text(c, meta).FontSize(11).TextColor(t.TextMuted.Alpha(0.72)).SingleLine().Shrink(1)
			})
			if it.SourceID != "" {
				p.appIconView(c, it.SourceID, it.SourceName, 18)
			} else {
				ui.Icon(c, icons.Get(kindIconName(it.Kind))).FontSize(15).TextColor(t.TextMuted.Alpha(0.85))
			}
		})
		// Body.
		body := ui.Box(c).Grow(1).Basis(0).Clip()
		if it.Kind != clipboard.KindImage && it.Kind != clipboard.KindColor {
			body.Padding(9, 11, 0, 11)
		}
		body.Children(func() {
			switch it.Kind {
			case clipboard.KindImage:
				p.imageBody(c, it)
			case clipboard.KindColor:
				col := parseColor(cmpStr(it.Color, it.Preview))
				ui.Box(c).Absolute().Top(0).Left(0).Right(0).Bottom(0).Background(col).Padding(10, 11).
					Justify(ui.End).Children(func() {
					ui.Text(c, strings.ToUpper(cmpStr(it.Color, it.Preview))).Font("monospace").FontSize(14).FontWeight(600).
						TextColor(readableOn(col))
				})
			case clipboard.KindFile:
				p.fileBody(c, it)
			case clipboard.KindLink:
				p.linkBody(c, it, bg)
			default:
				p.textBody(c, it, bg)
			}
			if badge > 0 && lengthInHead && len(pins) == 0 {
				p.badgeView(c, badge).Absolute().Right(8).Bottom(8)
			}
		})
		// Foot: size, pinboards, ⌘ number.
		if lengthInHead && len(pins) == 0 {
			return
		}
		ui.Row(c).Height(24).Padding(0, 8, 0, 11).Gap(6).AlignItems(ui.Center).Children(func() {
			foot := ""
			switch it.Kind {
			case clipboard.KindImage:
				foot = formatBytes(it.ByteSize)
				if it.ImageWidth > 0 && it.ImageHeight > 0 {
					foot = fmt.Sprintf("%d×%d · %s", it.ImageWidth, it.ImageHeight, foot)
				}
			case clipboard.KindFile:
				foot = i18n.T("clip.panel.card.files", "count", it.FileCount) + " · " + formatBytes(it.ByteSize)
			case clipboard.KindColor:
				foot = strings.ToUpper(it.Color)
			}
			ui.Text(c, foot).FontSize(11).TextColor(t.TextMuted).SingleLine().Grow(1).Shrink(1)
			ui.Row(c).Gap(3).AlignItems(ui.Center).Children(func() {
				for _, id := range pins {
					col := "gray"
					for _, pb := range p.pins {
						if pb.ID == id {
							col = pb.Color
						}
					}
					ui.Box(c).Size(6, 6).Radius(3).Background(pinboardColor(col))
				}
				if badge > 0 {
					p.badgeView(c, badge).Margin(0, 0, 0, 3)
				}
			})
		})
	})
	return card
}

func cmpStr(a, b string) string {
	if a != "" {
		return a
	}
	return b
}

func (p *ClipboardPanel) badgeView(c *ui.Context, n int) ui.Element {
	t := c.Theme()
	return ui.Text(c, fmt.Sprint(n)).FontSize(10.5).FontWeight(600).TextColor(ui.RGB(255, 255, 255)).
		MinWidth(16).Height(16).TextAlign(ui.Center).Padding(1, 3).Radius(4).Background(t.Accent)
}

// fade covers the bottom of a clipped text body, as the mask of .cp-text.
func fade(c *ui.Context, bg ui.Color) {
	ui.Box(c).Absolute().Left(0).Right(0).Bottom(0).Height(24).Gradient(bg.Alpha(0), bg, 180)
}

func (p *ClipboardPanel) textBody(c *ui.Context, it clipboard.Item, bg ui.Color) {
	t := c.Theme()
	ui.Column(c).Gap(3).Children(func() {
		if it.CustomTitle != "" {
			ui.Text(c, it.CustomTitle).FontSize(13).FontWeight(600).MaxLines(2)
		}
		text := it.Preview
		if it.Snippet != "" {
			text = it.Snippet
		}
		el := ui.Text(c, text).TextColor(t.Text)
		if isMono(it) {
			el.Font("monospace").FontSize(11.5).LineHeight(1.5)
		} else {
			el.FontSize(13).LineHeight(1.42)
		}
	})
	fade(c, bg)
}

func (p *ClipboardPanel) linkBody(c *ui.Context, it clipboard.Item, bg ui.Color) {
	t := c.Theme()
	pv := p.preview(it)
	title := it.CustomTitle
	site := domainOf(it.URL)
	var shot *ui.Bitmap
	if pv != nil {
		if title == "" {
			title = pv.title
		}
		if pv.site != "" {
			site = pv.site
		}
		shot = pv.image
	}
	domain := func() {
		ui.Row(c).Gap(4).AlignItems(ui.Center).Children(func() {
			ui.Icon(c, icons.Get("globe")).FontSize(12).TextColor(t.Accent)
			ui.Text(c, site).FontSize(12).TextColor(t.Accent).SingleLine()
		})
	}
	if shot != nil {
		// The picture runs edge to edge over the text.
		ui.Column(c).Absolute().Top(-9).Left(-11).Right(-11).Bottom(0).Gap(4).Padding(0, 0, 8, 0).Children(func() {
			ui.Image(c, shot).Fit(ui.Cover).FillWidth().Grow(1).Basis(0).MinHeight(40).Background(imageBackdrop(t))
			ui.Column(c).Gap(4).Padding(0, 11).Children(func() {
				if title != "" {
					ui.Text(c, title).FontSize(13).FontWeight(600).LineHeight(1.35).MaxLines(2)
				} else {
					ui.Text(c, it.URL).FontSize(12).MaxLines(2)
				}
				domain()
			})
		})
		return
	}
	ui.Column(c).Gap(4).Children(func() {
		if title != "" {
			ui.Text(c, title).FontSize(13).FontWeight(600).LineHeight(1.35).MaxLines(3)
		}
		domain()
		if title == "" {
			ui.Text(c, it.URL).FontSize(12).LineHeight(1.4).MaxLines(5)
		} else if it.Snippet != "" {
			ui.Text(c, it.URL).FontSize(11).TextColor(macTertiary(t)).MaxLines(2)
		}
	})
	_ = bg
}

func (p *ClipboardPanel) imageBody(c *ui.Context, it clipboard.Item) {
	t := c.Theme()
	ui.Box(c).Absolute().Top(0).Left(0).Right(0).Bottom(0).Background(imageBackdrop(t)).Center().Children(func() {
		if b := p.thumb(it); b != nil {
			ui.Image(c, b).Fit(ui.Contain).Fill()
		} else {
			ui.Icon(c, icons.Get("image")).FontSize(26).TextColor(macTertiary(t))
		}
	})
	if it.Snippet != "" && it.HasOCR {
		ui.Text(c, i18n.T("clip.panel.card.ocrMatch")).Absolute().Top(6).Left(6).FontSize(10.5).FontWeight(500).
			TextColor(ui.RGB(255, 255, 255)).Padding(1, 7).Radius(8).Background(ui.RGBA(0, 0, 0, 0.6))
	}
}

func (p *ClipboardPanel) fileBody(c *ui.Context, it clipboard.Item) {
	t := c.Theme()
	names := it.FileNames
	if len(names) == 0 {
		names = []string{it.Title}
	}
	icon := func() {
		if b := p.fileIcon(it); b != nil {
			ui.Image(c, b).Size(38, 38)
			return
		}
		name := "file"
		if it.FileCount > 1 {
			name = "files"
		}
		ui.Box(c).Size(38, 38).Radius(8).Background(macFill(t)).Center().Children(func() {
			ui.Icon(c, icons.Get(name)).FontSize(20).TextColor(t.TextMuted)
		})
	}
	ui.Column(c).Gap(7).Children(func() {
		icon()
		if it.FileCount <= 1 {
			ui.Text(c, middleEllipsis(names[0], 34)).FontSize(12.5).MaxLines(3).Tooltip(names[0])
			return
		}
		shown := names[:min(4, len(names))]
		ui.Column(c).Children(func() {
			for _, n := range shown {
				ui.Text(c, middleEllipsis(n, 26)).FontSize(12.5).LineHeight(1.6).SingleLine()
			}
			if rest := it.FileCount - len(shown); rest > 0 {
				ui.Text(c, i18n.T("clip.panel.card.moreFiles", "count", rest)).FontSize(12.5).LineHeight(1.6).TextColor(macTertiary(t))
			}
		})
	})
}

// cardMenu is the context menu of the cards the selection holds (ClipContextMenu.tsx).
func (p *ClipboardPanel) cardMenu(m *ui.Menu) {
	targets := p.targets()
	n := len(targets)
	if n == 0 {
		return
	}
	paste := i18n.T("clip.panel.menu.paste")
	if n > 1 {
		paste = i18n.T("clip.panel.menu.pasteCount", "count", n)
	}
	if m.Item(paste + "    ↩").Chosen() {
		p.paste(targets, false)
	}
	if m.Item(i18n.T("clip.panel.menu.pastePlain") + "    ⇧↩").Chosen() {
		p.paste(targets, true)
	}
	if m.Item(i18n.T("clip.panel.menu.copy") + "    ⌘C").Chosen() {
		p.copy(targets)
	}
	m.Separator()
	m.Submenu(i18n.T("clip.panel.menu.addToPinboard"), func(sub *ui.Menu) {
		for _, pb := range p.pins {
			all := true
			for _, it := range targets {
				in := false
				for _, id := range it.Pinboards {
					in = in || id == pb.ID
				}
				all = all && in
			}
			if sub.Item(pb.Name).Checked(all).Chosen() {
				p.togglePinboard(pb.ID)
			}
		}
		if len(p.pins) > 0 {
			sub.Separator()
		}
		if sub.Item(i18n.T("clip.panel.menu.newPinboard")).Chosen() {
			p.newPinboard(true)
		}
	})
	// Sync to remote: uploads at once when sync is set up, else opens its settings.
	if p.sync != nil {
		syncable := 0
		for _, it := range targets {
			if it.Kind != clipboard.KindFile {
				syncable++
			}
		}
		if syncable > 0 {
			label := i18n.T("clip.panel.menu.syncToRemote")
			if syncable > 1 {
				label = i18n.T("clip.panel.menu.syncToRemoteCount", "count", syncable)
			}
			if m.Item(label).Chosen() {
				p.pushSelected(targets)
			}
		}
	}
	m.Separator()
	if n == 1 {
		it := targets[0]
		if m.Item(i18n.T("clip.panel.menu.quickLook") + "    Space").Chosen() {
			p.selectOnly(it.ID)
			p.quickLook = false
			p.toggleQuickLook()
		}
		if m.Item(i18n.T("clip.panel.menu.rename") + "    ⌘R").Chosen() {
			p.startRename(it)
		}
		if clipboard.CanEdit(it) && m.Item(i18n.T("clip.panel.menu.edit")+"    ⌘E").Chosen() {
			p.startEdit(it)
		}
		switch it.Kind {
		case clipboard.KindLink:
			if m.Item(i18n.T("clip.panel.menu.openLink") + "    ⌘O").Chosen() {
				p.open(it)
			}
		case clipboard.KindFile:
			if m.Item(i18n.T("clip.panel.menu.openFile") + "    ⌘O").Chosen() {
				p.open(it)
			}
			if m.Item(i18n.T("clip.panel.menu.reveal")).Chosen() {
				p.revealInFinder(it)
			}
		}
		m.Separator()
	}
	del := i18n.T("clip.panel.menu.delete")
	if n > 1 {
		del = i18n.T("clip.panel.menu.deleteCount", "count", n)
	}
	if m.Item(del + "    ⌫").Chosen() {
		p.remove(targets)
	}
}

// ---- images, loaded once in the background ----

func (p *ClipboardPanel) cached(m map[string]*ui.Bitmap, key string, load func() []byte) *ui.Bitmap {
	p.mu.Lock()
	b, ok := m[key]
	if !ok {
		m[key] = nil
	}
	p.mu.Unlock()
	if ok {
		return b
	}
	if p.win == nil {
		// Rendered without a window (tests): load at once.
		var bm *ui.Bitmap
		if data := load(); len(data) > 0 {
			bm, _ = ui.DecodeBitmap(data)
		}
		m[key] = bm
		return bm
	}
	go func() {
		var bm *ui.Bitmap
		if data := load(); len(data) > 0 {
			bm, _ = ui.DecodeBitmap(data)
		}
		if bm == nil {
			return
		}
		p.win.Update(func() {
			p.mu.Lock()
			m[key] = bm
			p.mu.Unlock()
		})
	}()
	return nil
}

func (p *ClipboardPanel) thumb(it clipboard.Item) *ui.Bitmap {
	return p.cached(p.thumbs, it.ID, func() []byte { return p.store.Thumbnail(it) })
}

func (p *ClipboardPanel) appIcon(bundleID string) *ui.Bitmap {
	if bundleID == "" || p.win == nil {
		return nil
	}
	return p.cached(p.icons, bundleID, func() []byte {
		if path := native.ResolveAppPathByBundleID(bundleID); path != "" {
			if data, err := mygo.Shell.FileIcon(path, 36); err == nil {
				return data
			}
		}
		return nil
	})
}

func (p *ClipboardPanel) fileIcon(it clipboard.Item) *ui.Bitmap {
	if p.win == nil {
		return nil // Shell needs the app's main thread
	}
	return p.cached(p.fileIcons, it.ID, func() []byte {
		d, err := p.store.Detail(it.ID)
		if err != nil || len(d.FilePaths) == 0 {
			return nil
		}
		data, _ := mygo.Shell.FileIcon(d.FilePaths[0], 76)
		return data
	})
}

// preview is the link preview of a link card, fetched the first time the card shows.
func (p *ClipboardPanel) preview(it clipboard.Item) *clipPreview {
	if p.win == nil {
		return p.previews[it.URL]
	}
	p.mu.Lock()
	pv, ok := p.previews[it.URL]
	p.mu.Unlock()
	if ok {
		return pv
	}
	set := func(lp *clipboard.LinkPreview) {
		out := &clipPreview{title: lp.Title, site: lp.SiteName}
		if len(lp.Image) > 0 {
			out.image, _ = ui.DecodeBitmap(lp.Image)
		}
		p.win.Update(func() {
			p.mu.Lock()
			p.previews[it.URL] = out
			p.mu.Unlock()
		})
	}
	p.mu.Lock()
	p.previews[it.URL] = nil
	p.mu.Unlock()
	// Once per link: a known preview comes back at once, otherwise set runs when the fetch is done.
	go func() {
		if lp := p.store.LinkPreview(it.URL, set); lp != nil && lp.Status == "ready" {
			set(lp)
		}
	}()
	return nil
}
