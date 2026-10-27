package views

import (
	"strings"
	"sync/atomic"
	"time"

	"github.com/egoist/mygo"

	"popmind/internal/chat"
	"popmind/internal/clipboard"
	"popmind/internal/clipsync"
	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/settings"
	"popmind/internal/textpicker"
	"popmind/internal/windows"
)

// quitting is set once the app starts quitting, so windows stop turning a close into a hide.
var quitting atomic.Bool

// App owns popMind's windows and the actions between them.
type App struct {
	Launcher  *Launcher
	Settings  *SettingsWindow
	Bubble    *Bubble
	Translate *TranslatePopup
	Chat      *ChatWindow
	Clipboard *ClipboardPanel
	InputTr   *InputTranslation
	Clips     *clipboard.Store
	Sync      *clipsync.Service
	Picker    *textpicker.Manager

	// Set by main: the shortcut manager's status, and suspending shortcuts while one is recorded.
	ShortcutStatus       func() []ShortcutState
	SetShortcutRecording func(bool)
}

// Start creates the windows, hidden, so that they show at once when asked for, and starts the text picker.
// Call on the main thread once the app is ready.
func Start() *App {
	a := &App{}
	// Quitting closes every window first; from then on a close must really close, not hide.
	mygo.App.OnBeforeQuit(func(*mygo.QuitEvent) { quitting.Store(true) })
	a.Launcher = newLauncher(a)
	a.Settings = newSettingsWindow(a)
	a.Bubble = newBubble(a)
	a.Translate = newTranslatePopup(a)
	a.Chat = newChatWindow(a)
	a.InputTr = newInputTranslation(a)
	a.startClipboard()
	windows.Register(&windows.Surface{
		ID: "bubble", Priority: 200, Visible: a.Bubble.Visible, Hide: a.Bubble.Hide,
		ShouldDismiss: func(ctx windows.DismissContext) bool {
			switch ctx.Reason {
			case windows.DismissEscape, windows.DismissScene:
				return true
			case windows.DismissSurfaceOpened:
				return ctx.Target == "translation" || ctx.Target == "selection-chat" || ctx.Target == "main"
			case windows.DismissOutside:
				return !contains(a.Bubble.Bounds(), textpicker.Point{X: ctx.X, Y: ctx.Y})
			}
			return false
		},
	})
	a.Picker = textpicker.New(a)
	go a.Picker.Start()
	return a
}

// ShowLauncher shows the launcher with query typed in.
func (a *App) ShowLauncher(query string) { a.Launcher.Show(query) }

// ShowSettings shows the settings window, at section when given.
func (a *App) ShowSettings(section string) {
	a.Launcher.Hide()
	a.Settings.Show(section)
}

// ShowClipboard shows the clipboard panel, with query typed in.
func (a *App) ShowClipboard(query string) { a.Clipboard.Show(query) }

// ToggleClipboard shows or hides the clipboard panel.
func (a *App) ToggleClipboard() { a.Clipboard.Toggle() }

// startClipboard opens the history, starts capturing and keeps the retention.
func (a *App) startClipboard() {
	store, err := clipboard.Open(settings.DataDir())
	if err != nil {
		logx.Error("[clipboard] open failed", "err", err)
	}
	a.Clips = store
	a.Clipboard = newClipboardPanel(a, store)
	if store == nil {
		return
	}
	logx.Info("[clipboard] opened", "items", store.Count(), "root", store.Root())
	a.Sync = clipsync.NewService(store)
	a.Clipboard.sync = a.Sync
	a.Clipboard.openSyncSettings = func() { a.ShowSettings("clipboard-sync") }
	a.Sync.OnChange(func() { a.Clipboard.win.Update(func() {}) })
	clipboard.StartWatcher(store)
	// Sync quietly in the background every half hour while it is set up (the panel syncs as it opens too).
	go func() {
		time.Sleep(2 * time.Minute)
		for {
			if st := a.Sync.Status(); st.Configured && !st.Running {
				a.Sync.Run()
			}
			time.Sleep(30 * time.Minute)
		}
	}()
	go func() {
		time.Sleep(time.Minute)
		for {
			store.Retention(clipboard.CurrentSettings().Retention)
			store.Purge(10 * time.Second)
			time.Sleep(time.Hour)
		}
	}()
}

// ShowExplain opens the explain chat about text (from the launcher), or the web without an AI provider.
func (a *App) ShowExplain(text string, image []byte) {
	if !chat.Configured() {
		_ = mygo.Shell.OpenExternal(chat.FallbackURL(text))
		return
	}
	a.Chat.Open("explain", text, "", image, nil)
	a.afterFloatingChange()
}

// RunCommand runs a bubble command on a selection.
func (a *App) RunCommand(command string, p textpicker.Picked) {
	a.Picker.NoteInteraction(0)
	logx.Info("[app] command", "command", command, "app", p.AppName, "chars", len([]rune(p.Text)))
	switch command {
	case "translate":
		a.Translate.Show(p.Text, p.Anchor)
	case "explain", "ask":
		if command == "explain" && !chat.Configured() {
			_ = mygo.Shell.OpenExternal(chat.FallbackURL(p.Text))
			break
		}
		image := captureContext(p.AppPid)
		anchor := p.Anchor
		a.Chat.Open(command, p.Text, p.AppName, image, &anchor)
	case "copy":
		mygo.Clipboard.WriteText(p.Text)
	case "open":
		if u := textpicker.NormalizeLink(p.Text); u != "" {
			_ = mygo.Shell.OpenExternal(u)
		}
	case "block":
		if strings.TrimSpace(p.AppID) != "" {
			settings.Blocked.Add(p.AppID)
		}
	}
	a.afterFloatingChange()
}

// afterFloatingChange keeps the key monitor on exactly while a floating surface shows.
func (a *App) afterFloatingChange() {
	if a.Picker != nil {
		go func() {
			time.Sleep(50 * time.Millisecond)
			a.Picker.SyncKeyMonitor()
		}()
	}
}

// ---- textpicker.UI ----

// ShowBubble implements textpicker.UI.
func (a *App) ShowBubble(p textpicker.Picked) { a.Bubble.Show(p) }

// HideBubble implements textpicker.UI.
func (a *App) HideBubble() {
	a.Bubble.Hide()
	a.afterFloatingChange()
}

// BubbleVisible implements textpicker.UI.
func (a *App) BubbleVisible() bool { return a.Bubble.Visible() }

// InsideFloating implements textpicker.UI.
func (a *App) InsideFloating(pt textpicker.Point) bool {
	return (a.Bubble.Visible() && contains(a.Bubble.Bounds(), pt)) ||
		(a.Translate.Visible() && contains(a.Translate.Bounds(), pt)) ||
		(a.Chat.Visible() && contains(a.Chat.Bounds(), pt))
}

// FloatingVisible implements textpicker.UI.
func (a *App) FloatingVisible() bool {
	return a.Bubble.Visible() || a.Translate.Visible() || a.Chat.Visible()
}

// Dismiss implements textpicker.UI.
func (a *App) Dismiss(reason string, pt *textpicker.Point) {
	ctx := windows.DismissContext{Reason: windows.DismissReason(reason)}
	if pt != nil {
		ctx.X, ctx.Y = pt.X, pt.Y
	}
	windows.Dispatch(ctx)
	a.afterFloatingChange()
}

// RunDefault implements textpicker.UI.
func (a *App) RunDefault(command string, p textpicker.Picked) { a.RunCommand(command, p) }

// roundPanel rounds a frameless panel's corners and material (myGo rounds flyouts only).
func roundPanel(w *mygo.Window, radius int) {
	native.SetWindowCornerRadius(w.NativeHandle(), radius)
}
