package clipboard

import (
	"os"
	"testing"
	"time"
)

func TestStore(t *testing.T) {
	s, err := Open(t.TempDir())
	if err != nil {
		t.Skipf("sqlite unavailable: %v", err)
	}
	defer s.Close()
	rec := TextRecord("hello vector database", now())
	rec.SourceID, rec.SourceName = "com.apple.Safari", "Safari"
	id, inserted, err := s.Ingest(rec)
	if err != nil || !inserted {
		t.Fatalf("ingest = %v %v", inserted, err)
	}
	if id2, inserted2, _ := s.Ingest(rec); id2 != id || inserted2 {
		t.Fatalf("same text should bump: %v %v", id2, inserted2)
	}
	link := TextRecord("https://github.com/egoist/mygo", now())
	if link.Kind != KindLink {
		t.Fatalf("kind = %s", link.Kind)
	}
	s.Ingest(link)
	s.Ingest(TextRecord("#ff8800", now()))
	for q, want := range map[string]int{"": 3, "vector": 1, "ve": 1, "type:link": 1, "app:safari": 1, "今天": 3, "type:color": 1} {
		items, _ := s.Search(Query{Text: q})
		if len(items) != want {
			t.Errorf("search %q = %d items, want %d", q, len(items), want)
		}
	}
	items, _ := s.Search(Query{Text: "vector"})
	if items[0].SourceName != "Safari" || items[0].Title != "hello vector database" {
		t.Errorf("item = %+v", items[0])
	}
	p, _ := s.CreatePinboard("Work", "blue")
	s.AddToPinboard(p.ID, []string{id})
	if got, _ := s.Search(Query{PinboardID: p.ID}); len(got) != 1 {
		t.Errorf("pinboard items = %d", len(got))
	}
	token, _ := s.Delete([]string{id})
	if got, _ := s.Search(Query{Text: "vector"}); len(got) != 0 {
		t.Errorf("deleted item still found")
	}
	s.Undo(token)
	if got, _ := s.Search(Query{Text: "vector"}); len(got) != 1 {
		t.Errorf("undo failed")
	}
	groups, kind, err := s.WriteItems(id, false)
	if err != nil || kind != KindText || len(groups) != 1 || string(groups[0][0].Data) != "hello vector database" {
		t.Errorf("write items = %v %v %v", groups, kind, err)
	}
	if n := s.ClearHistory(); n != 2 {
		t.Errorf("clear = %d, want 2 (the pinned one stays)", n)
	}
	time.Sleep(10 * time.Millisecond)
	_ = os.Remove("")
}

func TestClassify(t *testing.T) {
	for text, kind := range map[string]string{"#fff": KindColor, "abcdef": KindColor, "235442": KindText, "https://x.com/a": KindLink, "hello": KindText} {
		if got := classifyText(text, "").kind; got != kind {
			t.Errorf("classify(%q) = %s, want %s", text, got, kind)
		}
	}
	if findSecret("token = abcdefghijklmnopqrstuvwxyz123") == "" {
		t.Error("labeled secret not found")
	}
}
