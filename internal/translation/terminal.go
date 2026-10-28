package translation

import (
	"regexp"
	"strings"
	"unicode"
	"unicode/utf8"
)

// Text selected in a terminal (a coding agent's reply, a CLI's output) comes with what the terminal drew
// around it: tables in box-drawing lines (┌─┬─┐ │ ├─┼─┤), or in ASCII (+---+), and an indent shared by every
// line. The engines would translate the lines of a table as text and mangle it, and markdown reads a deep
// indent as code. CleanTerminalText turns such tables into markdown tables, which the markdown path then
// translates cell by cell and the popup shows as a table, and drops the shared indent and the agents' reply
// markers (⏺, ⎿).

// boxVertical are the characters a box-drawn table's rows start and end with, and split their cells by.
const boxVertical = "│┃║"

var (
	asciiBorder = regexp.MustCompile(`^\+[-=+:]+\+$`)
	asciiRow    = regexp.MustCompile(`^\|.*\|$`)
)

// isBoxBorder reports whether line is a border of a box-drawn table: only box-drawing characters (and the
// spaces between them), with a run of horizontal lines.
func isBoxBorder(line string) bool {
	t := strings.TrimSpace(line)
	if t == "" {
		return false
	}
	if asciiBorder.MatchString(t) {
		return true
	}
	horizontal := 0
	for _, r := range t {
		switch {
		case r == '─' || r == '━' || r == '═' || r == '╌' || r == '┄':
			horizontal++
		case r >= 0x2500 && r <= 0x257F, r == ' ':
		default:
			return false
		}
	}
	return horizontal >= 3
}

// rowSep is the vertical character line uses as a table row, or 0 when it is not one.
func rowSep(line string, ascii bool) rune {
	t := strings.TrimSpace(line)
	if t == "" {
		return 0
	}
	first, _ := utf8.DecodeRuneInString(t)
	last, _ := utf8.DecodeLastRuneInString(t)
	if strings.ContainsRune(boxVertical, first) && first == last && utf8.RuneCountInString(t) > 1 {
		return first
	}
	if ascii && asciiRow.MatchString(t) {
		return '|'
	}
	return 0
}

// CleanTerminalText returns text with box-drawn tables as markdown tables, without the indent all its lines
// share and the agents' reply markers. Text without them comes back as it is.
func CleanTerminalText(text string) string {
	lines := strings.Split(text, "\n")
	for i, l := range lines {
		// The marker of a reply, as Claude Code draws it, kept as wide as it was so the indent stays shared.
		trimmed := strings.TrimLeft(l, " ")
		for _, m := range []string{"⏺ ", "⎿ ", "● "} {
			if strings.HasPrefix(trimmed, m) {
				lines[i] = l[:len(l)-len(trimmed)] + strings.Repeat(" ", utf8.RuneCountInString(m)) + trimmed[len(m):]
			}
		}
	}
	lines = dedent(lines)
	var out []string
	for i := 0; i < len(lines); {
		if n, table := boxTable(lines[i:]); n > 0 {
			if len(out) > 0 && strings.TrimSpace(out[len(out)-1]) != "" {
				out = append(out, "")
			}
			out = append(out, table...)
			i += n
			if i < len(lines) && strings.TrimSpace(lines[i]) != "" {
				out = append(out, "")
			}
			continue
		}
		out = append(out, lines[i])
		i++
	}
	return strings.Join(out, "\n")
}

// dedent removes the spaces every non-empty line starts with.
func dedent(lines []string) []string {
	shared := -1
	for _, l := range lines {
		if strings.TrimSpace(l) == "" {
			continue
		}
		n := len(l) - len(strings.TrimLeft(l, " "))
		if shared < 0 || n < shared {
			shared = n
		}
	}
	if shared <= 0 {
		return lines
	}
	out := make([]string, len(lines))
	for i, l := range lines {
		if len(l) >= shared {
			out[i] = l[shared:]
		} else {
			out[i] = strings.TrimLeft(l, " ")
		}
	}
	return out
}

// boxTable reads a box-drawn table at the start of lines: how many lines it takes, and it as markdown. A
// table is borders and rows, at least one of each; a row drawn over several lines (its cells wrapped) is
// merged back into one, which tables with a border between every row show.
func boxTable(lines []string) (int, []string) {
	if len(lines) == 0 {
		return 0, nil
	}
	ascii := asciiBorder.MatchString(strings.TrimSpace(lines[0]))
	var groups [][][]string // rows between borders, each a line of cells
	var current [][]string
	borders, n := 0, 0
	for _, l := range lines {
		if isBoxBorder(l) {
			borders++
			if len(current) > 0 {
				groups = append(groups, current)
				current = nil
			}
			n++
			continue
		}
		sep := rowSep(l, ascii)
		if sep == 0 {
			break
		}
		t := strings.TrimSpace(l)
		inner := strings.TrimSuffix(strings.TrimPrefix(t, string(sep)), string(sep))
		current = append(current, strings.Split(inner, string(sep)))
		n++
	}
	if len(current) > 0 {
		groups = append(groups, current)
	}
	if borders == 0 || len(groups) == 0 {
		return 0, nil
	}
	// Borders between body rows mean each group is one row, its lines wrapped cells; without them (a border
	// under the header only), each line is a row.
	var rows [][]string
	if len(groups) > 2 {
		for _, g := range groups {
			rows = append(rows, mergeLines(g))
		}
	} else {
		rows = append(rows, mergeLines(groups[0]))
		if len(groups) == 2 {
			for _, line := range groups[1] {
				rows = append(rows, cleanCells(line))
			}
		}
	}
	cols := 0
	for _, r := range rows {
		cols = max(cols, len(r))
	}
	var md []string
	for i, r := range rows {
		for len(r) < cols {
			r = append(r, "")
		}
		md = append(md, "| "+strings.Join(r, " | ")+" |")
		if i == 0 {
			md = append(md, "|"+strings.Repeat(" --- |", cols))
		}
	}
	return n, md
}

func cleanCells(cells []string) []string {
	out := make([]string, len(cells))
	for i, c := range cells {
		out[i] = strings.ReplaceAll(strings.TrimSpace(c), "|", `\|`)
	}
	return out
}

// mergeLines joins the lines of one row column by column.
func mergeLines(lines [][]string) []string {
	var row []string
	for _, line := range lines {
		for i, cell := range cleanCells(line) {
			for len(row) <= i {
				row = append(row, "")
			}
			row[i] = joinWrapped(row[i], cell)
		}
	}
	return row
}

// joinWrapped joins a cell's wrapped parts: with a space, except between two CJK characters.
func joinWrapped(a, b string) string {
	if a == "" || b == "" {
		return a + b
	}
	last, _ := utf8.DecodeLastRuneInString(a)
	first, _ := utf8.DecodeRuneInString(b)
	if isCJK(last) && isCJK(first) {
		return a + b
	}
	return a + " " + b
}

func isCJK(r rune) bool {
	return unicode.Is(unicode.Han, r) || unicode.Is(unicode.Hiragana, r) || unicode.Is(unicode.Katakana, r) ||
		unicode.Is(unicode.Hangul, r) || (r >= 0x3000 && r <= 0x303F) || (r >= 0xFF00 && r <= 0xFFEF)
}
