import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Adapter } from "chat";
import { Hono } from "hono";
import type { WhatsAppBaileysAdapter } from "./adapters/whatsapp.js";
import type { AppConfig } from "./config.js";
import { createApiApp } from "./core/api.js";
import type { MercuryCoreRuntime } from "./core/runtime.js";
import { logger } from "./logger.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

type WaitUntil = (task: Promise<unknown>) => void;

type WebhookHandler = (
  request: Request,
  options?: { waitUntil?: WaitUntil },
) => Promise<Response>;

export interface ServerContext {
  core: MercuryCoreRuntime;
  config: AppConfig;
  adapters: Record<string, Adapter>;
  webhooks: Record<string, WebhookHandler>;
  startTime: number;
}

export function createApp(ctx: ServerContext): Hono {
  const { core, config, adapters, webhooks, startTime } = ctx;

  const waitUntil: WaitUntil = (task) => {
    void task.catch((error) => {
      logger.error(
        "Background task failed",
        error instanceof Error ? error : undefined,
      );
    });
  };

  const app = new Hono();

  // ─── Dashboard ──────────────────────────────────────────────────────────

  app.get("/", (c) => {
    try {
      const html = readFileSync(
        join(__dirname, "dashboard/index.html"),
        "utf8",
      );
      return c.html(html);
    } catch {
      return c.text("Dashboard not found", 404);
    }
  });

  app.get("/dashboard", (c) => {
    try {
      const html = readFileSync(
        join(__dirname, "dashboard/index.html"),
        "utf8",
      );
      return c.html(html);
    } catch {
      return c.text("Dashboard not found", 404);
    }
  });

  app.get("/dashboard/activity", (c) => {
    const groups = core.db.listGroups();
    const activity: Array<{
      group: string;
      role: string;
      preview: string;
      time: number;
    }> = [];
    for (const g of groups.slice(0, 5)) {
      const msgs = core.db.getRecentMessages(g.id, 3);
      for (const m of msgs) {
        activity.push({
          group: g.id.split(":")[0],
          role: m.role,
          preview: m.content.slice(0, 60),
          time: m.createdAt,
        });
      }
    }
    activity.sort((a, b) => b.time - a.time);
    return c.json({ activity: activity.slice(0, 10) });
  });

  app.get("/dashboard/data", (c) => {
    const groups = core.db
      .listGroups()
      .map((g) => {
        const parts = g.id.split(":");
        const platform = parts[0];
        let shortId = parts.slice(1).join(":");
        if (shortId.length > 20) shortId = `...${shortId.slice(-15)}`;

        return {
          id: g.id,
          platform,
          shortId,
          title: g.title !== g.id ? g.title : null,
          lastActivity: g.updatedAt,
        };
      })
      .sort((a, b) => b.lastActivity - a.lastActivity);

    const tasks = core.db.listTasks();
    const activeGroups = core.containerRunner.getActiveGroups();

    const roles: Array<{
      groupId: string;
      platform: string;
      userId: string;
      role: string;
    }> = [];
    for (const g of groups) {
      const groupRoles = core.db.listRoles(g.id);
      for (const r of groupRoles) {
        roles.push({
          groupId: g.id,
          platform: g.platform,
          userId: r.platformUserId,
          role: r.role,
        });
      }
    }

    return c.json({ groups, tasks, activeGroups, roles });
  });

  // ─── Health & Auth ──────────────────────────────────────────────────────

  app.get("/health", (c) => {
    const uptimeSeconds = Math.floor((Date.now() - startTime) / 1000);
    const adapterStatus: Record<string, boolean> = {};
    for (const name of Object.keys(adapters)) {
      adapterStatus[name] = true;
    }
    return c.json({
      status: "ok",
      uptime: uptimeSeconds,
      queue: {
        active: core.queue.activeCount,
        pending: core.queue.pendingCount,
      },
      containers: {
        active: core.containerRunner.activeCount,
      },
      adapters: adapterStatus,
    });
  });

  app.get("/auth/whatsapp", (c) => {
    const whatsappAdapter = adapters.whatsapp as
      | WhatsAppBaileysAdapter
      | undefined;
    if (!whatsappAdapter) {
      return c.json({ error: "WhatsApp adapter not enabled" }, 400);
    }
    const status = whatsappAdapter.getQrStatus();
    return c.json(status);
  });

  // ─── Internal API ───────────────────────────────────────────────────────

  const apiApp = createApiApp({
    db: core.db,
    config,
    containerRunner: core.containerRunner,
    queue: core.queue,
    scheduler: core.scheduler,
  });

  app.route("/api", apiApp);

  // ─── Webhooks ───────────────────────────────────────────────────────────

  app.all("/webhooks/:platform", async (c) => {
    const platform = c.req.param("platform");
    logger.info("Webhook dispatch", { platform });

    const handler = webhooks[platform];
    if (!handler) {
      return c.text(`Unknown platform: ${platform}`, 404);
    }

    return handler(c.req.raw, { waitUntil });
  });

  // ─── Fallback ───────────────────────────────────────────────────────────

  app.all("*", (c) => {
    return c.text("Not found", 404);
  });

  return app;
}
