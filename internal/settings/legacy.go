package settings

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"sync"
	"time"

	"popmind/internal/jsonx"
	"popmind/internal/logx"
)

// The Electron popMind's settings come over by themselves: on every start (and from the settings' button) each
// settings file of the old app is merged into popMind's three ways, as git merges: base is what was taken from
// the old app last time (the defaults the first time), ours popMind's file, theirs the old app's.
//   - changed only in the old app: taken
//   - changed only here: kept
//   - changed in both: the side saved last wins; lists of names are joined instead
// The clipboard history is not copied: it comes through clipboard sync.

var legacyFiles = []string{capabilityFile, "theme-settings.json", blockedAppsFile}

// LegacyReport says what a merge took from the old app.
type LegacyReport struct {
	Found   bool
	Changed int // settings taken
	At      time.Time
}

var (
	legacyMu   sync.Mutex
	lastReport LegacyReport
)

// LastLegacyImport is the report of the last merge.
func LastLegacyImport() LegacyReport {
	legacyMu.Lock()
	defer legacyMu.Unlock()
	return lastReport
}

// LegacyAvailable reports whether the old app's settings exist on this Mac, apart from popMind's own (the
// installed app uses the old app's folder itself: nothing to merge).
func LegacyAvailable() bool {
	if SharesLegacyDir() {
		return false
	}
	_, err := os.Stat(filepath.Join(LegacyDir(), capabilityFile))
	return err == nil
}

// SharesLegacyDir reports whether popMind's data folder is the old app's (the installed app).
func SharesLegacyDir() bool {
	a, err1 := os.Stat(LegacyDir())
	b, err2 := os.Stat(DataDir())
	return err1 == nil && err2 == nil && os.SameFile(a, b)
}

func snapshotPath(name string) string { return Path("legacy-import", name) }

func readJSONAny(path string) (any, time.Time, bool) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, time.Time{}, false
	}
	var v any
	if json.Unmarshal(data, &v) != nil {
		return nil, time.Time{}, false
	}
	info, _ := os.Stat(path)
	return v, info.ModTime(), true
}

// mergeLegacyFile merges one file; it returns the merged value when popMind's file should change, and how many
// settings were taken.
func mergeLegacyFile(name string) (merged any, changed int, write bool) {
	theirs, theirsAt, ok := readJSONAny(filepath.Join(LegacyDir(), name))
	if !ok {
		return nil, 0, false
	}
	base, _, hasBase := readJSONAny(snapshotPath(name))
	if hasBase && reflect.DeepEqual(base, theirs) {
		return nil, 0, false // nothing new in the old app since last time
	}
	ours, oursAt, hasOurs := readJSONAny(Path(name))
	if !hasBase && name == capabilityFile {
		base = jsonx.Clone(defaults())
		if hasOurs {
			// What popMind would hold untouched: the defaults as its normalization writes them.
			base = normalize(jsonx.Merge(defaults(), map[string]any{}).(map[string]any), map[string]any{})
		}
	}
	if !hasOurs {
		_ = writeSnapshot(name, theirs)
		return theirs, countLeaves(theirs), true
	}
	merged = merge3(base, ours, theirs, theirsAt.After(oursAt), &changed)
	_ = writeSnapshot(name, theirs)
	return merged, changed, changed > 0
}

func writeSnapshot(name string, v any) error {
	return jsonx.WriteFile(snapshotPath(name), v)
}

// ImportLegacy merges every settings file of the old app into popMind's; live is true once the app runs (the
// capability settings then go through Update, which tells the app).
func ImportLegacy(live bool) LegacyReport {
	report := LegacyReport{Found: LegacyAvailable(), At: time.Now()}
	if !report.Found {
		return report
	}
	for _, name := range legacyFiles {
		merged, changed, write := mergeLegacyFile(name)
		if !write {
			continue
		}
		report.Changed += changed
		if live && name == capabilityFile {
			if m, ok := merged.(map[string]any); ok {
				_, _ = Capabilities.Update(m)
			}
			continue
		}
		_ = jsonx.WriteFile(Path(name), merged)
		if name == blockedAppsFile {
			Blocked.reload()
		}
	}
	legacyMu.Lock()
	lastReport = report
	legacyMu.Unlock()
	if report.Found {
		logx.Info("[settings] merged the old popMind's settings", "taken", report.Changed)
	}
	return report
}

func countLeaves(v any) int {
	if m, ok := v.(map[string]any); ok {
		n := 0
		for _, x := range m {
			n += countLeaves(x)
		}
		return n
	}
	return 1
}

// merge3 merges theirs into ours over base, counting what it takes from theirs.
func merge3(base, ours, theirs any, preferTheirs bool, taken *int) any {
	bm, _ := base.(map[string]any)
	om, oursMap := ours.(map[string]any)
	tm, theirsMap := theirs.(map[string]any)
	if oursMap && theirsMap {
		out := make(map[string]any, len(om))
		for k, v := range om {
			out[k] = v
		}
		for k, tv := range tm {
			ov, has := om[k]
			if !has {
				if _, inBase := bm[k]; !inBase || !reflect.DeepEqual(bm[k], tv) {
					out[k] = tv
					*taken += countLeaves(tv)
				}
				continue
			}
			out[k] = merge3(bm[k], ov, tv, preferTheirs, taken)
		}
		return out
	}
	switch {
	case reflect.DeepEqual(ours, theirs):
		return ours
	case reflect.DeepEqual(ours, base):
		*taken++
		return theirs
	case reflect.DeepEqual(theirs, base):
		return ours
	}
	// Both changed: lists of names are joined, other values follow the side saved last.
	if ol, ok := ours.([]any); ok {
		if tl, ok := theirs.([]any); ok && allStrings(ol) && allStrings(tl) {
			out := append([]any{}, ol...)
			for _, x := range tl {
				if !containsValue(out, x) {
					out = append(out, x)
					*taken++
				}
			}
			return out
		}
	}
	if preferTheirs {
		*taken++
		return theirs
	}
	return ours
}

func allStrings(v []any) bool {
	for _, x := range v {
		if _, ok := x.(string); !ok {
			return false
		}
	}
	return true
}

func containsValue(v []any, x any) bool {
	for _, y := range v {
		if y == x {
			return true
		}
	}
	return false
}
