package views

import (
	"github.com/egoist/mygo"

	"popmind/internal/jsonx"
	"popmind/internal/logx"
	"popmind/internal/settings"
)

// loginItemFile records that starting at login was set up once, so a user's "off" stays off.
const loginItemFile = "login-item.json"

// SetOpenAtLogin makes popMind start when the user logs in, or stops it, and remembers the choice.
func SetOpenAtLogin(on bool) error {
	err := mygo.App.SetOpenAtLogin(on)
	logx.Info("[login] set open at login", "on", on, "now", mygo.App.OpenAtLogin(), "err", err)
	if werr := jsonx.WriteFile(settings.Path(loginItemFile), map[string]any{"decided": true}); werr != nil {
		logx.Warn("[login] save failed", "err", werr)
	}
	return err
}

// DefaultOpenAtLogin turns starting at login on the first time an installed popMind runs; after that the
// switch in Settings decides. Development builds are left alone.
func DefaultOpenAtLogin() {
	var v struct {
		Decided bool `json:"decided"`
	}
	_ = jsonx.ReadFile(settings.Path(loginItemFile), &v)
	logx.Info("[login] state", "openAtLogin", mygo.App.OpenAtLogin(), "openedAtLogin", mygo.App.WasOpenedAtLogin(), "decided", v.Decided)
	if v.Decided || mygo.IsDev() {
		return
	}
	_ = SetOpenAtLogin(true)
}
