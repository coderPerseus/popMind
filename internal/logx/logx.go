// Package logx writes the app's log: one line per entry, to stderr (shown by `mygo dev`) and to
// popmind.log in the user data directory, which developers send when they report a problem.
package logx

import (
	"encoding/json"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sync"
	"time"
)

var (
	mu  sync.Mutex
	out io.Writer = os.Stderr
)

// Init also writes the log to dir/popmind.log, truncated once it passes 5 MB.
func Init(dir string) (string, error) {
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	path := filepath.Join(dir, "popmind.log")
	if info, err := os.Stat(path); err == nil && info.Size() > 5<<20 {
		_ = os.Rename(path, path+".1")
	}
	f, err := os.OpenFile(path, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return "", err
	}
	mu.Lock()
	out = io.MultiWriter(os.Stderr, f)
	mu.Unlock()
	return path, nil
}

func write(level, msg string, kv []any) {
	line := time.Now().Format("2006-01-02T15:04:05.000") + " " + level + " " + msg
	if len(kv) > 0 {
		fields := make(map[string]any, len(kv)/2)
		for i := 0; i+1 < len(kv); i += 2 {
			key := fmt.Sprint(kv[i])
			value := kv[i+1]
			if err, ok := value.(error); ok && err != nil {
				value = err.Error()
			}
			fields[key] = value
		}
		if len(kv)%2 == 1 {
			fields["_"] = kv[len(kv)-1]
		}
		if data, err := json.Marshal(fields); err == nil {
			line += " " + string(data)
		}
	}
	mu.Lock()
	fmt.Fprintln(out, line)
	mu.Unlock()
}

// Info logs msg with key/value pairs.
func Info(msg string, kv ...any) { write("INFO", msg, kv) }

// Warn logs msg with key/value pairs.
func Warn(msg string, kv ...any) { write("WARN", msg, kv) }

// Error logs msg with key/value pairs.
func Error(msg string, kv ...any) { write("ERROR", msg, kv) }
