// Package jsonx holds the small JSON helpers the stores share: deep merging of settings objects and atomic
// writes.
package jsonx

import (
	"encoding/json"
	"os"
	"path/filepath"
)

// Merge returns base with patch merged in: objects merge key by key, recursively; anything else in patch
// (scalars, arrays, null) replaces what base has. Neither argument is modified.
func Merge(base, patch any) any {
	pm, ok := patch.(map[string]any)
	if !ok {
		return Clone(patch)
	}
	bm, ok := base.(map[string]any)
	if !ok {
		return Clone(patch)
	}
	out := make(map[string]any, len(bm)+len(pm))
	for k, v := range bm {
		out[k] = Clone(v)
	}
	for k, v := range pm {
		if existing, ok := out[k]; ok {
			out[k] = Merge(existing, v)
		} else {
			out[k] = Clone(v)
		}
	}
	return out
}

// Clone deep-copies a decoded JSON value.
func Clone(v any) any {
	switch t := v.(type) {
	case map[string]any:
		out := make(map[string]any, len(t))
		for k, item := range t {
			out[k] = Clone(item)
		}
		return out
	case []any:
		out := make([]any, len(t))
		for i, item := range t {
			out[i] = Clone(item)
		}
		return out
	default:
		return v
	}
}

// Convert re-encodes v (e.g. a decoded map) into out (e.g. a typed struct).
func Convert(v any, out any) error {
	data, err := json.Marshal(v)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, out)
}

// ToMap encodes v as a JSON object.
func ToMap(v any) map[string]any {
	data, err := json.Marshal(v)
	if err != nil {
		return nil
	}
	var out map[string]any
	_ = json.Unmarshal(data, &out)
	return out
}

// ReadFile decodes the JSON file at path into v.
func ReadFile(path string, v any) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(data, v)
}

// WriteFile writes v as indented JSON to path, atomically.
func WriteFile(path string, v any) error {
	data, err := json.MarshalIndent(v, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, append(data, '\n'), 0o644); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

// Get walks a decoded JSON object along keys.
func Get(v any, keys ...string) any {
	for _, k := range keys {
		m, ok := v.(map[string]any)
		if !ok {
			return nil
		}
		v = m[k]
	}
	return v
}

// GetString is Get for a string value.
func GetString(v any, keys ...string) string {
	s, _ := Get(v, keys...).(string)
	return s
}

// GetBool is Get for a boolean value.
func GetBool(v any, keys ...string) bool {
	b, _ := Get(v, keys...).(bool)
	return b
}
