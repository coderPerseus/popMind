#!/usr/bin/env python3
"""Adds strings to internal/i18n/extra.go: add-i18n.py key 中文 English [key 中文 English ...]"""
import sys, json
p = 'internal/i18n/extra.go'
s = open(p).read()
args = sys.argv[1:]
for i in range(0, len(args), 3):
    key, zh, en = args[i:i + 3]
    if f'"{key}"' in s:
        continue
    s = s.replace('\t\t// zh-CN:end', f'\t\t{json.dumps(key)}: {json.dumps(zh, ensure_ascii=False)},\n\t\t// zh-CN:end')
    s = s.replace('\t\t// en:end', f'\t\t{json.dumps(key)}: {json.dumps(en, ensure_ascii=False)},\n\t\t// en:end')
open(p, 'w').write(s)
