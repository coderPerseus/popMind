package main

import (
	"slices"
	"sync"

	"github.com/egoist/mygo"

	"popmind/internal/logx"
)

// shortcutActions are the shortcut ids this build handles; the others stay "disabled" in Settings.
var shortcutOrder = []string{"toggleHome", "clipboardHistory", "clipboardPasteStack", "inputTranslation",
	"screenshotTranslate", "screenshotSearch", "hideBubble"}

type shortcutStatus struct {
	ID          string `json:"id"`
	Accelerator string `json:"accelerator"`
	State       string `json:"state"`
}

type shortcutManager struct {
	mu        sync.Mutex
	handlers  map[string]func()
	bindings  map[string]string
	status    map[string]string
	recording bool
}

var shortcuts = &shortcutManager{handlers: map[string]func(){}, status: map[string]string{}}

// SetHandler sets what the shortcut of id does.
func (m *shortcutManager) SetHandler(id string, fn func()) {
	m.mu.Lock()
	m.handlers[id] = fn
	m.mu.Unlock()
}

// Apply registers bindings (id → accelerator, "" off), replacing the earlier ones.
func (m *shortcutManager) Apply(bindings map[string]string) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.bindings = bindings
	m.registerLocked()
}

func (m *shortcutManager) registerLocked() {
	mygo.GlobalShortcut.UnregisterAll()
	m.status = map[string]string{}
	if m.recording {
		for id := range m.bindings {
			m.status[id] = "suspended"
		}
		return
	}
	used := map[string]string{}
	for _, id := range shortcutOrder {
		acc := m.bindings[id]
		fn := m.handlers[id]
		switch {
		case acc == "" || fn == nil:
			m.status[id] = "disabled"
		case used[acc] != "":
			m.status[id] = "conflict"
		default:
			if err := mygo.GlobalShortcut.Register(acc, fn); err != nil {
				logx.Warn("[shortcut] register failed", "id", id, "accelerator", acc, "err", err)
				m.status[id] = "failed"
			} else {
				used[acc] = id
				m.status[id] = "registered"
			}
		}
	}
	logx.Info("[shortcut] applied", "status", m.status)
}

// Status lists every shortcut with its registration state.
func (m *shortcutManager) Status() []shortcutStatus {
	m.mu.Lock()
	defer m.mu.Unlock()
	ids := slices.Clone(shortcutOrder)
	for id := range m.bindings {
		if !slices.Contains(ids, id) {
			ids = append(ids, id)
		}
	}
	out := make([]shortcutStatus, 0, len(ids))
	for _, id := range ids {
		state := m.status[id]
		if state == "" {
			state = "disabled"
		}
		out = append(out, shortcutStatus{ID: id, Accelerator: m.bindings[id], State: state})
	}
	return out
}

// SetRecording suspends every shortcut while Settings records a new one, so the keys reach the page.
func (m *shortcutManager) SetRecording(recording bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.recording == recording {
		return
	}
	m.recording = recording
	m.registerLocked()
}
