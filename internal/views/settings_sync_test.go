package views

import (
	"testing"

	"github.com/egoist/mygo/ui"

	"popmind/internal/clipboard"
	"popmind/internal/clipsync"
	"popmind/internal/settings"
)

// From the panel's "Sync to remote" before sync is set up: Settings opens on the clipboard page, scrolled to
// the sync settings at its end.
func TestSettingsRevealSync(t *testing.T) {
	settings.SetDataDir(t.TempDir())
	settings.Capabilities.Load("zh-CN")
	store, err := clipboard.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s := &SettingsWindow{section: "clipboard", app: &App{Sync: clipsync.NewService(store)}}
	tt := ui.NewTester(s.view, 980, 680)
	tt.Frame()
	visible := func() bool {
		r, ok := tt.Find("连接同步")
		return ok && r.Y >= 0 && r.Y+r.H <= 680
	}
	if visible() {
		t.Fatal("the sync settings already show without scrolling: the test proves nothing")
	}
	s.revealSync = true
	for i := 0; i < 4; i++ {
		tt.Frame()
	}
	if !visible() {
		r, ok := tt.Find("连接同步")
		t.Fatalf("sync settings not in view: %v %v", r, ok)
	}
}
