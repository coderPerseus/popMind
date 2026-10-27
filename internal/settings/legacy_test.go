package settings

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"popmind/internal/jsonx"
)

func TestImportLegacy(t *testing.T) {
	legacyDirOverride = t.TempDir()
	defer func() { legacyDirOverride = "" }()
	SetDataDir(t.TempDir())
	write := func(dir, name string, v any, at time.Time) {
		p := filepath.Join(dir, name)
		if err := jsonx.WriteFile(p, v); err != nil {
			t.Fatal(err)
		}
		_ = os.Chtimes(p, at, at)
	}
	old := time.Now().Add(-time.Hour)

	// The old app: an AI key, a translation engine turned off, a shortcut, a theme and blocked apps.
	write(legacyDirOverride, capabilityFile, map[string]any{
		"aiService":      map[string]any{"activeProvider": "deepseek", "providers": map[string]any{"deepseek": map[string]any{"apiKey": "sk-old", "model": "deepseek-chat"}}},
		"enabledEngines": map[string]any{"google": false},
		"shortcuts":      map[string]any{"clipboard": "Alt+V"},
	}, old)
	write(legacyDirOverride, "theme-settings.json", map[string]any{"mode": "dark"}, old)
	write(legacyDirOverride, blockedAppsFile, []any{"com.old.app"}, old)

	// popMind already has its own choices: another provider and a blocked app.
	write(DataDir(), capabilityFile, map[string]any{"aiService": map[string]any{"activeProvider": "custom",
		"providers": map[string]any{"custom": map[string]any{"apiKey": "sk-new", "baseURL": "https://relay/v1", "model": "gemini-3.8-flash"}}}}, time.Now())
	write(DataDir(), blockedAppsFile, []any{"com.new.app"}, time.Now())

	r := ImportLegacy(false)
	if !r.Found || r.Changed == 0 {
		t.Fatalf("report %+v", r)
	}
	var cap map[string]any
	_ = jsonx.ReadFile(Path(capabilityFile), &cap)
	get := func(keys ...string) any { return jsonx.Get(cap, keys...) }
	if get("aiService", "activeProvider") != "custom" {
		t.Error("popMind's newer provider choice must stay:", get("aiService", "activeProvider"))
	}
	if get("aiService", "providers", "deepseek", "apiKey") != "sk-old" || get("aiService", "providers", "custom", "apiKey") != "sk-new" {
		t.Error("both providers' keys must be there")
	}
	if get("enabledEngines", "google") != false || get("shortcuts", "clipboard") != "Alt+V" {
		t.Error("the old app's changes must come over", get("enabledEngines", "google"), get("shortcuts", "clipboard"))
	}
	var blocked []string
	_ = jsonx.ReadFile(Path(blockedAppsFile), &blocked)
	if len(blocked) != 2 {
		t.Error("blocked apps must be joined:", blocked)
	}
	if ThemeMode() != "dark" {
		t.Error("theme from the old app")
	}

	// Nothing new in the old app: nothing changes, even what popMind changed meanwhile.
	write(DataDir(), "theme-settings.json", map[string]any{"mode": "light"}, time.Now())
	if r := ImportLegacy(false); r.Changed != 0 || ThemeMode() != "light" {
		t.Fatalf("second import %+v theme %s", r, ThemeMode())
	}
	// The old app changes a setting later: it comes over; popMind's other changes stay.
	write(legacyDirOverride, capabilityFile, map[string]any{
		"aiService":      map[string]any{"activeProvider": "deepseek", "providers": map[string]any{"deepseek": map[string]any{"apiKey": "sk-rotated", "model": "deepseek-chat"}}},
		"enabledEngines": map[string]any{"google": false},
		"shortcuts":      map[string]any{"clipboard": "Alt+V"},
	}, time.Now().Add(time.Minute))
	ImportLegacy(false)
	_ = jsonx.ReadFile(Path(capabilityFile), &cap)
	if get("aiService", "providers", "deepseek", "apiKey") != "sk-rotated" || get("aiService", "activeProvider") != "custom" {
		t.Error("later change", get("aiService", "providers", "deepseek", "apiKey"), get("aiService", "activeProvider"))
	}
}
