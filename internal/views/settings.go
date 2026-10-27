package views

import (
	"github.com/egoist/mygo"
	"github.com/egoist/mygo/ui"

	"popmind/internal/logx"
)

// SettingsWindow is the settings window (P4 fills its sections).
type SettingsWindow struct {
	app     *App
	win     *mygo.Window
	section string
	err     string
	ui      settingsUI
	// revealSync scrolls the clipboard settings to their sync part once.
	revealSync bool
}

func newSettingsWindow(app *App) *SettingsWindow {
	s := &SettingsWindow{app: app, section: "general"}
	s.win = mygo.NewWindow(mygo.WindowOptions{
		Title:                "popMind",
		Width:                980,
		Height:               680,
		MinWidth:             860,
		MinHeight:            560,
		Hidden:               true,
		TitleBarStyle:        mygo.TitleBarHidden,
		TrafficLightPosition: &mygo.Point{X: 14, Y: 14},
		DisableFullScreen:    true,
		Vibrancy:             mygo.VibrancySidebar,
		StateKey:             "settings",
		Content:              ui.View(s.view),
	})
	s.win.OnClose(func(e *mygo.CloseEvent) {
		if quitting.Load() {
			return
		}
		e.PreventDefault()
		s.Hide()
	})
	return s
}

// Show shows the window, at section when given. popMind is a regular app (Dock icon) while it shows.
func (s *SettingsWindow) Show(section string) {
	if section != "" {
		s.win.Update(func() {
			// "clipboard-sync" is Clipboard, scrolled to its sync settings.
			s.section, s.revealSync = section, section == "clipboard-sync"
			if s.revealSync {
				s.section = "clipboard"
			}
		})
	}
	mygo.App.SetActivationPolicy(mygo.ActivationPolicyRegular)
	s.win.Show()
	s.win.Focus()
	mygo.App.Focus()
	logx.Info("[settings] shown", "section", section)
}

// Hide hides it, and popMind goes back to the menu bar.
func (s *SettingsWindow) Hide() {
	s.win.Hide()
	mygo.App.SetActivationPolicy(mygo.ActivationPolicyAccessory)
}

// Visible reports whether it shows.
func (s *SettingsWindow) Visible() bool { return s.win.IsVisible() }
