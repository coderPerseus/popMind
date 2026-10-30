package native

import (
	"errors"
	"os"
	"os/exec"
)

// CaptureScreenRegion lets the user pick an area of the screen with macOS's own capture (the crosshair of
// ⇧⌘4: drag an area, Space for a window, Esc to cancel) and saves it as a PNG at path. It reports false,
// with no error, when the user cancelled.
func CaptureScreenRegion(path string) (bool, error) {
	_ = os.Remove(path)
	// -i interactive, -x no sound, -o no window shadow in window mode.
	err := exec.Command("/usr/sbin/screencapture", "-i", "-x", "-o", path).Run()
	if info, statErr := os.Stat(path); statErr == nil && info.Size() > 0 {
		return true, nil
	}
	var exit *exec.ExitError
	if err == nil || errors.As(err, &exit) {
		return false, nil // Esc: screencapture writes nothing
	}
	return false, err
}
