import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Hono } from "hono";
import type { AppConfig } from "../src/config.js";
import { createApiApp, type Env } from "../src/core/api.js";
import { GroupQueue } from "../src/core/group-queue.js";
import {
  registerPermission,
  resetPermissions,
  seededGroups,
} from "../src/core/permissions.js";
import { ConfigRegistry } from "../src/extensions/config-registry.js";
import { ExtensionRegistry } from "../src/extensions/loader.js";
import { Db } from "../src/storage/db.js";

let tmpDir: string;
let db: Db;
let app: Hono<Env>;
let registry: ExtensionRegistry;

const headers = (caller = "admin1", group = "test-group") => ({
  "x-mercury-caller": caller,
  "x-mercury-group": group,
  "content-type": "application/json",
});

const containerRunner = {
  isRunning: () => false,
  abort: () => false,
  activeCount: 0,
  getActiveGroups: () => [],
} as any;

const scheduler = {
  start: () => {},
  stop: () => {},
  getUpcomingTasks: () => [],
} as any;

beforeEach(async () => {
  resetPermissions();
  seededGroups.clear();

  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-ext-routes-"));
  db = new Db(path.join(tmpDir, "state.db"));

  // Create extension dir with two extensions
  const extDir = path.join(tmpDir, "extensions");
  fs.mkdirSync(extDir, { recursive: true });

  // Extension with CLI + permission
  const napkinDir = path.join(extDir, "napkin");
  fs.mkdirSync(napkinDir, { recursive: true });
  fs.writeFileSync(
    path.join(napkinDir, "index.ts"),
    `export default function(m) {
			m.cli({ name: "napkin", install: "bun add -g napkin-ai" });
			m.permission({ defaultRoles: ["admin", "member"] });
		}`,
  );

  // Extension without CLI (job only)
  const distillDir = path.join(extDir, "kb-distill");
  fs.mkdirSync(distillDir, { recursive: true });
  fs.writeFileSync(
    path.join(distillDir, "index.ts"),
    `export default function(m) {
			m.job("run", { interval: 60000, run: async () => {} });
		}`,
  );

  registry = new ExtensionRegistry();
  const log = {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  } as any;
  await registry.loadAll(extDir, db, log);

  const config = {
    chatSdkPort: 8787,
    admins: "admin1",
  } as AppConfig;

  app = createApiApp({
    db,
    config,
    containerRunner,
    queue: new GroupQueue(2),
    scheduler,
    registry,
    configRegistry: new ConfigRegistry(),
  });
});

afterEach(() => {
  resetPermissions();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

// ─── GET /ext ─────────────────────────────────────────────────────────────

describe("GET /ext", () => {
  test("lists all extensions", async () => {
    const res = await app.request("/ext", { headers: headers() });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.extensions).toHaveLength(2);

    const names = body.extensions.map((e: any) => e.name).sort();
    expect(names).toEqual(["kb-distill", "napkin"]);
  });

  test("includes CLI and permission info", async () => {
    const res = await app.request("/ext", { headers: headers() });
    const body = (await res.json()) as any;

    const napkin = body.extensions.find((e: any) => e.name === "napkin");
    expect(napkin.hasCli).toBe(true);
    expect(napkin.permission).toBe("napkin");

    const distill = body.extensions.find((e: any) => e.name === "kb-distill");
    expect(distill.hasCli).toBe(false);
    expect(distill.permission).toBeNull();
  });

  test("requires auth headers", async () => {
    const res = await app.request("/ext");
    expect(res.status).toBe(400);
  });
});

// ─── POST /ext/:name/auth ─────────────────────────────────────────────────

describe("POST /ext/:name/auth", () => {
  test("allows admin for extension with permission", async () => {
    const res = await app.request("/ext/napkin/auth", {
      method: "POST",
      headers: headers("admin1"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as any;
    expect(body.allowed).toBe(true);
    expect(body.extension).toBe("napkin");
  });

  test("returns 404 for unknown extension", async () => {
    const res = await app.request("/ext/nonexistent/auth", {
      method: "POST",
      headers: headers(),
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as any;
    expect(body.error).toContain("Unknown extension");
  });

  test("returns 400 for extension without CLI", async () => {
    const res = await app.request("/ext/kb-distill/auth", {
      method: "POST",
      headers: headers(),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as any;
    expect(body.error).toContain("has no CLI");
  });

  test("returns 403 when caller lacks permission", async () => {
    // "nobody" has no role assignments, resolves to "member"
    // napkin has defaultRoles ["admin", "member"] so member should have it
    // But we need a case where permission is denied. Let's register a restricted extension.
    // Actually, napkin defaultRoles includes member, so let's test with a user
    // whose role doesn't include the permission.

    // Override napkin permissions to admin-only for this test
    db.ensureGroup("test-group");
    db.setGroupConfig("test-group", "role.member.permissions", "prompt");

    const res = await app.request("/ext/napkin/auth", {
      method: "POST",
      headers: headers("nobody", "test-group"),
    });
    expect(res.status).toBe(403);
    const body = (await res.json()) as any;
    expect(body.error).toContain("napkin");
  });
});
