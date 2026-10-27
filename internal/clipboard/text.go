package clipboard

import (
	"fmt"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
	"sync"
)

const (
	titleMax   = 72
	previewMax = 500
)

// NormalizeText unifies line endings and trims.
func NormalizeText(s string) string {
	return strings.TrimSpace(strings.ReplaceAll(strings.ReplaceAll(s, "\r\n", "\n"), "\r", "\n"))
}

var whitespace = regexp.MustCompile(`\s+`)

func truncate(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return strings.TrimRight(string(r[:max-1]), " \t\n") + "…"
}

// Preview is the card summary of an item.
func Preview(kind, text, url, color string, files []string, w, h int) string {
	switch kind {
	case KindFile:
		var names []string
		for i, p := range files {
			if i == 3 {
				break
			}
			names = append(names, filepath.Base(p))
		}
		return strings.Join(names, " · ")
	case KindImage:
		if w > 0 && h > 0 {
			return fmt.Sprintf("%d×%d", w, h)
		}
		return "Image"
	case KindColor:
		return cmpOr(color, text)
	case KindLink:
		return truncate(cmpOr(url, text), previewMax)
	}
	return truncate(regexp.MustCompile(`\n{2,}`).ReplaceAllString(text, "\n"), previewMax)
}

// DeriveTitle is an item's title when it has no custom one.
func DeriveTitle(kind, text, url, color string, files []string, fileCount, w, h int) string {
	switch kind {
	case KindImage:
		return fmt.Sprintf("Image %d×%d", w, h)
	case KindFile:
		if fileCount == 0 {
			fileCount = len(files)
		}
		if fileCount == 1 && len(files) > 0 {
			return filepath.Base(strings.TrimSuffix(files[0], "/"))
		}
		if fileCount == 1 {
			return "File"
		}
		return fmt.Sprintf("%d files", fileCount)
	case KindColor:
		return cmpOr(color, text, "Color")
	case KindLink:
		return truncate(cmpOr(url, text, "Link"), titleMax)
	}
	for _, line := range strings.Split(text, "\n") {
		if strings.TrimSpace(line) != "" {
			return truncate(strings.TrimSpace(whitespace.ReplaceAllString(line, " ")), titleMax)
		}
	}
	return "Clipboard Item"
}

// Fingerprints: text, links and colors share one namespace so a rich or URL copy of a value is one item.
func textFingerprint(v string) string { return "txt:" + sha([]byte(v)) }
func imageFingerprint(png []byte) string {
	return "img:" + sha(png)
}
func filesFingerprint(paths []string) string {
	sorted := append([]string{}, paths...)
	sort.Strings(sorted)
	return "file:" + sha([]byte(strings.Join(sorted, "\n")))
}

// ---- classification ----

var (
	hexWithHash   = regexp.MustCompile(`(?i)^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$`)
	hexBareSix    = regexp.MustCompile(`(?i)^[\da-f]{6}$`)
	cssColorFunc  = regexp.MustCompile(`(?i)^(?:rgb|hsl)a?\(\s*[\d.%\s,/a-z-]+\)$`)
	httpURL       = regexp.MustCompile(`(?i)^https?://\S+$`)
	anySchemeURL  = regexp.MustCompile(`(?i)^[a-z][a-z\d+.-]*://\S+$`)
	hasHexLetter  = regexp.MustCompile(`(?i)[a-f]`)
	emailPattern  = regexp.MustCompile(`^[^\s@]+@[^\s@]+\.[^\s@]+$`)
	phonePattern  = regexp.MustCompile(`^\+?[\d\s()-]{7,20}$`)
	pathPattern   = regexp.MustCompile(`^(?:~|/)[^\s]*$`)
	numberPattern = regexp.MustCompile(`^-?[\d,]+(?:\.\d+)?$`)
	codeHints     = regexp.MustCompile(`(?m)(?:^\s*(?:func|function|const|let|var|import|export|class|def|return|if|for)\b|[{};]\s*$|=>)`)
)

func isColorText(v string) bool {
	c := strings.TrimSpace(v)
	if c == "" || len(c) > 64 {
		return false
	}
	return hexWithHash.MatchString(c) || cssColorFunc.MatchString(c) || (hexBareSix.MatchString(c) && hasHexLetter.MatchString(c))
}

func normalizeColor(v string) string {
	c := strings.TrimSpace(v)
	if hexBareSix.MatchString(c) {
		return "#" + strings.ToLower(c)
	}
	if hexWithHash.MatchString(c) {
		return strings.ToLower(c)
	}
	return c
}

// localTags tags text by shape (a subset of lib/clipboard/search/local-tags.ts): the sub-kind cards show, and
// "secret" for keys and tokens.
func localTags(text string) (subKind string, tags []string) {
	t := strings.TrimSpace(text)
	switch {
	case emailPattern.MatchString(t):
		subKind = "email"
	case phonePattern.MatchString(t) && len(regexp.MustCompile(`\d`).FindAllString(t, -1)) >= 7:
		subKind = "phone"
	case numberPattern.MatchString(t):
		subKind = "number"
	case pathPattern.MatchString(t) && strings.Contains(t, "/") && len(t) > 1:
		subKind = "path"
	case (strings.HasPrefix(t, "{") && strings.HasSuffix(t, "}")) || (strings.HasPrefix(t, "[") && strings.HasSuffix(t, "]")):
		subKind = "json"
	case codeHints.MatchString(t):
		subKind = "code"
	}
	if subKind != "" {
		tags = append(tags, subKind)
	}
	if findSecret(t) != "" {
		tags = append(tags, "secret")
	}
	return subKind, tags
}

type classification struct {
	kind, url, color, fingerprint, subKind string
	tags                                   []string
}

func classifyText(plain, urlHint string) classification {
	text := NormalizeText(plain)
	hint := strings.TrimSpace(urlHint)
	if hint != "" && len(hint) <= 4096 && anySchemeURL.MatchString(hint) {
		_, tags := localTags(hint)
		return classification{kind: KindLink, url: hint, fingerprint: textFingerprint(hint), tags: tags}
	}
	if isColorText(text) {
		c := normalizeColor(text)
		return classification{kind: KindColor, color: c, fingerprint: textFingerprint(c)}
	}
	if len(text) <= 4096 && httpURL.MatchString(text) {
		_, tags := localTags(text)
		return classification{kind: KindLink, url: text, fingerprint: textFingerprint(text), tags: tags}
	}
	sub, tags := localTags(text)
	return classification{kind: KindText, fingerprint: textFingerprint(text), subKind: sub, tags: tags}
}

// TextRecord builds a record for text the user typed (new item).
func TextRecord(text string, copiedAt int64) Record {
	t := NormalizeText(text)
	c := classifyText(t, "")
	return Record{Kind: c.kind, SubKind: c.subKind, Fingerprint: c.fingerprint, PlainText: t, URL: c.url, Color: c.color,
		Title: DeriveTitle(c.kind, t, c.url, c.color, nil, 0, 0, 0), Preview: Preview(c.kind, t, c.url, c.color, nil, 0, 0),
		Reps: []Representation{{UTI: "public.utf8-plain-text", Data: []byte(t)}}, ByteSize: int64(len(t)),
		CharCount: len([]rune(t)), Tags: c.tags, CopiedAt: copiedAt}
}

// ---- privacy ----

var secretPatterns = []struct {
	name    string
	pattern *regexp.Regexp
}{
	{"pem-private-key", regexp.MustCompile(`-----BEGIN (?:[A-Z]+ )*PRIVATE KEY(?: BLOCK)?-----`)},
	{"github-token", regexp.MustCompile(`\bgh[pousr]_[A-Za-z0-9]{36,}\b`)},
	{"github-fine-grained-pat", regexp.MustCompile(`\bgithub_pat_[A-Za-z0-9_]{22,}\b`)},
	{"openai-style-key", regexp.MustCompile(`\bsk-(?:proj-|ant-[a-z\d]+-)?[A-Za-z0-9_-]{20,}`)},
	{"slack-token", regexp.MustCompile(`\bxox[abprso]-[A-Za-z0-9-]{10,}`)},
	{"aws-access-key-id", regexp.MustCompile(`\b(?:AKIA|ASIA)[0-9A-Z]{16}\b`)},
	{"jwt", regexp.MustCompile(`\beyJ[A-Za-z0-9_-]{8,}\.eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}`)},
	{"labeled-secret", regexp.MustCompile(`(?i)\b(?:api[_-]?key|secret(?:[_-]?key)?|access[_-]?token|auth[_-]?token|token|passw(?:or)?d|pwd)\s*[:=]\s*["']?[A-Za-z0-9_\-/+=.]{16,}`)},
}

var openAIDigit = regexp.MustCompile(`\bsk-(?:proj-|ant-[a-z\d]+-)?[A-Za-z0-9_-]*\d`)

func findSecret(text string) string {
	if len(text) > 100_000 {
		text = text[:100_000]
	}
	for _, p := range secretPatterns {
		if p.pattern.MatchString(text) {
			// Go's regexp has no lookahead: an OpenAI-style key also needs a digit.
			if p.name == "openai-style-key" && !openAIDigit.MatchString(text) {
				continue
			}
			return p.name
		}
	}
	return ""
}

// paused reports whether capture is paused.
func paused(s Settings, nowMs int64) bool {
	return s.PausedUntil == -1 || (s.PausedUntil > 0 && s.PausedUntil > nowMs)
}

type flags struct{ concealed, transient, autoGenerated bool }

func privacyPrecondition(s Settings, nowMs int64, sourceID, frontmostID string, f flags) string {
	if !s.Enabled {
		return "disabled"
	}
	if paused(s, nowMs) {
		return "paused"
	}
	for _, id := range []string{sourceID, frontmostID} {
		for _, ignored := range s.Privacy.IgnoredBundleIDs {
			if id != "" && strings.EqualFold(id, ignored) {
				return "ignored-app"
			}
		}
	}
	switch {
	case f.concealed && s.Privacy.IgnoreConfidential:
		return "concealed"
	case f.transient && s.Privacy.IgnoreTransient:
		return "transient"
	case f.autoGenerated && s.Privacy.IgnoreTransient:
		return "auto-generated"
	}
	return ""
}

var (
	userPatternsMu sync.Mutex
	userPatterns   = map[string]*regexp.Regexp{}
)

func privacyContent(s Settings, texts []string) string {
	for _, text := range texts {
		if text == "" {
			continue
		}
		for _, src := range s.Privacy.IgnoreRegexps {
			if src == "" {
				continue
			}
			userPatternsMu.Lock()
			re, ok := userPatterns[src]
			if !ok {
				re, _ = regexp.Compile(src)
				userPatterns[src] = re
			}
			userPatternsMu.Unlock()
			if re != nil && re.MatchString(text) {
				return "user-regexp"
			}
		}
		if s.Privacy.SkipSecrets {
			if name := findSecret(text); name != "" {
				return "secret:" + name
			}
		}
	}
	return ""
}
