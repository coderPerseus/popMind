// Package apps is the launcher's application search: an index of the installed apps with every name they go
// by (localized names, Info.plist names, bundle identifier segments), ranked as the Electron app ranks them,
// with their icons cached as PNGs.
package apps

import (
	"cmp"
	"crypto/sha1"
	"encoding/hex"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/egoist/mygo"

	"popmind/internal/logx"
	"popmind/internal/native"
	"popmind/internal/settings"
)

const (
	indexTTL     = 5 * time.Minute
	iconSize     = 64
	iconPixels   = 128
	cacheVersion = "v1"
)

var (
	indexedLocales     = []string{"en", "English", "Base", "zh_CN", "zh-Hans", "zh_TW", "zh-Hant", "zh_HK"}
	commonIDSegments   = map[string]bool{"app": true, "com": true, "helper": true, "macos": true, "system": true}
	spaces             = regexp.MustCompile(`\s+`)
	bundleIDSeparators = regexp.MustCompile(`[./_-]+`)
	nestedApp          = regexp.MustCompile(`(?i)\.app/Contents/.+\.app$`)
)

// Result is one search hit.
type Result struct {
	Name     string
	FileName string
	BundleID string
	Path     string
	// Icon is the app's icon as a PNG of iconPixels, or nil.
	Icon []byte
}

type entry struct {
	app      mygo.InstalledApp
	name     string
	fileName string
	bundleID string
	aliases  []string
}

// Service owns the index.
type Service struct {
	mu       sync.Mutex
	entries  []entry
	builtAt  time.Time
	building chan struct{}
	icons    sync.Map // path -> data URL
}

// Default is the app's service.
var Default = &Service{}

func normalize(s string) string {
	return spaces.ReplaceAllString(strings.ToLower(strings.TrimSpace(s)), " ")
}

func scoreField(field, query string) int {
	switch {
	case field == "":
		return 0
	case field == query:
		return 120
	case strings.HasPrefix(field, query):
		return 80
	case strings.Contains(field, query):
		return 45
	}
	compactField := strings.ReplaceAll(field, " ", "")
	compactQuery := strings.ReplaceAll(query, " ", "")
	switch {
	case compactField == compactQuery:
		return 90
	case strings.HasPrefix(compactField, compactQuery):
		return 60
	case strings.Contains(compactField, compactQuery):
		return 30
	}
	return 0
}

// Warmup builds the index in the background.
func (s *Service) Warmup() { go s.index() }

func (s *Service) index() []entry {
	s.mu.Lock()
	if s.entries != nil {
		entries := s.entries
		stale := time.Since(s.builtAt) > indexTTL
		s.mu.Unlock()
		if stale {
			go s.rebuild("stale")
		}
		return entries
	}
	s.mu.Unlock()
	return s.rebuild("initial")
}

func (s *Service) rebuild(reason string) []entry {
	s.mu.Lock()
	if s.building != nil {
		wait := s.building
		s.mu.Unlock()
		<-wait
		s.mu.Lock()
		defer s.mu.Unlock()
		return s.entries
	}
	done := make(chan struct{})
	s.building = done
	s.mu.Unlock()

	started := time.Now()
	entries := build()
	s.mu.Lock()
	if entries != nil || s.entries == nil {
		s.entries = entries
		s.builtAt = time.Now()
	}
	s.building = nil
	result := s.entries
	s.mu.Unlock()
	close(done)
	logx.Info("[apps] index built", "reason", reason, "apps", len(entries), "ms", time.Since(started).Milliseconds())
	return result
}

func build() []entry {
	installed, err := mygo.Shell.InstalledApps()
	if err != nil {
		logx.Warn("[apps] InstalledApps failed", "err", err)
	}
	installed = slices.DeleteFunc(installed, func(a mygo.InstalledApp) bool { return nestedApp.MatchString(a.Path) })
	paths := make([]string, len(installed))
	for i, app := range installed {
		paths[i] = app.Path
	}
	info := map[string]native.ApplicationInfo{}
	if records, err := native.ReadApplicationsInfo(paths, indexedLocales); err == nil {
		for _, r := range records {
			info[r.Path] = r
		}
	} else {
		logx.Warn("[apps] read Info.plist failed", "err", err)
	}

	entries := make([]entry, 0, len(installed))
	for _, app := range installed {
		meta := info[app.Path]
		fileName := filepath.Base(app.Path)
		fileBase := strings.TrimSuffix(fileName, filepath.Ext(fileName))
		name := cmp.Or(strings.TrimSpace(app.Name), meta.FileDisplayName, meta.DisplayName, meta.Name, fileBase)
		bundleID := strings.TrimSpace(meta.BundleID)
		if bundleID == "" && !strings.HasPrefix(app.ID, "/") {
			bundleID = app.ID
		}
		values := []string{name, meta.DisplayName, meta.Name, meta.FileDisplayName, fileBase}
		for _, localized := range meta.LocalizedNames {
			values = append(values, localized)
		}
		seen := map[string]bool{}
		var aliases []string
		add := func(v string) {
			if v = normalize(v); v != "" && !seen[v] {
				seen[v] = true
				aliases = append(aliases, v)
			}
		}
		for _, v := range values {
			add(v)
		}
		if id := normalize(bundleID); id != "" {
			add(id)
			for _, segment := range bundleIDSeparators.Split(id, -1) {
				if len(segment) >= 2 && !commonIDSegments[segment] {
					add(segment)
				}
			}
		}
		entries = append(entries, entry{app: app, name: name, fileName: fileName, bundleID: bundleID, aliases: aliases})
	}
	return entries
}

// Search ranks the apps against query.
func (s *Service) Search(query string, limit int) []Result {
	q := normalize(query)
	if q == "" {
		return []Result{}
	}
	if limit <= 0 {
		limit = 8
	}
	started := time.Now()
	entries := s.index()
	type ranked struct {
		e     *entry
		score int
	}
	var hits []ranked
	for i := range entries {
		best := 0
		for _, alias := range entries[i].aliases {
			best = max(best, scoreField(alias, q))
		}
		if best > 0 {
			hits = append(hits, ranked{&entries[i], best})
		}
	}
	slices.SortStableFunc(hits, func(a, b ranked) int {
		if a.score != b.score {
			return b.score - a.score
		}
		return strings.Compare(a.e.name, b.e.name)
	})
	if len(hits) > limit {
		hits = hits[:limit]
	}
	results := make([]Result, len(hits))
	for i, hit := range hits {
		results[i] = Result{
			Name:     hit.e.name,
			FileName: hit.e.fileName,
			BundleID: hit.e.bundleID,
			Path:     hit.e.app.Path,
			Icon:     s.icon(hit.e.app.Path),
		}
	}
	logx.Info("[apps] search", "query", q, "results", len(results), "ms", time.Since(started).Milliseconds())
	return results
}

func (s *Service) icon(path string) []byte {
	if cached, ok := s.icons.Load(path); ok {
		return cached.([]byte)
	}
	sum := sha1.Sum([]byte(path))
	file := settings.Path("app-icons", cacheVersion, hex.EncodeToString(sum[:])+"@"+strconv.Itoa(iconSize)+".png")
	data, err := os.ReadFile(file)
	if err != nil {
		_ = os.MkdirAll(filepath.Dir(file), 0o755)
		if ok := native.WriteApplicationIcons([]native.IconRequest{{AppPath: path, OutputPath: file}}, iconPixels); len(ok) == 1 && ok[0] {
			data, err = os.ReadFile(file)
		}
		if err != nil || len(data) == 0 {
			if data, err = mygo.Shell.FileIcon(path, iconPixels); err == nil && len(data) > 0 {
				_ = os.WriteFile(file, data, 0o644)
			}
		}
	}
	if len(data) == 0 {
		return nil
	}
	s.icons.Store(path, data)
	return data
}

// Open launches the app at path, or brings it to the front.
func (s *Service) Open(path string) bool {
	for _, e := range s.index() {
		if e.app.Path == path {
			if err := mygo.Shell.LaunchApp(e.app); err != nil {
				logx.Warn("[apps] launch failed", "path", path, "err", err)
				return mygo.Shell.OpenPath(path) == nil
			}
			return true
		}
	}
	return mygo.Shell.OpenPath(path) == nil
}
