package views

import (
	"fmt"
	"strings"
	"time"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/clipboard"
	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/views/icons"
)

const quickLookTextLimit = 100_000

func elevated(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.Hex("#2c2c2e")
	}
	return ui.RGB(255, 255, 255)
}

func popoverShadow(e ui.Element) ui.Element {
	return e.Shadow(0, 10, 30, 0, ui.RGBA(0, 0, 0, 0.25)).Border(0.5, ui.RGBA(0, 0, 0, 0.12))
}

// ---- toast ----

func (p *ClipboardPanel) toastView(c *ui.Context) {
	t := c.Theme()
	tt := p.toast
	if tt == nil {
		return
	}
	if time.Now().After(tt.until) {
		p.toast = nil
		return
	}
	c.After(time.Until(tt.until))
	ui.Row(c).Absolute().Bottom(14).Left(0).Right(0).Justify(ui.Center).Children(func() {
		popoverShadow(ui.Row(c.Key("toast")).Transition(ui.ElementTransition{Duration: motionBase,
			Enter: &ui.Motion{Y: 8}, Exit: &ui.Motion{Y: 4}}).Gap(8).AlignItems(ui.Center).Padding(6, 7, 6, 10).Radius(8).Background(elevated(t)).MaxWidthPercent(80)).Children(func() {
			icon, color := "info", t.TextMuted
			if tt.warning {
				icon, color = "shield-alert", macOrange
			}
			ui.Icon(c, icons.Get(icon)).FontSize(14).TextColor(color)
			ui.Text(c, tt.text).FontSize(12.5).SingleLine()
			if tt.action != "" {
				b := ui.ButtonBase(c.Key("toast-action")).Padding(1, 8).Radius(5).Background(t.Accent.Alpha(0.15))
				txt := t.Accent
				if b.Hovered() {
					b.Background(t.Accent)
					txt = ui.RGB(255, 255, 255)
				}
				b.Children(func() { ui.Text(c, tt.action).FontSize(12).FontWeight(500).TextColor(txt) })
				if b.Clicked() {
					if tt.undo != "" {
						p.undoDelete()
					}
					p.toast = nil
				}
			}
		})
	})
}

// ---- Quick Look ----

func (p *ClipboardPanel) quickLookView(c *ui.Context) {
	t := c.Theme()
	it, ok := p.activeItem()
	if !ok {
		p.quickLook = false
		return
	}
	d := p.detail
	if d != nil && d.ID != it.ID {
		d = nil
	}
	ui.DialogBase(c, &p.quickLook, func(backdrop, box ui.Element) {
		backdrop.Background(ui.RGBA(0, 0, 0, 0.28)).Padding(10, 24)
		w, h := c.Size()
		box.Width(min(w-48, 1000)).Height(min(h-20, 640)).Radius(10).Clip().Background(elevated(t))
		appear(c, box, &p.qlSeen)
		popoverShadow(box)
		{
			box.Children(func() {
				p.quickLookHead(c, it, d)
				ui.Row(c).Grow(1).Basis(0).AlignItems(ui.Stretch).Children(func() {
					ui.Scroll(c).Grow(1).Basis(0).Children(func() {
						ui.Column(c).FillWidth().Padding(12, 14).Gap(8).AlignItems(ui.Start).Children(func() { p.quickLookMain(c, it, d) })
					})
					w, _ := c.Size()
					if w > 760 {
						ui.Box(c).Width(0.5).Background(Hairline(t))
						ui.Scroll(c).Width(220).Children(func() {
							ui.Column(c).FillWidth().Padding(10, 14).Gap(8).AlignItems(ui.Start).Children(func() { p.quickLookMeta(c, it, d) })
						})
					}
				})
			})
		}
	})
}

func (p *ClipboardPanel) quickLookHead(c *ui.Context, it clipboard.Item, d *clipboard.Detail) {
	t := c.Theme()
	ui.Row(c).Padding(6, 8, 6, 12).Gap(12).AlignItems(ui.Center).Children(func() {
		ui.Row(c).Grow(1).Shrink(1).Gap(7).AlignItems(ui.Center).Clip().Children(func() {
			if it.SourceID != "" {
				p.appIconView(c, it.SourceID, it.SourceName, 18)
			} else {
				ui.Icon(c, icons.Get(kindIconName(it.Kind))).FontSize(16).TextColor(t.TextMuted)
			}
			title := cmpStr(it.Title, i18n.T("clip.panel.kind."+it.Kind))
			ui.Text(c, title).FontWeight(600).SingleLine().Shrink(1)
			sub := fullTime(it.LastCopiedAt)
			if it.SourceName != "" {
				sub = it.SourceName + " · " + sub
			}
			ui.Text(c, sub).FontSize(12).TextColor(t.TextMuted).SingleLine().Shrink(2)
		})
		if d != nil && d.HTML != "" && it.Kind == clipboard.KindText {
			ui.Segmented(c.Key("ql-mode"), &p.richView, i18n.T("clip.panel.quickLook.rich"), i18n.T("clip.panel.quickLook.plain")).
				FontSize(12).Height(22)
		}
		if it.Kind == clipboard.KindLink || it.Kind == clipboard.KindFile {
			if actionButton(c, "ql-open", "external-link", i18n.T("clip.panel.menu.openLink"), false).Clicked() {
				p.open(it)
			}
		}
		b := ui.ButtonBase(c.Key("ql-paste")).Height(24).Padding(0, 10).Radius(6).Gap(5).AlignItems(ui.Center).Background(t.Accent)
		if b.Hovered() {
			b.Background(t.AccentHover)
		}
		b.Children(func() {
			ui.Icon(c, icons.Get("clipboard-paste")).FontSize(13).TextColor(t.AccentText)
			ui.Text(c, i18n.T("clip.panel.menu.paste")).FontSize(12).TextColor(t.AccentText)
		})
		if b.Clicked() {
			p.paste([]clipboard.Item{it}, false)
		}
		if IconButton(c, "x", i18n.T("clip.panel.quickLook.close")).Clicked() {
			p.quickLook = false
		}
	})
	ui.Box(c).Height(0.5).Background(Hairline(t))
}

func limitedText(c *ui.Context, text string, mono bool) {
	if r := []rune(text); len(r) > quickLookTextLimit {
		ui.Text(c, i18n.T("clip.panel.quickLook.truncated", "count", "100,000")).FontSize(12).TextColor(c.Theme().TextMuted)
		text = string(r[:quickLookTextLimit]) + "…"
	}
	el := ui.Text(c, text).Selectable()
	if mono {
		el.Font("monospace").FontSize(12).LineHeight(1.5)
	} else {
		el.FontSize(13).LineHeight(1.5)
	}
}

func (p *ClipboardPanel) quickLookMain(c *ui.Context, it clipboard.Item, d *clipboard.Detail) {
	t := c.Theme()
	if d == nil && it.Kind == clipboard.KindText {
		ui.Spinner(c).Size(18, 18)
		return
	}
	switch it.Kind {
	case clipboard.KindImage:
		if b := p.thumb(it); b != nil {
			ui.Image(c, b).Fit(ui.Contain).FillWidth().MaxHeight(420)
		}
		if d != nil && d.OCRText != "" {
			ui.Row(c).AlignItems(ui.Center).Children(func() {
				ui.Text(c, i18n.T("clip.panel.quickLook.ocrText")).FontSize(12).FontWeight(600).TextColor(t.TextMuted).Grow(1)
				if actionButton(c, "ql-ocr", "clipboard-copy", i18n.T("clip.panel.quickLook.copyOcr"), false).Clicked() {
					mygo.Clipboard.WriteText(d.OCRText)
					p.showToast(clipToast{text: i18n.T("clip.panel.quickLook.ocrCopied")}, 0)
				}
			})
			limitedText(c, d.OCRText, false)
		}
	case clipboard.KindColor:
		col := parseColor(cmpStr(it.Color, it.Preview))
		ui.Row(c).Gap(16).AlignItems(ui.Center).Children(func() {
			ui.Box(c).Size(120, 120).Radius(12).Background(col).Border(0.5, Hairline(t))
			ui.Column(c).Gap(4).Children(func() {
				ui.Text(c, strings.ToUpper(it.Color)).Font("monospace").FontSize(18).FontWeight(600).Selectable()
				ui.Text(c, fmt.Sprintf("rgb(%d, %d, %d)", col.R, col.G, col.B)).Font("monospace").TextColor(t.TextMuted).Selectable()
			})
		})
	case clipboard.KindFile:
		paths := it.FileNames
		if d != nil && len(d.FilePaths) > 0 {
			paths = d.FilePaths
		}
		for _, path := range paths {
			ui.Text(c, path).Font("monospace").FontSize(12).Selectable()
		}
	case clipboard.KindLink:
		if pv := p.preview(it); pv != nil {
			if pv.image != nil {
				ui.Image(c, pv.image).Fit(ui.Contain).MaxWidth(480).MaxHeight(260).Radius(8).AlignSelf(ui.Start)
			}
			if pv.title != "" {
				ui.Text(c, pv.title).FontSize(15).FontWeight(600).Selectable()
			}
		}
		if ui.Link(c, it.URL, "").Clicked() {
			p.open(it)
		}
		if d != nil && d.PlainText != "" && d.PlainText != it.URL {
			limitedText(c, d.PlainText, false)
		}
	default:
		text := it.Preview
		if d != nil {
			text = d.PlainText
		}
		limitedText(c, text, isMono(it))
	}
}

func (p *ClipboardPanel) quickLookMeta(c *ui.Context, it clipboard.Item, d *clipboard.Detail) {
	t := c.Theme()
	row := func(label, value string) {
		ui.Column(c).Gap(1).Children(func() {
			ui.Text(c, label).FontSize(11).TextColor(macTertiary(t))
			ui.Text(c, value).FontSize(12).Selectable()
		})
	}
	row(i18n.T("clip.panel.meta.kind"), i18n.T("clip.panel.kind."+it.Kind))
	if it.SourceName != "" {
		row(i18n.T("clip.panel.meta.source"), it.SourceName)
	}
	if it.Kind == clipboard.KindLink {
		row(i18n.T("clip.panel.meta.domain"), domainOf(it.URL))
	}
	row(i18n.T("clip.panel.meta.copiedAt"), fullTime(it.LastCopiedAt))
	row(i18n.T("clip.panel.meta.createdAt"), fullTime(it.CreatedAt))
	row(i18n.T("clip.panel.meta.copyCount"), fmt.Sprint(it.CopyCount))
	if it.Kind == clipboard.KindImage && it.ImageWidth > 0 {
		row(i18n.T("clip.panel.meta.dimensions"), fmt.Sprintf("%d × %d", it.ImageWidth, it.ImageHeight))
	}
	if it.Kind == clipboard.KindText || it.Kind == clipboard.KindLink {
		row(i18n.T("clip.panel.meta.chars"), fmt.Sprint(it.CharCount))
	}
	if it.Kind == clipboard.KindFile {
		row(i18n.T("clip.panel.meta.files"), fmt.Sprint(it.FileCount))
	}
	row(i18n.T("clip.panel.meta.size"), formatBytes(it.ByteSize))
	if d != nil && len(d.Tags) > 0 {
		row(i18n.T("clip.panel.meta.tags"), strings.Join(d.Tags, ", "))
	}
}

// ---- dialogs ----

func dialogButton(c *ui.Context, key, label string, primary, disabled bool) bool {
	t := c.Theme()
	b := ui.ButtonBase(c.Key(key)).Height(24).Padding(0, 12).Radius(6).Center().Disabled(disabled)
	color := t.Text
	switch {
	case primary && disabled:
		b.Background(t.Accent.Alpha(0.4))
		color = t.AccentText
	case primary:
		b.Background(t.Accent)
		color = t.AccentText
		if b.Hovered() {
			b.Background(t.AccentHover)
		}
	case b.Hovered():
		b.Background(HoverFill(t))
	}
	b.Children(func() { ui.Text(c, label).FontSize(12.5).TextColor(color) })
	return b.Clicked() && !disabled
}

func (p *ClipboardPanel) closeDialog() {
	if p.dialog.kind != "" {
		logx.Info("[clip-panel] dialog closed", "kind", p.dialog.kind)
	}
	p.dialog = clipDialog{}
	p.input.Focus()
}

func (p *ClipboardPanel) dialogs(c *ui.Context) {
	if !p.dialog.open {
		return
	}
	t := c.Theme()
	d := &p.dialog
	width := float32(360)
	if d.kind == "edit" || d.kind == "newText" {
		width = 560
	}
	ui.DialogBase(c, &d.open, func(backdrop, panel ui.Element) {
		backdrop.Background(ui.RGBA(0, 0, 0, 0.28))
		popoverShadow(panel.Width(width).Radius(10).Padding(16).Gap(12).Background(elevated(t)))
		appear(c, panel, &d.seen)
		panel.Children(func() {
			switch d.kind {
			case "rename":
				p.nameDialog(c, i18n.T("clip.panel.dialog.renameTitle"), i18n.T("clip.panel.dialog.renameHint"), d.item.Title, true,
					func(v string) {
						id := d.item.ID
						go p.store.Rename(id, v)
					})
			case "renamePinboard":
				p.nameDialog(c, i18n.T("clip.panel.pinboard.rename"), "", i18n.T("clip.panel.pinboard.namePlaceholder"), false,
					func(v string) {
						id := d.pin.ID
						go p.store.UpdatePinboard(id, v, "")
					})
			case "newPinboard":
				p.newPinboardDialog(c)
			case "edit":
				p.textDialog(c, i18n.T("clip.panel.dialog.editTitle"), func(v string) {
					id := d.item.ID
					go p.store.UpdateText(id, v)
				})
			case "newText":
				p.textDialog(c, i18n.T("clip.panel.dialog.newTextTitle"), func(v string) {
					go func() {
						if id, err := p.store.CreateText(v); err == nil {
							p.win.Update(func() { p.selectOnly(id) })
						}
					}()
				})
			case "deletePinboard":
				ui.Text(c, i18n.T("clip.panel.pinboard.deleteTitle")).FontSize(13).FontWeight(600)
				ui.Text(c, i18n.T("clip.panel.pinboard.deleteHint", "name", d.pin.Name)).FontSize(12).TextColor(t.TextMuted)
				ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
					if dialogButton(c, "cancel", i18n.T("clip.panel.dialog.cancel"), false, false) {
						p.closeDialog()
					}
					if dialogButton(c, "ok", i18n.T("clip.panel.pinboard.delete"), true, false) || c.Shortcut(0, ui.KeyEnter) {
						id := d.pin.ID
						if p.scope == id {
							p.scope = ""
						}
						go p.store.DeletePinboard(id)
						p.closeDialog()
					}
				})
			}
		})
	})
	if !d.open {
		p.closeDialog()
	}
}

func (p *ClipboardPanel) nameDialog(c *ui.Context, title, hint, placeholder string, allowEmpty bool, save func(string)) {
	t := c.Theme()
	d := &p.dialog
	ui.Column(c).Gap(4).Children(func() {
		ui.Text(c, title).FontSize(13).FontWeight(600)
		if hint != "" {
			ui.Text(c, hint).FontSize(12).TextColor(t.TextMuted)
		}
	})
	ok := allowEmpty || strings.TrimSpace(d.text) != ""
	submit := func() {
		if ok {
			save(strings.TrimSpace(d.text))
			p.closeDialog()
		}
	}
	in := ui.TextInput(c.Key("name"), &d.text).Placeholder(placeholder).AutoFocus().Height(26)
	if in.Submitted() {
		submit()
	}
	ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
		if dialogButton(c, "cancel", i18n.T("clip.panel.dialog.cancel"), false, false) {
			p.closeDialog()
		}
		if dialogButton(c, "save", i18n.T("clip.panel.dialog.save"), true, !ok) {
			submit()
		}
	})
}

func (p *ClipboardPanel) textDialog(c *ui.Context, title string, save func(string)) {
	t := c.Theme()
	d := &p.dialog
	ui.Text(c, title).FontSize(13).FontWeight(600)
	ok := !d.loading && strings.TrimSpace(d.text) != ""
	submit := func() {
		if ok {
			save(d.text)
			p.closeDialog()
		}
	}
	if d.loading {
		ui.Row(c).Height(200).Center().Children(func() { ui.Spinner(c).Size(18, 18) })
	} else {
		in := ui.TextArea(c.Key("text"), &d.text).Lines(10, 16).AutoFocus().FontSize(13).
			Placeholder(i18n.T("clip.panel.dialog.textPlaceholder"))
		in.OnTextKey(func(k ui.TextKey) bool {
			if k.Key == ui.KeyEnter && k.Mods == ui.Cmd {
				d.text = k.Text()
				ok = strings.TrimSpace(d.text) != ""
				submit()
				return true
			}
			return false
		})
	}
	ui.Row(c).Gap(8).AlignItems(ui.Center).Children(func() {
		ui.Text(c, "⌘↩ "+i18n.T("clip.panel.dialog.save")).FontSize(11).TextColor(macTertiary(t)).Grow(1)
		if dialogButton(c, "cancel", i18n.T("clip.panel.dialog.cancel"), false, false) {
			p.closeDialog()
		}
		if dialogButton(c, "save", i18n.T("clip.panel.dialog.save"), true, !ok) {
			submit()
		}
	})
}

func (p *ClipboardPanel) newPinboardDialog(c *ui.Context) {
	t := c.Theme()
	d := &p.dialog
	ui.Text(c, i18n.T("clip.panel.pinboard.new")).FontSize(13).FontWeight(600)
	ok := strings.TrimSpace(d.text) != ""
	submit := func() {
		if !ok {
			return
		}
		name, color, add := strings.TrimSpace(d.text), d.color, d.addTargets
		p.closeDialog()
		go func() {
			pb, err := p.store.CreatePinboard(name, color)
			if err != nil {
				return
			}
			if len(add) > 0 {
				_ = p.store.AddToPinboard(pb.ID, add)
				p.win.Update(func() {
					p.showToast(clipToast{text: i18n.T("clip.panel.toast.addedToPinboard", "name", name)}, 0)
				})
				return
			}
			p.win.Update(func() { p.selectScope(pb.ID) })
		}()
	}
	in := ui.TextInput(c.Key("pin-name"), &d.text).Placeholder(i18n.T("clip.panel.pinboard.namePlaceholder")).AutoFocus().Height(26)
	if in.Submitted() {
		submit()
	}
	ui.Row(c).Gap(8).Children(func() {
		for _, col := range clipboard.PinboardColors {
			sw := ui.ButtonBase(c.Key("swatch:"+col)).Size(20, 20).Radius(10).Center().Background(pinboardColor(col)).
				Tooltip(i18n.T("clip.panel.color." + col)).Label(i18n.T("clip.panel.color." + col))
			if d.color == col {
				sw.Border(2, elevated(t)).Shadow(0, 0, 0, 2, pinboardColor(col))
				sw.Children(func() { ui.Icon(c, icons.Get("check")).FontSize(11).TextColor(ui.RGB(255, 255, 255)) })
			}
			if sw.Clicked() {
				d.color = col
			}
		}
	})
	ui.Row(c).Gap(8).Justify(ui.End).Children(func() {
		if dialogButton(c, "cancel", i18n.T("clip.panel.dialog.cancel"), false, false) {
			p.closeDialog()
		}
		if dialogButton(c, "create", i18n.T("clip.panel.pinboard.create"), true, !ok) {
			submit()
		}
	})
}
