package clipboard

import (
	"math"
	"regexp"
	"slices"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"popmind/internal/logx"
)

// Query is what the panel asks for.
type Query struct {
	Text       string
	PinboardID string
	Kinds      []string
	AppIDs     []string
	// From and To limit when items were last copied (Unix ms, 0 for no limit).
	From, To int64
	Limit    int
}

// Token is a filter the text named (type:image, app:微信, 上周…).
type Token struct {
	Kind  string // "type", "app", "date", "pinboard"
	Value string
	Label string
}

// Parsed is a query split into keywords and filters.
type Parsed struct {
	Keywords   []string
	Kinds      []string
	AppIDs     []string
	From, To   int64
	PinboardID string
	Tokens     []Token
}

var typeAliases = map[string][]string{
	KindImage: {"image", "images", "img", "photo", "photos", "picture", "pictures", "screenshot", "screenshots", "图片", "图像", "图", "截图", "照片", "截屏"},
	KindText:  {"text", "texts", "txt", "string", "文本", "文字", "纯文本"},
	KindLink:  {"link", "links", "url", "urls", "web", "链接", "网址", "网页", "连接"},
	KindFile:  {"file", "files", "document", "documents", "doc", "文件", "文档"},
	KindColor: {"color", "colors", "colour", "colours", "颜色", "色值", "色彩", "色"},
}

func kindOfWord(w string) string {
	w = strings.ToLower(strings.TrimSpace(w))
	for _, k := range Kinds {
		if slices.Contains(typeAliases[k], w) {
			return k
		}
	}
	if len(w) >= 2 && regexp.MustCompile(`^[a-z]+$`).MatchString(w) {
		found := ""
		for _, k := range Kinds {
			for _, a := range typeAliases[k] {
				if strings.HasPrefix(a, w) {
					if found != "" && found != k {
						return ""
					}
					found = k
				}
			}
		}
		return found
	}
	return ""
}

func startOfDay(t time.Time, offset int) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day()+offset, 0, 0, 0, 0, t.Location())
}

func startOfWeek(t time.Time, offset int) time.Time {
	dow := (int(t.Weekday()) + 6) % 7
	return time.Date(t.Year(), t.Month(), t.Day()-dow+offset*7, 0, 0, 0, 0, t.Location())
}

func startOfMonth(t time.Time, offset int) time.Time {
	return time.Date(t.Year(), t.Month()+time.Month(offset), 1, 0, 0, 0, 0, t.Location())
}

var (
	staticDates = []struct {
		re    *regexp.Regexp
		value string
	}{
		{regexp.MustCompile(`(?i)^(?:今天|今日|today)$`), "today"},
		{regexp.MustCompile(`(?i)^(?:昨天|昨日|yesterday)$`), "yesterday"},
		{regexp.MustCompile(`(?i)^(?:前天|day before yesterday)$`), "day_before_yesterday"},
		{regexp.MustCompile(`(?i)^(?:本周|这周|本星期|这星期|这一周|这个星期|this week)$`), "this_week"},
		{regexp.MustCompile(`(?i)^(?:上周|上星期|上个星期|上一周|上个礼拜|上礼拜|last week)$`), "last_week"},
		{regexp.MustCompile(`(?i)^(?:本月|这个月|这月|this month)$`), "this_month"},
		{regexp.MustCompile(`(?i)^(?:上个月|上月|上一个月|last month)$`), "last_month"},
		{regexp.MustCompile(`(?i)^(?:近一周|最近一周|最近一星期|past week)$`), "last_7_days"},
		{regexp.MustCompile(`(?i)^(?:近一个月|最近一个月|past month)$`), "last_30_days"},
	}
	recentZH = regexp.MustCompile(`^(?:最近|近|过去)\s*(\d+|[零一二两三四五六七八九十]+)\s*个?\s*(天|日|小时)(?:内|以内)?$`)
	recentEN = regexp.MustCompile(`(?i)^(?:last|past)\s+(\d+)\s+(days?|hours?)$`)
	prefixRE = regexp.MustCompile(`(?i)^(type|kind|app|in|pinboard)[:：](.*)$`)
)

func cnNumber(s string) int {
	if n, err := strconv.Atoi(s); err == nil {
		return n
	}
	digits := map[rune]int{'零': 0, '一': 1, '二': 2, '两': 2, '三': 3, '四': 4, '五': 5, '六': 6, '七': 7, '八': 8, '九': 9}
	r := []rune(s)
	ten := slices.Index(r, '十')
	if ten < 0 {
		n := 0
		for _, c := range r {
			n = n*10 + digits[c]
		}
		return n
	}
	tens := 1
	if ten > 0 {
		tens = digits[r[ten-1]]
	}
	ones := 0
	if ten+1 < len(r) {
		ones = digits[r[ten+1]]
	}
	return tens*10 + ones
}

// dateRange resolves a date phrase to [from, to) in ms; to 0 means open.
func dateRange(phrase string, now time.Time) (int64, int64, bool) {
	p := strings.TrimSpace(phrase)
	ms := func(t time.Time) int64 { return t.UnixMilli() }
	for _, d := range staticDates {
		if !d.re.MatchString(p) {
			continue
		}
		switch d.value {
		case "today":
			return ms(startOfDay(now, 0)), ms(startOfDay(now, 1)), true
		case "yesterday":
			return ms(startOfDay(now, -1)), ms(startOfDay(now, 0)), true
		case "day_before_yesterday":
			return ms(startOfDay(now, -2)), ms(startOfDay(now, -1)), true
		case "this_week":
			return ms(startOfWeek(now, 0)), ms(startOfWeek(now, 1)), true
		case "last_week":
			return ms(startOfWeek(now, -1)), ms(startOfWeek(now, 0)), true
		case "this_month":
			return ms(startOfMonth(now, 0)), ms(startOfMonth(now, 1)), true
		case "last_month":
			return ms(startOfMonth(now, -1)), ms(startOfMonth(now, 0)), true
		case "last_7_days":
			return ms(startOfDay(now, -6)), 0, true
		case "last_30_days":
			return ms(startOfDay(now, -29)), 0, true
		}
	}
	m := recentZH.FindStringSubmatch(p)
	if m == nil {
		m = recentEN.FindStringSubmatch(p)
	}
	if m == nil {
		return 0, 0, false
	}
	n := cnNumber(m[1])
	if n < 1 || n > 3650 {
		return 0, 0, false
	}
	if strings.Contains(m[2], "小时") || strings.HasPrefix(strings.ToLower(m[2]), "hour") {
		return now.Add(-time.Duration(n) * time.Hour).UnixMilli(), 0, true
	}
	return ms(startOfDay(now, -(n - 1))), 0, true
}

func normalizeName(s string) string {
	return regexp.MustCompile(`[\s._\-·]+`).ReplaceAllString(strings.ToLower(s), "")
}

func matchApps(q string, apps []App) []App {
	query := normalizeName(q)
	if query == "" {
		return nil
	}
	best, out := 99, []App(nil)
	for _, a := range apps {
		name := normalizeName(a.Name)
		parts := strings.Split(a.BundleID, ".")
		tail := normalizeName(parts[len(parts)-1])
		tier := -1
		switch {
		case strings.EqualFold(a.BundleID, strings.TrimSpace(q)):
			tier = 0
		case name == query || tail == query:
			tier = 1
		case strings.HasPrefix(name, query) || strings.HasPrefix(tail, query):
			tier = 2
		case strings.Contains(name, query) || strings.Contains(strings.ToLower(a.BundleID), query):
			tier = 3
		}
		if tier < 0 {
			continue
		}
		if tier < best {
			best, out = tier, []App{a}
		} else if tier == best {
			out = append(out, a)
		}
	}
	if len(out) > 5 {
		out = out[:5]
	}
	return out
}

// Parse splits text into keywords and filters.
func Parse(text string, apps []App, pinboards []Pinboard, now time.Time) Parsed {
	var p Parsed
	words := strings.Fields(text)
	used := make([]bool, len(words))
	dated := false
	for i := 0; i < len(words); i++ {
		if used[i] {
			continue
		}
		if m := prefixRE.FindStringSubmatch(words[i]); m != nil {
			used[i] = true
			key, value := strings.ToLower(m[1]), m[2]
			if value == "" {
				continue
			}
			switch key {
			case "type", "kind":
				if k := kindOfWord(value); k != "" {
					p.Kinds = append(p.Kinds, k)
					p.Tokens = append(p.Tokens, Token{"type", k, value})
				} else {
					used[i] = false
				}
			case "app":
				matched := matchApps(value, apps)
				if len(matched) == 0 {
					p.AppIDs = append(p.AppIDs, value)
					p.Tokens = append(p.Tokens, Token{"app", value, value})
				}
				for _, a := range matched {
					p.AppIDs = append(p.AppIDs, a.BundleID)
					p.Tokens = append(p.Tokens, Token{"app", a.BundleID, a.Name})
				}
			default:
				p.PinboardID = value
				for _, b := range pinboards {
					if normalizeName(b.Name) == normalizeName(value) || b.ID == value {
						p.PinboardID = b.ID
						value = b.Name
					}
				}
				p.Tokens = append(p.Tokens, Token{"pinboard", p.PinboardID, value})
			}
			continue
		}
		if dated {
			continue
		}
		for length := min(3, len(words)-i); length >= 1; length-- {
			if slices.Contains(used[i:i+length], true) {
				continue
			}
			phrase := strings.Join(words[i:i+length], " ")
			if from, to, ok := dateRange(phrase, now); ok {
				for j := i; j < i+length; j++ {
					used[j] = true
				}
				p.From, p.To, dated = from, to, true
				p.Tokens = append(p.Tokens, Token{"date", phrase, phrase})
				i += length - 1
				break
			}
		}
	}
	for i, w := range words {
		if !used[i] {
			p.Keywords = append(p.Keywords, w)
		}
	}
	return p
}

// ---- ranking ----

var (
	ftsColumns   = []string{"title", "body", "ocr", "tags", "app", "url"}
	fieldWeights = map[string]float64{"title": 5, "body": 3, "ocr": 1.5, "tags": 2, "app": 1, "url": 1}
)

func rankScore(text float64, lastCopied int64, use, copies int, pinned bool, nowMs int64) float64 {
	age := math.Max(0, float64(nowMs-lastCopied)) / float64(dayMs)
	recency := math.Pow(0.5, age/14)
	usage := math.Min(1, math.Log(math.Max(1, float64(use+copies)))/math.Log(20))
	score := 0.62*text + 0.25*recency + 0.08*usage
	if pinned {
		score += 0.05
	}
	return score
}

func escapeLike(s string) string {
	return strings.NewReplacer(`\`, `\\`, "%", `\%`, "_", `\_`).Replace(s)
}

// Search returns the items q finds, best first (or newest first without keywords).
func (s *Store) Search(q Query) ([]Item, Parsed) {
	started := time.Now()
	parsed := Parse(q.Text, s.Apps(), s.Pinboards(), time.Now())
	kinds := append(append([]string{}, q.Kinds...), parsed.Kinds...)
	appIDs := append(append([]string{}, q.AppIDs...), parsed.AppIDs...)
	pinboard := cmpOr(parsed.PinboardID, q.PinboardID)
	limit := q.Limit
	if limit <= 0 || limit > 200 {
		limit = 100
	}

	join, where, args := "", []string{"i.deleted_at IS NULL"}, []any{}
	var joinArgs []any
	if pinboard != "" {
		join = "JOIN pinboard_items pi ON pi.item_id = i.id AND pi.pinboard_id = ?"
		joinArgs = append(joinArgs, pinboard)
	}
	if len(kinds) > 0 {
		where = append(where, "i.kind IN ("+placeholders(len(kinds))+")")
		for _, k := range kinds {
			args = append(args, k)
		}
	}
	if len(appIDs) > 0 {
		where = append(where, "i.source_bundle_id IN ("+placeholders(len(appIDs))+")")
		for _, a := range appIDs {
			args = append(args, a)
		}
	}
	if q.From > 0 {
		where, args = append(where, "i.last_copied_at >= ?"), append(args, q.From)
	}
	if q.To > 0 {
		where, args = append(where, "i.last_copied_at < ?"), append(args, q.To)
	}
	if parsed.From > 0 {
		where, args = append(where, "i.last_copied_at >= ?"), append(args, parsed.From)
	}
	if parsed.To > 0 {
		where, args = append(where, "i.last_copied_at < ?"), append(args, parsed.To)
	}

	var ids []string
	if len(parsed.Keywords) == 0 {
		order := "i.last_copied_at DESC"
		if pinboard != "" {
			order = "pi.sort_order ASC"
		}
		rows, err := s.query("SELECT i.id FROM clip_items i "+join+" WHERE "+strings.Join(where, " AND ")+" ORDER BY "+order+" LIMIT ?",
			append(append(joinArgs, args...), limit)...)
		if err != nil {
			logx.Warn("[clip-search] browse failed", "err", err)
		}
		for _, r := range rows {
			ids = append(ids, str(r["id"]))
		}
	} else {
		ids = s.keywordSearch(parsed.Keywords, join, joinArgs, where, args, pinboard != "", limit)
	}
	items := s.Items(ids)
	logx.Info("[clip-search] list", "keywords", len(parsed.Keywords), "results", len(items), "ms", time.Since(started).Milliseconds())
	return items, parsed
}

func (s *Store) keywordSearch(keywords []string, join string, joinArgs []any, where []string, args []any, inPinboard bool, limit int) []string {
	var long, short []string
	for _, k := range keywords {
		if utf8.RuneCountInString(k) >= 3 {
			long = append(long, k)
		} else {
			short = append(short, k)
		}
	}
	pinnedExpr := "EXISTS (SELECT 1 FROM pinboard_items x WHERE x.item_id = i.id)"
	if inPinboard {
		pinnedExpr = "0"
	}
	run := func(fts []string, like []string) ([]map[string]any, error) {
		selects := []string{"i.id AS id", "i.last_copied_at AS t", "i.use_count AS u", "i.copy_count AS c", pinnedExpr + " AS pinned"}
		var selArgs, w2 []any
		cond := []string{}
		if len(fts) > 0 {
			var weights []string
			for _, f := range ftsColumns {
				weights = append(weights, strconv.FormatFloat(fieldWeights[f], 'f', -1, 64))
			}
			selects = append(selects, "bm25(clip_search, "+strings.Join(weights, ", ")+") AS b")
			var terms []string
			for _, k := range fts {
				terms = append(terms, `"`+strings.ReplaceAll(k, `"`, `""`)+`"`)
			}
			cond = append(cond, "clip_search MATCH ?")
			w2 = append(w2, strings.Join(terms, " "))
		}
		if len(like) > 0 {
			var terms []string
			for _, k := range like {
				for _, f := range ftsColumns {
					terms = append(terms, "(CASE WHEN clip_search."+f+" LIKE ? ESCAPE '\\' THEN "+strconv.FormatFloat(fieldWeights[f], 'f', -1, 64)+" ELSE 0 END)")
					selArgs = append(selArgs, "%"+escapeLike(k)+"%")
				}
				var ors []string
				for _, f := range ftsColumns {
					ors = append(ors, "clip_search."+f+" LIKE ? ESCAPE '\\'")
				}
				cond = append(cond, "("+strings.Join(ors, " OR ")+")")
				for range ftsColumns {
					w2 = append(w2, "%"+escapeLike(k)+"%")
				}
			}
			selects = append(selects, "("+strings.Join(terms, " + ")+") AS ls")
		}
		order := "i.last_copied_at DESC"
		if len(fts) > 0 {
			order = "b ASC"
		}
		sql := "SELECT " + strings.Join(selects, ", ") + " FROM clip_search JOIN clip_items i ON i.rowid = clip_search.rowid " + join +
			" WHERE " + strings.Join(append(cond, where...), " AND ") + " ORDER BY " + order + " LIMIT 1000"
		all := append(append(append(append([]any{}, selArgs...), joinArgs...), w2...), args...)
		return s.query(sql, all...)
	}
	rows, err := run(long, short)
	if err != nil && len(long) > 0 {
		rows, err = run(nil, keywords)
	}
	if err != nil {
		logx.Warn("[clip-search] keyword search failed", "err", err)
		return nil
	}
	nowMs := now()
	maxB := 0.0
	for _, r := range rows {
		if b, ok := r["b"].(float64); ok {
			maxB = math.Max(maxB, -b)
		}
	}
	type scored struct {
		id    string
		score float64
		t     int64
	}
	var list []scored
	for _, r := range rows {
		text, parts := 0.0, 0.0
		if b, ok := r["b"].(float64); ok && len(long) > 0 {
			v := 1.0
			if maxB > 0 {
				v = math.Max(0, -b) / maxB
			}
			text += float64(len(long)) * v
			parts += float64(len(long))
		}
		likeCount := len(short)
		if _, ok := r["b"]; !ok {
			likeCount = len(keywords)
		}
		if ls, ok := r["ls"]; ok && likeCount > 0 {
			text += float64(likeCount) * (1 - math.Exp(-float64(num(ls))/float64(likeCount*4)))
			parts += float64(likeCount)
		}
		if parts > 0 {
			text /= parts
		}
		list = append(list, scored{str(r["id"]), rankScore(text, num(r["t"]), int(num(r["u"])), int(num(r["c"])), num(r["pinned"]) == 1, nowMs), num(r["t"])})
	}
	slices.SortStableFunc(list, func(a, b scored) int {
		switch {
		case a.score > b.score:
			return -1
		case a.score < b.score:
			return 1
		}
		return int(b.t - a.t)
	})
	var ids []string
	for i, sc := range list {
		if i == limit {
			break
		}
		ids = append(ids, sc.id)
	}
	return ids
}

// DatePresets are the date filters the panel offers.
var DatePresets = []string{"today", "yesterday", "this_week", "last_week", "this_month"}

// PresetRange is the time range of a date preset (presetToRange of panel-utils.ts).
func PresetRange(preset string, t time.Time) (from, to int64) {
	ms := func(t time.Time) int64 { return t.UnixMilli() }
	switch preset {
	case "today":
		return ms(startOfDay(t, 0)), ms(startOfDay(t, 1))
	case "yesterday":
		return ms(startOfDay(t, -1)), ms(startOfDay(t, 0))
	case "this_week":
		return ms(startOfWeek(t, 0)), ms(startOfWeek(t, 1))
	case "last_week":
		return ms(startOfWeek(t, -1)), ms(startOfWeek(t, 0))
	case "this_month":
		return ms(startOfMonth(t, 0)), 0
	}
	return 0, 0
}
