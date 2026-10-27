// Package websearch searches the web for the explain chat with the first configured provider, in the
// Electron app's order: Tavily, Serper, Brave, Jina.
package websearch

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"

	"popmind/internal/settings"
)

// Order is the providers' priority.
var Order = []string{"tavily", "serper", "brave", "jina"}

// Result is one search hit.
type Result struct {
	Title    string
	URL      string
	Snippet  string
	Provider string
}

// Resolve returns the provider to use and its key, or "" when web search is off or has no key.
func Resolve(c settings.Capability) (string, string) {
	if !c.WebSearch.Enabled {
		return "", ""
	}
	return Configured(c)
}

// Configured returns the first provider with a key and its key, whether web search is on by default or not
// (a conversation's switch turns it on for itself), or "" when none has a key.
func Configured(c settings.Capability) (string, string) {
	for _, id := range Order {
		if key := strings.TrimSpace(c.WebSearch.Providers[id].APIKey); key != "" {
			return id, key
		}
	}
	return "", ""
}

// Search searches with provider and key.
func Search(ctx context.Context, provider, key, query string) ([]Result, error) {
	switch provider {
	case "tavily":
		var out struct {
			Results []struct{ Title, URL, Content string } `json:"results"`
		}
		body, _ := json.Marshal(map[string]any{"api_key": key, "query": query, "search_depth": "basic", "max_results": 5})
		if err := do(ctx, http.MethodPost, "https://api.tavily.com/search", body, nil, &out); err != nil {
			return nil, err
		}
		var r []Result
		for _, x := range out.Results {
			r = append(r, Result{x.Title, x.URL, x.Content, provider})
		}
		return clean(r), nil
	case "serper":
		var out struct {
			Organic []struct{ Title, Link, Snippet string } `json:"organic"`
		}
		body, _ := json.Marshal(map[string]any{"q": query, "num": 5})
		if err := do(ctx, http.MethodPost, "https://google.serper.dev/search", body, map[string]string{"x-api-key": key}, &out); err != nil {
			return nil, err
		}
		var r []Result
		for _, x := range out.Organic {
			r = append(r, Result{x.Title, x.Link, x.Snippet, provider})
		}
		return clean(r), nil
	case "brave":
		var out struct {
			Web struct {
				Results []struct{ Title, URL, Description string } `json:"results"`
			} `json:"web"`
		}
		u := "https://api.search.brave.com/res/v1/web/search?" + url.Values{"q": {query}, "count": {"5"}}.Encode()
		if err := do(ctx, http.MethodGet, u, nil, map[string]string{"X-Subscription-Token": key}, &out); err != nil {
			return nil, err
		}
		var r []Result
		for _, x := range out.Web.Results {
			r = append(r, Result{x.Title, x.URL, x.Description, provider})
		}
		return clean(r), nil
	case "jina":
		var out struct {
			Data []struct{ Title, URL, Content, Description string } `json:"data"`
		}
		if err := do(ctx, http.MethodGet, "https://s.jina.ai/"+url.PathEscape(query), nil, map[string]string{"Authorization": "Bearer " + key}, &out); err != nil {
			return nil, err
		}
		var r []Result
		for _, x := range out.Data {
			snippet := x.Description
			if snippet == "" {
				snippet = x.Content
			}
			r = append(r, Result{x.Title, x.URL, snippet, provider})
		}
		r = clean(r)
		if len(r) > 5 {
			r = r[:5]
		}
		return r, nil
	}
	return nil, fmt.Errorf("unknown web search provider %q", provider)
}

func clean(in []Result) []Result {
	var out []Result
	for _, r := range in {
		if r.URL == "" {
			continue
		}
		r.Title = strings.TrimSpace(r.Title)
		if r.Title == "" {
			r.Title = r.URL
		}
		r.Snippet = strings.TrimSpace(r.Snippet)
		out = append(out, r)
	}
	return out
}

func do(ctx context.Context, method, u string, body []byte, headers map[string]string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, u, bytes.NewReader(body))
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	if body != nil {
		req.Header.Set("Content-Type", "application/json")
	}
	for k, v := range headers {
		req.Header.Set(k, v)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	data, _ := io.ReadAll(io.LimitReader(resp.Body, 4<<20))
	if resp.StatusCode/100 != 2 {
		return fmt.Errorf("%s request failed: %d", req.URL.Host, resp.StatusCode)
	}
	return json.Unmarshal(data, out)
}

// Test runs one search, as the settings page's "Test" button.
func Test(ctx context.Context, provider, key string) (int, error) {
	r, err := Search(ctx, provider, key, "popMind desktop app")
	return len(r), err
}
