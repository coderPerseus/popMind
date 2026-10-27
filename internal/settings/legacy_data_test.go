package settings

import (
	"os"
	"testing"
)

// The installed app reads the Electron app's folder itself: its settings load as they are, nothing is merged.
func TestLegacyFolderInPlace(t *testing.T) {
	dir := os.Getenv("POPMIND_LEGACY_COPY")
	if dir == "" {
		t.Skip("set POPMIND_LEGACY_COPY")
	}
	legacyDirOverride = dir
	defer func() { legacyDirOverride = "" }()
	SetDataDir(dir)
	if !SharesLegacyDir() || LegacyAvailable() {
		t.Fatal("the shared folder is not recognized")
	}
	if r := ImportLegacy(false); r.Found || r.Changed != 0 {
		t.Fatalf("merged into itself: %+v", r)
	}
	Capabilities.Load("zh-CN")
	c := Capabilities.Get()
	if c.AIService.ActiveProvider == nil || *c.AIService.ActiveProvider == "" || len(c.Shortcuts) == 0 {
		t.Fatal("settings not read")
	}
	t.Logf("active provider set, %d shortcuts, theme %s, %d blocked apps", len(c.Shortcuts), ThemeMode(), len(Blocked.All()))
}
