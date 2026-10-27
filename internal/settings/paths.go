// Package settings keeps popMind's settings files in the user data directory, with the same names and
// shapes as the Electron app's, which it imports from on first launch.
package settings

import (
	"os"
	"path/filepath"
	"sync"
)

// legacyDirOverride points LegacyDir elsewhere (tests).
var legacyDirOverride string

var (
	dirMu   sync.RWMutex
	dataDir string
)

// SetDataDir sets where the settings live; call once at startup.
func SetDataDir(dir string) {
	dirMu.Lock()
	dataDir = dir
	dirMu.Unlock()
}

// DataDir returns the user data directory.
func DataDir() string {
	dirMu.RLock()
	defer dirMu.RUnlock()
	return dataDir
}

// Path returns name inside the user data directory.
func Path(name ...string) string {
	return filepath.Join(append([]string{DataDir()}, name...)...)
}

// LegacyDir is the Electron app's user data directory.
func LegacyDir() string {
	if legacyDirOverride != "" {
		return legacyDirOverride
	}
	home, _ := os.UserHomeDir()
	return filepath.Join(home, "Library", "Application Support", "popmind")
}

// importLegacy copies name from the Electron app's data directory when popMind has none yet.
func importLegacy(name string) bool {
	target := Path(name)
	if _, err := os.Stat(target); err == nil {
		return false
	}
	data, err := os.ReadFile(filepath.Join(LegacyDir(), name))
	if err != nil {
		return false
	}
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return false
	}
	return os.WriteFile(target, data, 0o644) == nil
}
