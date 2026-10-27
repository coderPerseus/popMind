package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/egoist/mygo"

	"popmind/internal/logx"
	"popmind/internal/textpicker"
	"popmind/internal/views"
)

// runSelfTest drives the windows for development checks without a person at the keyboard: with
// POPMIND_SELFTEST=launcher:<query>|<query>… (dev builds only) it shows the launcher with each query and saves
// a capture of it to POPMIND_SELFTEST_DIR.
func runSelfTest(app *views.App) {
	spec := os.Getenv("POPMIND_SELFTEST")
	dir := os.Getenv("POPMIND_SELFTEST_DIR")
	if spec == "" || dir == "" || !mygo.IsDev() {
		return
	}
	go func() {
		time.Sleep(2 * time.Second)
		kind, rest, _ := strings.Cut(spec, ":")
		if kind == "clipboard" {
			selfTestClipboard(app, dir, rest)
			return
		}
		if kind == "popups" {
			selfTestPopups(app, dir, rest)
			return
		}
		if kind != "launcher" {
			return
		}
		for i, query := range strings.Split(rest, "|") {
			app.ShowLauncher(query)
			time.Sleep(2500 * time.Millisecond)
			png, err := app.Launcher.Capture()
			path := filepath.Join(dir, "selftest-launcher-"+string(rune('a'+i))+".png")
			if err == nil {
				err = os.WriteFile(path, png, 0o644)
			}
			logx.Info("[selftest] launcher", "query", query, "capture", path, "err", err)
			screen(dir, "screen-launcher-"+string(rune('a'+i))+".png", app.Launcher.Bounds())
		}
		app.Launcher.Hide()
	}()
}

// screen saves what the screen shows in r (with the material and corners the capture of a window lacks).
func screen(dir, name string, r mygo.Rectangle) {
	pad := 24
	arg := fmt.Sprintf("%d,%d,%d,%d", r.X-pad, r.Y-pad, r.Width+2*pad, r.Height+2*pad)
	if err := exec.Command("screencapture", "-x", "-R", arg, filepath.Join(dir, name)).Run(); err != nil {
		logx.Warn("[selftest] screencapture failed", "err", err)
	}
}

// selfTestPopups opens the translation popup and the explain chat about text, as the bubble would, and saves
// what the screen shows.
func selfTestPopups(app *views.App, dir, text string) {
	d := mygo.Screen.DisplayNearestPoint(mygo.Screen.CursorScreenPoint())
	anchor := textpicker.Anchor{X: float64(d.WorkArea.X + d.WorkArea.Width/2), TopY: float64(d.WorkArea.Y + d.WorkArea.Height/2),
		BottomY: float64(d.WorkArea.Y + d.WorkArea.Height/2 + 20)}
	logx.Info("[selftest] picker", "running", app.Picker.Running())
	p := textpicker.Picked{Text: text, AppName: "Self Test", Anchor: anchor, Cursor: textpicker.Point{X: anchor.X, Y: anchor.TopY}}
	app.ShowBubble(p)
	time.Sleep(800 * time.Millisecond)
	screen(dir, "screen-bubble.png", app.Bubble.Bounds())
	app.RunCommand("translate", p)
	time.Sleep(4 * time.Second)
	screen(dir, "screen-translate.png", app.Translate.Bounds())
	app.RunCommand("explain", p)
	time.Sleep(15 * time.Second)
	screen(dir, "screen-chat.png", app.Chat.Bounds())
	logx.Info("[selftest] popups done")
}

// selfTestClipboard copies each "|"-separated text, as another app would, waits for the capture, then shows
// the panel (searching for query after "?") and saves what the screen shows. The user's clipboard is restored.
func selfTestClipboard(app *views.App, dir, spec string) {
	texts, query, _ := strings.Cut(spec, "?")
	previous := mygo.Clipboard.ReadText()
	for _, text := range strings.Split(texts, "|") {
		mygo.Clipboard.WriteText(text)
		time.Sleep(700 * time.Millisecond)
	}
	logx.Info("[selftest] clipboard items", "count", app.Clips.Count())
	app.ShowClipboard("")
	time.Sleep(1500 * time.Millisecond)
	screen(dir, "screen-clipboard.png", app.Clipboard.Bounds())
	if query != "" {
		app.Clipboard.Hide()
		time.Sleep(300 * time.Millisecond)
		app.ShowClipboard(query)
		time.Sleep(1500 * time.Millisecond)
		screen(dir, "screen-clipboard-search.png", app.Clipboard.Bounds())
	}
	app.Clipboard.Hide()
	if previous != "" {
		mygo.Clipboard.WriteText(previous)
	}
	logx.Info("[selftest] clipboard done")
}
