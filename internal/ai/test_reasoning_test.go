package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"testing"
)

// A reasoning model behind a relay: with a small max_tokens its thinking uses them all and the content is empty.
func TestTestWithReasoningModel(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"reasoning_content\":\"Thinking about the answer...\"}}]}\n\n")
		if mt, ok := body["max_tokens"].(float64); ok && mt < 200 {
			fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"length\"}]}\n\n")
		} else {
			fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"OK\"},\"finish_reason\":\"stop\"}]}\n\n")
		}
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()
	m := &Model{Provider: Custom, Format: Custom, ModelID: "gemini-3.8-flash", APIKey: "k", BaseURL: srv.URL + "/v1"}
	if _, err := Test(context.Background(), m); err != nil {
		t.Fatal(err)
	}
}
