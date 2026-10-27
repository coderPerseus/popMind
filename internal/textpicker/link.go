package textpicker

import (
	"net/url"
	"regexp"
	"strings"
)

var (
	leadingWrap  = regexp.MustCompile(`^[<({\[\s"'` + "`" + `]+`)
	trailingWrap = regexp.MustCompile(`[>)}\]\s"'` + "`" + `，。！？、；：,.!?;:]+$`)
	bareLink     = regexp.MustCompile(`(?i)^(\[[0-9a-f:]+\]|[a-z0-9.-]+)(?::\d{1,5})?(?:[/?#]\S*)?$`)
	hostLabel    = regexp.MustCompile(`(?i)^[a-z0-9-]+$`)
	ipv4         = regexp.MustCompile(`^(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)){3}$`)
	genericTLDs  = map[string]bool{}
)

func init() {
	for _, tld := range strings.Fields(`app art blog cc cloud club cn co com dev digital email fm gg group guide info io live me
media mobi name net news online org page pro shop site software space store studio tech today tools top tv uk us vip wiki
work works world xyz zone`) {
		genericTLDs[tld] = true
	}
}

func likelyHostname(host string) bool {
	h := strings.TrimSuffix(strings.ToLower(host), ".")
	if h == "" {
		return false
	}
	if h == "localhost" || ipv4.MatchString(h) || (strings.HasPrefix(h, "[") && strings.HasSuffix(h, "]")) {
		return true
	}
	labels := strings.Split(h, ".")
	if len(labels) < 2 {
		return false
	}
	for _, l := range labels {
		if l == "" || strings.HasPrefix(l, "-") || strings.HasSuffix(l, "-") || !hostLabel.MatchString(l) {
			return false
		}
	}
	tld := labels[len(labels)-1]
	return len(tld) == 2 || strings.HasPrefix(tld, "xn--") || genericTLDs[tld]
}

// NormalizeLink returns the URL a selection is, or "" when it is not one link (normalizeSelectedLink).
func NormalizeLink(text string) string {
	t := strings.TrimSpace(text)
	for t != "" && leadingWrap.MatchString(t) {
		t = leadingWrap.ReplaceAllString(t, "")
	}
	for t != "" && trailingWrap.MatchString(t) {
		t = trailingWrap.ReplaceAllString(t, "")
	}
	if t == "" || strings.ContainsAny(t, " \t\n\r") {
		return ""
	}
	withProtocol := t
	if !regexp.MustCompile(`(?i)^https?://`).MatchString(t) {
		m := bareLink.FindStringSubmatch(t)
		if m == nil || !likelyHostname(m[1]) {
			return ""
		}
		withProtocol = "https://" + t
	}
	u, err := url.Parse(withProtocol)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || !likelyHostname(u.Hostname()) {
		return ""
	}
	if u.Path == "" {
		u.Path = "/"
	}
	return u.String()
}
