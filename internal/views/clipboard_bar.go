package views

import (
	"slices"
	"time"

	"github.com/egoist/mygo/ui"

	"popmind/internal/clipboard"
	"popmind/internal/i18n"
	"popmind/internal/views/icons"
)

// macFill and friends are the tokens of app/styles/tokens.css the panel uses.
func macFill(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.07)
	}
	return ui.RGBA(0, 0, 0, 0.05)
}

func macSelected(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.1)
	}
	return ui.RGBA(0, 0, 0, 0.08)
}

func macBorder(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.12)
	}
	return ui.RGBA(0, 0, 0, 0.12)
}

func macTertiary(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.3)
	}
	return ui.RGBA(0, 0, 0, 0.34)
}

var macOrange = ui.Hex("#ff9f0a")

func kindIconName(kind string) string {
	switch kind {
	case clipboard.KindLink:
		return "link-2"
	case clipboard.KindImage:
		return "image"
	case clipboard.KindFile:
		return "file"
	case clipboard.KindColor:
		return "palette"
	}
	return "file-text"
}

// barButton is a 24px high button of the top bar: an icon and an optional label, accent-tinted when on.
func barButton(c *ui.Context, key, icon, label, tip string, on bool) ui.Element {
	t := c.Theme()
	b := ui.ButtonBase(c.Key(key)).Height(24).Radius(6).Gap(4).AlignItems(ui.Center).Center().Transition(hoverColors)
	if label == "" {
		b.Width(24)
	} else {
		b.Padding(0, 8)
	}
	if tip != "" {
		b.Tooltip(tip).Label(tip)
	}
	color := t.TextMuted
	switch {
	case on:
		b.Background(t.Accent.Alpha(0.15))
		color = t.Accent
	case b.Hovered():
		b.Background(HoverFill(t))
		color = t.Text
	}
	return b.Children(func() {
		ui.Icon(c, icons.Get(icon)).FontSize(14).TextColor(color)
		if label != "" {
			ui.Text(c, label).FontSize(12.5).TextColor(color).SingleLine()
		}
	})
}

func (p *ClipboardPanel) placeholder(c *ui.Context) string {
	hint := i18n.T("clip.panel.hint.copyOnly")
	if clipboard.CurrentSettings().DirectPaste {
		if p.target.Name != "" {
			hint = i18n.T("clip.panel.hint.pasteTo", "app", p.target.Name)
		} else {
			hint = i18n.T("clip.panel.hint.pasteFront")
		}
	}
	hints := []string{i18n.T("clip.panel.search.placeholder"), hint, i18n.T("clip.panel.hint.plain"),
		i18n.T("clip.panel.hint.preview"), i18n.T("clip.panel.hint.quickPaste"), i18n.T("clip.panel.hint.filters")}
	// The hints take turns every 3 s while the field is empty.
	if p.query != "" {
		return ""
	}
	n := int(time.Since(p.shownAt) / (3 * time.Second))
	c.After(3*time.Second - time.Since(p.shownAt)%(3*time.Second))
	return hints[n%len(hints)]
}

func (p *ClipboardPanel) topBar(c *ui.Context) {
	t := c.Theme()
	ui.Box(c).Height(46).Padding(6, 0, 0, 0).Children(func() {
		// The controls sit in the middle; the right group is pinned to the edge.
		ui.Row(c).Fill().Padding(0, 150).Gap(6).AlignItems(ui.Center).Justify(ui.Center).Children(func() {
			p.searchField(c)
			kindLabel, kindIcon := i18n.T("clip.panel.filter.type"), "list-filter"
			if p.kind != "" {
				kindLabel, kindIcon = i18n.T("clip.panel.kind."+p.kind), kindIconName(p.kind)
			}
			barButton(c, "kind", kindIcon, kindLabel, "", p.kind != "").Menu(func(m *ui.Menu) {
				if m.Item(i18n.T("clip.panel.filter.allTypes")).Checked(p.kind == "").Chosen() {
					p.kind = ""
					p.reload()
				}
				m.Separator()
				for _, k := range clipboard.Kinds {
					if m.Item(i18n.T("clip.panel.kind." + k)).Checked(p.kind == k).Chosen() {
						p.kind = k
						p.reload()
					}
				}
			})
			if barButton(c, "filters", "sliders-horizontal", "", i18n.T("clip.panel.filter.more")+" (⌘F)", p.filterRow).Clicked() {
				p.filterRow = !p.filterRow
				p.input.Focus()
			}
			ui.Box(c).Width(0.5).Height(14).Margin(0, 4).Background(macBorder(t))
			p.tabs(c)
		})
		ui.Row(c).Absolute().Top(0).Bottom(0).Right(12).Gap(8).AlignItems(ui.Center).Children(func() {
			if on, label := p.paused(); on {
				b := ui.ButtonBase(c.Key("paused")).Height(22).Padding(0, 8).Radius(5).Gap(4).AlignItems(ui.Center).
					Background(macOrange.Alpha(0.16)).Tooltip(i18n.T("clip.panel.pause.resume"))
				b.Children(func() {
					ui.Icon(c, icons.Get("pause")).FontSize(11).TextColor(macOrange)
					ui.Text(c, label).FontSize(11.5).TextColor(macOrange)
				})
				if b.Clicked() {
					p.setPaused("resume")
				}
			}
			count := i18n.T("clip.panel.count.total", "count", len(p.items))
			if len(p.items) >= 200 {
				count = i18n.T("clip.panel.count.more", "count", len(p.items))
			}
			color := macTertiary(t)
			if n := len(p.selected); n > 1 {
				count, color = i18n.T("clip.panel.count.selected", "count", n), t.Accent
			}
			ui.Text(c, count).FontSize(11.5).TextColor(color).FontFeatures("tnum").SingleLine()
			if p.sync != nil {
				st := p.sync.Status()
				tip := i18n.T("clip.panel.sync.setup")
				if st.Configured {
					tip = i18n.T("clip.panel.sync.run")
				}
				if st.Running {
					ui.Box(c.Key("sync-busy")).Size(24, 24).Center().Tooltip(i18n.T("clip.panel.sync.running")).Children(func() {
						ui.Spinner(c).Size(13, 13)
					})
				} else if barButton(c, "sync", "refresh-cw", "", tip, false).Clicked() {
					go p.runSync(true)
				}
			}
			barButton(c, "more", "ellipsis", "", i18n.T("clip.panel.more.title"), false).Menu(func(m *ui.Menu) {
				if on, _ := p.paused(); on {
					if m.Item(i18n.T("clip.panel.pause.resume") + "    ⌘T").Chosen() {
						p.setPaused("resume")
					}
				} else {
					m.Submenu(i18n.T("clip.panel.pause.title"), func(sub *ui.Menu) {
						if sub.Item(i18n.T("clip.panel.pause.15m")).Chosen() {
							p.setPaused("15m")
						}
						if sub.Item(i18n.T("clip.panel.pause.1h")).Chosen() {
							p.setPaused("1h")
						}
						if sub.Item(i18n.T("clip.panel.pause.forever") + "    ⌘T").Chosen() {
							p.setPaused("forever")
						}
					})
				}
				m.Separator()
				if m.Item(i18n.T("clip.panel.dialog.newTextTitle") + "…    ⌘N").Chosen() {
					p.dialog = clipDialog{kind: "newText", open: true}
				}
				if m.Item(i18n.T("clip.panel.pinboard.new") + "…    ⇧⌘N").Chosen() {
					p.newPinboard(false)
				}
				m.Separator()
				if m.Item(i18n.T("clip.panel.more.settings")).Chosen() {
					p.app.ShowSettings("clipboard")
					go p.Hide()
				}
			})
		})
	})
}

func (p *ClipboardPanel) searchField(c *ui.Context) {
	t := c.Theme()
	focused := p.input.FocusWithin(c)
	field := ui.Row(c.Key("search")).Width(360).MinWidth(150).Shrink(1).Height(26).Padding(0, 4, 0, 8).Gap(6).
		AlignItems(ui.Center).Radius(6).Background(macFill(t)).Clip()
	field.Transition(hoverColors)
	if focused {
		field.Border(0.5, t.Accent).Shadow(0, 0, 0, 2, t.Accent.Alpha(0.25))
	} else {
		field.Border(0.5, macBorder(t))
	}
	field.Children(func() {
		ui.Icon(c, icons.Get("search")).FontSize(14).TextColor(t.TextMuted)
		chip := func(key, icon, label string, remove func()) {
			ui.Row(c.Key(key)).Height(18).Padding(0, 3, 0, 6).Gap(3).Radius(4).AlignItems(ui.Center).Transition(popIn).
				Background(t.Accent.Alpha(0.15)).Children(func() {
				ui.Icon(c, icons.Get(icon)).FontSize(11).TextColor(t.Accent)
				ui.Text(c, label).FontSize(11.5).FontWeight(500).TextColor(t.Accent).SingleLine()
				x := ui.ButtonBase(c.Key(key+":x")).Size(14, 14).Radius(7).Center().Label(i18n.T("clip.panel.search.removeFilter"))
				x.Opacity(0.65)
				if x.Hovered() {
					x.Opacity(1)
				}
				x.Children(func() { ui.Icon(c, icons.Get("x")).FontSize(10).TextColor(t.Accent) })
				if x.Clicked() {
					remove()
					p.reload()
				}
			})
		}
		if p.kind != "" {
			chip("chip:kind", kindIconName(p.kind), i18n.T("clip.panel.kind."+p.kind), func() { p.kind = "" })
		}
		for _, id := range p.appIDs {
			name := id
			for _, a := range p.apps {
				if a.BundleID == id {
					name = a.Name
				}
			}
			chip("chip:app:"+id, "app-window", name, func() {
				p.appIDs = slices.DeleteFunc(p.appIDs, func(v string) bool { return v == id })
			})
		}
		if p.date != "" {
			chip("chip:date", "calendar-days", i18n.T("clip.panel.date."+p.date), func() { p.date = "" })
		}
		in := ui.TextInputBase(c.Key("q"), &p.query).Bind(&p.input).Grow(1).MinWidth(40).FontSize(13).
			Placeholder(p.placeholder(c)).Label(i18n.T("clip.panel.search.placeholder"))
		in.OnTextKey(func(k ui.TextKey) bool { return p.key(k.Key, k.Mods, k.Text()) })
		if in.Changed() {
			p.reload()
		}
		if p.query != "" {
			x := ui.ButtonBase(c.Key("clear")).Size(16, 16).Radius(8).Center().Label(i18n.T("clip.panel.search.clear"))
			if x.Hovered() {
				x.Background(macSelected(t))
			}
			x.Children(func() { ui.Icon(c, icons.Get("x")).FontSize(11).TextColor(t.TextMuted) })
			if x.Clicked() {
				p.query = ""
				p.reload()
				p.input.Focus()
			}
		}
	})
}

func (p *ClipboardPanel) tabs(c *ui.Context) {
	t := c.Theme()
	tab := func(id, name, color string) {
		active := p.scope == id
		b := ui.ButtonBase(c.Key("tab:"+id)).Height(24).Padding(0, 9).Radius(6).Gap(5).AlignItems(ui.Center).MaxWidth(160).
			Transition(ui.ElementTransition{Duration: motionBase, Position: true, Colors: true, Enter: &ui.Motion{Scale: 0.9}})
		txt := t.TextMuted
		switch {
		case active:
			b.Background(macSelected(t))
			txt = t.Text
		case b.Hovered():
			b.Background(HoverFill(t))
		}
		// Cards dragged onto a pinboard tab join it.
		if ids, ok := ui.DragOver[[]string](b); ok && id != "" && len(ids) > 0 {
			b.Border(2, t.Accent)
		}
		if ids, ok := ui.Drop[[]string](b); ok && id != "" {
			name := name
			go func() {
				if p.store.AddToPinboard(id, ids) == nil {
					p.win.Update(func() {
						p.showToast(clipToast{text: i18n.T("clip.panel.toast.addedToPinboard", "name", name)}, 0)
					})
				}
			}()
		}
		b.Children(func() {
			if color != "" {
				ui.Box(c).Size(8, 8).Radius(4).Background(pinboardColor(color))
			}
			ui.Text(c, name).FontSize(13).TextColor(txt).SingleLine()
		})
		if b.Clicked() {
			p.selectScope(id)
		}
		if id == "" {
			return
		}
		pb := clipboard.Pinboard{ID: id, Name: name, Color: color}
		b.ContextMenu(func(m *ui.Menu) {
			if m.Item(i18n.T("clip.panel.pinboard.rename")).Chosen() {
				p.dialog = clipDialog{kind: "renamePinboard", pin: pb, text: pb.Name, open: true}
			}
			m.Submenu(i18n.T("clip.panel.pinboard.color"), func(sub *ui.Menu) {
				for _, col := range clipboard.PinboardColors {
					if sub.Item(i18n.T("clip.panel.color." + col)).Checked(pb.Color == col).Chosen() {
						col := col
						go func() { _ = p.store.UpdatePinboard(pb.ID, "", col) }()
					}
				}
			})
			m.Separator()
			if m.Item(i18n.T("clip.panel.pinboard.delete")).Chosen() {
				p.dialog = clipDialog{kind: "deletePinboard", pin: pb, open: true}
			}
		})
	}
	ui.Row(c).Gap(1).AlignItems(ui.Center).Shrink(1).Children(func() {
		tab("", i18n.T("clip.panel.tab.history"), "")
		for _, pb := range p.pins {
			tab(pb.ID, pb.Name, pb.Color)
		}
		if barButton(c, "tab:new", "plus", "", i18n.T("clip.panel.pinboard.new")+" (⇧⌘N)", false).Clicked() {
			p.newPinboard(false)
		}
	})
}

// filterRowView is the second row (⌘F): date presets and the apps items came from.
func (p *ClipboardPanel) filterRowView(c *ui.Context) {
	t := c.Theme()
	btn := func(key, label string, on bool, icon func()) bool {
		b := ui.ButtonBase(c.Key(key)).Height(22).Padding(0, 8).Radius(5).Gap(4).AlignItems(ui.Center).Transition(hoverColors)
		color := t.TextMuted
		switch {
		case on:
			b.Background(t.Accent.Alpha(0.15))
			color = t.Accent
		case b.Hovered():
			b.Background(HoverFill(t))
		}
		b.Children(func() {
			if icon != nil {
				icon()
			}
			ui.Text(c, label).FontSize(12).TextColor(color).SingleLine()
		})
		return b.Clicked()
	}
	ui.ScrollHorizontal(c.Key("filter-row")).Transition(ui.ElementTransition{Duration: motionBase,
		Enter: &ui.Motion{Collapse: true}, Exit: &ui.Motion{Collapse: true}}).Padding(0, 14, 8, 14).Children(func() {
		ui.Row(c).Gap(10).AlignItems(ui.Center).Justify(ui.Center).Grow(1).Children(func() {
			ui.Row(c).Gap(3).AlignItems(ui.Center).Children(func() {
				ui.Text(c, i18n.T("clip.panel.filter.time")).FontSize(11.5).TextColor(macTertiary(t)).Margin(0, 4, 0, 0)
				for _, d := range clipboard.DatePresets {
					if btn("date:"+d, i18n.T("clip.panel.date."+d), p.date == d, nil) {
						if p.date == d {
							p.date = ""
						} else {
							p.date = d
						}
						p.reload()
					}
				}
			})
			if len(p.apps) == 0 {
				return
			}
			ui.Box(c).Width(0.5).Height(14).Background(macBorder(t))
			ui.Row(c).Gap(3).AlignItems(ui.Center).Children(func() {
				ui.Text(c, i18n.T("clip.panel.filter.app")).FontSize(11.5).TextColor(macTertiary(t)).Margin(0, 4, 0, 0)
				for i, a := range p.apps {
					if i >= 16 {
						break
					}
					on := slices.Contains(p.appIDs, a.BundleID)
					id := a.BundleID
					if btn("app:"+id, a.Name, on, func() { p.appIconView(c, id, a.Name, 13) }) {
						if on {
							p.appIDs = slices.DeleteFunc(p.appIDs, func(v string) bool { return v == id })
						} else {
							p.appIDs = append(p.appIDs, id)
						}
						p.reload()
					}
				}
			})
		})
	})
}

// appIconView shows the icon of an app, or the first letter of its name while there is none.
func (p *ClipboardPanel) appIconView(c *ui.Context, bundleID, name string, size float32) {
	if b := p.appIcon(bundleID); b != nil {
		ui.Image(c, b).Size(size, size)
		return
	}
	letter := "?"
	if r := []rune(name); len(r) > 0 {
		letter = string(r[0])
	}
	ui.Text(c, letter).FontSize(size*0.6).FontWeight(700).Size(size, size).TextAlign(ui.Center).Radius(4).
		Background(ui.RGBA(255, 255, 255, 0.3))
}
