package translation

import (
	"context"
	"os"
	"testing"
	"time"
)

func TestLanguageRules(t *testing.T) {
	if got := GuessSourceLanguage("你好世界"); got != "zh-CN" {
		t.Errorf("guess zh = %s", got)
	}
	if got := GuessSourceLanguage("hello world"); got != "en" {
		t.Errorf("guess en = %s", got)
	}
	if got := QueryMode("serendipity", "auto"); got != "word" {
		t.Errorf("word mode = %s", got)
	}
	if got := QueryMode("hello world", "auto"); got != "text" {
		t.Errorf("text mode = %s", got)
	}
	if got := NormalizeText("getUserName"); got != "get user name" {
		t.Errorf("normalize = %q", got)
	}
	if got := NormalizeText("MAX_RETRY_COUNT"); got != "MAX RETRY COUNT" {
		t.Errorf("normalize = %q", got)
	}
}

// Live engine checks; run with POPMIND_LIVE=1.
func TestLiveEngines(t *testing.T) {
	if os.Getenv("POPMIND_LIVE") == "" {
		t.Skip("set POPMIND_LIVE=1 to call the translation web endpoints")
	}
	for _, id := range []string{Google, Bing, DeepL, Youdao} {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		res, err := engines[id].translate(ctx, Request{Text: "Good morning, how are you?", SourceLanguage: "auto", TargetLanguage: "zh-CN", QueryMode: "text"}, settingsZero)
		cancel()
		t.Logf("%s: %q detected=%s err=%v", id, res.TranslatedText, res.DetectedSourceLanguage, err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	res, err := youdaoTranslate(ctx, Request{Text: "serendipity", SourceLanguage: "auto", TargetLanguage: "zh-CN", QueryMode: "word"})
	if err == nil {
		t.Logf("youdao word: %s %v %v", res.Word.Headword, res.Word.Phonetics, res.Word.Definitions)
	} else {
		t.Logf("youdao word err: %v", err)
	}
}

var settingsZero = settingsCapability()
