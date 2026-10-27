package ai

import (
	"regexp"
	"strings"
	"sync"
)

// A model's abilities follow from what the model is, not from the provider it is reached through: Gemini behind
// an OpenAI-compatible relay still reads images and a million tokens. Profile reads them from the model id.

// Profile is what popMind knows about a model.
type Profile struct {
	// Vision is whether it takes images. Unknown models are assumed to (a refusal is learned, see NoImages).
	Vision bool
	// ContextLimit is how many tokens it reads, 0 when unknown (the provider's default applies).
	ContextLimit int
	// FixedTemperature is set for reasoning models that refuse a temperature.
	FixedTemperature bool
}

// family is the bare model name: lower case, without a vendor or path prefix ("google/", "models/",
// "accounts/x/models/") or a ":tag" suffix.
func family(id string) string {
	id = strings.ToLower(strings.TrimSpace(id))
	if i := strings.LastIndex(id, "/"); i >= 0 {
		id = id[i+1:]
	}
	if i := strings.Index(id, ":"); i >= 0 {
		id = id[:i]
	}
	return id
}

var (
	visionYes  = regexp.MustCompile(`^(gpt-4o|chatgpt-4o|gpt-4\.1|gpt-4\.5|gpt-4-turbo|gpt-4-vision|gpt-5|o1($|-[0-9])|o1-pro|o3($|-[0-9]|-pro)|o4|claude|gemini|gemma-?3n|gemma-?[34]-(?:[4-9]|[1-9][0-9])b|gemma-?4|llava|pixtral|grok-4|grok-2-vision|grok-vision|llama-4|llama-3\.2-(11|90)b|qvq|internvl|minicpm-v|moondream|step-1v|step-1o|yi-vision|phi-3\.5-vision|phi-4-multimodal|doubao-seed|doubao-1\.5-vision|mistral-medium-3|mistral-small-3\.[1-9]|kimi-vl|kimi-k2\.5|glm-4(\.[0-9])?v|glm-[45]\.[0-9]?v)`)
	visionHint = regexp.MustCompile(`(^|[-_.])(vl|vision|omni|multimodal|mm)($|[-_.0-9])`)
	visionNo   = regexp.MustCompile(`^(deepseek|gpt-3\.5|gpt-4($|-0|-32k)|o1-mini|o3-mini|text-|embedding|qwen|qwq|glm|kimi|moonshot|codestral|mistral|ministral|llama|gemma|mixtral|command|ernie|hunyuan|abab|minimax|yi-|baichuan|sonar|grok)`)
	reasoning  = regexp.MustCompile(`^(gpt-5|o[1-9]($|-))`)
)

var contextByFamily = []struct {
	re    *regexp.Regexp
	limit int
}{
	{regexp.MustCompile(`^gemini`), 1_000_000},
	{regexp.MustCompile(`^gpt-4\.1`), 1_000_000},
	{regexp.MustCompile(`^(gpt-5|o[34])`), 400_000},
	{regexp.MustCompile(`^claude`), 200_000},
	{regexp.MustCompile(`^(gpt-4o|chatgpt-4o|gpt-4-turbo|o1)`), 128_000},
	{regexp.MustCompile(`^(kimi-k2|qwen3|qwen-(plus|max|turbo|long)|glm-4\.[5-9]|glm-[5-9]|grok-4|llama-4)`), 128_000},
	{regexp.MustCompile(`^deepseek`), 64_000},
	{regexp.MustCompile(`^gemma`), 32_000},
}

// ProfileOf reads a model's abilities from its id.
func ProfileOf(modelID string) Profile {
	f := family(modelID)
	p := Profile{FixedTemperature: reasoning.MatchString(f)}
	switch {
	case visionYes.MatchString(f), visionHint.MatchString(f):
		p.Vision = true
	case visionNo.MatchString(f):
		p.Vision = false
	default:
		p.Vision = true // unknown: try, and learn from a refusal
	}
	for _, c := range contextByFamily {
		if c.re.MatchString(f) {
			p.ContextLimit = c.limit
			break
		}
	}
	return p
}

var (
	noImagesMu sync.Mutex
	noImages   = map[string]bool{}
)

// NoImages records that a model refused an image, so it is not sent one again in this session.
func NoImages(m *Model) {
	noImagesMu.Lock()
	noImages[m.Provider+"|"+m.BaseURL+"|"+m.ModelID] = true
	noImagesMu.Unlock()
}

func refusedImages(m *Model) bool {
	noImagesMu.Lock()
	defer noImagesMu.Unlock()
	return noImages[m.Provider+"|"+m.BaseURL+"|"+m.ModelID]
}
