import { Hono } from "hono";
import { checkPerm, type Env, getApiCtx, getAuth } from "../api-types.js";
import { getRolePermissions } from "../permissions.js";

export const control = new Hono<Env>();

control.get("/whoami", (c) => {
  const { callerId, groupId, role } = getAuth(c);
  const { db } = getApiCtx(c);
  const permissions = [...getRolePermissions(db, groupId, role)];
  return c.json({ callerId, groupId, role, permissions });
});

control.post("/stop", (c) => {
  const { groupId } = getAuth(c);
  const denied = checkPerm(c, "stop");
  if (denied) return denied;

  const { containerRunner, queue } = getApiCtx(c);
  const stopped = containerRunner.abort(groupId);
  const dropped = queue.cancelPending(groupId);

  return c.json({ stopped, dropped });
});

control.post("/compact", (c) => {
  const { groupId } = getAuth(c);
  const denied = checkPerm(c, "compact");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const boundary = db.setSessionBoundaryToLatest(groupId);
  return c.json({ groupId, boundary });
});
