package ai

import (
	"encoding/base64"
	"encoding/json"
	"strings"
)

func b64(data []byte) string { return base64.StdEncoding.EncodeToString(data) }

// Float returns a pointer to v, for Request.Temperature.
func Float(v float64) *float64 { return &v }

// ExtractJSON decodes the first JSON object in a reply (models wrap it in prose or code fences) into v.
func ExtractJSON(reply string, v any) error {
	start := strings.Index(reply, "{")
	end := strings.LastIndex(reply, "}")
	if start < 0 || end < start {
		return json.Unmarshal([]byte(reply), v)
	}
	return json.Unmarshal([]byte(reply[start:end+1]), v)
}
