import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import type { AppConfig } from "../src/config.js";
import { createApiApp, type Env } from "../src/core/api.js";
import { seededSpaces } from "../src/core/permissions.js";
import { SpaceQueue } from "../src/core/space-queue.js";
import { ConfigRegistry } from "../src/extensions/config-registry.js";
import { ExtensionRegistry } from "../src/extensions/loader.js";
import { Db } from "../src/storage/db.js";

let tmpDir: string;
let db: Db;
let queue: SpaceQueue;
let config: AppConfig;
let triggeredTasks: number[];
let app: Hono<Env>;

// Minimal container runner - tracks abort calls
const containerRunner = {
  abortedSpaces: new Set<string>(),
  abort(spaceId: string): boolean {
    const wasRunning = this.abortedSpaces.has(spaceId);
    this.abortedSpaces.add(spaceId);
    return wasRunning;
  },
  reset() {
    this.abortedSpaces.clear();
  },
};

// Minimal scheduler - tracks triggered tasks
const scheduler = {
  async triggerTask(taskId: number): Promise<void> {
    triggeredTasks.push(taskId);
  },
};

async function api(
  method: string,
  pathname: string,
  options: {
    callerId?: string;
    spaceId?: string;
    body?: unknown;
    skipAuth?: boolean;
  } = {},
): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (!options.skipAuth) {
    headers["x-mercury-caller"] = options.callerId ?? "admin1";
    headers["x-mercury-space"] = options.spaceId ?? "group1";
  }

  // Strip /api prefix since routes are mounted without it
  const path = pathname.replace(/^\/api/, "");

  const res = await app.request(path, {
    method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });

  const data = (await res.json()) as Record<string, unknown>;
  return { status: res.status, data };
}

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-api-test-"));
  db = new Db(path.join(tmpDir, "state.db"));
  queue = new SpaceQueue(2);
  triggeredTasks = [];
  containerRunner.reset();
  seededSpaces.clear();

  config = {
    logLevel: "silent",
    logFormat: "text",
    modelProvider: "anthropic",
    model: "claude-sonnet-4-20250514",
    triggerPatterns: "@Pi,Pi",
    triggerMatch: "mention",
    dataDir: tmpDir,
    agentContainerImage: "mercury-agent:test",
    containerTimeoutMs: 60000,
    maxConcurrency: 2,
    rateLimitPerUser: 10,
    rateLimitWindowMs: 60000,
    port: 8787,
    botUsername: "mercury",
    enableDiscord: false,
    discordGatewayDurationMs: 600000,
    enableSlack: false,
    enableWhatsApp: false,
    mediaEnabled: true,
    mediaMaxSizeMb: 10,
    admins: "admin1",
    kbDistillIntervalMs: 0,
    globalDir: path.join(tmpDir, "global"),
    spacesDir: path.join(tmpDir, "spaces"),
    whatsappAuthDir: path.join(tmpDir, "whatsapp"),
  } as AppConfig;

  app = createApiApp({
    db,
    config,
    containerRunner,
    queue,
    scheduler,
    registry: new ExtensionRegistry(),
    configRegistry: new ConfigRegistry(),
  });
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── Auth ─────────────────────────────────────────────────────────────────

describe("API auth", () => {
  test("missing headers returns 400", async () => {
    const { status, data } = await api("GET", "/api/whoami", {
      skipAuth: true,
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Missing");
  });

  test("missing caller header returns 400", async () => {
    const res = await app.request("/whoami", {
      headers: { "x-mercury-space": "group1" },
    });
    expect(res.status).toBe(400);
  });

  test("missing group header returns 400", async () => {
    const res = await app.request("/whoami", {
      headers: { "x-mercury-caller": "user1" },
    });
    expect(res.status).toBe(400);
  });
});

// ─── Whoami ───────────────────────────────────────────────────────────────

describe("GET /api/whoami", () => {
  test("returns caller info for admin", async () => {
    const { status, data } = await api("GET", "/api/whoami");
    expect(status).toBe(200);
    expect(data.callerId).toBe("admin1");
    expect(data.spaceId).toBe("group1");
    expect(data.role).toBe("admin");
    expect(Array.isArray(data.permissions)).toBe(true);
  });

  test("returns member role for unknown user", async () => {
    const { status, data } = await api("GET", "/api/whoami", {
      callerId: "random-user",
    });
    expect(status).toBe(200);
    expect(data.role).toBe("member");
  });

  test("returns system role for system caller", async () => {
    const { status, data } = await api("GET", "/api/whoami", {
      callerId: "system",
    });
    expect(status).toBe(200);
    expect(data.role).toBe("system");
  });
});

// ─── Tasks ────────────────────────────────────────────────────────────────

describe("GET /api/tasks", () => {
  test("returns empty list initially", async () => {
    const { status, data } = await api("GET", "/api/tasks");
    expect(status).toBe(200);
    expect(data.tasks).toEqual([]);
  });

  test("member without permission is denied", async () => {
    const { status, data } = await api("GET", "/api/tasks", {
      callerId: "user1",
    });
    expect(status).toBe(403);
    expect(data.error).toContain("tasks.list");
  });

  test("returns tasks for group only", async () => {
    // Create task in group1
    await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *", prompt: "task1" },
      spaceId: "group1",
    });
    // Create task in group2
    await api("POST", "/api/tasks", {
      body: { cron: "0 10 * * *", prompt: "task2" },
      spaceId: "group2",
    });

    const { data } = await api("GET", "/api/tasks", { spaceId: "group1" });
    const tasks = data.tasks as Array<{ prompt: string }>;
    expect(tasks.length).toBe(1);
    expect(tasks[0].prompt).toBe("task1");
  });
});

describe("POST /api/tasks", () => {
  test("creates cron task", async () => {
    const { status, data } = await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *", prompt: "morning standup" },
    });
    expect(status).toBe(200);
    expect(data.id).toBeDefined();
    expect(data.cron).toBe("0 9 * * *");
    expect(data.prompt).toBe("morning standup");
    expect(data.silent).toBe(false);
  });

  test("creates at-task (one-shot)", async () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const { status, data } = await api("POST", "/api/tasks", {
      body: { at: future, prompt: "remind me" },
    });
    expect(status).toBe(200);
    expect(data.at).toBe(future);
    expect(data.cron).toBeNull();
  });

  test("creates silent task", async () => {
    const { status, data } = await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *", prompt: "silent task", silent: true },
    });
    expect(status).toBe(200);
    expect(data.silent).toBe(true);
  });

  test("rejects missing prompt", async () => {
    const { status, data } = await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *" },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("prompt");
  });

  test("rejects missing cron and at", async () => {
    const { status, data } = await api("POST", "/api/tasks", {
      body: { prompt: "no schedule" },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("cron or at");
  });

  test("rejects both cron and at", async () => {
    const future = new Date(Date.now() + 60000).toISOString();
    const { status, data } = await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *", at: future, prompt: "both" },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("both");
  });

  test("rejects invalid cron expression", async () => {
    const { status, data } = await api("POST", "/api/tasks", {
      body: { cron: "not a cron", prompt: "test" },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("cron");
  });

  test("rejects past at-timestamp", async () => {
    const past = new Date(Date.now() - 60000).toISOString();
    const { status, data } = await api("POST", "/api/tasks", {
      body: { at: past, prompt: "past" },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("future");
  });

  test("rejects invalid at-timestamp", async () => {
    const { status, data } = await api("POST", "/api/tasks", {
      body: { at: "not-a-date", prompt: "invalid" },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Invalid at");
  });

  test("member without permission is denied", async () => {
    const { status } = await api("POST", "/api/tasks", {
      callerId: "user1",
      body: { cron: "0 9 * * *", prompt: "test" },
    });
    expect(status).toBe(403);
  });
});

describe("POST /api/tasks/:id/pause", () => {
  test("pauses active task", async () => {
    const create = await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *", prompt: "test" },
    });
    const taskId = create.data.id;

    const { status, data } = await api("POST", `/api/tasks/${taskId}/pause`);
    expect(status).toBe(200);
    expect(data.active).toBe(false);
  });

  test("returns 404 for non-existent task", async () => {
    const { status } = await api("POST", "/api/tasks/9999/pause");
    expect(status).toBe(404);
  });

  test("returns 404 for task in different group", async () => {
    const create = await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *", prompt: "test" },
      spaceId: "group1",
    });
    const taskId = create.data.id;

    const { status } = await api("POST", `/api/tasks/${taskId}/pause`, {
      spaceId: "group2",
    });
    expect(status).toBe(404);
  });

  test("invalid task ID returns 400", async () => {
    const { status } = await api("POST", "/api/tasks/abc/pause");
    expect(status).toBe(400);
  });
});

describe("POST /api/tasks/:id/resume", () => {
  test("resumes paused task", async () => {
    const create = await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *", prompt: "test" },
    });
    const taskId = create.data.id;
    await api("POST", `/api/tasks/${taskId}/pause`);

    const { status, data } = await api("POST", `/api/tasks/${taskId}/resume`);
    expect(status).toBe(200);
    expect(data.active).toBe(true);
  });

  test("returns 404 for non-existent task", async () => {
    const { status } = await api("POST", "/api/tasks/9999/resume");
    expect(status).toBe(404);
  });

  test("invalid task ID returns 400", async () => {
    const { status } = await api("POST", "/api/tasks/abc/resume");
    expect(status).toBe(400);
  });
});

describe("POST /api/tasks/:id/run", () => {
  test("triggers active task", async () => {
    const create = await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *", prompt: "test" },
    });
    const taskId = create.data.id as number;

    const { status, data } = await api("POST", `/api/tasks/${taskId}/run`);
    expect(status).toBe(200);
    expect(data.triggered).toBe(true);
    expect(triggeredTasks).toContain(taskId);
  });

  test("returns 404 for non-existent task", async () => {
    const { status } = await api("POST", "/api/tasks/9999/run");
    expect(status).toBe(404);
  });

  test("invalid task ID returns 400", async () => {
    const { status } = await api("POST", "/api/tasks/abc/run");
    expect(status).toBe(400);
  });

  test("rejects running paused task", async () => {
    const create = await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *", prompt: "test" },
    });
    const taskId = create.data.id;
    await api("POST", `/api/tasks/${taskId}/pause`);

    const { status, data } = await api("POST", `/api/tasks/${taskId}/run`);
    expect(status).toBe(400);
    expect(data.error).toContain("paused");
  });
});

describe("DELETE /api/tasks/:id", () => {
  test("deletes task", async () => {
    const create = await api("POST", "/api/tasks", {
      body: { cron: "0 9 * * *", prompt: "test" },
    });
    const taskId = create.data.id;

    const { status, data } = await api("DELETE", `/api/tasks/${taskId}`);
    expect(status).toBe(200);
    expect(data.deleted).toBe(true);

    // Verify it's gone
    const list = await api("GET", "/api/tasks");
    expect((list.data.tasks as unknown[]).length).toBe(0);
  });

  test("returns 404 for non-existent task", async () => {
    const { status } = await api("DELETE", "/api/tasks/9999");
    expect(status).toBe(404);
  });

  test("invalid task ID returns 400", async () => {
    const { status } = await api("DELETE", "/api/tasks/abc");
    expect(status).toBe(400);
  });
});

// ─── Config ───────────────────────────────────────────────────────────────

describe("GET /api/config", () => {
  test("returns empty config initially", async () => {
    const { status, data } = await api("GET", "/api/config");
    expect(status).toBe(200);
    expect(data.config).toEqual({});
  });

  test("returns set config values", async () => {
    await api("PUT", "/api/config", {
      body: { key: "trigger.match", value: "always" },
    });

    const { data } = await api("GET", "/api/config");
    const config = data.config as Record<string, string>;
    expect(config["trigger.match"]).toBe("always");
  });
});

describe("PUT /api/config", () => {
  test("sets trigger.match", async () => {
    const { status, data } = await api("PUT", "/api/config", {
      body: { key: "trigger.match", value: "prefix" },
    });
    expect(status).toBe(200);
    expect(data.key).toBe("trigger.match");
    expect(data.value).toBe("prefix");
  });

  test("sets trigger.patterns", async () => {
    const { status } = await api("PUT", "/api/config", {
      body: { key: "trigger.patterns", value: "Hey Bot,@Bot" },
    });
    expect(status).toBe(200);
  });

  test("sets trigger.case_sensitive", async () => {
    const { status } = await api("PUT", "/api/config", {
      body: { key: "trigger.case_sensitive", value: "true" },
    });
    expect(status).toBe(200);
  });

  test("rejects invalid key", async () => {
    const { status, data } = await api("PUT", "/api/config", {
      body: { key: "invalid.key", value: "foo" },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("Invalid config key");
  });

  test("rejects invalid trigger.match value", async () => {
    const { status, data } = await api("PUT", "/api/config", {
      body: { key: "trigger.match", value: "invalid" },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("prefix, mention, always");
  });

  test("rejects invalid trigger.case_sensitive value", async () => {
    const { status, data } = await api("PUT", "/api/config", {
      body: { key: "trigger.case_sensitive", value: "yes" },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("true, false");
  });

  test("rejects missing key", async () => {
    const { status } = await api("PUT", "/api/config", {
      body: { value: "foo" },
    });
    expect(status).toBe(400);
  });

  test("rejects missing value", async () => {
    const { status } = await api("PUT", "/api/config", {
      body: { key: "trigger.match" },
    });
    expect(status).toBe(400);
  });
});

// ─── Roles ────────────────────────────────────────────────────────────────

describe("GET /api/roles", () => {
  test("includes seeded admin", async () => {
    const { status, data } = await api("GET", "/api/roles");
    expect(status).toBe(200);
    // Seeded admin (admin1) is auto-granted on first access
    const roles = data.roles as Array<{ platformUserId: string; role: string }>;
    expect(roles.some((r) => r.platformUserId === "admin1")).toBe(true);
  });

  test("returns granted roles", async () => {
    await api("POST", "/api/roles", {
      body: { platformUserId: "user1", role: "moderator" },
    });

    const { data } = await api("GET", "/api/roles");
    const roles = data.roles as Array<{ platformUserId: string; role: string }>;
    const user1Role = roles.find((r) => r.platformUserId === "user1");
    expect(user1Role).toBeDefined();
    expect(user1Role?.role).toBe("moderator");
  });
});

describe("POST /api/roles", () => {
  test("grants role to user", async () => {
    const { status, data } = await api("POST", "/api/roles", {
      body: { platformUserId: "user1", role: "admin" },
    });
    expect(status).toBe(200);
    expect(data.platformUserId).toBe("user1");
    expect(data.role).toBe("admin");
  });

  test("defaults to admin role", async () => {
    const { status, data } = await api("POST", "/api/roles", {
      body: { platformUserId: "user1" },
    });
    expect(status).toBe(200);
    expect(data.role).toBe("admin");
  });

  test("rejects missing platformUserId", async () => {
    const { status, data } = await api("POST", "/api/roles", {
      body: { role: "admin" },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("platformUserId");
  });
});

describe("DELETE /api/roles/:userId", () => {
  test("revokes role (sets to member)", async () => {
    await api("POST", "/api/roles", {
      body: { platformUserId: "user1", role: "admin" },
    });

    const { status, data } = await api("DELETE", "/api/roles/user1");
    expect(status).toBe(200);
    expect(data.role).toBe("member");
  });

  test("handles URL-encoded user IDs", async () => {
    const userId = "whatsapp:123@s.whatsapp.net";
    await api("POST", "/api/roles", {
      body: { platformUserId: userId, role: "admin" },
    });

    const { status, data } = await api(
      "DELETE",
      `/api/roles/${encodeURIComponent(userId)}`,
    );
    expect(status).toBe(200);
    expect(data.platformUserId).toBe(userId);
  });
});

// ─── Permissions ──────────────────────────────────────────────────────────

describe("GET /api/permissions", () => {
  test("returns all role permissions", async () => {
    const { status, data } = await api("GET", "/api/permissions");
    expect(status).toBe(200);
    const perms = data.permissions as Record<string, string[]>;
    expect(perms.admin).toBeDefined();
    expect(perms.member).toBeDefined();
    expect(Array.isArray(data.available)).toBe(true);
  });

  test("returns specific role permissions with query param", async () => {
    const { status, data } = await api("GET", "/api/permissions?role=member");
    expect(status).toBe(200);
    expect(data.role).toBe("member");
    expect(Array.isArray(data.permissions)).toBe(true);
  });
});

describe("PUT /api/permissions", () => {
  test("sets role permissions", async () => {
    const { status, data } = await api("PUT", "/api/permissions", {
      body: { role: "member", permissions: ["prompt", "stop"] },
    });
    expect(status).toBe(200);
    expect(data.permissions).toEqual(["prompt", "stop"]);
  });

  test("rejects invalid permissions", async () => {
    const { status, data } = await api("PUT", "/api/permissions", {
      body: { role: "member", permissions: ["prompt", "invalid"] },
    });
    expect(status).toBe(400);
    expect(data.error).toContain("invalid");
  });

  test("rejects missing role", async () => {
    const { status } = await api("PUT", "/api/permissions", {
      body: { permissions: ["prompt"] },
    });
    expect(status).toBe(400);
  });

  test("rejects non-array permissions", async () => {
    const { status } = await api("PUT", "/api/permissions", {
      body: { role: "member", permissions: "prompt" },
    });
    expect(status).toBe(400);
  });
});

describe("Blacklist API", () => {
  test("admin can create and list blacklist entries", async () => {
    const created = await api("POST", "/api/blacklist", {
      body: {
        platformUserId: "user1",
        reason: "spam",
      },
    });
    expect(created.status).toBe(200);

    const list = await api("GET", "/api/blacklist");
    expect(list.status).toBe(200);
    const entries = list.data.entries as Array<{
      platformUserId: string;
      strikeCount: number;
      source: string;
    }>;
    expect(entries.length).toBe(1);
    expect(entries[0]).toMatchObject({
      platformUserId: "user1",
      strikeCount: 1,
      source: "admin",
    });
  });

  test("admin can set permanent ghosting directly", async () => {
    const { status, data } = await api("POST", "/api/blacklist", {
      body: {
        platformUserId: "user1",
        level: 3,
      },
    });
    expect(status).toBe(200);
    const entry = data.entry as {
      strikeCount: number;
      expiresAt: number | null;
    };
    expect(entry.strikeCount).toBe(3);
    expect(entry.expiresAt).toBeNull();
  });

  test("member cannot manage blacklist", async () => {
    const { status } = await api("POST", "/api/blacklist", {
      callerId: "user1",
      body: { platformUserId: "user2" },
    });
    expect(status).toBe(403);
  });

  test("admin can clear blacklist entry", async () => {
    await api("POST", "/api/blacklist", {
      body: { platformUserId: "user1" },
    });

    const cleared = await api("DELETE", "/api/blacklist/user1");
    expect(cleared.status).toBe(200);
    expect(cleared.data.cleared).toBe(true);

    const list = await api("GET", "/api/blacklist");
    expect(list.data.entries).toEqual([]);
  });
});

// ─── Stop ─────────────────────────────────────────────────────────────────

describe("POST /api/stop", () => {
  test("calls containerRunner.abort and queue.cancelPending", async () => {
    const { status, data } = await api("POST", "/api/stop");
    expect(status).toBe(200);
    expect(typeof data.stopped).toBe("boolean");
    expect(typeof data.dropped).toBe("number");
  });

  test("member without permission is denied", async () => {
    const { status } = await api("POST", "/api/stop", { callerId: "user1" });
    expect(status).toBe(403);
  });
});

// ─── Compact ──────────────────────────────────────────────────────────────

describe("POST /api/compact", () => {
  test("sets session boundary", async () => {
    const { status, data } = await api("POST", "/api/compact");
    expect(status).toBe(200);
    expect(data.spaceId).toBe("group1");
  });

  test("member without permission is denied", async () => {
    const { status } = await api("POST", "/api/compact", { callerId: "user1" });
    expect(status).toBe(403);
  });
});

// ─── Groups ───────────────────────────────────────────────────────────────

describe("GET /api/spaces", () => {
  test("returns all spaces", async () => {
    // Access multiple spaces to create them
    await api("GET", "/api/whoami", { spaceId: "group1" });
    await api("GET", "/api/whoami", { spaceId: "group2" });

    const { status, data } = await api("GET", "/api/spaces");
    expect(status).toBe(200);
    const spaces = data.spaces as Array<{ id: string }>;
    expect(spaces.length).toBeGreaterThanOrEqual(2);
  });
});

describe("GET /api/spaces/current", () => {
  test("returns current space", async () => {
    const { status, data } = await api("GET", "/api/spaces/current");
    expect(status).toBe(200);
    const space = data.space as { id: string };
    expect(space.id).toBe("group1");
  });
});

describe("PUT /api/spaces/current/name", () => {
  test("sets space name", async () => {
    const { status, data } = await api("PUT", "/api/spaces/current/name", {
      body: { name: "My Group" },
    });
    expect(status).toBe(200);
    expect(data.name).toBe("My Group");

    // Verify it persisted
    const get = await api("GET", "/api/spaces/current");
    const space = get.data.space as { name: string };
    expect(space.name).toBe("My Group");
  });

  test("rejects missing name", async () => {
    const { status } = await api("PUT", "/api/spaces/current/name", {
      body: {},
    });
    expect(status).toBe(400);
  });

  test("member without permission is denied", async () => {
    const { status } = await api("PUT", "/api/spaces/current/name", {
      callerId: "user1",
      body: { name: "Test" },
    });
    expect(status).toBe(403);
  });
});

describe("DELETE /api/spaces/current", () => {
  test("deletes current space data", async () => {
    await api("POST", "/api/tasks", {
      body: { cron: "0 * * * *", prompt: "ping" },
    });
    await api("POST", "/api/roles", {
      body: { platformUserId: "cleanup-user", role: "moderator" },
    });
    await api("PUT", "/api/config", {
      body: { key: "trigger_match", value: "always" },
    });

    const { status, data } = await api("DELETE", "/api/spaces/current");
    expect(status).toBe(200);
    expect(data.deleted).toBe(true);

    const removed = data.removed as {
      tasks: number;
      space: number;
    };
    expect(removed.space).toBe(1);
    expect(removed.tasks).toBeGreaterThanOrEqual(1);
  });

  test("member without permission is denied", async () => {
    const { status } = await api("DELETE", "/api/spaces/current", {
      callerId: "user1",
    });
    expect(status).toBe(403);
  });
});

describe("GET /api/conversations", () => {
  test("lists conversations", async () => {
    db.ensureConversation("whatsapp", "chat-1", "group");
    const { status, data } = await api("GET", "/api/conversations");
    expect(status).toBe(200);
    expect((data.conversations as unknown[]).length).toBe(1);
  });

  test("filters unlinked conversations", async () => {
    db.createSpace("space1", "Space 1");
    const c1 = db.ensureConversation("whatsapp", "chat-1", "group");
    const c2 = db.ensureConversation("slack", "C123", "channel");
    db.linkConversation(c1.id, "space1");

    const { status, data } = await api(
      "GET",
      "/api/conversations?linked=false",
    );
    expect(status).toBe(200);
    const conversations = data.conversations as Array<{ id: number }>;
    expect(conversations.map((c) => c.id)).toEqual([c2.id]);
  });
});

describe("POST /api/conversations/:id/link", () => {
  test("links conversation to space", async () => {
    db.createSpace("space1", "Space 1");
    const convo = db.ensureConversation("whatsapp", "chat-1", "group");

    const { status, data } = await api(
      "POST",
      `/api/conversations/${convo.id}/link`,
      {
        body: { spaceId: "space1" },
      },
    );
    expect(status).toBe(200);
    expect(data.linked).toBe(true);
    expect(db.findConversation("whatsapp", "chat-1")?.spaceId).toBe("space1");
  });

  test("returns 404 for non-existent space", async () => {
    const convo = db.ensureConversation("whatsapp", "chat-1", "group");
    const { status } = await api(
      "POST",
      `/api/conversations/${convo.id}/link`,
      {
        body: { spaceId: "missing" },
      },
    );
    expect(status).toBe(404);
  });

  test("returns 404 for non-existent conversation", async () => {
    db.createSpace("space1", "Space 1");
    const { status } = await api("POST", "/api/conversations/999/link", {
      body: { spaceId: "space1" },
    });
    expect(status).toBe(404);
  });
});

describe("POST /api/conversations/:id/unlink", () => {
  test("unlinks conversation", async () => {
    db.createSpace("space1", "Space 1");
    const convo = db.ensureConversation("whatsapp", "chat-1", "group");
    db.linkConversation(convo.id, "space1");

    const { status, data } = await api(
      "POST",
      `/api/conversations/${convo.id}/unlink`,
    );
    expect(status).toBe(200);
    expect(data.unlinked).toBe(true);
    expect(db.findConversation("whatsapp", "chat-1")?.spaceId).toBeNull();
  });
});

// ─── Not Found ────────────────────────────────────────────────────────────

describe("Unknown routes", () => {
  test("returns 404 for unknown path", async () => {
    const { status, data } = await api("GET", "/api/unknown");
    expect(status).toBe(404);
    expect(data.error).toBe("Not found");
  });

  test("returns 404 for wrong method", async () => {
    const { status } = await api("DELETE", "/api/whoami");
    expect(status).toBe(404);
  });
});

// ─── Permission integration ───────────────────────────────────────────────

describe("Permission changes take effect", () => {
  test("granting member stop permission allows stop", async () => {
    // Initially denied
    const denied = await api("POST", "/api/stop", { callerId: "user1" });
    expect(denied.status).toBe(403);

    // Grant permission
    await api("PUT", "/api/permissions", {
      body: { role: "member", permissions: ["prompt", "stop"] },
    });

    // Now allowed
    const allowed = await api("POST", "/api/stop", { callerId: "user1" });
    expect(allowed.status).toBe(200);
  });

  test("promoting user to admin grants all permissions", async () => {
    // Initially denied
    const denied = await api("POST", "/api/compact", { callerId: "user1" });
    expect(denied.status).toBe(403);

    // Promote to admin
    await api("POST", "/api/roles", {
      body: { platformUserId: "user1", role: "admin" },
    });

    // Now allowed
    const allowed = await api("POST", "/api/compact", { callerId: "user1" });
    expect(allowed.status).toBe(200);
  });
});
