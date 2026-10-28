package translation

import (
	"context"
	"fmt"
	"regexp"
	"strconv"
	"strings"
	"sync"
	"unicode"
)

// Markdown sent to the web engines (Google, Bing, DeepL, Youdao) loses its structure: they translate list
// markers, break tables and translate code. So the text is cut into its translatable pieces — the words of each
// line, without the line's markup; code, links' targets and HTML stand in as {{n}} placeholders, which the
// engines keep — those are translated in one request, one per line, and put back into the markup.
// The AI engines are asked to keep the markdown instead (aiTranslate's prompt).

var (
	mdFence     = regexp.MustCompile("^\\s*(```|~~~)")
	mdHeading   = regexp.MustCompile(`(?m)^#{1,6}\s+\S`)
	mdList      = regexp.MustCompile(`(?m)^\s*(?:[-*+]|\d+[.)])\s+\S`)
	mdQuote     = regexp.MustCompile(`(?m)^\s*>\s?\S`)
	mdTableSep  = regexp.MustCompile(`^\s*\|?\s*:?-{2,}:?\s*(?:\|\s*:?-{2,}:?\s*)+\|?\s*$`)
	mdLink      = regexp.MustCompile(`!?\[[^\]\n]*\]\([^)\s]+(?:\s+"[^"]*")?\)`)
	mdEmphasis  = regexp.MustCompile(`\*\*[^*\n]+\*\*|__[^_\n]+__|~~[^~\n]+~~`)
	mdCode      = regexp.MustCompile("`[^`\n]+`")
	mdRule      = regexp.MustCompile(`^\s*([-*_])(?:\s*([-*_])){2,}\s*$`)
	mdLinePre   = regexp.MustCompile(`^(\s*(?:>\s?)*\s*(?:#{1,6}\s+|(?:[-*+]|\d+[.)])\s+(?:\[[ xX]\]\s+)?)?)`)
	mdProtect   = regexp.MustCompile("`[^`\n]+`|!\\[[^\\]\n]*\\]\\([^)\\s]+(?:\\s+\"[^\"]*\")?\\)|\\]\\([^)\\s]+(?:\\s+\"[^\"]*\")?\\)|<[a-zA-Z/][^>\n]*>|https?://[^\\s)\\]>]+|\\{\\{\\d+\\}\\}")
	mdHolder    = regexp.MustCompile(`\{\{\s*(\d+)\s*\}\}`)
	mdUnitMark  = regexp.MustCompile("\x00(\\d+)\x00")
	mdBatchSize = 1800
)

// LooksLikeMarkdown reports whether text is markdown worth keeping: a code fence, a heading or a table, or
// two other signs of it (lists, quotes, links, bold, inline code).
func LooksLikeMarkdown(text string) bool {
	lines := strings.Split(text, "\n")
	for _, l := range lines {
		if mdFence.MatchString(l) || mdTableSep.MatchString(l) {
			return true
		}
	}
	if mdHeading.MatchString(text) {
		return true
	}
	score := 0
	if n := len(mdList.FindAllString(text, 3)); n >= 2 {
		score += 2
	} else {
		score += n
	}
	for _, re := range []*regexp.Regexp{mdQuote, mdLink, mdEmphasis, mdCode} {
		if re.MatchString(text) {
			score++
		}
	}
	return score >= 2
}

// mdDoc is markdown cut into a template, with \x00n\x00 where unit n goes, and the units to translate.
type mdDoc struct {
	template string
	units    []mdUnit
}

type mdUnit struct {
	text      string   // with {{k}} for the protected spans
	protected []string // what the placeholders stand for
}

func hasWords(s string) bool {
	for _, r := range s {
		if unicode.IsLetter(r) {
			return true
		}
	}
	return false
}

// isLabel reports whether s is a lone letter (a, b, x in a table's cells): a name, not a word to translate.
func isLabel(s string) bool {
	letters := 0
	for _, r := range s {
		if unicode.IsLetter(r) {
			letters++
		}
	}
	return letters <= 1 && len([]rune(strings.TrimSpace(s))) <= 2
}

func (d *mdDoc) unit(text string) string {
	lead := text[:len(text)-len(strings.TrimLeft(text, " \t"))]
	trail := text[len(strings.TrimRight(text, " \t")):]
	core := strings.TrimSpace(text)
	if core == "" {
		return text
	}
	var protected []string
	masked := mdProtect.ReplaceAllStringFunc(core, func(m string) string {
		// A link's target goes, its brackets stay: "[text]{{k}}" reads as balanced text to the engines.
		prefix := ""
		if strings.HasPrefix(m, "](") {
			prefix, m = "]", m[1:]
		}
		protected = append(protected, m)
		return prefix + "{{" + strconv.Itoa(len(protected)-1) + "}}"
	})
	if words := mdHolder.ReplaceAllString(masked, ""); !hasWords(words) || isLabel(words) {
		return text
	}
	d.units = append(d.units, mdUnit{text: masked, protected: protected})
	return lead + "\x00" + strconv.Itoa(len(d.units)-1) + "\x00" + trail
}

func parseMarkdown(text string) *mdDoc {
	d := &mdDoc{}
	var out []string
	fence := ""
	for _, line := range strings.Split(text, "\n") {
		if m := mdFence.FindStringSubmatch(line); m != nil {
			switch {
			case fence == "":
				fence = m[1]
			case m[1] == fence:
				fence = ""
			}
			out = append(out, line)
			continue
		}
		switch {
		case fence != "", strings.TrimSpace(line) == "", mdRule.MatchString(line), mdTableSep.MatchString(line),
			strings.HasPrefix(line, "    ") || strings.HasPrefix(line, "\t"):
			out = append(out, line)
		case strings.HasPrefix(strings.TrimSpace(line), "|"):
			cells := strings.Split(line, "|")
			for i, cell := range cells {
				cells[i] = d.unit(cell)
			}
			out = append(out, strings.Join(cells, "|"))
		default:
			pre := mdLinePre.FindString(line)
			out = append(out, pre+d.unit(line[len(pre):]))
		}
	}
	d.template = strings.Join(out, "\n")
	return d
}

// restore puts unit i's translation back into the template, with its protected spans.
func (d *mdDoc) restore(translated []string) string {
	return mdUnitMark.ReplaceAllStringFunc(d.template, func(m string) string {
		i, _ := strconv.Atoi(mdUnitMark.FindStringSubmatch(m)[1])
		u := d.units[i]
		t := translated[i]
		used := map[int]bool{}
		t = mdHolder.ReplaceAllStringFunc(t, func(h string) string {
			k, _ := strconv.Atoi(mdHolder.FindStringSubmatch(h)[1])
			if k < len(u.protected) {
				used[k] = true
				return u.protected[k]
			}
			return h
		})
		// A span the engine dropped is added at the end, so no code or link goes missing.
		for k, p := range u.protected {
			if !used[k] {
				t += " " + p
			}
		}
		return t
	})
}

// translateMarkdown translates markdown with a web engine, keeping its structure.
func translateMarkdown(ctx context.Context, translate func(context.Context, Request) (Result, error), r Request) (Result, error) {
	d := parseMarkdown(r.Text)
	if len(d.units) == 0 {
		res := Result{Engine: r.Engine, QueryMode: "text", SourceText: r.Text, TranslatedText: r.Text}
		return res, nil
	}
	// Units go in batches of about 1800 characters, one per line.
	var batches [][]int
	size := 0
	for i, u := range d.units {
		if len(batches) == 0 || size+len(u.text) > mdBatchSize {
			batches = append(batches, nil)
			size = 0
		}
		batches[len(batches)-1] = append(batches[len(batches)-1], i)
		size += len(u.text) + 1
	}
	translated := make([]string, len(d.units))
	detected := ""
	var mu sync.Mutex
	var firstErr error
	var wg sync.WaitGroup
	sem := make(chan struct{}, 3)
	one := func(ids []int) {
		defer wg.Done()
		sem <- struct{}{}
		defer func() { <-sem }()
		lines := make([]string, len(ids))
		for j, i := range ids {
			lines[j] = d.units[i].text
		}
		req := r
		req.Text = strings.Join(lines, "\n")
		res, err := translate(ctx, req)
		var got []string
		if err == nil {
			got = strings.Split(strings.Trim(res.TranslatedText, "\n"), "\n")
		}
		if err == nil && len(got) != len(ids) {
			// The engine merged or split lines: translate them one by one.
			got = make([]string, len(ids))
			for j, line := range lines {
				req.Text = line
				single, e := translate(ctx, req)
				if e != nil {
					err = e
					break
				}
				got[j] = strings.ReplaceAll(strings.TrimSpace(single.TranslatedText), "\n", " ")
			}
		}
		mu.Lock()
		defer mu.Unlock()
		if err != nil {
			if firstErr == nil {
				firstErr = err
			}
			return
		}
		if detected == "" {
			detected = res.DetectedSourceLanguage
		}
		for j, i := range ids {
			translated[i] = strings.TrimSpace(got[j])
		}
	}
	for _, b := range batches {
		wg.Add(1)
		go one(b)
	}
	wg.Wait()
	if firstErr != nil {
		return Result{}, firstErr
	}
	out := d.restore(translated)
	if strings.TrimSpace(out) == "" {
		return Result{}, fmt.Errorf("markdown translation came back empty")
	}
	return Result{Engine: r.Engine, QueryMode: "text", SourceText: r.Text, TranslatedText: out, DetectedSourceLanguage: detected}, nil
}
