package translation

import (
	"regexp"
	"strings"
	"unicode"

	"popmind/internal/i18n"
)

// Language is a language the translators offer.
type Language struct {
	Code  string
	Label string
}

var languageLabels = [][3]string{
	{"auto", "自动检测", "Auto Detect"},
	{"en", "英语", "English"},
	{"zh-CN", "简体中文", "Simplified Chinese"},
	{"zh-TW", "繁体中文", "Traditional Chinese"},
	{"ja", "日语", "Japanese"},
	{"ko", "韩语", "Korean"},
	{"fr", "法语", "French"},
	{"de", "德语", "German"},
	{"es", "西班牙语", "Spanish"},
	{"ru", "俄语", "Russian"},
	{"it", "意大利语", "Italian"},
	{"pt", "葡萄牙语", "Portuguese"},
}

// Languages lists the languages, with "auto" first, in the app's language.
func Languages() []Language {
	out := make([]Language, len(languageLabels))
	for i, l := range languageLabels {
		label := l[1]
		if i18n.IsEnglish() {
			label = l[2]
		}
		out[i] = Language{Code: l[0], Label: label}
	}
	return out
}

// LanguageLabel is the name of code.
func LanguageLabel(code string) string {
	for _, l := range Languages() {
		if l.Code == code {
			return l.Label
		}
	}
	return code
}

// englishLabel is the English name of code, for prompts.
func englishLabel(code string) string {
	for _, l := range languageLabels {
		if l[0] == code {
			return l[2]
		}
	}
	return code
}

// Family is the language without its region: "zh" for "zh-CN".
func Family(code string) string { return strings.Split(strings.ToLower(code), "-")[0] }

// SameLanguage reports whether two codes name the same language.
func SameLanguage(a, b string) bool { return strings.EqualFold(a, b) || Family(a) == Family(b) }

var (
	spacesRun   = regexp.MustCompile(`[^\S\n]+`)
	cjkKana     = regexp.MustCompile(`[\x{4e00}-\x{9fff}\x{3040}-\x{30ff}\x{ac00}-\x{d7af}]`)
	latin       = regexp.MustCompile(`[A-Za-z]`)
	englishWord = regexp.MustCompile(`^[A-Za-z]+(?:['-][A-Za-z]+)*$`)
)

// Trim normalizes line endings and spaces, as trimTranslationText.
func Trim(text string) string {
	lines := strings.Split(strings.ReplaceAll(text, "\r\n", "\n"), "\n")
	for i, line := range lines {
		lines[i] = strings.TrimRightFunc(spacesRun.ReplaceAllString(line, " "), unicode.IsSpace)
	}
	return strings.TrimSpace(strings.Join(lines, "\n"))
}

func looksLikeEnglish(text string) bool {
	t := Trim(text)
	if t == "" || cjkKana.MatchString(t) {
		return false
	}
	return len(latin.FindAllString(t, -1)) >= min(4, len([]rune(t)))
}

// GuessSourceLanguage is the local detector: scripts first, then English letters.
func GuessSourceLanguage(text string) string {
	t := Trim(text)
	switch {
	case t == "":
		return "auto"
	case regexp.MustCompile(`[\x{ac00}-\x{d7af}]`).MatchString(t):
		return "ko"
	case regexp.MustCompile(`[\x{3040}-\x{30ff}]`).MatchString(t):
		return "ja"
	case regexp.MustCompile(`[\x{4e00}-\x{9fff}]`).MatchString(t):
		return "zh-CN"
	case looksLikeEnglish(t):
		return "en"
	}
	return "auto"
}

// IsEnglishWord reports whether text is one English word, for the dictionary.
func IsEnglishWord(text string) bool { return englishWord.MatchString(text) && len(text) <= 48 }

// QueryMode is "word" for one English word (with an English or auto source), else "text".
func QueryMode(text, sourceLanguage string) string {
	if sourceLanguage == "" {
		sourceLanguage = "auto"
	}
	if sourceLanguage != "auto" && Family(sourceLanguage) != "en" {
		return "text"
	}
	if IsEnglishWord(Trim(text)) {
		return "word"
	}
	return "text"
}

var (
	identifierChars = regexp.MustCompile(`^[\p{L}\p{N}_-]+$`)
	camelBoundary   = regexp.MustCompile(`[\p{Ll}\p{N}][\p{Lu}]|[\p{Lu}]{2}[\p{Ll}]`)
)

// NormalizeText splits code identifiers (fooBar, foo_bar) into words before translating them.
func NormalizeText(text string) string {
	if text == "" || strings.ContainsAny(text, " \t\n") || !identifierChars.MatchString(text) ||
		!(strings.ContainsAny(text, "-_") || camelBoundary.MatchString(text)) {
		return text
	}
	s := regexp.MustCompile(`[-_]+`).ReplaceAllString(text, " ")
	s = regexp.MustCompile(`([\p{Lu}]+)([\p{Lu}][\p{Ll}])`).ReplaceAllString(s, "$1 $2")
	s = regexp.MustCompile(`([\p{Ll}\p{N}])([\p{Lu}])`).ReplaceAllString(s, "$1 $2")
	s = regexp.MustCompile(`(\p{L})(\p{N})`).ReplaceAllString(s, "$1 $2")
	s = regexp.MustCompile(`(\p{N})(\p{L})`).ReplaceAllString(s, "$1 $2")
	tokens := strings.Fields(s)
	for i, tok := range tokens {
		if !regexp.MustCompile(`^[\p{Lu}\p{N}]+$`).MatchString(tok) {
			tokens[i] = strings.ToLower(tok)
		}
	}
	return strings.Join(tokens, " ")
}
