package settings

import (
	"slices"
	"strings"
	"sync"

	"popmind/internal/jsonx"
)

// ThemeMode is "system", "light" or "dark" (theme-settings.json).
func ThemeMode() string {
	var v struct {
		Mode string `json:"mode"`
	}
	_ = jsonx.ReadFile(Path("theme-settings.json"), &v)
	switch v.Mode {
	case "light", "dark":
		return v.Mode
	}
	return "system"
}

// SetThemeMode persists the theme mode.
func SetThemeMode(mode string) error {
	return jsonx.WriteFile(Path("theme-settings.json"), map[string]string{"mode": mode})
}

// BlockedApps are the bundle identifiers where the selection bubble stays away (text-picker-blocked-apps.json).
type BlockedApps struct {
	mu     sync.Mutex
	loaded bool
	apps   []string
}

// Blocked is the app's blocked-apps list.
var Blocked = &BlockedApps{}

const blockedAppsFile = "text-picker-blocked-apps.json"

func (b *BlockedApps) load() {
	if b.loaded {
		return
	}
	b.loaded = true
	var list []string
	_ = jsonx.ReadFile(Path(blockedAppsFile), &list)
	for _, id := range list {
		if id = strings.TrimSpace(id); id != "" && !slices.Contains(b.apps, id) {
			b.apps = append(b.apps, id)
		}
	}
}

// All returns the list.
func (b *BlockedApps) All() []string {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.load()
	return slices.Clone(b.apps)
}

// Contains reports whether bundleID is blocked.
func (b *BlockedApps) Contains(bundleID string) bool {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.load()
	return slices.Contains(b.apps, bundleID)
}

// Add blocks bundleID.
func (b *BlockedApps) Add(bundleID string) {
	bundleID = strings.TrimSpace(bundleID)
	if bundleID == "" {
		return
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	b.load()
	if !slices.Contains(b.apps, bundleID) {
		b.apps = append(b.apps, bundleID)
		_ = jsonx.WriteFile(Path(blockedAppsFile), b.apps)
	}
}

// Remove unblocks bundleID.
func (b *BlockedApps) Remove(bundleID string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.load()
	b.apps = slices.DeleteFunc(b.apps, func(id string) bool { return id == strings.TrimSpace(bundleID) })
	_ = jsonx.WriteFile(Path(blockedAppsFile), b.apps)
}

// reload reads the list again (after the old app's was merged in).
func (b *BlockedApps) reload() {
	b.mu.Lock()
	defer b.mu.Unlock()
	b.loaded, b.apps = false, nil
	b.load()
}

// InputTranslationPrefs are the engine and target language last chosen in the input translation box
// (input-translation.json).
type InputTranslationPrefs struct {
	Engine         string `json:"engine"`
	TargetLanguage string `json:"targetLanguage"`
}

const inputTranslationFile = "input-translation.json"

// LoadInputTranslation reads the input translation box's choices; the target is English until one is chosen.
func LoadInputTranslation() InputTranslationPrefs {
	var p InputTranslationPrefs
	_ = jsonx.ReadFile(Path(inputTranslationFile), &p)
	if p.TargetLanguage == "" {
		p.TargetLanguage = "en"
	}
	return p
}

// SaveInputTranslation keeps the input translation box's choices.
func SaveInputTranslation(p InputTranslationPrefs) error {
	return jsonx.WriteFile(Path(inputTranslationFile), p)
}
