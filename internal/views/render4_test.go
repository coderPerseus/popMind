package views

import (
	"bytes"
	"image"
	"image/color"
	"image/png"
	"os"
	"testing"
	"time"

	"github.com/egoist/mygo/ui"

	"popmind/internal/clipboard"
)

func samplePNG(w, h int) []byte {
	img := image.NewRGBA(image.Rect(0, 0, w, h))
	for y := 0; y < h; y++ {
		for x := 0; x < w; x++ {
			img.Set(x, y, color.RGBA{uint8(40 + x*180/w), uint8(90 + y*120/h), 200, 255})
		}
	}
	var b bytes.Buffer
	_ = png.Encode(&b, img)
	return b.Bytes()
}

func TestRenderClipboardPanel(t *testing.T) {
	if os.Getenv("POPMIND_RENDER_DIR") == "" {
		t.Skip("set POPMIND_RENDER_DIR to render")
	}
	store, err := clipboard.Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	ts := time.Now().UnixMilli()
	add := func(rec clipboard.Record, ago time.Duration, app, name string) string {
		rec.CopiedAt = ts - ago.Milliseconds()
		rec.SourceID, rec.SourceName = app, name
		id, _, err := store.Ingest(rec)
		if err != nil {
			t.Fatal(err)
		}
		return id
	}
	pngData := samplePNG(640, 400)
	add(clipboard.Record{Kind: clipboard.KindImage, Fingerprint: "img:sample", ImagePNG: pngData, ImageWidth: 640, ImageHeight: 400,
		Title: "Image 640×400", Preview: "Image 640×400", ByteSize: int64(len(pngData))}, 50*time.Hour, "com.apple.Safari", "Safari")
	add(clipboard.Record{Kind: clipboard.KindFile, Fingerprint: "file:sample", FilePaths: []string{"/Users/demo/Documents/季度报告-2026-Q3-final-version.pdf", "/Users/demo/Desktop/notes.md", "/Users/demo/Desktop/logo.png"},
		Title: "季度报告-2026-Q3-final-version.pdf", Preview: "3 files", ByteSize: 2_400_000}, 26*time.Hour, "com.apple.finder", "Finder")
	add(clipboard.TextRecord("#FF6B35", 0), 3*time.Hour, "com.figma.Desktop", "Figma")
	add(clipboard.TextRecord("func main() {\n\tfmt.Println(\"hello, popMind\")\n\tfor i := 0; i < 3; i++ {\n\t\tlog.Print(i)\n\t}\n}", 0), 40*time.Minute, "com.microsoft.VSCode", "Code")
	add(clipboard.TextRecord("api_key = sk-proj-AbCdEfGhIjKlMnOpQrStUvWxYz0123456789", 0), 20*time.Minute, "com.apple.Terminal", "Terminal")
	linkID := add(clipboard.TextRecord("https://github.com/egoist/mygo", 0), 8*time.Minute, "com.google.Chrome", "Chrome")
	add(clipboard.TextRecord("https://www.example.com/articles/2026/10/very-long-path-for-a-link-card?ref=popmind", 0), 6*time.Minute, "com.google.Chrome", "Chrome")
	textID := add(clipboard.TextRecord("向量数据库（Vector Database）是专门用来存储、索引和检索高维向量的数据库。它通过近似最近邻（ANN）算法，在海量 embedding 中快速找到语义上最相似的内容，是 RAG、推荐系统和图片搜索的基础设施。", 0), time.Minute, "com.tencent.xinWeChat", "WeChat")
	pb, _ := store.CreatePinboard("工作", "orange")
	_ = store.AddToPinboard(pb.ID, []string{textID, linkID})
	_ = store.Rename(linkID, "myGo — Go 原生桌面框架")
	pb2, _ := store.CreatePinboard("灵感", "purple")
	_ = pb2

	newPanel := func(appearance string) *ClipboardPanel {
		p := &ClipboardPanel{store: store, selected: map[string]bool{}, cardRects: map[string]ui.Rect{},
			thumbs: map[string]*ui.Bitmap{}, icons: map[string]*ui.Bitmap{}, fileIcons: map[string]*ui.Bitmap{},
			previews: map[string]*clipPreview{}, appearance: appearance, shownAt: time.Now()}
		p.items, _ = store.Search(clipboard.Query{Limit: 200})
		p.pins, p.apps = store.Pinboards(), store.Apps()
		p.selectOnly(p.items[0].ID)
		return p
	}
	const w, h = 1500, 340

	p := newPanel("dark")
	save(t, "clip-dark", p.view, w, h)

	p = newPanel("light")
	save(t, "clip-light", p.view, w, h)

	p = newPanel("dark")
	p.extendTo(p.items[2].ID)
	p.filterRow, p.kind, p.date = true, "", "today"
	p.toast = &clipToast{text: "已删除 1 项", action: "撤销", undo: "x", until: time.Now().Add(time.Minute)}
	save(t, "clip-multi-filter", p.view, w, h+40)

	p = newPanel("dark")
	p.quickLook, p.qlSeen = true, true
	p.detail, _ = store.Detail(p.active)
	p.detailID = p.active
	save(t, "clip-quicklook", p.view, w, 560)

	p = newPanel("light")
	p.dialog = clipDialog{kind: "newPinboard", open: true, seen: true, color: "blue", text: "设计稿"}
	save(t, "clip-dialog-pinboard", p.view, w, h)

	p = newPanel("light")
	p.dialog = clipDialog{kind: "edit", open: true, seen: true, item: p.items[0], text: "向量数据库（Vector Database）是专门用来存储……"}
	save(t, "clip-dialog-edit", p.view, w, 420)
}
