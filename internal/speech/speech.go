// Package speech reads text aloud with the system's voices (the "system" speech provider of the Electron app).
package speech

import (
	"os/exec"
	"strings"
	"sync"

	"popmind/internal/logx"
)

var (
	mu      sync.Mutex
	current *exec.Cmd
	role    string
)

// Speak reads text in lang ("en-US", "en-GB", "zh-CN"), stopping what was being read. done runs when it ends.
func Speak(text, lang, r string, done func()) {
	Stop()
	cmd := command(strings.TrimSpace(text), lang)
	if err := cmd.Start(); err != nil {
		logx.Warn("[speech] say failed", "err", err)
		if done != nil {
			done()
		}
		return
	}
	mu.Lock()
	current, role = cmd, r
	mu.Unlock()
	go func() {
		_ = cmd.Wait()
		mu.Lock()
		if current == cmd {
			current, role = nil, ""
		}
		mu.Unlock()
		if done != nil {
			done()
		}
	}()
}

// Stop stops reading.
func Stop() {
	mu.Lock()
	cmd := current
	current, role = nil, ""
	mu.Unlock()
	if cmd != nil && cmd.Process != nil {
		_ = cmd.Process.Kill()
	}
}

// Speaking returns the role being read ("source", "translated", "headword"), or "".
func Speaking() string {
	mu.Lock()
	defer mu.Unlock()
	return role
}
