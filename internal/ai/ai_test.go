package ai

import (
	"strings"
	"testing"
)

func TestReadSSE(t *testing.T) {
	stream := "data: {\"a\":1}\n\n: comment\ndata: {\"a\":2}\n\ndata: [DONE]\n\ndata: {\"a\":3}\n\n"
	var got []string
	err := readSSE(strings.NewReader(stream), func(b []byte) error { got = append(got, string(b)); return nil })
	if err != nil || len(got) != 2 || got[1] != `{"a":2}` {
		t.Fatalf("readSSE = %v, %v", got, err)
	}
}

func TestNormalizeBaseURL(t *testing.T) {
	for in, want := range map[string]string{
		"https://api.example.com/v1/chat/completions": "https://api.example.com/v1",
		"https://api.example.com/v1/":                 "https://api.example.com/v1",
		"":                                            "",
	} {
		if got := normalizeOpenAIBaseURL(in); got != want {
			t.Errorf("normalize(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestExtractJSON(t *testing.T) {
	var v struct {
		TranslatedText string `json:"translatedText"`
	}
	if err := ExtractJSON("```json\n{\"translatedText\":\"你好\"}\n```", &v); err != nil || v.TranslatedText != "你好" {
		t.Fatalf("ExtractJSON = %+v, %v", v, err)
	}
}
