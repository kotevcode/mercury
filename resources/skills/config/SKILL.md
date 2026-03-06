---
name: config
description: View and set per-group configuration. Use when the user asks to change trigger behavior, extension settings, or other group settings.
---

## Commands

```bash
mrctl config get [key]
mrctl config set <key> <value>
```

## Built-in keys

| Key | Values | Description |
|-----|--------|-------------|
| `trigger.match` | `prefix`, `mention`, `always` | How the bot is triggered |
| `trigger.patterns` | comma-separated words | Custom trigger words |
| `trigger.case_sensitive` | `true`, `false` | Case-sensitive trigger matching |

Extension config keys are also available and shown in `mrctl config get` output with descriptions and defaults.
