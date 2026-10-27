package ai

import "testing"

func TestProfileOf(t *testing.T) {
	vision := map[string]bool{
		"gemini-3.8-flash": true, "google/gemini-2.5-pro": true, "models/gemini-2.0-flash": true,
		"gpt-4o-mini": true, "openai/gpt-5": true, "gpt-4.1": true, "o3": true, "o4-mini": true,
		"claude-sonnet-4-5": true, "anthropic/claude-3-5-haiku-latest": true,
		"qwen2.5-vl-72b-instruct": true, "qwen3-vl-plus": true, "glm-4.5v": true, "gemma-3-27b-it": true,
		"gemma-4-e4b-it": true, "llama-4-maverick": true, "grok-4": true, "some-new-model": true,
		"deepseek-chat": false, "deepseek-reasoner": false, "gpt-3.5-turbo": false, "o3-mini": false,
		"qwen-max": false, "kimi-k2-turbo": false, "moonshot-v1-8k": false, "glm-4.6": false, "gemma-3-1b-it": false,
		"grok-3": false, "mistral-large-latest": false,
	}
	for id, want := range vision {
		if got := ProfileOf(id).Vision; got != want {
			t.Errorf("%s vision = %v, want %v", id, got, want)
		}
	}
	if ProfileOf("gemini-3.8-flash").ContextLimit != 1_000_000 || ProfileOf("x/claude-opus-4").ContextLimit != 200_000 {
		t.Error("context limits")
	}
	if !ProfileOf("openai/gpt-5-mini").FixedTemperature || ProfileOf("gpt-4o").FixedTemperature || ProfileOf("omni-x").FixedTemperature {
		t.Error("temperature")
	}
	m := &Model{Provider: OpenAI, ModelID: "gemini-3.8-flash", BaseURL: "https://relay"}
	if !m.SupportsImages() {
		t.Fatal("gemini behind a relay takes images")
	}
	NoImages(m)
	if m.SupportsImages() {
		t.Fatal("refusal not remembered")
	}
}

func TestCustomProvider(t *testing.T) {
	if APIFormat(Custom, FormatAnthropic) != Anthropic || APIFormat(Custom, "") != Custom || APIFormat(Google, "") != Google {
		t.Fatal("formats")
	}
	for in, want := range map[string]string{"": "https://api.anthropic.com/v1", "https://r.com": "https://r.com/v1",
		"https://r.com/v1/": "https://r.com/v1", "https://r.com/claude/v1/messages": "https://r.com/claude/v1"} {
		if got := anthropicBase(in); got != want {
			t.Errorf("anthropicBase(%q) = %q", in, got)
		}
	}
	if geminiBase("https://r.com") != "https://r.com/v1beta" || geminiBase("https://r.com/v1") != "https://r.com/v1" {
		t.Error("geminiBase")
	}
}
