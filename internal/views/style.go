// Package views draws popMind's windows in myGo's native UI: the launcher, the selection bubble, the
// translation and explain popups, the clipboard panel and the settings. The look follows AGENTS.md's macOS
// rules: the system font at 13px, hairlines, the accent color for choices, materials behind panels.
package views

import (
	"github.com/egoist/mygo/ui"

	"popmind/internal/views/icons"
)

// Look is popMind's theme over myGo's default (which follows the system's appearance and accent): white
// windows in light mode and near-black ones in dark mode, with quiet grays for hover, selection and lines,
// as Raycast and the system's own panels do.
func Look(c *ui.Context) *ui.Theme {
	t := *c.Theme()
	t.FontSize = 13
	t.Radius = 7
	t.Spacing = 4
	t.Background = Surface(&t)
	t.Surface = Surface(&t)
	t.Border = Hairline(&t)
	if t.Dark {
		t.Text = ui.RGBA(255, 255, 255, 0.92)
		t.TextMuted = ui.RGBA(255, 255, 255, 0.55)
	} else {
		t.Text = ui.RGBA(0, 0, 0, 0.86)
		t.TextMuted = ui.RGBA(0, 0, 0, 0.5)
	}
	c.SetTheme(&t)
	return c.Theme()
}

// TooltipFill and TooltipText are the colors of a tooltip: dark gray with white text, a lighter gray in dark mode.
// (The theme's Inverse is left unset; the ui package works it out for its own tooltips.)
func TooltipFill(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.Hex("#4a4a4e")
	}
	return ui.Hex("#2c2c2e")
}

func TooltipText(*ui.Theme) ui.Color { return ui.RGBA(255, 255, 255, 0.92) }

// Surface is the background of popMind's windows.
func Surface(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.Hex("#1e1e20")
	}
	return ui.RGB(255, 255, 255)
}

// Tertiary is the faintest text: hints, counts, captions.
func Tertiary(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.32)
	}
	return ui.RGBA(0, 0, 0, 0.32)
}

// Hairline is a 0.5–1px separator color.
func Hairline(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.08)
	}
	return ui.RGBA(0, 0, 0, 0.07)
}

// HoverFill is the background of a hovered row or icon button.
func HoverFill(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.06)
	}
	return ui.RGBA(0, 0, 0, 0.04)
}

// SelectedFill is the background of the chosen row.
func SelectedFill(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.1)
	}
	return ui.RGBA(0, 0, 0, 0.06)
}

// CardFill is the background of a group of content on a window (a result card, a settings group).
func CardFill(t *ui.Theme) ui.Color {
	if t.Dark {
		return ui.RGBA(255, 255, 255, 0.035)
	}
	return ui.RGBA(0, 0, 0, 0.018)
}

// PanelFill is what a panel draws: the surface.
func PanelFill(t *ui.Theme) ui.Color { return Surface(t) }

// Panel gives a floating window its background: over the window's material (vibrancy), a light tint of the
// surface that lets the blurred desktop show through, as Spotlight's and the system popovers' do; without the
// material, the plain surface.
func Panel(c *ui.Context) {
	t := c.Theme()
	if c.Vibrancy() {
		tint := float32(0.5)
		if t.Dark {
			tint = 0.55
		}
		c.Root().Background(Surface(t).Alpha(tint))
		return
	}
	c.Root().Background(Surface(t))
}

// IconButton is a 26×26 button showing a lucide icon, with a tooltip.
func IconButton(c *ui.Context, icon, tip string) ui.Element {
	t := c.Theme()
	b := ui.ButtonBase(c).Size(26, 26).Radius(6).Center().Label(tip).Tooltip(tip).Transition(hoverColors)
	if b.Pressed() {
		b.Background(SelectedFill(t))
	} else if b.Hovered() {
		b.Background(HoverFill(t))
	}
	return b.Children(func() { ui.Icon(c, icons.Get(icon)).FontSize(15).TextColor(t.TextMuted) })
}

// ActiveIconButton is IconButton in the accent color, for toggles that are on (pinned).
func ActiveIconButton(c *ui.Context, icon, tip string, on bool) ui.Element {
	t := c.Theme()
	b := ui.ButtonBase(c).Size(26, 26).Radius(6).Center().Label(tip).Tooltip(tip).Transition(hoverColors)
	color := t.TextMuted
	if on {
		b.Background(t.Accent.Alpha(0.14))
		color = t.Accent
	} else if b.Hovered() {
		b.Background(HoverFill(t))
	}
	return b.Children(func() { ui.Icon(c, icons.Get(icon)).FontSize(15).TextColor(color) })
}

// Kbd shows a key cap, as ⌘ or ↵.
func Kbd(c *ui.Context, key string) ui.Element {
	t := c.Theme()
	return ui.Text(c, key).FontSize(11).FontWeight(500).TextColor(t.TextMuted).MinWidth(20).Height(20).TextAlign(ui.Center).
		Padding(2, 6).Radius(5).Background(SelectedFill(t))
}

// SectionTitle is the small muted heading of a group of rows.
func SectionTitle(c *ui.Context, title string) ui.Element {
	return ui.Text(c, title).FontSize(11.5).FontWeight(600).TextColor(c.Theme().TextMuted).Padding(8, 10, 4, 10)
}

// Muted is secondary text.
func Muted(c *ui.Context, s string) ui.Element {
	return ui.Text(c, s).FontSize(12).TextColor(c.Theme().TextMuted)
}

// Option is a choice of a Picker: a value and what it shows.
type Option struct {
	Value string
	Label string
}

// Picker is a compact drop-down choosing a value by its label.
func Picker(c *ui.Context, selected *string, options []Option, label string) ui.Element {
	t := c.Theme()
	sel := ui.SelectBase(c, selected)
	current := *selected
	for _, o := range options {
		if o.Value == *selected {
			current = o.Label
		}
	}
	trigger := sel.Trigger.Gap(4).Padding(3, 8).Radius(6).Label(label).AlignItems(ui.Center).Transition(hoverColors)
	if trigger.Hovered() {
		trigger.Background(HoverFill(t))
	}
	trigger.Children(func() {
		ui.Text(c, current).FontSize(12).SingleLine()
		ui.Icon(c, icons.Get("chevron-down")).FontSize(11).TextColor(t.TextMuted)
	})
	sel.Popup(func(panel ui.Element) {
		// Long lists (the languages) scroll inside a panel that fits the window.
		_, h := c.Size()
		panel.Transition(popIn).TransformOrigin(0.5, 0).Margin(4, 0, 0, 0).Radius(8).Background(t.Background).Border(0.5, Hairline(t)).Clip().
			Shadow(0, 6, 18, 0, ui.RGBA(0, 0, 0, 0.18)).MinWidth(140)
		ui.Scroll(c).MaxHeight(max(120, min(320, h-90))).Children(func() {
			ui.Column(c).Padding(4).Children(func() {
				for _, o := range options {
					item := sel.Item(o.Value).Padding(5, 10).Radius(5).Transition(hoverColors)
					color := t.Text
					if item.Highlighted() {
						item.Background(t.Accent)
						color = t.AccentText
					}
					item.Children(func() {
						ui.Row(c).Gap(6).AlignItems(ui.Center).Children(func() {
							ui.Text(c, o.Label).FontSize(12).TextColor(color).Grow(1).SingleLine()
							if o.Value == *selected {
								ui.Icon(c, icons.Get("check")).FontSize(12).TextColor(color)
							}
						})
					})
				}
			})
		})
	})
	return sel.Trigger
}
