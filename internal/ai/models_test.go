package ai

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestListModels(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case r.URL.Path == "/v1/models" && r.Header.Get("Authorization") == "Bearer k":
			fmt.Fprint(w, `{"data":[{"id":"gpt-4o"},{"id":"deepseek-chat"},{"id":"gpt-4o"}]}`)
		case r.URL.Path == "/anthropic/v1/models" && r.Header.Get("x-api-key") == "k":
			fmt.Fprint(w, `{"data":[{"id":"claude-sonnet-4-5"},{"id":"claude-haiku-4-5"}]}`)
		case r.URL.Path == "/gemini/v1beta/models" && r.URL.Query().Get("key") == "k":
			fmt.Fprint(w, `{"models":[{"name":"models/gemini-2.5-pro","supportedGenerationMethods":["generateContent"]},{"name":"models/embedding-001","supportedGenerationMethods":["embedContent"]}]}`)
		case r.URL.Path == "/models":
			fmt.Fprint(w, "<html>relay console</html>")
		default:
			http.Error(w, `{"error":"bad key"}`, 401)
		}
	}))
	defer srv.Close()
	ctx := context.Background()
	got, err := ListModels(ctx, OpenAI, "k", srv.URL+"/v1/chat/completions")
	if err != nil || strings.Join(got, ",") != "deepseek-chat,gpt-4o" {
		t.Fatal(got, err)
	}
	got, err = ListModels(ctx, Anthropic, "k", srv.URL+"/anthropic/v1")
	if err != nil || strings.Join(got, ",") != "claude-sonnet-4-5,claude-haiku-4-5" {
		t.Fatal(got, err)
	}
	got, err = ListModels(ctx, Google, "k", srv.URL+"/gemini/v1beta")
	if err != nil || strings.Join(got, ",") != "gemini-2.5-pro" {
		t.Fatal(got, err)
	}
	// Claude format on a relay pasted without /v1.
	if got, err = ListModels(ctx, Anthropic, "k", srv.URL+"/anthropic"); err != nil || len(got) != 2 {
		t.Fatal("anthropic base without /v1", got, err)
	}
	// A relay address without /v1 (its root serves a web page).
	got, err = ListModels(ctx, OpenAI, "k", srv.URL)
	if err != nil || len(got) != 2 {
		t.Fatal("no /v1 fallback", got, err)
	}
	if _, err = ListModels(ctx, OpenAI, "bad", srv.URL+"/v1"); err == nil || !strings.Contains(err.Error(), "401") {
		t.Fatal("expected 401", err)
	}
}
