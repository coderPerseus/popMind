package chat

import (
	"strings"
	"testing"

	"popmind/internal/websearch"
)

func TestBuildPrompt(t *testing.T) {
	msgs := []Message{
		{Role: "user", Text: "vector database"},
		{Role: "assistant", Text: "A database for embeddings."},
		{Role: "user", Text: "examples?"},
	}
	p := buildPrompt("vector database", msgs, []websearch.Result{{Title: "Milvus", URL: "https://milvus.io", Snippet: "open source"}}, "Safari", false)
	for _, want := range []string{"Current application:\nSafari", "vector database", "Assistant: A database for embeddings.", "examples?", "1. Milvus"} {
		if !strings.Contains(p, want) {
			t.Errorf("prompt lacks %q:\n%s", want, p)
		}
	}
	if strings.Contains(p, "User: vector database") {
		t.Errorf("the selection repeated as history:\n%s", p)
	}
}
