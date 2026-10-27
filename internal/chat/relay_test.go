package chat

import (
	"bytes"
	"fmt"
	"image"
	pngenc "image/png"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"popmind/internal/settings"
)

// A relay that crashes on images (new-api's "HTTP 500: Panic detected"): the explanation still comes, from the
// text alone, the window says so, and the next one sends no screenshot to that model.
func TestExplainSurvivesRelayCrashingOnImages(t *testing.T) {
	var withImage, withoutImage atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body, _ := io.ReadAll(r.Body)
		if strings.Contains(string(body), "image_url") {
			withImage.Add(1)
			http.Error(w, "Panic detected, error: runtime error: invalid memory address or nil pointer dereference. Please submit a issue here: https://github.com/Calcium-Ion/new-api", 500)
			return
		}
		withoutImage.Add(1)
		w.Header().Set("Content-Type", "text/event-stream")
		fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"向量数据库\"}}]}\n\n")
		fmt.Fprint(w, "data: [DONE]\n\n")
	}))
	defer srv.Close()

	settings.SetDataDir(t.TempDir())
	settings.Capabilities.Load("zh-CN")
	if _, err := settings.Capabilities.Update(map[string]any{"aiService": map[string]any{"activeProvider": "openai",
		"providers": map[string]any{"openai": map[string]any{"apiKey": "k", "baseURL": srv.URL + "/v1", "model": "gemini-3.8-flash"}}},
		"webSearch": map[string]any{"enabled": false}}); err != nil {
		t.Fatal(err)
	}
	png := testPNG()
	explain := func() *Session {
		done := make(chan struct{}, 8)
		var s *Session
		update := func(fn func()) { fn(); done <- struct{}{} }
		s = Start(update, "explain", "vector database", "Safari", png)
		deadline := time.After(10 * time.Second)
		for s.Busy() {
			select {
			case <-done:
			case <-deadline:
				t.Fatal("no answer")
			}
		}
		return s
	}

	s := explain()
	last := s.Messages[len(s.Messages)-1]
	if last.Err != "" || last.Text != "向量数据库" {
		t.Fatalf("answer %q err %q", last.Text, last.Err)
	}
	// Every way of sending the image was tried once (ai.ImageStyles), then the text alone.
	if s.ImageState != "dropped" || withImage.Load() != 5 || withoutImage.Load() != 1 {
		t.Fatalf("state %q, with image %d, without %d", s.ImageState, withImage.Load(), withoutImage.Load())
	}
	// Remembered: the next explanation goes without the screenshot at once.
	s = explain()
	if withImage.Load() != 5 || withoutImage.Load() != 2 || s.ImageState != "unsupported" {
		t.Fatalf("second: state %q, with image %d, without %d", s.ImageState, withImage.Load(), withoutImage.Load())
	}
}

func testPNG() []byte {
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	var b bytes.Buffer
	_ = pngenc.Encode(&b, img)
	return b.Bytes()
}

// Relays that fail on one way of sending the image take another: the explanation sees the screenshot, and the
// way that worked is used first next time.
func TestExplainFindsImageStyleRelayTakes(t *testing.T) {
	for name, crashes := range map[string]func(body string) bool{
		"thinking fields with an image": func(b string) bool { return strings.Contains(b, "enable_thinking") },
		"a PNG":                         func(b string) bool { return strings.Contains(b, "image/png") },
		"streaming an image":            func(b string) bool { return strings.Contains(b, `"stream":true`) },
	} {
		t.Run(name, func(t *testing.T) {
			var requests, crashed atomic.Int32
			srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				body, _ := io.ReadAll(r.Body)
				requests.Add(1)
				if strings.Contains(string(body), "image_url") && crashes(string(body)) {
					crashed.Add(1)
					http.Error(w, "Panic detected, error: runtime error: invalid memory address or nil pointer dereference.", 500)
					return
				}
				if !strings.Contains(string(body), "image_url") {
					t.Error("the screenshot was dropped")
				}
				if strings.Contains(string(body), `"stream":false`) {
					fmt.Fprint(w, `{"choices":[{"message":{"content":"ok"}}]}`)
					return
				}
				w.Header().Set("Content-Type", "text/event-stream")
				fmt.Fprint(w, "data: {\"choices\":[{\"delta\":{\"content\":\"ok\"}}]}\n\ndata: [DONE]\n\n")
			}))
			defer srv.Close()
			settings.SetDataDir(t.TempDir())
			settings.Capabilities.Load("zh-CN")
			_, _ = settings.Capabilities.Update(map[string]any{"aiService": map[string]any{"activeProvider": "custom",
				"providers": map[string]any{"custom": map[string]any{"apiKey": "k", "baseURL": srv.URL + "/v1", "model": "gemini-3.8-flash"}}},
				"webSearch": map[string]any{"enabled": false}})
			explain := func() *Session {
				done := make(chan struct{}, 8)
				s := Start(func(fn func()) { fn(); done <- struct{}{} }, "explain", "vector database", "Safari", testPNG())
				for s.Busy() {
					select {
					case <-done:
					case <-time.After(10 * time.Second):
						t.Fatal("no answer")
					}
				}
				return s
			}
			s := explain()
			if s.ImageState != "sent" || s.Messages[len(s.Messages)-1].Text != "ok" {
				t.Fatalf("state %q", s.ImageState)
			}
			first := requests.Load()
			explain()
			if requests.Load()-first != 1 {
				t.Fatalf("the way that worked was not kept: %d requests", requests.Load()-first)
			}
		})
	}
}
