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

// UsedButtons are the bubble buttons the user has clicked at least once: from then on they show their icon
// alone, without the label (bubble-used-buttons.json).
type UsedButtons struct {
	mu     sync.Mutex
	loaded bool
	ids    []string
}

// BubbleUsed is the app's record of clicked bubble buttons.
var BubbleUsed = &UsedButtons{}

const bubbleUsedFile = "bubble-used-buttons.json"

func (u *UsedButtons) load() {
	if !u.loaded {
		u.loaded = true
		_ = jsonx.ReadFile(Path(bubbleUsedFile), &u.ids)
	}
}

// Has reports whether the button id was clicked before.
func (u *UsedButtons) Has(id string) bool {
	u.mu.Lock()
	defer u.mu.Unlock()
	u.load()
	return slices.Contains(u.ids, id)
}

// Add records a click on the button id.
func (u *UsedButtons) Add(id string) {
	u.mu.Lock()
	u.load()
	if slices.Contains(u.ids, id) {
		u.mu.Unlock()
		return
	}
	u.ids = append(u.ids, id)
	ids := slices.Clone(u.ids)
	u.mu.Unlock()
	_ = jsonx.WriteFile(Path(bubbleUsedFile), ids)
}

// Forget drops the record of the button ids (the dev self test).
func (u *UsedButtons) Forget(ids ...string) {
	u.mu.Lock()
	u.load()
	u.ids = slices.DeleteFunc(u.ids, func(id string) bool { return slices.Contains(ids, id) })
	kept := slices.Clone(u.ids)
	u.mu.Unlock()
	_ = jsonx.WriteFile(Path(bubbleUsedFile), kept)
}
