---
name: groups
description: Manage groups. Use when the user asks about groups, wants to rename the current group, or delete group data.
---

## Commands

```bash
mrctl groups list
mrctl groups name [<name>]
mrctl groups delete
```

## Details

- `list` — shows all groups with platform and name
- `name` — with no argument, shows current group name; with argument, renames
- `delete` — deletes the current group and all its data (irreversible)
