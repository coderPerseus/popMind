package clipboard

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// TestLegacyData opens a copy of the Electron app's data (POPMIND_LEGACY_COPY) and uses it as the new app will.
func TestLegacyData(t *testing.T) {
	dir := os.Getenv("POPMIND_LEGACY_COPY")
	if dir == "" {
		t.Skip("set POPMIND_LEGACY_COPY")
	}
	s, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	total := s.Count()
	items, _ := s.Search(Query{Limit: 200})
	t.Logf("items %d, listed %d", total, len(items))
	if total < 1000 || len(items) != 200 {
		t.Fatal("history not read")
	}
	kinds := map[string]int{}
	thumbs, details := 0, 0
	for _, it := range items {
		kinds[it.Kind]++
		if d, err := s.Detail(it.ID); err == nil && d.ID == it.ID {
			details++
		}
		if it.Kind == KindImage && len(s.Thumbnail(it)) > 0 {
			thumbs++
		}
	}
	t.Logf("kinds %v, details %d, image thumbs %d", kinds, details, thumbs)
	if details != len(items) {
		t.Fatal("details missing")
	}
	if kinds[KindImage] > 0 && thumbs == 0 {
		t.Fatal("no image thumbnails")
	}
	found, _ := s.Search(Query{Text: "https", Limit: 20})
	t.Logf("search https: %d", len(found))
	t.Logf("pinboards %d, apps %d, sync known %d", len(s.Pinboards()), len(s.Apps()), len(s.SyncKnownKeys()))
	id, err := s.CreateText("written by the new app " + time.Now().String())
	if err != nil {
		t.Fatal(err)
	}
	if s.Count() != total+1 {
		t.Fatal("new item not stored")
	}
	_, _ = s.Delete([]string{id})
	if _, err := os.Stat(filepath.Join(dir, "clipboard", "clipboard.sqlite")); err != nil {
		t.Fatal(err)
	}
}
