import { Hono } from "hono";
import { checkPerm, type Env, getApiCtx, getAuth } from "../api-types.js";

export const extensions = new Hono<Env>();

/** GET /ext — list all installed extensions */
extensions.get("/", (c) => {
  const { registry } = getApiCtx(c);

  const list = registry.list().map((ext) => ({
    name: ext.name,
    hasCli: !!ext.cli,
    hasSkill: !!ext.skillDir,
    permission: ext.permission ? ext.name : null,
  }));

  return c.json({ extensions: list });
});

/** POST /ext/:name/auth — permission check for extension CLI usage */
extensions.post("/:name/auth", (c) => {
  getAuth(c); // validates auth headers are present
  const { registry } = getApiCtx(c);
  const name = c.req.param("name");

  const ext = registry.get(name);
  if (!ext) {
    return c.json({ error: `Unknown extension: ${name}` }, 404);
  }
  if (!ext.cli) {
    return c.json({ error: `Extension '${name}' has no CLI` }, 400);
  }

  // If the extension registered a permission, check it
  if (ext.permission) {
    const denied = checkPerm(c, name);
    if (denied) return denied;
  }

  return c.json({ allowed: true, extension: name });
});
