package views

import (
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo/ui"

	"popmind/internal/apps"
	"popmind/internal/translation"
)

// TestRenderLauncher writes PNGs of the launcher's states to $POPMIND_RENDER_DIR, to look at.
func TestRenderLauncher(t *testing.T) {
	dir := os.Getenv("POPMIND_RENDER_DIR")
	if dir == "" {
		t.Skip("set POPMIND_RENDER_DIR to render")
	}
	newL := func(query string) *Launcher {
		l := &Launcher{app: &App{}, icons: map[string]*ui.Bitmap{}, placeholder: "搜应用，直接输入"}
		l.translator.Reset()
		l.translator.Update = func(fn func()) { fn() }
		l.query = query
		return l
	}
	cases := map[string]func() *Launcher{
		"empty": func() *Launcher { return newL("") },
		"apps": func() *Launcher {
			l := newL("we")
			l.results = []apps.Result{{Name: "WeChat", Path: "/Applications/WeChat.app"}, {Name: "Weather", Path: "/System/Applications/Weather.app"}}
			return l
		},
		"calc":     func() *Launcher { return newL("/cal (12 + 8) * 3 / 2") },
		"mathauto": func() *Launcher { return newL("1200*3+4") },
		"plugin":   func() *Launcher { return newL("/google mygo framework") },
		"translate": func() *Launcher {
			l := newL("/tr serendipity")
			l.translator.Text = "serendipity"
			l.translator.Status = "success"
			l.translator.Result = translation.Result{Engine: "youdao", TranslatedText: "n. 意外发现", TargetLanguage: "zh-CN",
				DetectedSourceLanguage: "en", Word: &translation.WordEntry{Headword: "serendipity",
					Phonetics:   []translation.WordPhonetic{{Label: "US", Value: "ˌserənˈdɪpəti"}},
					Definitions: []translation.WordDefinition{{Part: "n.", Meaning: "意外发现美好事物的运气，机缘巧合"}}}}
			return l
		},
		"translate-text": func() *Launcher {
			l := newL("/tr Good morning, how are you?")
			l.translator.Text = "Good morning, how are you?"
			l.translator.Status = "success"
			l.translator.Result = translation.Result{Engine: "bing", TranslatedText: "早上好，你好吗？", SourceText: "Good morning, how are you?",
				TargetLanguage: "zh-CN", DetectedSourceLanguage: "en"}
			return l
		},
	}
	for name, mk := range cases {
		l := mk()
		img := ui.Render(l.view, launcherWidth, launcherHeight, 2)
		f, err := os.Create(filepath.Join(dir, "launcher-"+name+".png"))
		if err != nil {
			t.Fatal(err)
		}
		_ = png.Encode(f, img)
		f.Close()
	}
}
