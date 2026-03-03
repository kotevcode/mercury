import { Hono } from "hono";
import { checkPerm, type Env, getApiCtx, getAuth } from "../api-types.js";
import {
  ALL_PERMISSIONS,
  getRolePermissions,
  type Permission,
} from "../permissions.js";

export const roles = new Hono<Env>();

// ─── Roles ────────────────────────────────────────────────────────────────

roles.get("/", (c) => {
  const { groupId } = getAuth(c);
  const denied = checkPerm(c, "roles.list");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const roleList = db.listRoles(groupId);
  return c.json({ roles: roleList });
});

roles.post("/", async (c) => {
  const { groupId, callerId } = getAuth(c);
  const denied = checkPerm(c, "roles.grant");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const body = await c.req.json<{ platformUserId?: string; role?: string }>();

  if (!body.platformUserId) {
    return c.json({ error: "Missing platformUserId" }, 400);
  }

  const targetRole = body.role ?? "admin";
  db.setRole(groupId, body.platformUserId, targetRole, callerId);

  return c.json({
    groupId,
    platformUserId: body.platformUserId,
    role: targetRole,
  });
});

roles.delete("/:userId", (c) => {
  const { groupId, callerId } = getAuth(c);
  const denied = checkPerm(c, "roles.revoke");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const targetUserId = decodeURIComponent(c.req.param("userId"));
  db.setRole(groupId, targetUserId, "member", callerId);
  return c.json({ groupId, platformUserId: targetUserId, role: "member" });
});

// ─── Permissions ──────────────────────────────────────────────────────────

export const permissions = new Hono<Env>();

permissions.get("/", (c) => {
  const { groupId } = getAuth(c);
  const denied = checkPerm(c, "permissions.get");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const url = new URL(c.req.url);
  const targetRole = url.searchParams.get("role");

  if (targetRole) {
    const perms = [...getRolePermissions(db, groupId, targetRole)];
    return c.json({ groupId, role: targetRole, permissions: perms });
  }

  // Return all known roles' permissions
  const allRoles: Record<string, string[]> = {};
  for (const r of ["admin", "member"]) {
    allRoles[r] = [...getRolePermissions(db, groupId, r)];
  }

  // Also include any custom roles from group_roles table
  const groupRoles = db.listRoles(groupId);
  const roleNames = new Set(groupRoles.map((r) => r.role));
  for (const r of roleNames) {
    if (!allRoles[r]) {
      allRoles[r] = [...getRolePermissions(db, groupId, r)];
    }
  }

  return c.json({
    groupId,
    permissions: allRoles,
    available: ALL_PERMISSIONS,
  });
});

permissions.put("/", async (c) => {
  const { groupId, callerId } = getAuth(c);
  const denied = checkPerm(c, "permissions.set");
  if (denied) return denied;

  const { db } = getApiCtx(c);
  const body = await c.req.json<{
    role?: string;
    permissions?: string[];
  }>();

  if (!body.role || !Array.isArray(body.permissions)) {
    return c.json({ error: "Missing role or permissions array" }, 400);
  }

  const invalid = body.permissions.filter(
    (p) => !ALL_PERMISSIONS.includes(p as Permission),
  );
  if (invalid.length > 0) {
    return c.json(
      {
        error: `Invalid permissions: ${invalid.join(", ")}. Valid: ${ALL_PERMISSIONS.join(", ")}`,
      },
      400,
    );
  }

  const key = `role.${body.role}.permissions`;
  db.setGroupConfig(groupId, key, body.permissions.join(","), callerId);

  return c.json({ groupId, role: body.role, permissions: body.permissions });
});
