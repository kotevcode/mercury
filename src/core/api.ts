import { Hono } from "hono";
import type { ApiContext, AuthContext, Env } from "./api-types.js";
import { resolveRole } from "./permissions.js";
import {
  config,
  control,
  extensions,
  groups,
  permissions,
  roles,
  tasks,
} from "./routes/index.js";

// ─── App Factory ──────────────────────────────────────────────────────────

export function createApiApp(apiCtx: ApiContext): Hono<Env> {
  const app = new Hono<Env>();

  // ─── Auth Middleware ────────────────────────────────────────────────────

  app.use("*", async (c, next) => {
    // Parse auth headers
    const callerId = c.req.header("x-mercury-caller");
    const groupId = c.req.header("x-mercury-group");

    if (!callerId || !groupId) {
      return c.json(
        { error: "Missing X-Mercury-Caller or X-Mercury-Group headers" },
        400,
      );
    }

    // Resolve role
    const seededAdmins = apiCtx.config.admins
      ? apiCtx.config.admins
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean)
      : [];

    apiCtx.db.ensureGroup(groupId);
    const role = resolveRole(apiCtx.db, groupId, callerId, seededAdmins);

    // Store in request context
    c.set("auth", { callerId, groupId, role } as AuthContext);
    c.set("apiCtx", apiCtx);
    await next();
  });

  // ─── Mount Routes ───────────────────────────────────────────────────────

  app.route("/", control);
  app.route("/tasks", tasks);
  app.route("/config", config);
  app.route("/roles", roles);
  app.route("/permissions", permissions);
  app.route("/groups", groups);
  app.route("/ext", extensions);

  // ─── Fallback ───────────────────────────────────────────────────────────

  app.all("*", (c) => {
    return c.json({ error: "Not found" }, 404);
  });

  return app;
}

// Re-export types for convenience
export type { ApiContext, AuthContext, Env } from "./api-types.js";
