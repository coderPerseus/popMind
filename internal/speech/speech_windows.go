package speech

import (
	"os/exec"
	"strings"
	"syscall"
)

// command reads text with Windows' speech synthesizer (SAPI, through PowerShell), in a voice of lang's
// culture when one is installed. The text goes in on stdin, so that no quoting can break it; no console
// window shows.
func command(text, lang string) *exec.Cmd {
	culture := lang
	if culture == "" {
		culture = "en-US"
	}
	script := `[Console]::InputEncoding = [Text.Encoding]::UTF8; Add-Type -AssemblyName System.Speech; ` +
		`$s = New-Object System.Speech.Synthesis.SpeechSynthesizer; ` +
		`try { $s.SelectVoiceByHints('NotSet', 'NotSet', 0, [Globalization.CultureInfo]'` + culture + `') } catch {}; ` +
		`$s.Speak([Console]::In.ReadToEnd())`
	cmd := exec.Command("powershell.exe", "-NoProfile", "-NonInteractive", "-Command", script)
	cmd.Stdin = strings.NewReader(text)
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true, CreationFlags: 0x08000000} // CREATE_NO_WINDOW
	return cmd
}
