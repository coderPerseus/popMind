package native

import "errors"

// CaptureScreenRegion has no Windows capture wired in yet.
func CaptureScreenRegion(path string) (bool, error) {
	return false, errors.New("screen capture is not available on Windows yet")
}
