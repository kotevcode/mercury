import { Hono } from "hono";
import {
  applyBlacklistPenalty,
  clearBlacklistPenalty,
} from "../blacklist.js";
import { checkPerm, type Env, getApiCtx, getAuth } from "../api-types.js";

export const blacklist = new Hono<Env>();

blacklist.get("/", (c) => {
  const { spaceId } = getAuth(c);
  const denied = checkPerm(c, "blacklist.list");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  return c.json({ entries: db.listBlacklist(spaceId) });
});

blacklist.post("/", async (c) => {
  const { spaceId } = getAuth(c);
  const denied = checkPerm(c, "blacklist.set");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const body = await c.req.json<{
    platformUserId?: string;
    level?: number;
    reason?: string;
  }>();

  if (!body.platformUserId) {
    return c.json({ error: "Missing platformUserId" }, 400);
  }

  const level =
    typeof body.level === "number" && Number.isFinite(body.level)
      ? Math.trunc(body.level)
      : undefined;

  const entry = applyBlacklistPenalty(db, spaceId, body.platformUserId, {
    source: "admin",
    level,
    reason: body.reason,
  });

  return c.json({ entry });
});

blacklist.delete("/:userId", (c) => {
  const { spaceId } = getAuth(c);
  const denied = checkPerm(c, "blacklist.clear");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const platformUserId = decodeURIComponent(c.req.param("userId"));
  const cleared = clearBlacklistPenalty(db, spaceId, platformUserId);

  if (!cleared) {
    return c.json({ error: "Blacklist entry not found" }, 404);
  }

  return c.json({ cleared: true, platformUserId, spaceId });
});
