package settings

import (
	_ "embed"
	"encoding/json"
	"strings"
	"sync"

	"popmind/internal/jsonx"
	"popmind/internal/logx"
)

//go:embed defaults/capability-settings.json
var defaultCapabilityJSON []byte

//go:embed defaults/shortcuts.json
var defaultShortcutsJSON []byte

//go:embed defaults/translation-shared.json
var translationSharedJSON []byte

const capabilityFile = "capability-settings.json"

// CapabilityStateChannel is pushed to every page when the settings change.
const CapabilityStateChannel = "capability:state"

// Capability is the typed view of the fields the Go side reads; the full settings stay a JSON object so
// fields the Go side does not know survive round trips.
type Capability struct {
	AppLanguage string `json:"appLanguage"`
	Selection   struct {
		DefaultAction string `json:"defaultAction"`
		// ExplainScreenshot attaches a silent capture of the window the text is in to explanations; nil is on.
		ExplainScreenshot *bool `json:"explainScreenshot"`
	} `json:"selection"`
	Shortcuts             map[string]string `json:"shortcuts"`
	EnabledEngines        map[string]bool   `json:"enabledEngines"`
	FirstLanguage         string            `json:"firstLanguage"`
	SecondLanguage        string            `json:"secondLanguage"`
	DefaultSourceLanguage string            `json:"defaultSourceLanguage"`
	AIService             AIService         `json:"aiService"`
	LocalModels           struct {
		Gemma LocalGemma `json:"gemma"`
	} `json:"localModels"`
	WebSearch struct {
		Enabled   bool `json:"enabled"`
		Providers map[string]struct {
			APIKey string `json:"apiKey"`
		} `json:"providers"`
	} `json:"webSearch"`
	Clipboard map[string]any `json:"clipboard"`
}

// AIService is the configured AI providers.
type AIService struct {
	ActiveProvider *string                     `json:"activeProvider"`
	Providers      map[string]AIProviderConfig `json:"providers"`
}

// AIProviderConfig is one AI provider's connection.
type AIProviderConfig struct {
	APIKey  string `json:"apiKey"`
	BaseURL string `json:"baseURL"`
	Model   string `json:"model"`
	// Name and Format are the custom provider's (a relay): what it is called and the API it speaks
	// ("openai", "anthropic" or "google").
	Name   string `json:"name,omitempty"`
	Format string `json:"format,omitempty"`
}

// LocalGemma is the local OpenAI-compatible model.
type LocalGemma struct {
	Enabled bool   `json:"enabled"`
	APIKey  string `json:"apiKey"`
	BaseURL string `json:"baseURL"`
	Model   string `json:"model"`
}

// CapabilityStore keeps capability-settings.json.
type CapabilityStore struct {
	mu        sync.Mutex
	value     map[string]any
	listeners []func(Capability)
	notify    func(map[string]any)
}

// Capabilities is the app's capability store.
var Capabilities = &CapabilityStore{}

func defaults() map[string]any {
	var v map[string]any
	if err := json.Unmarshal(defaultCapabilityJSON, &v); err != nil {
		panic(err)
	}
	return v
}

// DefaultShortcuts is the Electron app's defaultShortcutBindings.
func DefaultShortcuts() map[string]string {
	var v map[string]string
	_ = json.Unmarshal(defaultShortcutsJSON, &v)
	return v
}

// TranslationShared is lib/translation/shared.ts's exported constants (languages, engine order and labels).
func TranslationShared() map[string]any {
	var v map[string]any
	_ = json.Unmarshal(translationSharedJSON, &v)
	return v
}

// SetBroadcaster sets how changes reach pages (the IPC broadcast); call at startup.
func (s *CapabilityStore) SetBroadcaster(fn func(map[string]any)) {
	s.mu.Lock()
	s.notify = fn
	s.mu.Unlock()
}

// Load reads the settings, importing the Electron app's on first launch. locale picks the initial language.
func (s *CapabilityStore) Load(locale string) {
	imported := ImportLegacy(false).Changed
	value := defaults()
	var stored map[string]any
	if err := jsonx.ReadFile(Path(capabilityFile), &stored); err == nil {
		value = normalize(jsonx.Merge(value, stored).(map[string]any), stored)
	} else {
		lang := "zh-CN"
		if strings.HasPrefix(strings.ToLower(locale), "en") {
			lang = "en"
		}
		value["appLanguage"] = lang
		if err := jsonx.WriteFile(Path(capabilityFile), value); err != nil {
			logx.Error("[settings] write capability settings failed", "err", err)
		}
	}
	s.mu.Lock()
	s.value = value
	s.mu.Unlock()
	logx.Info("[settings] capability settings loaded", "importedFromElectron", imported, "appLanguage", value["appLanguage"])
}

// Raw returns a copy of the full settings object.
func (s *CapabilityStore) Raw() map[string]any {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.value == nil {
		s.value = defaults()
	}
	return jsonx.Clone(s.value).(map[string]any)
}

// Get returns the typed view.
func (s *CapabilityStore) Get() Capability {
	var c Capability
	_ = jsonx.Convert(s.Raw(), &c)
	return c
}

// Update merges patch, persists and broadcasts the result, which it returns.
func (s *CapabilityStore) Update(patch map[string]any) (map[string]any, error) {
	s.mu.Lock()
	if s.value == nil {
		s.value = defaults()
	}
	next := normalize(jsonx.Merge(s.value, patch).(map[string]any), patch)
	if err := jsonx.WriteFile(Path(capabilityFile), next); err != nil {
		s.mu.Unlock()
		return nil, err
	}
	s.value = next
	listeners := append([]func(Capability){}, s.listeners...)
	notify := s.notify
	s.mu.Unlock()

	if notify != nil {
		notify(jsonx.Clone(next).(map[string]any))
	}
	var typed Capability
	_ = jsonx.Convert(next, &typed)
	for _, fn := range listeners {
		fn(typed)
	}
	return jsonx.Clone(next).(map[string]any), nil
}

// Subscribe calls fn after every update.
func (s *CapabilityStore) Subscribe(fn func(Capability)) {
	s.mu.Lock()
	s.listeners = append(s.listeners, fn)
	s.mu.Unlock()
}

// normalize applies the rules of mergeCapabilitySettings (lib/capability/shared.ts) that a plain deep merge
// does not.
func normalize(v map[string]any, patch map[string]any) map[string]any {
	// The AI engine was once called "deepseek".
	if engines, ok := v["enabledEngines"].(map[string]any); ok {
		if legacy, ok := engines["deepseek"].(bool); ok {
			if _, has := jsonx.Get(patch, "enabledEngines", "ai").(bool); !has {
				engines["ai"] = legacy
			}
			delete(engines, "deepseek")
		}
	}
	// selection.defaultAction is one of three.
	sel, _ := v["selection"].(map[string]any)
	if sel == nil {
		sel = map[string]any{}
		v["selection"] = sel
	}
	if _, ok := sel["explainScreenshot"].(bool); !ok {
		sel["explainScreenshot"] = true
	}
	switch sel["defaultAction"] {
	case "bubble", "translate", "explain":
	default:
		sel["defaultAction"] = "bubble"
	}
	// Shortcuts: every action has a (trimmed) accelerator string.
	shortcuts, _ := v["shortcuts"].(map[string]any)
	normalized := map[string]any{}
	for id, fallback := range DefaultShortcuts() {
		if s, ok := shortcuts[id].(string); ok {
			normalized[id] = strings.TrimSpace(s)
		} else {
			normalized[id] = fallback
		}
	}
	v["shortcuts"] = normalized
	// The local Gemma model is mirrored into the "gemma" AI provider.
	if gemma, ok := jsonx.Get(v, "localModels", "gemma").(map[string]any); ok {
		if provider, ok := jsonx.Get(v, "aiService", "providers", "gemma").(map[string]any); ok {
			for _, key := range []string{"apiKey", "baseURL", "model"} {
				if _, patched := jsonx.Get(patch, "localModels", "gemma", key).(string); patched {
					provider[key] = gemma[key]
				} else if value, ok := jsonx.Get(patch, "aiService", "providers", "gemma", key).(string); ok {
					gemma[key] = value
				} else {
					provider[key] = gemma[key]
				}
			}
		}
	}
	return v
}

// ExplainScreenshotOn reports whether explanations take a capture of the source window as context.
func (c Capability) ExplainScreenshotOn() bool {
	return c.Selection.ExplainScreenshot == nil || *c.Selection.ExplainScreenshot
}
