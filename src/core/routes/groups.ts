import { Hono } from "hono";
import { checkPerm, type Env, getApiCtx, getAuth } from "../api-types.js";

export const groups = new Hono<Env>();

groups.get("/", (c) => {
  const denied = checkPerm(c, "groups.list");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const groupList = db.listGroups();
  return c.json({ groups: groupList });
});

groups.get("/current", (c) => {
  const { groupId } = getAuth(c);
  const { db } = getApiCtx(c);

  const group = db.getGroup(groupId);
  if (!group) {
    return c.json({ error: "Group not found" }, 404);
  }
  return c.json({ group });
});

groups.put("/current/name", async (c) => {
  const { groupId } = getAuth(c);
  const denied = checkPerm(c, "groups.rename");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const body = await c.req.json<{ name?: string }>();

  if (!body.name) {
    return c.json({ error: "Missing name" }, 400);
  }

  const updated = db.updateGroupTitle(groupId, body.name);
  if (!updated) {
    return c.json({ error: "Group not found" }, 404);
  }

  return c.json({ groupId, name: body.name });
});
