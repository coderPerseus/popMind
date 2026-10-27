package views

import (
	"image/png"
	"os"
	"path/filepath"
	"testing"

	"github.com/egoist/mygo/ui"

	"popmind/internal/chat"
	"popmind/internal/textpicker"
	"popmind/internal/translation"
	"popmind/internal/websearch"
)

func save(t *testing.T, name string, view func(*ui.Context), w, h int) {
	dir := os.Getenv("POPMIND_RENDER_DIR")
	f, err := os.Create(filepath.Join(dir, name+".png"))
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	_ = png.Encode(f, ui.Render(view, w, h, 2))
}

func TestRenderPopups(t *testing.T) {
	if os.Getenv("POPMIND_RENDER_DIR") == "" {
		t.Skip("set POPMIND_RENDER_DIR to render")
	}
	b := &Bubble{skills: skillsFor("vector database"), picked: textpicker.Picked{Text: "vector database"}}
	b.buttons = buttonsFor(b.skills)
	save(t, "bubble", b.view, b.rowWidth(b.buttons, nil), bubbleHeight)
	b.used = map[string]bool{"translate": true, "copy": true, "logo": true}
	save(t, "bubble-used", b.view, b.rowWidth(b.buttons, b.used), bubbleHeight)
	bl := &Bubble{skills: skillsFor("https://github.com/egoist/mygo")}
	bl.buttons = buttonsFor(bl.skills)
	save(t, "bubble-link", bl.view, bl.rowWidth(bl.buttons, nil), bubbleHeight)

	p := &TranslatePopup{}
	p.tr.Reset()
	p.tr.Update = func(fn func()) { fn() }
	p.tr.Text, p.tr.Status = "The quick brown fox jumps over the lazy dog.", "success"
	p.tr.Result = translation.Result{Engine: "bing", TranslatedText: "敏捷的棕色狐狸跳过了那只懒狗。",
		SourceText: "The quick brown fox jumps over the lazy dog.", TargetLanguage: "zh-CN", DetectedSourceLanguage: "en"}
	save(t, "translate-popup", p.view, translateWidth, translateHeight)

	pm := &TranslatePopup{}
	pm.tr.Reset()
	pm.tr.Update = func(fn func()) { fn() }
	src := "# Getting Started\n\nInstall the **CLI** with `npm i -g foo` and read [the docs](https://example.com/docs).\n\n- First item\n- Second item\n\n| Name | Description |\n| --- | --- |\n| `foo` | Runs the server |\n\n```go\nfunc main() {\n    fmt.Println(\"hi\")\n}\n```"
	pm.tr.Text, pm.tr.Status = src, "success"
	pm.tr.Result = translation.Result{Engine: "google", Markdown: true, SourceText: src, TargetLanguage: "zh-CN", DetectedSourceLanguage: "en",
		TranslatedText: "# 开始使用\n\n使用 `npm i -g foo` 安装 **CLI** 并阅读[文档](https://example.com/docs)。\n\n- 第一项\n- 第二项\n\n| 名称 | 描述 |\n| --- | --- |\n| `foo` | 运行服务器 |\n\n```go\nfunc main() {\n    fmt.Println(\"hi\")\n}\n```"}
	save(t, "translate-popup-md", pm.view, translateWidth, 640)

	w := &ChatWindow{conv: newConversation()}
	s := &chat.Session{Update: func(fn func()) { fn() }, Mode: "explain", SelectionText: "vector database",
		Status: chat.StatusReady, Provider: "deepseek", ModelID: "deepseek-chat", WebSearch: true, SearchProvider: "tavily"}
	s.Messages = []*chat.Message{
		{ID: "1", Role: "user", Text: "vector database", Done: true},
		{ID: "2", Role: "assistant", Done: true, Text: "**向量数据库**用来存储和检索向量（embedding）。\n\n- 支持相似度搜索\n- 常用于 RAG\n\n```python\nindex.search(query, k=5)\n```",
			Sources: []websearch.Result{{Title: "Milvus", URL: "https://milvus.io"}}},
	}
	s.SetImage(samplePNG(320, 200))
	s.ImageState = "sent"
	w.conv.Session = s
	save(t, "chat", w.view, chatWidth, chatHeight)
}
