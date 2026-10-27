package clipsync

import (
	"bytes"
	"context"
	"fmt"
	"image"
	"image/color"
	"image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"sort"
	"strings"
	"sync"
	"testing"
	"time"

	"popmind/internal/clipboard"
)

// fakeR2 is an in-memory S3 bucket: ListObjectsV2, GET, HEAD and PUT.
type fakeR2 struct {
	mu      sync.Mutex
	objects map[string][]byte
	puts    int
}

func (f *fakeR2) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.mu.Lock()
	defer f.mu.Unlock()
	key := strings.TrimPrefix(r.URL.Path, "/popmind-sync")
	key = strings.TrimPrefix(key, "/")
	switch {
	case r.Method == http.MethodGet && key == "":
		prefix := r.URL.Query().Get("prefix")
		var keys []string
		for k := range f.objects {
			if strings.HasPrefix(k, prefix) {
				keys = append(keys, k)
			}
		}
		sort.Strings(keys)
		fmt.Fprint(w, "<ListBucketResult><IsTruncated>false</IsTruncated>")
		for _, k := range keys {
			fmt.Fprintf(w, "<Contents><Key>%s</Key><LastModified>2026-01-02T03:04:05.000Z</LastModified><Size>%d</Size></Contents>", k, len(f.objects[k]))
		}
		fmt.Fprint(w, "</ListBucketResult>")
	case r.Method == http.MethodGet, r.Method == http.MethodHead:
		data, ok := f.objects[key]
		if !ok {
			w.WriteHeader(404)
			fmt.Fprint(w, "<Error><Code>NoSuchKey</Code></Error>")
			return
		}
		if r.Method == http.MethodGet {
			w.Write(data)
		}
	case r.Method == http.MethodPut:
		data, _ := io.ReadAll(r.Body)
		f.objects[key] = data
		f.puts++
	}
}

func samplePNG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 8, 6))
	for i := range img.Pix {
		img.Pix[i] = byte(i)
	}
	img.Set(0, 0, color.RGBA{255, 0, 0, 255})
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func TestSyncBetweenTwoMacs(t *testing.T) {
	fake := &fakeR2{objects: map[string][]byte{}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	creds := Credentials{AccountID: "0123456789abcdef0123456789abcdef", Bucket: "popmind-sync", AccessKeyID: "k",
		SecretAccessKey: "s", EncryptionKey: bytes.Repeat([]byte{3}, 32)}
	opts := func(s *clipboard.Store) Options {
		r := NewR2(creds)
		r.Endpoint = srv.URL
		return Options{Store: s, Remote: r, Credentials: creds, Range: "all", MaxImage: 10 << 20, StartedAt: time.Now().UnixMilli()}
	}

	a, _ := clipboard.Open(t.TempDir())
	b, _ := clipboard.Open(t.TempDir())
	textID, _ := a.CreateText("hello from Mac A")
	_, _ = a.CreateText("https://github.com/egoist/mygo")
	pngData := samplePNG()
	imgID, _, err := a.Ingest(clipboard.Record{Kind: clipboard.KindImage, Fingerprint: "img:x", ImagePNG: pngData, ImageWidth: 8, ImageHeight: 6,
		Reps: []clipboard.Representation{{UTI: "public.png", Data: pngData}}, ByteSize: int64(len(pngData)), CopiedAt: time.Now().UnixMilli()})
	if err != nil {
		t.Fatal(err)
	}
	_ = a.Rename(textID, "greeting")
	pb, _ := a.CreatePinboard("工作", "orange")
	_ = a.AddToPinboard(pb.ID, []string{textID, imgID})

	sumA := Run(context.Background(), opts(a))
	if !sumA.OK || sumA.Uploaded != 3 {
		t.Fatalf("A: %+v", sumA)
	}
	sumB := Run(context.Background(), opts(b))
	if !sumB.OK || sumB.Received != 3 || sumB.PinboardsChange != 1 || sumB.Uploaded != 0 {
		t.Fatalf("B: %+v", sumB)
	}
	items, _ := b.Search(clipboard.Query{Limit: 50})
	if len(items) != 3 {
		t.Fatalf("B has %d items", len(items))
	}
	var gotImage, gotTitle bool
	for _, it := range items {
		gotImage = gotImage || (it.Kind == clipboard.KindImage && it.ImageWidth == 8 && len(b.Thumbnail(it)) > 0)
		gotTitle = gotTitle || it.CustomTitle == "greeting"
	}
	if !gotImage || !gotTitle {
		t.Fatalf("image %v title %v", gotImage, gotTitle)
	}
	pins := b.Pinboards()
	if len(pins) != 1 || pins[0].Name != "工作" || pins[0].ItemCount != 2 {
		t.Fatalf("pinboards %+v", pins)
	}

	// Nothing new: no uploads, no downloads.
	puts := fake.puts
	again := Run(context.Background(), opts(a))
	if !again.OK || again.Uploaded != 0 || again.Received != 0 || fake.puts != puts {
		t.Fatalf("second run %+v puts %d→%d", again, puts, fake.puts)
	}
	// B copies something new: A receives just that.
	_, _ = b.CreateText("reply from Mac B")
	Run(context.Background(), opts(b))
	if s := Run(context.Background(), opts(a)); s.Received != 1 {
		t.Fatalf("A received %d", s.Received)
	}

	// A wrong key is told apart.
	wrong := creds
	wrong.EncryptionKey = bytes.Repeat([]byte{9}, 32)
	r := NewR2(wrong)
	r.Endpoint = srv.URL
	if s := Run(context.Background(), Options{Store: a, Remote: r, Credentials: wrong, Range: "all"}); s.ErrorCode != ErrWrongKey {
		t.Fatalf("wrong key: %+v", s)
	}
}

// Right click → Sync to remote: the chosen item goes up at once, alone, whatever the range; again, it is
// already there.
func TestPushSingleItem(t *testing.T) {
	fake := &fakeR2{objects: map[string][]byte{}}
	srv := httptest.NewServer(fake)
	defer srv.Close()
	creds := Credentials{AccountID: "0123456789abcdef0123456789abcdef", Bucket: "popmind-sync", AccessKeyID: "k",
		SecretAccessKey: "s", EncryptionKey: bytes.Repeat([]byte{5}, 32)}
	opts := func(s *clipboard.Store) Options {
		r := NewR2(creds)
		r.Endpoint = srv.URL
		return Options{Store: s, Remote: r, Credentials: creds, Range: "none", MaxImage: 10 << 20, StartedAt: time.Now().UnixMilli()}
	}
	a, _ := clipboard.Open(t.TempDir())
	b, _ := clipboard.Open(t.TempDir())
	chosen, _ := a.CreateText("only this one")
	_, _ = a.CreateText("not this one")

	res := Push(context.Background(), opts(a), []string{chosen})
	if !res.OK || res.Uploaded != 1 {
		t.Fatalf("push %+v", res)
	}
	if again := Push(context.Background(), opts(a), []string{chosen}); !again.OK || again.Existing != 1 || again.Uploaded != 0 {
		t.Fatalf("second push %+v", again)
	}
	sum := Run(context.Background(), opts(b))
	items, _ := b.Search(clipboard.Query{Limit: 10})
	if !sum.OK || sum.Received != 1 || len(items) != 1 || items[0].Preview != "only this one" {
		t.Fatalf("B received %+v %d", sum, len(items))
	}
}
