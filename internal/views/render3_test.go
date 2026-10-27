package views

import (
	"os"
	"testing"

	"github.com/egoist/mygo/ui"

	"popmind/internal/clipboard"
	"popmind/internal/clipsync"

	"popmind/internal/settings"
)

func TestRenderSettings(t *testing.T) {
	if os.Getenv("POPMIND_RENDER_DIR") == "" {
		t.Skip("set POPMIND_RENDER_DIR to render")
	}
	settings.SetDataDir(t.TempDir())
	settings.Capabilities.Load("zh-CN")
	for _, sec := range []string{"general", "selection", "translation", "ai", "shortcuts", "clipboard"} {
		s := &SettingsWindow{section: sec}
		save(t, "settings-"+sec, s.view, 980, 680)
	}
	s := &SettingsWindow{section: "ai"}
	s.ui.aiProvider, s.ui.loadedDraft = "openai", true
	s.ui.aiDraft.APIKey, s.ui.aiDraft.BaseURL, s.ui.aiDraft.Model = "sk-test", "https://api.example.com/v1", "gpt-4o"
	s.ui.models = modelList{key: s.modelKey(), models: []string{"gpt-4o", "gpt-4o-mini", "gpt-5"}, seq: 1}
	save(t, "settings-ai-models", s.view, 980, 680)
	s = &SettingsWindow{section: "ai"}
	s.ui.aiProvider, s.ui.loadedDraft = "custom", true
	s.ui.aiDraft.Name, s.ui.aiDraft.APIKey, s.ui.aiDraft.BaseURL, s.ui.aiDraft.Model = "三号中转站", "sk-test", "https://relay.example.com/v1", "gemini-3.8-flash"
	s.ui.models = modelList{key: s.modelKey(), models: []string{"gemini-3.8-flash", "claude-sonnet-4-5", "gpt-5"}, seq: 1}
	save(t, "settings-ai-custom", s.view, 980, 760)

	store, err := clipboard.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	s = &SettingsWindow{section: "clipboard", app: &App{Sync: clipsync.NewService(store)}}
	save(t, "settings-clipboard-sync", func(c *ui.Context) {
		s.view(c)
	}, 980, 1900)
}
