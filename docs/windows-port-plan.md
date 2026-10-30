# popMind for Windows

The goal is a Windows version with the macOS version's features: the selection bubble everywhere, the
launcher, translation and AI, input translation, the clipboard history, settings, the first-run intro,
an installer and in-app updates. It is tested by hand on a Windows PC (the workflow of AGENTS.md: the code
logs what matters, the developer runs the build and sends the log).

## How it is built

- The UI is myGo's native UI, which runs on Windows: the views need no change.
- Everything system-specific goes through `internal/native`, one set of functions over shared types
  (`native.go`). On macOS they call `libpopmind_native.dylib` (`native_darwin.go`, `api_darwin.go`); on
  Windows they call the system directly in Go, with `golang.org/x/sys/windows`, no cgo
  (`native_windows.go`, `api_windows.go`). The rest of the app stays the same on both.
- `go tool mygo build -platform windows/amd64` builds the Windows app and its NSIS installer from the Mac
  (`brew install makensis`); CI will do it on its runner.

## Phases

| Phase | What | Windows API | State |
| --- | --- | --- | --- |
| 0 | Compiles and starts: native split, pointer, foreground app, clipboard sequence, activation, Ctrl+V | user32, kernel32 | done |
| 1 | Launcher's app index (Start menu shortcuts, icons); clipboard history: read and write text, HTML, RTF, images (DIB to PNG), files (CF_HDROP), watch for copies; speech | myGo's InstalledApps and FileIcon, the clipboard API (sequence number polled), SAPI | done |
| 2 | Selection bubble: low-level mouse and keyboard hooks for selection gestures; the selected text through UI Automation (TextPattern), else a Ctrl+C with the clipboard saved and restored; the user's own Ctrl+V for the paste stack | Raw input (`RegisterRawInputDevices`, `RIDEV_INPUTSINK`), not low-level hooks: Windows silently drops a hook that once answers slower than `LowLevelHooksTimeout`, and the bubble stopped showing; `SetWinEventHook`; Ctrl+C with the clipboard saved and restored | done |
| 3 | Windows look: the bubble and panels not taking focus, topmost, rounded corners and Mica/Acrylic; capture of the foreground window for explanations; OCR if wanted | `SetWindowPos`, `WS_EX_NOACTIVATE`, DWM corner preference, `PrintWindow`; OCR not offered | done |
| 4 | Shipping: installer, shortcuts that do not clash (Alt+Space opens the window menu on Windows), signed updates for `windows-amd64`, CI, the website's Windows download (`WINDOWS_READY`) | NSIS, mygo updates, `scripts/package-windows.sh`, CI | done; first release pending |

## Differences to settle

- **Shortcuts**: Alt+Space is the window menu on Windows; the launcher's default there is to be chosen
  (Alt+Space can still be registered, as PowerToys Run does).
- **Identity of apps**: macOS has bundle IDs; on Windows an app is its executable's path, which the
  blocked-apps list and the clipboard's sources keep.
- **Permissions**: Windows asks for none; the launcher's Accessibility card never shows there.
- **Code signing**: without a code-signing certificate, Windows SmartScreen warns on first run, as
  Gatekeeper does on the Mac.

## Testing on the Windows PC

The test PC is reached over SSH (`ssh popmind-win`, a key of its own). SSH sessions have no desktop, so
the scripts in `%USERPROFILE%\popmind-dev` run things in the signed-in session through one-off scheduled
tasks (`ui.ps1`), press keys (`chord.ps1`, `keyshot.ps1`) and capture the screen (`shot.ps1`).

- Synthetic keys from a normal-level process do not reach an elevated foreground window (UIPI): run key
  presses with `ui.ps1 -High`. Synthetic mouse input from an elevated process does not reach popMind's hooks:
  run mouse tests at the normal level.
- popMind ignores synthetic mouse input unless `POPMIND_ACCEPT_INJECTED=1` (tests only);
  `POPMIND_HOOK_DEBUG=1` logs every press; `POPMIND_TEST_DATA_DIR` runs a separate copy with its own data.
- The same limit holds for users: popMind cannot read the selection of, or paste into, apps run as
  administrator.
