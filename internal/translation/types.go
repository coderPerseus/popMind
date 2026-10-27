// Package translation translates text with the engines of the Electron app — Google, Bing, DeepL and Youdao
// through their web endpoints, and the AI / local Gemma models — falling back from one to the next, with the
// same language rules (lib/translation/service.ts).
package translation

// Engine ids.
const (
	Google = "google"
	DeepL  = "deepl"
	Bing   = "bing"
	Youdao = "youdao"
	AI     = "ai"
	Gemma  = "gemma"
)

// EngineOrder is how the settings list the engines.
var EngineOrder = []string{Google, DeepL, Bing, Youdao, AI, Gemma}

// EngineLabels are their names.
var EngineLabels = map[string]string{Google: "Google", DeepL: "DeepL", Bing: "Bing", Youdao: "有道", AI: "AI", Gemma: "Gemma"}

// Request is one translation.
type Request struct {
	Text           string
	SourceLanguage string
	TargetLanguage string
	QueryMode      string // "text" or "word"
	Engine         string
}

// WordPhonetic is a pronunciation.
type WordPhonetic struct{ Label, Value string }

// WordDefinition is a meaning, with its part of speech.
type WordDefinition struct{ Part, Meaning string }

// WordForm is an inflection.
type WordForm struct{ Label, Value string }

// WordPhrase is a phrase with the word.
type WordPhrase struct{ Text, Meaning string }

// WordExample is a sentence and its translation.
type WordExample struct{ Source, Translated string }

// WordEntry is a dictionary entry (Youdao, English words).
type WordEntry struct {
	Headword    string
	Phonetics   []WordPhonetic
	Definitions []WordDefinition
	Forms       []WordForm
	Phrases     []WordPhrase
	Examples    []WordExample
}

// Result is a translation.
type Result struct {
	Engine                 string
	QueryMode              string
	SourceLanguage         string
	TargetLanguage         string
	SourceText             string
	TranslatedText         string
	DetectedSourceLanguage string
	Word                   *WordEntry
	// Markdown is set when the text was markdown: the translation is markdown with the same structure.
	Markdown bool
}

// Input is what the UI asks for; empty fields take the settings' defaults.
type Input struct {
	Text           string
	SourceLanguage string // "" or "auto": detect
	TargetLanguage string // "" or "auto": the first/second language rule
	QueryMode      string
	Engine         string
}
