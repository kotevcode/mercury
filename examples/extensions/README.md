# Extension Examples

Real-world Mercury extensions. Copy any of these into `.mercury/extensions/` to use.

| Extension | What it does | Features used |
|-----------|-------------|---------------|
| **charts** | Chart generation via `charts-cli` | cli, skill, permission |
| **pdf** | PDF processing (OCR, form filling, conversion) | cli, skill, permission |
| **pinchtab** | Browser automation via Playwright | cli, skill, permission, `before_container` hook (env + system prompt) |
| **napkin** | Obsidian vault management + KB distillation | cli, skill, permission, `workspace_init` hook, `before_container` hook, job, config, widget, store |

## Complexity Spectrum

- **charts** — minimal: just a CLI + skill + permission
- **pdf** — system deps: apt + pip install chain, no npm binary
- **pinchtab** — env injection: `before_container` hook sets `CHROME_FLAGS` and injects search instructions into system prompt
- **napkin** — full-featured: hooks, background jobs, config, dashboard widget, KB distillation pipeline
