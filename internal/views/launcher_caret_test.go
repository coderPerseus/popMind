package views

import (
	"testing"

	"github.com/egoist/mygo/ui"
)

// Choosing a command fills the field with it; what is typed next goes after it, not where the caret was.
func TestLauncherCaretAfterCommand(t *testing.T) {
	l := &Launcher{app: &App{}, icons: map[string]*ui.Bitmap{}, placeholder: "搜应用"}
	l.translator.Reset()
	l.translator.Update = func(func()) {}
	tt := ui.NewTester(l.view, 760, 500)
	l.input.Focus()
	tt.Frame()
	tt.Type("/t")
	tt.Frame()
	if l.query != "/t" {
		t.Fatalf("typed %q", l.query)
	}
	var cmd *entry
	for _, e := range l.entries(parseQuery(l.query)) {
		if e.command != nil && e.command.kind == "translate" {
			e := e
			cmd = &e
		}
	}
	if cmd == nil {
		t.Fatal("no translate command listed")
	}
	l.activate(*cmd)
	tt.Frame()
	tt.Type("hello")
	tt.Frame()
	if l.query != "/tr hello" {
		t.Fatalf("after choosing the command and typing: %q", l.query)
	}
}
