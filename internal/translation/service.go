package translation

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"
	"time"

	"popmind/internal/ai"
	"popmind/internal/logx"
	"popmind/internal/settings"
)

type engine struct {
	translate  func(ctx context.Context, r Request, c settings.Capability) (Result, error)
	detect     func(ctx context.Context, text string) (string, error)
	configured func(c settings.Capability) bool
}

func always(settings.Capability) bool { return true }

var engines = map[string]engine{
	Google: {func(ctx context.Context, r Request, _ settings.Capability) (Result, error) {
		return googleTranslate(ctx, r)
	}, googleDetect, always},
	Bing: {func(ctx context.Context, r Request, _ settings.Capability) (Result, error) {
		return bingTranslate(ctx, r)
	}, bingDetect, always},
	DeepL: {func(ctx context.Context, r Request, _ settings.Capability) (Result, error) {
		return deeplTranslate(ctx, r)
	}, deeplDetect, always},
	Youdao: {func(ctx context.Context, r Request, _ settings.Capability) (Result, error) {
		return youdaoTranslate(ctx, r)
	}, youdaoDetect, always},
	AI: {func(ctx context.Context, r Request, c settings.Capability) (Result, error) {
		return aiTranslate(ctx, ai.Resolve(c, ""), AI, r)
	}, nil, func(c settings.Capability) bool { return ai.Resolve(c, "") != nil }},
	Gemma: {func(ctx context.Context, r Request, c settings.Capability) (Result, error) {
		return aiTranslate(ctx, ai.Resolve(c, ai.Gemma), Gemma, r)
	}, nil, func(c settings.Capability) bool { return ai.Resolve(c, ai.Gemma) != nil }},
}

// builtInFallback are the free web engines, tried last even when the user has not enabled them.
var builtInFallback = []string{Bing, Google, DeepL}

const (
	webTimeout = 8 * time.Second
	llmTimeout = 45 * time.Second
)

func gemmaConfigured(c settings.Capability) bool { return ai.Resolve(c, ai.Gemma) != nil }

// VisibleEngines are the engines the settings show (Gemma once it is set up).
func VisibleEngines(c settings.Capability) []string {
	return slices.DeleteFunc(slices.Clone(EngineOrder), func(id string) bool { return id == Gemma && !gemmaConfigured(c) })
}

// EnabledEngines lists the enabled engines, the AI (or Gemma) one first when configured.
func EnabledEngines(c settings.Capability) []string {
	var enabled []string
	for _, id := range VisibleEngines(c) {
		if c.EnabledEngines[id] {
			enabled = append(enabled, id)
		}
	}
	first := func(id string) []string {
		return append([]string{id}, slices.DeleteFunc(slices.Clone(enabled), func(e string) bool { return e == id })...)
	}
	aiReady := c.EnabledEngines[AI] && ai.Resolve(c, "") != nil
	if aiReady && slices.Contains(enabled, AI) {
		return first(AI)
	}
	if c.EnabledEngines[Gemma] && gemmaConfigured(c) && slices.Contains(enabled, Gemma) {
		return first(Gemma)
	}
	return enabled
}

// PreferredEngine is preferred when enabled, else the first enabled engine.
func PreferredEngine(c settings.Capability, preferred string) string {
	enabled := EnabledEngines(c)
	if preferred != "" && slices.Contains(enabled, preferred) {
		return preferred
	}
	if len(enabled) > 0 {
		return enabled[0]
	}
	return ""
}

// AutoTarget is the target for a detected source: the second language for text in the first, else the first.
func AutoTarget(c settings.Capability, detected string) string {
	if detected != "" && SameLanguage(detected, c.FirstLanguage) {
		return c.SecondLanguage
	}
	return c.FirstLanguage
}

func detect(ctx context.Context, text string, engineID string) (string, string) {
	if e, ok := engines[engineID]; ok && e.detect != nil {
		ctx, cancel := context.WithTimeout(ctx, 3*time.Second)
		defer cancel()
		if lang, err := e.detect(ctx, text); err == nil && lang != "" && lang != "auto" {
			return lang, "remote"
		} else if err != nil {
			logx.Warn("[translation] engine detector failed, using local rules", "engine", engineID, "err", err)
		}
	}
	return GuessSourceLanguage(text), "local"
}

// Translate translates in, trying the preferred engine first and the others after it.
func Translate(ctx context.Context, in Input) (Result, error) {
	c := settings.Capabilities.Get()
	text := NormalizeText(strings.TrimSpace(in.Text))
	if text == "" {
		return Result{}, errors.New("Translation text is empty")
	}
	source := cmpOr(in.SourceLanguage, c.DefaultSourceLanguage, "auto")
	mode := in.QueryMode
	if mode == "" {
		mode = QueryMode(text, source)
	}
	preferred := PreferredEngine(c, in.Engine)
	useWord := mode == "word"
	engineID := preferred
	if useWord {
		engineID = Youdao
	} else {
		mode = "text"
	}
	if engineID == "" {
		return Result{}, errors.New("No translation engine is enabled")
	}

	explicitTarget := ""
	if in.TargetLanguage != "" && in.TargetLanguage != "auto" {
		explicitTarget = in.TargetLanguage
	}
	detected, detectSource := "", "explicit"
	if source != "auto" {
		detected = source
	}
	if explicitTarget == "" && source == "auto" {
		detected, detectSource = detect(ctx, text, engineID)
	}
	target := explicitTarget
	if target == "" {
		target = AutoTarget(c, detected)
	}
	if useWord && Family(target) != "zh" && Family(c.SecondLanguage) == "zh" {
		target = c.SecondLanguage
	}

	chain := []string{}
	if useWord {
		chain = append(chain, Youdao)
	}
	textPrimary := engineID
	if useWord {
		textPrimary = preferred
	}
	for _, id := range append(append([]string{textPrimary}, EnabledEngines(c)...), builtInFallback...) {
		if id != "" && !slices.Contains(chain, id) && engines[id].configured(c) {
			chain = append(chain, id)
		}
	}

	markdown := !useWord && LooksLikeMarkdown(text)
	req := Request{Text: text, SourceLanguage: source, TargetLanguage: target, QueryMode: mode}
	started := time.Now()
	var firstErr error
	for _, id := range chain {
		attempt := req
		attempt.Engine = id
		if id != Youdao {
			attempt.QueryMode = "text"
		}
		timeout := webTimeout
		if id == AI || id == Gemma {
			timeout = llmTimeout
		} else if markdown {
			timeout = 3 * webTimeout
		}
		actx, cancel := context.WithTimeout(ctx, timeout)
		var res Result
		var err error
		if markdown && id != AI && id != Gemma && attempt.QueryMode == "text" {
			e := engines[id]
			res, err = translateMarkdown(actx, func(ctx context.Context, r Request) (Result, error) { return e.translate(ctx, r, c) }, attempt)
		} else {
			res, err = engines[id].translate(actx, attempt, c)
		}
		cancel()
		if markdown && err == nil {
			res.SourceText, res.Markdown = text, true
		}
		if err == nil && strings.TrimSpace(res.TranslatedText) == "" && res.Word == nil {
			err = fmt.Errorf("Translation engine %q returned an empty result", id)
		}
		if err != nil {
			if ctx.Err() != nil {
				return Result{}, ctx.Err()
			}
			firstErr = cmpErr(firstErr, err)
			logx.Warn("[translation] engine failed, trying next", "engine", id, "err", err)
			continue
		}
		res.SourceLanguage = source
		res.TargetLanguage = target
		if res.DetectedSourceLanguage == "" || res.DetectedSourceLanguage == "auto" {
			res.DetectedSourceLanguage = detected
		}
		logx.Info("[translation] done", "engine", id, "requested", engineID, "detect", detectSource,
			"detected", res.DetectedSourceLanguage, "target", target, "ms", time.Since(started).Milliseconds(), "chars", len([]rune(text)))
		return res, nil
	}
	if firstErr == nil {
		firstErr = errors.New("No translation engine is available")
	}
	return Result{}, firstErr
}

func cmpErr(a, b error) error {
	if a != nil {
		return a
	}
	return b
}

func aiTranslate(ctx context.Context, m *ai.Model, engineID string, r Request) (Result, error) {
	if m == nil {
		return Result{}, errors.New("AI translation is not configured")
	}
	system := strings.Join([]string{
		"You are a professional translation engine inside a desktop app.",
		"Translate the user text faithfully into the target language and never answer questions or add commentary.",
		"Preserve the original meaning, tone, structure, paragraphs, markdown, lists, line breaks, code blocks, inline code, URLs, placeholders, punctuation, and proper nouns whenever possible.",
		"When the text is markdown, translatedText must be markdown with the same structure: keep headings, list markers, tables, emphasis, links (translate their text, keep their URLs) and code blocks (keep code unchanged, translate only comments if any) exactly where they are.",
		"If the source text is a short UI string, keep the translation concise and natural.",
		"If the source text contains code or identifiers, keep code tokens unchanged unless they are plain natural-language words.",
		`Return only a JSON object: {"translatedText": string, "detectedSourceLanguage": string}.`,
		"detectedSourceLanguage must be a language code such as en, zh-CN, ja, ko, fr, de, es, ru, it, pt, or auto only when detection truly fails.",
	}, " ")
	prompt := fmt.Sprintf("sourceLanguage: %s (%s)\ntargetLanguage: %s (%s)\ntext:\n%s",
		r.SourceLanguage, englishLabel(r.SourceLanguage), r.TargetLanguage, englishLabel(r.TargetLanguage), r.Text)
	reply, err := ai.Generate(ctx, m, ai.Request{System: system, Messages: []ai.Message{{Role: "user", Content: prompt}}, Temperature: ai.Float(0.1)})
	if err != nil {
		return Result{}, err
	}
	var out struct {
		TranslatedText         string `json:"translatedText"`
		DetectedSourceLanguage string `json:"detectedSourceLanguage"`
	}
	if err := ai.ExtractJSON(reply, &out); err != nil || strings.TrimSpace(out.TranslatedText) == "" {
		// A model that ignored the format still answered with the translation.
		out.TranslatedText = strings.TrimSpace(reply)
	}
	if out.TranslatedText == "" {
		return Result{}, errors.New("AI translate returned an empty result")
	}
	translated := Trim(out.TranslatedText)
	if LooksLikeMarkdown(r.Text) {
		// Trim would squeeze the indentation of code blocks.
		translated = strings.Trim(strings.ReplaceAll(out.TranslatedText, "\r\n", "\n"), "\n ")
	}
	return textResult(engineID, r, translated, strings.TrimSpace(out.DetectedSourceLanguage)), nil
}
