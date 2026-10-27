package clipboard

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestEditAndCreate(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	id, err := s.CreateText("hello world")
	if err != nil {
		t.Fatal(err)
	}
	other, _ := s.CreateText("https://example.com")
	if err := s.UpdateText(id, "https://example.com"); err != nil {
		t.Fatal(err)
	}
	items := s.Items([]string{id, other})
	if len(items) != 1 || items[0].Kind != KindLink || items[0].CopyCount != 2 {
		t.Fatalf("merge: %+v", items)
	}
	if found, _ := s.Search(Query{Text: "example"}); len(found) != 1 {
		t.Fatalf("search after edit: %d", len(found))
	}
	if _, err := s.CreateText("   "); err == nil {
		t.Fatal("empty text accepted")
	}
}

func TestPresetRange(t *testing.T) {
	now := time.Date(2026, 10, 29, 15, 0, 0, 0, time.Local) // a Thursday
	from, to := PresetRange("this_week", now)
	if time.UnixMilli(from).Day() != 26 || time.UnixMilli(to).Day() != 2 {
		t.Fatal(time.UnixMilli(from), time.UnixMilli(to))
	}
	from, to = PresetRange("yesterday", now)
	if time.UnixMilli(from).Day() != 28 || time.UnixMilli(to).Day() != 29 {
		t.Fatal(from, to)
	}
}

func TestLinkPreview(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		fmt.Fprint(w, `<html><head><title>Fallback</title><meta property="og:title" content="myGo &amp; Go"><meta property="og:site_name" content="GitHub"></head></html>`)
	}))
	defer srv.Close()
	s, _ := Open(t.TempDir())
	p := s.fetchPreview(srv.URL)
	if p.Status != "ready" || p.Title != "myGo & Go" || p.SiteName != "GitHub" {
		t.Fatalf("%+v", p)
	}
	if got := s.loadPreview(srv.URL); got == nil || got.Title != p.Title {
		t.Fatal("not stored")
	}
	for _, u := range []string{"http://localhost:3000", "https://x.com/logout", "https://a.com/?token=1", "http://192.168.1.2"} {
		if PreviewSkipReason(u) == "" {
			t.Fatal("not skipped:", u)
		}
	}
	if PreviewSkipReason("https://github.com/egoist/mygo") != "" {
		t.Fatal("skipped a public link")
	}
}
