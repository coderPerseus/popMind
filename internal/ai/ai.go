// Package ai talks to the language models the user configured (Settings → AI service): OpenAI and the
// OpenAI-compatible APIs (Kimi, DeepSeek, a local Gemma), Anthropic and Gemini, streaming their replies.
// It replaces the Vercel AI SDK of the Electron app with what popMind uses of it: a system prompt, turns of
// text (and images), streaming, cancellation.
package ai

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	"popmind/internal/settings"
)

// Provider ids, as in lib/capability/types.ts.
const (
	OpenAI    = "openai"
	Anthropic = "anthropic"
	Google    = "google"
	Kimi      = "kimi"
	DeepSeek  = "deepseek"
	Gemma     = "gemma"
	// Custom is a provider of the user's own, such as a relay: any base URL, speaking the API format chosen.
	Custom = "custom"
)

// API formats of the custom provider.
const (
	FormatOpenAI    = "openai"
	FormatAnthropic = "anthropic"
	FormatGoogle    = "google"
)

// ProviderOrder is the order the settings list the providers in.
var ProviderOrder = []string{OpenAI, Anthropic, Google, Kimi, DeepSeek, Custom, Gemma}

var defaultModels = map[string]string{
	OpenAI: "gpt-5-mini", Anthropic: "claude-3-5-haiku-latest", Google: "gemini-2.5-flash",
	Kimi: "moonshot-v1-8k", DeepSeek: "deepseek-chat", Gemma: "gemma-4-e4b-it",
}

var contextLimits = map[string]int{
	OpenAI: 128_000, Anthropic: 200_000, Google: 128_000, Kimi: 128_000, DeepSeek: 64_000, Gemma: 32_000, Custom: 128_000,
}

// ProviderLabels are the names the UI shows.
var ProviderLabels = map[string]string{
	OpenAI: "OpenAI", Anthropic: "Claude", Google: "Gemini", Kimi: "Kimi", DeepSeek: "DeepSeek", Gemma: "Gemma", Custom: "Custom",
}

// APIFormat is the API a provider speaks: the custom provider's chosen one, Claude's and Gemini's own, and the
// OpenAI-compatible one for the rest. It answers with the provider id the request code switches on.
func APIFormat(provider, format string) string {
	if provider != Custom {
		return provider
	}
	switch format {
	case FormatAnthropic:
		return Anthropic
	case FormatGoogle:
		return Google
	}
	return Custom
}

// Model is a resolved provider connection.
type Model struct {
	Provider string
	// Format is the provider id whose API the requests use (APIFormat): the provider's own but for Custom.
	Format string
	// Name is what the UI calls the provider.
	Name         string
	ModelID      string
	APIKey       string
	BaseURL      string
	ContextLimit int
}

// Resolve returns the model of provider (the active one when ""), or nil when it is not configured.
func Resolve(c settings.Capability, provider string) *Model {
	if provider == "" {
		if c.AIService.ActiveProvider == nil {
			return nil
		}
		provider = *c.AIService.ActiveProvider
	}
	var cfg settings.AIProviderConfig
	if provider == Gemma {
		g := c.LocalModels.Gemma
		if !g.Enabled || strings.TrimSpace(g.APIKey) == "" || strings.TrimSpace(g.BaseURL) == "" || strings.TrimSpace(g.Model) == "" {
			return nil
		}
		cfg = settings.AIProviderConfig{APIKey: g.APIKey, BaseURL: g.BaseURL, Model: g.Model}
	} else {
		var ok bool
		if cfg, ok = c.AIService.Providers[provider]; !ok {
			return nil
		}
	}
	if strings.TrimSpace(cfg.APIKey) == "" {
		return nil
	}
	model := strings.TrimSpace(cfg.Model)
	if model == "" {
		model = defaultModels[provider]
	}
	if provider == Custom && (strings.TrimSpace(cfg.BaseURL) == "" || model == "") {
		return nil // a relay needs its address and a model
	}
	limit := contextLimits[provider]
	if l := ProfileOf(model).ContextLimit; l > 0 {
		limit = l
	}
	name := ProviderLabels[provider]
	if provider == Custom && strings.TrimSpace(cfg.Name) != "" {
		name = strings.TrimSpace(cfg.Name)
	}
	return &Model{Provider: provider, Format: APIFormat(provider, cfg.Format), Name: name, ModelID: model,
		APIKey: strings.TrimSpace(cfg.APIKey), BaseURL: strings.TrimSpace(cfg.BaseURL), ContextLimit: limit}
}

// Configured lists the providers with a key, in ProviderOrder.
func Configured(c settings.Capability) []string {
	var out []string
	for _, id := range ProviderOrder {
		if Resolve(c, id) != nil {
			out = append(out, id)
		}
	}
	return out
}

// SupportsImages reports whether the model takes images: from what the model is (ProfileOf), whatever provider
// it is reached through, unless it refused one earlier in this session.
func (m *Model) SupportsImages() bool {
	return ProfileOf(m.ModelID).Vision && !refusedImages(m)
}

// Message is one turn.
type Message struct {
	Role    string // "user" or "assistant"
	Content string
	// Images are PNGs shown to the model with the text (user turns).
	Images [][]byte
}

// Request is what to ask.
type Request struct {
	System      string
	Messages    []Message
	Temperature *float64
	MaxTokens   int
	// ImageStyle is how an OpenAI-compatible request carries images (ImageStyles): some relays crash on one
	// way and take another.
	ImageStyle int
}

// EstimateTokens is the Electron app's rough estimate: four characters a token.
func EstimateTokens(parts ...string) int {
	n := 0
	for _, p := range parts {
		n += len([]rune(p)) + 1
	}
	return (n + 3) / 4
}

var client = &http.Client{Timeout: 0} // streams are bounded by their contexts

// Generate returns the whole reply.
func Generate(ctx context.Context, m *Model, req Request) (string, error) {
	var b strings.Builder
	err := Stream(ctx, m, req, func(delta string) { b.WriteString(delta) })
	return b.String(), err
}

// Stream calls onDelta with the reply as it comes, and returns once it is complete.
func Stream(ctx context.Context, m *Model, req Request, onDelta func(string)) error {
	if m == nil {
		return errors.New("AI service is not configured")
	}
	format := m.Format
	if format == "" {
		format = m.Provider
	}
	switch format {
	case Anthropic:
		return streamAnthropic(ctx, m, req, onDelta)
	case Google:
		return streamGemini(ctx, m, req, onDelta)
	default:
		return streamOpenAI(ctx, m, req, onDelta)
	}
}

// normalizeOpenAIBaseURL strips /chat/completions and /responses from a pasted endpoint.
func normalizeOpenAIBaseURL(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	u, err := url.Parse(raw)
	if err != nil {
		return strings.TrimSuffix(raw, "/")
	}
	p := strings.TrimRight(u.Path, "/")
	p = strings.TrimSuffix(strings.TrimSuffix(p, "/chat/completions"), "/responses")
	u.Path = p
	return strings.TrimSuffix(u.String(), "/")
}

func openAIEndpoint(m *Model) (endpoint string, compatible bool) {
	base := normalizeOpenAIBaseURL(m.BaseURL)
	switch m.Provider {
	case Kimi:
		if base == "" {
			base = "https://api.moonshot.cn/v1"
		}
		return base + "/chat/completions", true
	case DeepSeek:
		if base == "" {
			base = "https://api.deepseek.com"
		}
		return base + "/chat/completions", true
	case Gemma:
		if base == "" {
			base = "http://127.0.0.1:1234/v1"
		}
		return base + "/chat/completions", true
	}
	if base == "" {
		return "https://api.openai.com/v1/chat/completions", false
	}
	u, err := url.Parse(base)
	return base + "/chat/completions", err != nil || u.Host != "api.openai.com"
}

func streamOpenAI(ctx context.Context, m *Model, req Request, onDelta func(string)) error {
	endpoint, compatible := openAIEndpoint(m)
	var messages []map[string]any
	if req.System != "" {
		messages = append(messages, map[string]any{"role": "system", "content": req.System})
	}
	for _, msg := range req.Messages {
		if len(msg.Images) == 0 {
			messages = append(messages, map[string]any{"role": msg.Role, "content": msg.Content})
			continue
		}
		var images []map[string]any
		for _, img := range msg.Images {
			data, mime := img, "image/png"
			if req.ImageStyle >= imageJPEG {
				data, mime = toJPEG(img)
			}
			url := map[string]string{"url": "data:" + mime + ";base64," + b64(data)}
			if req.ImageStyle >= imageFirst {
				url["detail"] = "auto"
			}
			images = append(images, map[string]any{"type": "image_url", "image_url": url})
		}
		text := map[string]any{"type": "text", "text": msg.Content}
		parts := append([]map[string]any{text}, images...)
		if req.ImageStyle >= imageFirst {
			parts = append(images, text)
		}
		messages = append(messages, map[string]any{"role": msg.Role, "content": parts})
	}
	stream := !(req.ImageStyle >= imageNoStream && hasImages(req))
	body := map[string]any{"model": m.ModelID, "messages": messages, "stream": stream}
	if req.Temperature != nil && !ProfileOf(m.ModelID).FixedTemperature {
		body["temperature"] = *req.Temperature
	}
	if req.MaxTokens > 0 {
		body["max_tokens"] = req.MaxTokens
	}
	// Reasoning models behind compatible APIs think for seconds before answering; popMind wants the answer.
	if compatible && (req.ImageStyle == imagePlain || !hasImages(req)) {
		body["enable_thinking"] = false
		body["thinking"] = map[string]string{"type": "disabled"}
	}
	resp, err := post(ctx, endpoint, body, map[string]string{"Authorization": "Bearer " + m.APIKey})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if !stream {
		// The whole reply at once (a relay that fails streaming images).
		var out struct {
			Choices []struct {
				Message struct {
					Content string `json:"content"`
				} `json:"message"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
			return err
		}
		if out.Error != nil {
			return errors.New(out.Error.Message)
		}
		for _, c := range out.Choices {
			if c.Message.Content != "" {
				onDelta(c.Message.Content)
			}
		}
		return nil
	}
	return readSSE(resp.Body, func(data []byte) error {
		var chunk struct {
			Choices []struct {
				Delta struct {
					Content string `json:"content"`
				} `json:"delta"`
			} `json:"choices"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(data, &chunk); err != nil {
			return nil
		}
		if chunk.Error != nil {
			return errors.New(chunk.Error.Message)
		}
		for _, c := range chunk.Choices {
			if c.Delta.Content != "" {
				onDelta(c.Delta.Content)
			}
		}
		return nil
	})
}

// anthropicBase is the base of Claude's API: an address pasted without its version (a relay's) gets /v1, and
// a pasted /messages endpoint loses it.
func anthropicBase(raw string) string {
	base := strings.TrimSuffix(strings.TrimSuffix(strings.TrimSpace(raw), "/"), "/messages")
	if base == "" {
		return "https://api.anthropic.com/v1"
	}
	if !strings.Contains(base[strings.Index(base, "//")+2:], "/v1") {
		base += "/v1"
	}
	return base
}

// geminiBase is the base of Gemini's API: an address without a version gets /v1beta.
func geminiBase(raw string) string {
	base := strings.TrimSuffix(strings.TrimSpace(raw), "/")
	if base == "" {
		return "https://generativelanguage.googleapis.com/v1beta"
	}
	if !strings.Contains(base[strings.Index(base, "//")+2:], "/v1") {
		base += "/v1beta"
	}
	return base
}

func streamAnthropic(ctx context.Context, m *Model, req Request, onDelta func(string)) error {
	base := anthropicBase(m.BaseURL)
	var messages []map[string]any
	for _, msg := range req.Messages {
		parts := []map[string]any{}
		for _, img := range msg.Images {
			parts = append(parts, map[string]any{"type": "image",
				"source": map[string]string{"type": "base64", "media_type": "image/png", "data": b64(img)}})
		}
		parts = append(parts, map[string]any{"type": "text", "text": msg.Content})
		messages = append(messages, map[string]any{"role": msg.Role, "content": parts})
	}
	maxTokens := req.MaxTokens
	if maxTokens <= 0 {
		maxTokens = 4096
	}
	body := map[string]any{"model": m.ModelID, "messages": messages, "stream": true, "max_tokens": maxTokens}
	if req.System != "" {
		body["system"] = req.System
	}
	if req.Temperature != nil {
		body["temperature"] = *req.Temperature
	}
	resp, err := post(ctx, base+"/messages", body, map[string]string{"x-api-key": m.APIKey, "anthropic-version": "2023-06-01"})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return readSSE(resp.Body, func(data []byte) error {
		var ev struct {
			Type  string `json:"type"`
			Delta struct {
				Type string `json:"type"`
				Text string `json:"text"`
			} `json:"delta"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(data, &ev); err != nil {
			return nil
		}
		if ev.Error != nil {
			return errors.New(ev.Error.Message)
		}
		if ev.Type == "content_block_delta" && ev.Delta.Text != "" {
			onDelta(ev.Delta.Text)
		}
		return nil
	})
}

func streamGemini(ctx context.Context, m *Model, req Request, onDelta func(string)) error {
	base := geminiBase(m.BaseURL)
	var contents []map[string]any
	for _, msg := range req.Messages {
		role := "user"
		if msg.Role == "assistant" {
			role = "model"
		}
		parts := []map[string]any{{"text": msg.Content}}
		for _, img := range msg.Images {
			parts = append(parts, map[string]any{"inlineData": map[string]string{"mimeType": "image/png", "data": b64(img)}})
		}
		contents = append(contents, map[string]any{"role": role, "parts": parts})
	}
	body := map[string]any{"contents": contents}
	if req.System != "" {
		body["systemInstruction"] = map[string]any{"parts": []map[string]string{{"text": req.System}}}
	}
	gen := map[string]any{}
	if req.Temperature != nil {
		gen["temperature"] = *req.Temperature
	}
	if req.MaxTokens > 0 {
		gen["maxOutputTokens"] = req.MaxTokens
	}
	if len(gen) > 0 {
		body["generationConfig"] = gen
	}
	endpoint := fmt.Sprintf("%s/models/%s:streamGenerateContent?alt=sse", base, url.PathEscape(m.ModelID))
	resp, err := post(ctx, endpoint, body, map[string]string{"x-goog-api-key": m.APIKey})
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return readSSE(resp.Body, func(data []byte) error {
		var chunk struct {
			Candidates []struct {
				Content struct {
					Parts []struct {
						Text    string `json:"text"`
						Thought bool   `json:"thought"`
					} `json:"parts"`
				} `json:"content"`
			} `json:"candidates"`
			Error *struct {
				Message string `json:"message"`
			} `json:"error"`
		}
		if err := json.Unmarshal(data, &chunk); err != nil {
			return nil
		}
		if chunk.Error != nil {
			return errors.New(chunk.Error.Message)
		}
		for _, c := range chunk.Candidates {
			for _, p := range c.Content.Parts {
				if p.Text != "" && !p.Thought {
					onDelta(p.Text)
				}
			}
		}
		return nil
	})
}

func post(ctx context.Context, endpoint string, body any, headers map[string]string) (*http.Response, error) {
	data, err := json.Marshal(body)
	if err != nil {
		return nil, err
	}
	httpReq, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	httpReq.Header.Set("Content-Type", "application/json")
	httpReq.Header.Set("Accept", "text/event-stream")
	for k, v := range headers {
		httpReq.Header.Set(k, v)
	}
	resp, err := client.Do(httpReq)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode/100 != 2 {
		defer resp.Body.Close()
		msg, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
		return nil, &HTTPError{Status: resp.StatusCode, Body: apiErrorMessage(msg)}
	}
	return resp, nil
}

// HTTPError is a provider's error response.
type HTTPError struct {
	Status int
	Body   string
}

func (e *HTTPError) Error() string { return fmt.Sprintf("HTTP %d: %s", e.Status, e.Body) }

// apiErrorMessage pulls the message out of the providers' error bodies.
func apiErrorMessage(body []byte) string {
	var v struct {
		Error any `json:"error"`
	}
	if json.Unmarshal(body, &v) == nil && v.Error != nil {
		switch e := v.Error.(type) {
		case string:
			return e
		case map[string]any:
			if m, ok := e["message"].(string); ok {
				return m
			}
		}
	}
	s := strings.TrimSpace(string(body))
	if len(s) > 300 {
		s = s[:300]
	}
	return s
}

// readSSE calls fn with the data of every server-sent event until [DONE] or the end of the body.
func readSSE(r io.Reader, fn func([]byte) error) error {
	sc := bufio.NewScanner(r)
	sc.Buffer(make([]byte, 64<<10), 8<<20)
	var data bytes.Buffer
	flush := func() error {
		if data.Len() == 0 {
			return nil
		}
		payload := bytes.TrimSpace(data.Bytes())
		data.Reset()
		if string(payload) == "[DONE]" {
			return io.EOF
		}
		return fn(payload)
	}
	for sc.Scan() {
		line := sc.Bytes()
		if len(line) == 0 {
			if err := flush(); err != nil {
				if err == io.EOF {
					return nil
				}
				return err
			}
			continue
		}
		if after, ok := bytes.CutPrefix(line, []byte("data:")); ok {
			if data.Len() > 0 {
				data.WriteByte('\n')
			}
			data.Write(bytes.TrimPrefix(after, []byte(" ")))
		}
	}
	if err := flush(); err != nil && err != io.EOF {
		return err
	}
	return sc.Err()
}

// Test sends a one-word prompt, as the settings page's "Test" button.
func Test(ctx context.Context, m *Model) (time.Duration, error) {
	started := time.Now()
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	// No token limit: reasoning models (Gemini 3, GPT-5, o-series) think before they answer, and a small limit
	// is used up by the thinking, leaving an empty reply.
	reply, err := Generate(ctx, m, Request{Messages: []Message{{Role: "user", Content: "Reply with: OK"}}})
	if err == nil && strings.TrimSpace(reply) == "" {
		err = errors.New("empty reply")
	}
	return time.Since(started), err
}
