#!/usr/bin/env bun

import { RESERVED_EXTENSION_NAMES } from "../extensions/reserved.js";

const API_URL = process.env.API_URL;
const CALLER_ID = process.env.CALLER_ID;
const GROUP_ID = process.env.GROUP_ID;

function fatal(msg: string): never {
  process.stderr.write(`error: ${msg}\n`);
  process.exit(1);
}

if (!API_URL) fatal("API_URL not set");
if (!CALLER_ID) fatal("CALLER_ID not set");
if (!GROUP_ID) fatal("GROUP_ID not set");

const headers: Record<string, string> = {
  "x-mercury-caller": CALLER_ID,
  "x-mercury-group": GROUP_ID,
  "content-type": "application/json",
};

async function api(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const res = await fetch(`${API_URL}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });

  const data = (await res.json()) as Record<string, unknown>;

  if (!res.ok) {
    const msg =
      typeof data.error === "string" ? data.error : JSON.stringify(data);
    fatal(`${res.status} — ${msg}`);
  }

  return data;
}

function print(data: unknown): void {
  process.stdout.write(`${JSON.stringify(data, null, 2)}\n`);
}

function usage(): never {
  process.stderr.write(`mrctl — manage mercury from inside the agent container

Built-in commands:
  mrctl whoami
  mrctl tasks list|create|pause|resume|run|delete
  mrctl config get|set
  mrctl roles list|grant|revoke
  mrctl permissions show|set
  mrctl groups list|name|delete
  mrctl stop
  mrctl compact
  mrctl ext list

Extension commands:
  mrctl <extension> [args...]    Run an extension CLI (permission-gated)

Run 'mrctl ext list' to see installed extensions.

Environment:
  API_URL       Host API base URL
  CALLER_ID     Platform user ID of the caller
  GROUP_ID      Current group ID
`);
  process.exit(1);
}

function requireArg(args: string[], index: number, name: string): string {
  const val = args[index];
  if (!val) fatal(`Missing required argument: ${name}`);
  return val;
}

function parseFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1 || idx + 1 >= args.length) return undefined;
  return args[idx + 1];
}

// Built-in command names — anything else is dispatched as an extension.
// Includes help flags that aren't in reserved names.
const BUILTINS = new Set([...RESERVED_EXTENSION_NAMES, "--help", "-h"]);

async function runExtension(name: string, extArgs: string[]): Promise<void> {
  // 1. Permission check via host API
  let authRes: Response;
  try {
    authRes = await fetch(`${API_URL}/api/ext/${name}/auth`, {
      method: "POST",
      headers,
    });
  } catch (err) {
    fatal(
      `Failed to reach host API: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  if (authRes.status === 404) {
    fatal(`unknown command '${name}'. Run 'mrctl help' for usage.`);
  }

  if (authRes.status === 403) {
    fatal(`permission denied. You need the '${name}' permission.`);
  }

  if (authRes.status === 400) {
    const data = (await authRes.json()) as { error?: string };
    fatal(data.error ?? `Extension '${name}' has no CLI`);
  }

  if (!authRes.ok) {
    fatal(`Auth check failed: ${authRes.status}`);
  }

  // 2. Run CLI locally in container
  const cwd = process.env.MERCURY_WORKSPACE ?? process.cwd();
  const proc = Bun.spawn([name, ...extArgs], {
    cwd,
    env: process.env,
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (stderr) process.stderr.write(stderr);
  if (stdout) process.stdout.write(stdout);

  // Check if CLI was found
  if (exitCode === 127 || (exitCode !== 0 && stderr.includes("not found"))) {
    process.stderr.write(
      `error: '${name}' CLI not found. The extension may require an image rebuild.\n`,
    );
  }

  process.exit(exitCode);
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 0) usage();

  const cmd = args[0];
  const sub = args[1];

  // Extension dispatch — anything not a built-in
  if (!BUILTINS.has(cmd)) {
    await runExtension(cmd, args.slice(1));
    return;
  }

  switch (cmd) {
    case "whoami": {
      print(await api("GET", "/api/whoami"));
      break;
    }

    case "ext": {
      if (sub !== "list") {
        fatal("Usage: mrctl ext list");
      }
      const data = (await api("GET", "/api/ext")) as {
        extensions: Array<{
          name: string;
          hasCli: boolean;
          hasSkill: boolean;
          permission: string | null;
        }>;
      };
      if (data.extensions.length === 0) {
        process.stdout.write("No extensions installed.\n");
      } else {
        for (const ext of data.extensions) {
          const parts: string[] = [];
          if (ext.hasCli) parts.push("CLI");
          if (ext.hasSkill) parts.push("Skill");
          if (!ext.hasCli && !ext.hasSkill) parts.push("Job");
          const caps = parts.join(" + ");
          process.stdout.write(`${ext.name.padEnd(16)}${caps}\n`);
        }
      }
      break;
    }

    case "tasks": {
      if (!sub) usage();
      switch (sub) {
        case "list":
          print(await api("GET", "/api/tasks"));
          break;
        case "create": {
          const cron = parseFlag(args, "--cron");
          const at = parseFlag(args, "--at");
          const prompt = parseFlag(args, "--prompt");
          const silent = args.includes("--silent");
          if (!prompt) fatal("Missing --prompt");
          if (!cron && !at) fatal("Must specify --cron or --at");
          if (cron && at) fatal("Cannot specify both --cron and --at");
          print(await api("POST", "/api/tasks", { cron, at, prompt, silent }));
          break;
        }
        case "pause": {
          const id = requireArg(args, 2, "task id");
          print(await api("POST", `/api/tasks/${id}/pause`));
          break;
        }
        case "resume": {
          const id = requireArg(args, 2, "task id");
          print(await api("POST", `/api/tasks/${id}/resume`));
          break;
        }
        case "run": {
          const id = requireArg(args, 2, "task id");
          print(await api("POST", `/api/tasks/${id}/run`));
          break;
        }
        case "delete": {
          const id = requireArg(args, 2, "task id");
          print(await api("DELETE", `/api/tasks/${id}`));
          break;
        }
        default:
          fatal(`Unknown tasks subcommand: ${sub}`);
      }
      break;
    }

    case "config": {
      if (!sub) usage();
      switch (sub) {
        case "get": {
          const data = (await api("GET", "/api/config")) as {
            config: Record<string, string>;
          };
          const key = args[2];
          if (key) {
            const value = data.config[key];
            if (value === undefined) fatal(`Config key not set: ${key}`);
            process.stdout.write(`${value}\n`);
          } else {
            print(data);
          }
          break;
        }
        case "set": {
          const key = requireArg(args, 2, "key");
          const value = requireArg(args, 3, "value");
          print(await api("PUT", "/api/config", { key, value }));
          break;
        }
        default:
          fatal(`Unknown config subcommand: ${sub}`);
      }
      break;
    }

    case "roles": {
      if (!sub) usage();
      switch (sub) {
        case "list":
          print(await api("GET", "/api/roles"));
          break;
        case "grant": {
          const userId = requireArg(args, 2, "platform-user-id");
          const role = parseFlag(args, "--role") ?? "admin";
          print(
            await api("POST", "/api/roles", { platformUserId: userId, role }),
          );
          break;
        }
        case "revoke": {
          const userId = requireArg(args, 2, "platform-user-id");
          print(
            await api("DELETE", `/api/roles/${encodeURIComponent(userId)}`),
          );
          break;
        }
        default:
          fatal(`Unknown roles subcommand: ${sub}`);
      }
      break;
    }

    case "permissions": {
      if (!sub) usage();
      switch (sub) {
        case "show": {
          const role = parseFlag(args, "--role");
          const query = role ? `?role=${encodeURIComponent(role)}` : "";
          print(await api("GET", `/api/permissions${query}`));
          break;
        }
        case "set": {
          const targetRole = requireArg(args, 2, "role");
          const permsStr = requireArg(args, 3, "permissions (comma-separated)");
          const permissions = permsStr
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          print(
            await api("PUT", "/api/permissions", {
              role: targetRole,
              permissions,
            }),
          );
          break;
        }
        default:
          fatal(`Unknown permissions subcommand: ${sub}`);
      }
      break;
    }

    case "groups": {
      if (!sub) usage();
      switch (sub) {
        case "list": {
          const data = (await api("GET", "/api/groups")) as {
            groups: Array<{ id: string; title: string }>;
          };
          for (const g of data.groups) {
            const name = g.title !== g.id ? g.title : "(unnamed)";
            process.stdout.write(`${g.id}\t${name}\n`);
          }
          break;
        }
        case "name": {
          const name = args[2];
          if (name) {
            print(await api("PUT", "/api/groups/current/name", { name }));
          } else {
            const data = (await api("GET", "/api/groups/current")) as {
              group: { id: string; title: string };
            };
            const displayName =
              data.group.title !== data.group.id
                ? data.group.title
                : "(unnamed)";
            process.stdout.write(`${displayName}\n`);
          }
          break;
        }
        case "delete":
          print(await api("DELETE", "/api/groups/current"));
          break;
        default:
          fatal(`Unknown groups subcommand: ${sub}`);
      }
      break;
    }

    case "stop": {
      print(await api("POST", "/api/stop"));
      break;
    }

    case "compact": {
      print(await api("POST", "/api/compact"));
      break;
    }

    case "help":
    case "--help":
    case "-h":
      usage();
      break;

    default:
      // Should not reach here since non-builtins are handled above
      fatal(`Unknown command: ${cmd}`);
  }
}

main().catch((err) => {
  fatal(String(err));
});
