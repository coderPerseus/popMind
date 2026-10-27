// Package i18n has the app's strings in its two languages, generated from the Electron app's catalogs
// (lib/i18n/shared.ts, lib/clipboard/i18n) by scripts/gen-defaults.mjs, plus the few the native build adds.
package i18n

import (
	_ "embed"
	"encoding/json"
	"fmt"
	"strings"
	"sync/atomic"
)

//go:embed messages.json
var catalogJSON []byte

var (
	catalogs = map[string]map[string]string{}
	language atomic.Value // string
)

func init() {
	if err := json.Unmarshal(catalogJSON, &catalogs); err != nil {
		panic(err)
	}
	for _, set := range []map[string]map[string]string{native, extra} {
		for lang, entries := range set {
			for k, v := range entries {
				catalogs[lang][k] = v
			}
		}
	}
	language.Store("zh-CN")
}

// SetLanguage sets the language of T: "zh-CN" or "en".
func SetLanguage(lang string) {
	if lang != "en" {
		lang = "zh-CN"
	}
	language.Store(lang)
}

// Language returns the current language.
func Language() string { return language.Load().(string) }

// T returns the message of key, with {name} placeholders filled from pairs of name, value.
func T(key string, params ...any) string {
	s, ok := catalogs[Language()][key]
	if !ok {
		if s, ok = catalogs["zh-CN"][key]; !ok {
			s = key
		}
	}
	for i := 0; i+1 < len(params); i += 2 {
		s = strings.ReplaceAll(s, "{"+fmt.Sprint(params[i])+"}", fmt.Sprint(params[i+1]))
	}
	return s
}

// IsEnglish reports whether the app shows English.
func IsEnglish() bool { return Language() == "en" }

// Placeholders are the launcher's rotating hints (mainPlaceholderOptions in lib/i18n/shared.ts).
func Placeholders() []string {
	if IsEnglish() {
		return []string{"Type to find apps", "Use /ex to explain", "Use /tr to translate", "Paste errors here",
			"Jump to AI fast", "Launch apps by name", "Confused? Try /ex", "Translate or explain", "Try 12*3+4"}
	}
	return []string{"搜应用，直接输入", "用 /ex 解释困惑", "用 /tr 快速翻译", "输入报错试试看", "一键跳转 AI", "搜 App 更快",
		"术语不懂就 /ex", "翻译解释都支持", "试试 12*3+4"}
}

// native are strings the native build adds, or the Electron catalog builds with functions.
var native = map[string]map[string]string{
	"zh-CN": {
		"calc.title":              "计算器",
		"calc.result":             "计算结果",
		"calc.example":            "示例：{trigger} (12 + 8) * 3 / 2",
		"calc.unsupported":        "只支持数字和 + - * / ( ) 这些运算符",
		"calc.invalid":            "算式格式不正确，请继续调整",
		"calc.badResult":          "算式结果无效，请检查输入内容",
		"calc.copy":               "回车复制结果",
		"main.plugin.openHint":    "输入内容后回车，打开 {title}",
		"main.plugin.example":     "示例：{trigger} 你想问的问题",
		"common.copied":           "已复制",
		"tray.openClipboard":      "剪切板历史",
		"tray.accessibility":      "授予辅助功能权限…",
		"translate.placeholder":   "输入要翻译的文本",
		"launcher.askWeb":         "用 AI / 网页搜索",
		"bubble.openHome":         "打开 popMind",
		"bubble.drag":             "拖动",
		"launcher.explain.hint":   "输入要解释的内容，例如：/ex 什么是向量数据库",
		"launcher.explain.enter":  "回车开始解释",
		"translate.detected":      "识别为{language}",
		"translate.word.forms":    "词形变化",
		"translate.word.phrases":  "常见短语",
		"translate.word.examples": "双语例句",
		"translate.pin":           "固定",
		"translate.unpin":         "取消固定",
	},
	"en": {
		"calc.title":              "Calculator",
		"calc.result":             "Result",
		"calc.example":            "Example: {trigger} (12 + 8) * 3 / 2",
		"calc.unsupported":        "Only numbers and + - * / ( ) are supported",
		"calc.invalid":            "The expression is incomplete",
		"calc.badResult":          "The result is not a number",
		"calc.copy":               "Press Enter to copy",
		"main.plugin.openHint":    "Type your question and press Enter to open {title}",
		"main.plugin.example":     "Example: {trigger} your question",
		"common.copied":           "Copied",
		"tray.openClipboard":      "Clipboard History",
		"tray.accessibility":      "Grant Accessibility Access…",
		"translate.placeholder":   "Type text to translate",
		"launcher.askWeb":         "Ask the web",
		"bubble.openHome":         "Open popMind",
		"bubble.drag":             "Drag",
		"launcher.explain.hint":   "Type what to explain, e.g. /ex what is a vector database",
		"launcher.explain.enter":  "Press Enter to explain",
		"translate.detected":      "Detected {language}",
		"translate.word.forms":    "Forms",
		"translate.word.phrases":  "Phrases",
		"translate.word.examples": "Examples",
		"translate.pin":           "Pin",
		"translate.unpin":         "Unpin",
	},
}
