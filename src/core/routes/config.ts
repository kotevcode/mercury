import { Hono } from "hono";
import { checkPerm, type Env, getApiCtx, getAuth } from "../api-types.js";

export const config = new Hono<Env>();

config.get("/", (c) => {
  const { groupId } = getAuth(c);
  const denied = checkPerm(c, "config.get");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const entries = db.listGroupConfig(groupId);
  const configMap: Record<string, string> = {};
  for (const e of entries) configMap[e.key] = e.value;
  return c.json({ groupId, config: configMap });
});

config.put("/", async (c) => {
  const { groupId, callerId } = getAuth(c);
  const denied = checkPerm(c, "config.set");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const body = await c.req.json<{ key?: string; value?: string }>();

  if (!body.key || body.value === undefined) {
    return c.json({ error: "Missing key or value" }, 400);
  }

  const validKeys = [
    "trigger.match",
    "trigger.patterns",
    "trigger.case_sensitive",
  ];
  if (!validKeys.includes(body.key)) {
    return c.json(
      { error: `Invalid config key. Valid: ${validKeys.join(", ")}` },
      400,
    );
  }

  if (
    body.key === "trigger.match" &&
    !["prefix", "mention", "always"].includes(body.value)
  ) {
    return c.json(
      {
        error: "Invalid trigger.match value. Valid: prefix, mention, always",
      },
      400,
    );
  }
  if (
    body.key === "trigger.case_sensitive" &&
    !["true", "false"].includes(body.value)
  ) {
    return c.json(
      { error: "Invalid trigger.case_sensitive value. Valid: true, false" },
      400,
    );
  }

  db.setGroupConfig(groupId, body.key, body.value, callerId);
  return c.json({ groupId, key: body.key, value: body.value });
});
