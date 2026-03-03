# Mercury — Agent Instructions

Personal AI assistant for chat platforms. Runs agents in Docker containers using [pi](https://github.com/badlogic/pi) as the runtime.

## Commands

```bash
bun run check        # Typecheck + lint + test (run before PR)
bun run check:fix    # Same but auto-fix lint issues
bun test             # Tests only
bun run typecheck    # TypeScript only
bun run lint         # Biome only
```

## Running in Background

The preferred way to run Mercury in the background is via system service (not tmux):

```bash
mercury service install   # Install as launchd (macOS) or systemd (Linux)
mercury service status    # Check if running
mercury service logs -f   # Tail logs
mercury service uninstall # Remove service
```

This provides auto-restart on crash and proper system integration. See [deployment.md](docs/deployment.md) for details.

## Structure

```
src/
├── main.ts                 # Entry point — bootstraps everything
├── server.ts               # Hono HTTP server factory
├── config.ts               # Zod schema + env parsing
├── logger.ts               # Pino logger
├── types.ts                # Shared types
│
├── adapters/               # Platform adapters
│   ├── setup.ts                # Adapter initialization
│   ├── whatsapp.ts             # Baileys-based WhatsApp
│   ├── whatsapp-media.ts       # Media download/upload
│   ├── slack.ts                # Slack Events API
│   ├── discord.ts              # Discord interactions
│   └── discord-native.ts       # Discord gateway
│
├── handlers/               # Message handlers
│   └── whatsapp.ts             # WhatsApp message processing
│
├── core/
│   ├── runtime.ts              # Main orchestrator
│   ├── router.ts               # Message routing
│   ├── group-queue.ts          # Per-group concurrency
│   ├── task-scheduler.ts       # Task scheduling (cron + at)
│   ├── permissions.ts          # RBAC
│   ├── trigger.ts              # Pattern matching
│   ├── rate-limiter.ts         # Rate limiting
│   ├── api.ts                  # API app factory (Hono)
│   ├── api-types.ts            # Shared API types
│   └── routes/                 # API route handlers
│       ├── tasks.ts                # /api/tasks/*
│       ├── roles.ts                # /api/roles/* + /api/permissions/*
│       ├── config.ts               # /api/config/*
│       ├── groups.ts               # /api/groups/*
│       └── control.ts              # /api/whoami, /api/stop, /api/compact
│
├── agent/
│   ├── container-runner.ts     # Spawns Docker containers
│   ├── container-entry.ts      # Runs inside container (calls pi)
│   └── container-error.ts      # Error types
│
├── storage/
│   ├── db.ts                   # SQLite schema + queries
│   ├── memory.ts               # Workspace management
│   └── pi-auth.ts              # Pi OAuth tokens
│
├── cli/
│   ├── mercury.ts              # Main CLI (init, run, build)
│   ├── mercury-ctl.ts          # In-container CLI
│   ├── kb-distill.ts           # KB distillation logic
│   └── whatsapp-auth.ts        # WhatsApp QR auth
│
└── dashboard/
    └── index.html              # Admin dashboard (static)

tests/                      # Bun tests
docs/                       # Documentation
container/                  # Dockerfile + build.sh
resources/
├── templates/              # Init templates (AGENTS.md, .env)
├── prompts/                # KB distillation prompts
└── extensions/             # Pi extensions (subagent)
```

## Key Files

| File | What it does |
|------|--------------|
| `main.ts` | Entry point — initializes runtime, adapters, server |
| `server.ts` | Creates Hono app with all routes (dashboard, API, webhooks) |
| `runtime.ts` | Orchestrates message → container → reply flow |
| `db.ts` | All SQLite: groups, messages, tasks, roles, config |
| `container-runner.ts` | Docker spawn, timeout, cleanup |
| `config.ts` | Environment parsing with Zod |
| `core/api.ts` | Creates API app, mounts route handlers |
| `core/routes/*.ts` | Individual API route handlers |

## Database Schema

Tables in `state.db`:
- `groups` — Chat groups/channels
- `messages` — Message history (for ambient context)
- `tasks` — Scheduled tasks (cron + one-shot at)
- `roles` — User role assignments
- `permissions` — Role permission sets
- `config` — Per-group config overrides

## API

Internal API used by `mercury-ctl` from inside containers:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/api/whoami` | GET | Caller + group info |
| `/api/tasks` | GET/POST | List/create tasks |
| `/api/tasks/:id` | DELETE | Delete task |
| `/api/tasks/:id/pause` | POST | Pause task |
| `/api/tasks/:id/resume` | POST | Resume task |
| `/api/roles` | GET/POST/DELETE | Role management |
| `/api/permissions` | GET/POST | Permission management |
| `/api/config` | GET/POST | Group config |
| `/api/stop` | POST | Abort current run |
| `/api/compact` | POST | Session boundary |

Auth: `X-Mercury-Caller` + `X-Mercury-Group` headers.

## Docs

| Doc | Topic |
|-----|-------|
| [ingress.md](docs/ingress.md) | Adapter message flow |
| [memory.md](docs/memory.md) | Obsidian vault system |
| [scheduler.md](docs/scheduler.md) | Task scheduling (cron + at) |
| [permissions.md](docs/permissions.md) | RBAC system |
| [kb-distillation.md](docs/kb-distillation.md) | Knowledge extraction |
| [container-lifecycle.md](docs/container-lifecycle.md) | Docker management |
| [graceful-shutdown.md](docs/graceful-shutdown.md) | Shutdown sequence |
| [rate-limiting.md](docs/rate-limiting.md) | Rate limits |
| [media/overview.md](docs/media/overview.md) | Media handling |

## Conventions

- **Commits**: `feat:`, `fix:`, `docs:`, `refactor:`, `chore:`
- **Branches**: `issue-<num>-<slug>` for GitHub issues
- **Tests**: Co-located in `tests/`, use temp DBs
- **Config**: All via env vars, parsed in `config.ts`
- **Errors**: Use typed errors from `container-error.ts`
