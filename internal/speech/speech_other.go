//go:build !windows

package speech

import "os/exec"

var voices = map[string]string{"en-US": "Samantha", "en-GB": "Daniel", "zh-CN": "Tingting"}

// command reads text with macOS's say, in the voice of lang.
func command(text, lang string) *exec.Cmd {
	args := []string{}
	if v := voices[lang]; v != "" {
		args = append(args, "-v", v)
	}
	return exec.Command("/usr/bin/say", append(args, "--", text)...)
}
