package ai

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sort"
	"strings"
)

// ListModels asks a provider which models its key can use (provider is an APIFormat for the custom one): GET /models of an OpenAI-compatible API (OpenAI,
// Kimi, DeepSeek, local servers, any baseURL), Anthropic's /v1/models, or Gemini's models that generate text.
func ListModels(ctx context.Context, provider, apiKey, baseURL string) ([]string, error) {
	ids, err := listModels(ctx, provider, apiKey, baseURL)
	// A relay's address pasted without its /v1 answers /models with a web page: try /v1.
	base := strings.TrimSuffix(strings.TrimSpace(baseURL), "/")
	if err != nil && provider != Anthropic && provider != Google && base != "" && !strings.HasSuffix(base, "/v1") &&
		(strings.Contains(err.Error(), "unexpected reply") || strings.Contains(err.Error(), "HTTP 404")) {
		if more, err2 := listModels(ctx, provider, apiKey, base+"/v1"); err2 == nil {
			return more, nil
		}
	}
	return ids, err
}

func listModels(ctx context.Context, provider, apiKey, baseURL string) ([]string, error) {
	m := &Model{Provider: provider, APIKey: strings.TrimSpace(apiKey), BaseURL: strings.TrimSpace(baseURL)}
	var endpoint string
	headers := map[string]string{}
	switch provider {
	case Anthropic:
		endpoint = anthropicBase(m.BaseURL) + "/models?limit=1000"
		headers["x-api-key"] = m.APIKey
		headers["anthropic-version"] = "2023-06-01"
	case Google:
		endpoint = geminiBase(m.BaseURL) + "/models?pageSize=1000&key=" + url.QueryEscape(m.APIKey)
	default:
		chat, _ := openAIEndpoint(m)
		endpoint = strings.TrimSuffix(chat, "/chat/completions") + "/models"
		if m.APIKey != "" {
			headers["Authorization"] = "Bearer " + m.APIKey
		}
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, err
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	res, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(res.Body, 8<<20))
	if res.StatusCode >= 400 {
		msg := strings.TrimSpace(string(body))
		if len(msg) > 200 {
			msg = msg[:200]
		}
		return nil, fmt.Errorf("HTTP %d: %s", res.StatusCode, msg)
	}
	var out struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
		Models []struct {
			Name    string   `json:"name"`
			Methods []string `json:"supportedGenerationMethods"`
		} `json:"models"`
	}
	if err := json.Unmarshal(body, &out); err != nil {
		return nil, fmt.Errorf("unexpected reply from %s", endpoint)
	}
	seen := map[string]bool{}
	var ids []string
	add := func(id string) {
		if id = strings.TrimSpace(id); id != "" && !seen[id] {
			seen[id] = true
			ids = append(ids, id)
		}
	}
	for _, d := range out.Data {
		add(d.ID)
	}
	for _, g := range out.Models {
		generates := len(g.Methods) == 0
		for _, method := range g.Methods {
			generates = generates || method == "generateContent"
		}
		if generates {
			add(strings.TrimPrefix(g.Name, "models/"))
		}
	}
	if provider != Anthropic { // Anthropic lists the newest first already
		sort.Strings(ids)
	}
	return ids, nil
}
