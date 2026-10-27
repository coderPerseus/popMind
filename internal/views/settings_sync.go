package views

import (
	"errors"
	"time"

	"github.com/egoist/mygo/ui"

	"popmind/internal/clipsync"
	"popmind/internal/i18n"
	"popmind/internal/jsonx"
	"popmind/internal/settings"
)

// syncUI is the editing state of the sync settings.
type syncUI struct {
	key, token, account string
	busy                string // "connect", "create", "legacy", "run"
	err                 string
	copied              time.Time
	confirmDisconnect   bool
	legacyMsg           string
}

func syncErrorText(err error) string {
	var se *clipsync.Error
	code := clipsync.ErrUnknown
	if errors.As(err, &se) {
		code = se.Code
	}
	return i18n.T("clip.panel.sync.error." + code)
}

// syncSection is Settings → Clipboard → Sync: set up the first Mac, join with a key, or the connected state.
func (s *SettingsWindow) syncSection(c *ui.Context) {
	if s.app == nil || s.app.Sync == nil {
		return
	}
	svc := s.app.Sync
	t := c.Theme()
	// Opened from the panel: scroll to the end of the page, where the sync settings are.
	defer func() {
		anchor := ui.Box(c.Key("sync-anchor")).Height(1)
		if s.revealSync {
			s.revealSync = false
			anchor.ScrollIntoView()
		}
	}()
	st := svc.Status()
	u := &s.ui.sync
	do := func(kind string, fn func() error) {
		u.busy, u.err = kind, ""
		go func() {
			err := fn()
			s.win.Update(func() {
				u.busy = ""
				if err != nil {
					u.err = syncErrorText(err)
				} else {
					u.key, u.token, u.account = "", "", ""
				}
			})
		}()
	}
	if !st.Configured {
		if st.LegacyAvailable {
			group(c, i18n.T("clip.settings.sync.legacy"), func() {
				row(c, i18n.T("clip.settings.sync.legacy"), i18n.T("clip.settings.sync.legacyDesc"), func() {
					label := i18n.T("clip.settings.sync.legacyImport")
					if u.busy == "legacy" {
						label = i18n.T("clip.settings.sync.importing")
					}
					if ui.Button(c.Key("sync-legacy"), label).Disabled(u.busy != "").Clicked() {
						do("legacy", svc.ImportLegacy)
					}
				})
			})
		}
		group(c, i18n.T("clip.settings.group.syncConnect"), func() {
			row(c, i18n.T("clip.settings.sync.key"), i18n.T("clip.settings.sync.keyDesc"), func() {
				in := ui.TextInput(c.Key("sync-key"), &u.key).Password().Width(240).Placeholder(i18n.T("clip.settings.sync.keyPlaceholder"))
				label := i18n.T("clip.settings.sync.connect")
				if u.busy == "connect" {
					label = i18n.T("clip.settings.sync.connecting")
				}
				if (ui.Button(c.Key("sync-connect"), label).Disabled(u.key == "" || u.busy != "").Clicked() || in.Submitted()) && u.key != "" {
					key := u.key
					do("connect", func() error { return svc.Connect(key) })
				}
			})
		})
		footnote(c, i18n.T("clip.settings.sync.introAuto"))
		group(c, i18n.T("clip.settings.group.syncNew"), func() {
			row(c, i18n.T("clip.settings.sync.manual"), i18n.T("clip.settings.sync.manualDesc"), func() {
				if ui.Button(c.Key("sync-cf"), i18n.T("clip.settings.sync.openCloudflare")).Clicked() {
					c.OpenURL("https://dash.cloudflare.com/?to=/:account/r2/api-tokens")
				}
			})
			row(c, i18n.T("clip.settings.sync.token"), "", func() {
				ui.TextInput(c.Key("sync-token"), &u.token).Password().Width(320).Placeholder(i18n.T("clip.settings.sync.tokenPlaceholder"))
			})
			row(c, i18n.T("clip.settings.sync.accountId"), "", func() {
				ui.TextInput(c.Key("sync-account"), &u.account).Width(320).Placeholder(i18n.T("clip.settings.sync.accountIdPlaceholder"))
			})
			row(c, "", "", func() {
				label := i18n.T("clip.settings.sync.create")
				if u.busy == "create" {
					label = i18n.T("clip.settings.sync.creating")
				}
				if ui.Button(c.Key("sync-create"), label).Disabled(u.token == "" || u.busy != "").Clicked() {
					token, account := u.token, u.account
					do("create", func() error { return svc.SetupWithToken(token, account) })
				}
			})
		})
		if u.err != "" {
			ui.Text(c, u.err).FontSize(12).TextColor(t.Danger).Padding(0, 6)
		}
		return
	}

	group(c, i18n.T("clip.settings.group.syncStatus"), func() {
		row(c, i18n.T("clip.settings.sync.status"), "", func() {
			ui.Text(c, i18n.T("clip.settings.sync.statusConnected", "bucket", st.Bucket)).FontSize(12).TextColor(t.Success)
		})
		last := i18n.T("clip.settings.sync.never")
		lastColor := t.TextMuted
		if l := st.LastSync; l != nil && l.FinishedAt > 0 {
			when := time.UnixMilli(l.FinishedAt).Format("01-02 15:04")
			if l.OK {
				last = i18n.T("clip.settings.sync.lastOk", "time", when, "received", l.Received, "uploaded", l.Uploaded)
			} else {
				last = i18n.T("clip.settings.sync.lastFailed", "time", when, "reason", i18n.T("clip.panel.sync.error."+l.ErrorCode))
				lastColor = t.Warning
			}
		}
		row(c, i18n.T("clip.settings.sync.lastSync"), "", func() {
			ui.Text(c, last).FontSize(12).TextColor(lastColor)
			label := i18n.T("clip.settings.sync.runNow")
			if st.Running {
				label = i18n.T("clip.settings.sync.running")
			}
			if ui.Button(c.Key("sync-run"), label).Disabled(st.Running).Clicked() {
				go svc.Run()
			}
		})
	})
	footnote(c, i18n.T("clip.settings.sync.introAuto"))
	raw := settings.Capabilities.Raw()
	rng, _ := jsonx.Get(raw, "clipboard", "sync", "range").(string)
	if rng == "" {
		rng = "7d"
	}
	group(c, i18n.T("clip.settings.group.syncRange"), func() {
		row(c, i18n.T("clip.settings.sync.range"), i18n.T("clip.settings.sync.rangeHint"), func() {
			v := rng
			var opts []Option
			for _, r := range []string{"7d", "30d", "all", "none"} {
				opts = append(opts, Option{r, i18n.T("clip.settings.sync.range." + r)})
			}
			if Picker(c.Key("sync-range"), &v, opts, "range").Changed() {
				s.save(map[string]any{"clipboard": map[string]any{"sync": map[string]any{"range": v}}})
			}
		})
	})
	footnote(c, i18n.T("clip.settings.sync.rangeDesc"))
	group(c, i18n.T("clip.settings.group.syncDevices"), func() {
		row(c, i18n.T("clip.settings.sync.shareKey"), i18n.T("clip.settings.sync.shareKeyDesc"), func() {
			hint := st.KeyHint
			if time.Since(u.copied) < 2500*time.Millisecond {
				hint = i18n.T("clip.settings.sync.keyCopied")
				c.After(2500*time.Millisecond - time.Since(u.copied))
			}
			ui.Text(c, hint).FontSize(12).Font("monospace").TextColor(t.TextMuted)
			if ui.Button(c.Key("sync-copy"), i18n.T("clip.settings.sync.copyKey")).Clicked() && svc.CopyKey() {
				u.copied = time.Now()
			}
		})
		row(c, i18n.T("clip.settings.sync.disconnect"), i18n.T("clip.settings.sync.disconnectDesc"), func() {
			if ui.Button(c.Key("sync-disconnect"), i18n.T("clip.settings.sync.disconnect")).Clicked() {
				u.confirmDisconnect = true
			}
		})
	})
	if u.confirmDisconnect {
		switch ui.AlertDialog(c, &u.confirmDisconnect, i18n.T("clip.settings.sync.disconnectConfirmTitle"),
			i18n.T("clip.settings.sync.disconnectConfirmDesc"), i18n.T("clip.settings.sync.cancel"), i18n.T("clip.settings.sync.disconnect")) {
		case 1:
			svc.Disconnect()
			u.confirmDisconnect = false
		case 0:
			u.confirmDisconnect = false
		}
	}
}

// legacyRow is General → the old popMind's settings: whether they are merged, and a button to merge now.
func (s *SettingsWindow) legacyRow(c *ui.Context) {
	if settings.SharesLegacyDir() {
		return // the installed app uses the old app's data itself
	}
	r := settings.LastLegacyImport()
	status := i18n.T("settings.legacy.none")
	if settings.LegacyAvailable() {
		status = i18n.T("settings.legacy.upToDate")
		if r.Changed > 0 {
			status = i18n.T("settings.legacy.done", "count", r.Changed)
		}
		if s.ui.sync.legacyMsg != "" {
			status = s.ui.sync.legacyMsg
		}
	}
	row(c, i18n.T("settings.legacy.title"), i18n.T("settings.legacy.desc"), func() {
		Muted(c, status)
		if settings.LegacyAvailable() && ui.Button(c.Key("legacy-merge"), i18n.T("settings.legacy.run")).Clicked() {
			go func() {
				rep := settings.ImportLegacy(true)
				msg := i18n.T("settings.legacy.upToDate")
				if rep.Changed > 0 {
					msg = i18n.T("settings.legacy.done", "count", rep.Changed)
				}
				s.win.Update(func() { s.ui.sync.legacyMsg = msg })
			}()
		}
	})
}
