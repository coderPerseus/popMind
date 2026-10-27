package textpicker

import "testing"

func TestNormalizeLink(t *testing.T) {
	cases := map[string]string{
		"https://github.com/egoist/mygo": "https://github.com/egoist/mygo",
		"github.com/egoist":              "https://github.com/egoist",
		"(example.com)":                  "https://example.com/",
		"hello world":                    "",
		"file.txt":                       "",
		"localhost:3000/a":               "https://localhost:3000/a",
		"not a link.":                    "",
		"192.168.1.1":                    "https://192.168.1.1/",
	}
	for in, want := range cases {
		if got := NormalizeLink(in); got != want {
			t.Errorf("NormalizeLink(%q) = %q, want %q", in, got, want)
		}
	}
}
