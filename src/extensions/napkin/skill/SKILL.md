---
name: napkin
description: Read, search, and write to the group's knowledge vault. Use when the user asks to remember something, look up past context, or manage their notes and memory.
---

Mercury uses napkin (Obsidian-compatible vault) for persistent memory.
Each group has its own vault with entities/, daily/, and structured notes.

## Reading

```bash
mrctl napkin search "query"
mrctl napkin read "filename"
mrctl napkin link back --file "name"
mrctl napkin daily read
```

## Writing

```bash
mrctl napkin create --name "Entity Name" --path entities --content "..."
mrctl napkin append --file "Entity Name" --content "..."
mrctl napkin property set --file "Entity Name" --name key --value "value"
mrctl napkin daily append --content "..."
```

## Conventions

- Use `[[wikilinks]]` when mentioning people, places, projects, or concepts
- Pages are cheap — if in doubt, link it
- Files in entities/ for persistent knowledge, daily/ for conversation context
- Remember everything the user explicitly asks you to remember
- Write context needed to continue the conversation tomorrow
