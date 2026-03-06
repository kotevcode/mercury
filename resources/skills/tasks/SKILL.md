---
name: tasks
description: Manage scheduled tasks — create cron jobs or one-shot reminders that run prompts on a schedule. Use when the user asks to schedule something, set a reminder, or manage recurring tasks.
---

## Commands

```bash
mrctl tasks list
mrctl tasks create --cron "<expr>" --prompt "<text>" [--silent]
mrctl tasks create --at "<ISO8601>" --prompt "<text>" [--silent]
mrctl tasks pause <id>
mrctl tasks resume <id>
mrctl tasks run <id>
mrctl tasks delete <id>
```

## Cron expressions

Standard 5-field cron: minute hour day-of-month month day-of-week

Examples:
- `0 9 * * *` — daily at 9am
- `*/30 * * * *` — every 30 minutes
- `0 9 * * 1` — every Monday at 9am
- `0 0 1 * *` — first day of each month

## One-shot tasks

Use `--at` with ISO 8601 timestamp for one-time execution:
- `--at "2026-03-05T10:00:00Z"`

## Options

- `--silent` — task runs but output is not sent to chat (useful for background work)
