package calc

import "testing"

func TestEval(t *testing.T) {
	cases := map[string]string{
		"1+2*3":            "7",
		"(12 + 8) * 3 / 2": "30",
		"10 / 4":           "2.5",
		"2 × 3":            "6",
		"7 % 3":            "1",
		"1234567 * 1":      "1,234,567",
		"-5 + 2":           "-3",
		"0.1 + 0.2":        "0.3",
		"1,000 + 1":        "1,001",
		"（1+2）×3":          "9",
	}
	for in, want := range cases {
		if got := Eval(in); got.Err != "" || got.Formatted != want {
			t.Errorf("Eval(%q) = %q (err %q), want %q", in, got.Formatted, got.Err, want)
		}
	}
	for _, bad := range []string{"1+", "(1", "1/0", "abc"} {
		if got := Eval(bad); got.Err == "" {
			t.Errorf("Eval(%q) = %q, want an error", bad, got.Formatted)
		}
	}
}

func TestLooksLikeMath(t *testing.T) {
	for in, want := range map[string]bool{"1+2": true, "(3*4)": true, "wechat": false, "2026": false, "12 / 4": true, "v2": false} {
		if got := LooksLikeMath(in); got != want {
			t.Errorf("LooksLikeMath(%q) = %v, want %v", in, got, want)
		}
	}
}
