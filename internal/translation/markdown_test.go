package translation

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"
)

const sampleMD = "# Getting Started\n\nInstall the **CLI** with `npm i -g foo` and read [the docs](https://example.com/docs \"Docs\").\n\n- First item\n- [ ] Second item with https://example.com/a\n  1. Nested step\n\n> A quote line\n\n| Name | Description |\n| --- | :---: |\n| `foo` | Runs the server |\n\n```go\n// keep me\nfunc main() {\n    fmt.Println(\"hi\")\n}\n```\n\n---\n\n![logo](https://example.com/logo.png)\n\n    indented code stays"

func TestLooksLikeMarkdown(t *testing.T) {
	for _, s := range []string{sampleMD, "- a\n- b", "see **this** and `that`", "| a | b |\n|---|---|"} {
		if !LooksLikeMarkdown(s) {
			t.Error("not markdown:", s)
		}
	}
	for _, s := range []string{"Hello world.", "I think - well - maybe.", "Use *args in Python", "1. Not really a list"} {
		if LooksLikeMarkdown(s) {
			t.Error("markdown:", s)
		}
	}
}

func TestTranslateMarkdownKeepsStructure(t *testing.T) {
	fake := func(_ context.Context, r Request) (Result, error) {
		return Result{TranslatedText: "译:" + strings.ReplaceAll(r.Text, "\n", "\n译:"), DetectedSourceLanguage: "en"}, nil
	}
	res, err := translateMarkdown(context.Background(), fake, Request{Text: sampleMD})
	if err != nil {
		t.Fatal(err)
	}
	out := res.TranslatedText
	for _, want := range []string{"# 译:Getting Started", "`npm i -g foo`", "](https://example.com/docs \"Docs\")", "- 译:First item",
		"- [ ] 译:Second item with https://example.com/a", "  1. 译:Nested step", "> 译:A quote line", "| --- | :---: |",
		"| `foo` |", "// keep me\nfunc main() {\n    fmt.Println(\"hi\")", "\n---\n", "![logo](https://example.com/logo.png)",
		"    indented code stays"} {
		if !strings.Contains(out, want) {
			t.Errorf("missing %q in\n%s", want, out)
		}
	}
	if strings.Contains(out, "{{") || strings.Contains(out, "\x00") {
		t.Errorf("placeholder left:\n%s", out)
	}
}

func TestLiveMarkdown(t *testing.T) {
	if os.Getenv("LIVE") == "" {
		t.Skip()
	}
	for name, fn := range map[string]func(context.Context, Request) (Result, error){"google": googleTranslate, "bing": bingTranslate, "deepl": deeplTranslate} {
		ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
		res, err := translateMarkdown(ctx, fn, Request{Text: sampleMD, SourceLanguage: "en", TargetLanguage: "zh-CN", QueryMode: "text"})
		cancel()
		t.Logf("== %s err=%v\n%s", name, err, res.TranslatedText)
	}
}
