// popMind, rebuilt on myGo with native UI. See docs/mygo-migration-plan.md.
package main

import (
	"log"
	"os"
	"path/filepath"

	"github.com/egoist/mygo"
	"github.com/egoist/mygo/plugins/updater"
	updaterui "github.com/egoist/mygo/plugins/updater/native"

	"popmind/internal/apps"
	"popmind/internal/assets"
	"popmind/internal/i18n"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/settings"
	"popmind/internal/views"
	"popmind/internal/windows"
)

var app *views.App

func main() {
	if !mygo.App.RequestSingleInstanceLock() {
		return // the running popMind shows itself
	}
	mygo.App.SetActivationPolicy(mygo.ActivationPolicyAccessory)
	// Updates from the GitHub releases (mygo.json's updates), signed with popMind's key: checked in the
	// background after launch and daily, offered in myGo's native update window, installed in place.
	mygo.Use(updaterui.Plugin)
	mygo.App.OnWindowAllClosed(func() {})
	mygo.App.OnSecondInstance(func([]string, string) {
		if app != nil {
			app.ShowLauncher("")
		}
	})
	mygo.App.WhenReady(ready)
	mygo.App.OnWillQuit(func(*mygo.QuitEvent) { shutdown() })
	if err := mygo.App.Run(); err != nil {
		log.Fatal(err)
	}
}

func ready() {
	dataDir, err := mygo.App.Path(mygo.PathUserData)
	if err != nil {
		log.Fatal(err)
	}
	// The installed app is the Electron popMind's upgrade: same identifier, and the same data folder
	// (~/Library/Application Support/popMind, "popmind" on a case-insensitive disk), whose settings and
	// clipboard history it reads as they are. `mygo dev` keeps its own ("popMind Dev").
	if override := os.Getenv("POPMIND_USER_DATA_DIR"); override != "" && mygo.IsDev() {
		dataDir = override
	}
	settings.SetDataDir(dataDir)
	logPath, err := logx.Init(dataDir)
	if err != nil {
		log.Printf("log file: %v", err)
	}
	logx.Info("[app] ready", "version", mygo.App.Version(), "dev", mygo.IsDev(), "userData", dataDir, "log", logPath)

	resources, _ := mygo.App.Path(mygo.PathResources)
	exe, _ := os.Executable()
	if err := native.Load(resources, filepath.Join(filepath.Dir(exe), "..", "Resources"), "resources"); err != nil {
		logx.Error("[native] load failed", "err", err)
	}
	logx.Info("[native] permission", "accessibility", native.CheckPermission(false))

	// Decided before the settings load, since loading writes them.
	firstRun := views.FirstRun()
	settings.Capabilities.Load(mygo.App.Locale())
	setLanguage(settings.Capabilities.Get().AppLanguage)
	applyThemeMode(settings.ThemeMode())

	app = views.Start()
	app.ShortcutStatus = func() []views.ShortcutState {
		var out []views.ShortcutState
		for _, st := range shortcuts.Status() {
			out = append(out, views.ShortcutState{ID: st.ID, Accelerator: st.Accelerator, State: st.State})
		}
		return out
	}
	app.SetShortcutRecording = shortcuts.SetRecording
	shortcuts.SetHandler("toggleHome", app.Launcher.Toggle)
	shortcuts.SetHandler("clipboardHistory", app.ToggleClipboard)
	shortcuts.SetHandler("inputTranslation", app.InputTr.Toggle)
	shortcuts.SetHandler("hideBubble", func() { windows.DismissTopmost(windows.DismissEscape) })

	createTray()
	shortcuts.Apply(settings.Capabilities.Get().Shortcuts)
	settings.Capabilities.Subscribe(func(c settings.Capability) {
		setLanguage(c.AppLanguage)
		shortcuts.Apply(c.Shortcuts)
		refreshTrayMenu()
	})
	apps.Default.Warmup()
	if firstRun {
		app.Onboard()
	}
	runSelfTest(app)
}

// setLanguage shows popMind in lang, and myGo's own windows (the update window) with it.
func setLanguage(lang string) {
	i18n.SetLanguage(lang)
	if lang != "" && lang != mygo.App.Locale() {
		mygo.App.SetLocale(lang)
	}
}

func shutdown() {
	mygo.GlobalShortcut.UnregisterAll()
	native.StopActionMonitor()
	native.StopPasteMonitor()
	logx.Info("[app] quit")
}

// applyThemeMode sets light, dark or the system's appearance (theme-settings.json).
func applyThemeMode(mode string) {
	switch mode {
	case "light":
		mygo.Theme.SetSource(mygo.ThemeLight)
	case "dark":
		mygo.Theme.SetSource(mygo.ThemeDark)
	default:
		mygo.Theme.SetSource(mygo.ThemeSystem)
	}
}

var tray *mygo.Tray

func createTray() {
	tooltip := "popMind"
	if mygo.IsDev() {
		tooltip = "popMind (dev)"
	}
	var err error
	tray, err = mygo.NewTray(mygo.TrayOptions{ID: "popmind", Icon: assets.TrayIcon, IconIsTemplate: true, ToolTip: tooltip, Menu: trayMenu()})
	if err != nil {
		logx.Error("[tray] create failed", "err", err)
	}
}

func refreshTrayMenu() {
	if tray != nil {
		tray.SetMenu(trayMenu())
	}
}

func trayMenu() *mygo.Menu {
	items := []*mygo.MenuItem{
		{Label: i18n.T("tray.openHome"), Click: func(*mygo.MenuItem, *mygo.Window) { app.ShowLauncher("") }},
		{Label: i18n.T("tray.openClipboard"), Click: func(*mygo.MenuItem, *mygo.Window) { app.ShowClipboard("") }},
		mygo.Separator(),
		pickerItem(),
		{Label: i18n.T("tray.openSettings"), Accelerator: "Cmd+,", Click: func(*mygo.MenuItem, *mygo.Window) { app.ShowSettings("") }},
	}
	if native.Loaded() && !native.CheckPermission(false) {
		items = append(items, &mygo.MenuItem{Label: i18n.T("tray.accessibility"), Click: func(*mygo.MenuItem, *mygo.Window) {
			native.CheckPermission(true)
			native.OpenAccessibilitySettings()
		}})
	}
	if mygo.IsDev() {
		// Development only: play the first-run intro again (release builds leave it out).
		items = append(items, &mygo.MenuItem{Label: "播放安装动画", Click: func(*mygo.MenuItem, *mygo.Window) { app.Onboard() }})
	}
	items = append(items, mygo.Separator())
	if !mygo.IsDev() { // development builds cannot update themselves
		items = append(items, &mygo.MenuItem{Label: i18n.T("settings.advanced.checkUpdate") + "…",
			Click: func(*mygo.MenuItem, *mygo.Window) { updater.CheckForUpdates() }})
	}
	items = append(items,
		&mygo.MenuItem{Label: i18n.T("tray.version", "version", mygo.App.Version()), Disabled: true},
		&mygo.MenuItem{Label: i18n.T("tray.quit"), Accelerator: "Cmd+Q", Click: func(*mygo.MenuItem, *mygo.Window) { mygo.App.Quit() }},
	)
	return mygo.NewMenu(items)
}

func pickerItem() *mygo.MenuItem {
	on := app.Picker.Enabled()
	label := i18n.T("tray.disableSelection")
	if !on {
		label = i18n.T("tray.enableSelection")
	}
	return &mygo.MenuItem{Label: label, Click: func(*mygo.MenuItem, *mygo.Window) {
		app.Picker.SetEnabled(!on)
		refreshTrayMenu()
	}}
}
