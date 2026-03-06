/**
 * Napkin extension — Obsidian-compatible vault for persistent memory.
 *
 * Registers:
 * - CLI: napkin (installed in derived container image)
 * - Permission: napkin (default: admin, member)
 * - Skill: agent discovery for vault operations
 * - Hook: workspace_init — creates vault directory structure
 */

import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { MercuryExtensionAPI } from "../types.js";

const VAULT_DIRS = [".napkin", ".obsidian", "entities", "daily"];

export default function napkin(mercury: MercuryExtensionAPI): void {
  mercury.cli({ name: "napkin", install: "bun add -g napkin-ai" });
  mercury.permission({ defaultRoles: ["admin", "member"] });
  mercury.skill("./skill");

  mercury.on("workspace_init", async ({ workspace }) => {
    for (const dir of VAULT_DIRS) {
      mkdirSync(join(workspace, dir), { recursive: true });
    }
    return undefined;
  });
}
