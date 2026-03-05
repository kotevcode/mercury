/**
 * Extension skill installation.
 *
 * Copies extension skill directories into the global pi agent dir
 * so pi discovers them inside containers. Also installs built-in
 * skills shipped with Mercury.
 */

import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../logger.js";
import type { ExtensionMeta } from "./types.js";

/**
 * Install extension skills into the global pi agent dir.
 *
 * - Copies each extension's skill directory to `<globalDir>/skills/<name>/`
 * - Removes stale skill directories for extensions that no longer exist
 * - Preserves all files (scripts, references, assets) — not just SKILL.md
 */
export function installExtensionSkills(
	extensions: ExtensionMeta[],
	globalDir: string,
	log: Logger,
): void {
	const skillsDir = path.join(globalDir, "skills");
	fs.mkdirSync(skillsDir, { recursive: true });

	// Track which extension names have skills
	const activeSkillNames = new Set(
		extensions.filter((e) => e.skillDir).map((e) => e.name),
	);

	// Clean up stale skill directories
	for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
		if (!entry.isDirectory()) continue;
		if (!activeSkillNames.has(entry.name)) {
			const stale = path.join(skillsDir, entry.name);
			fs.rmSync(stale, { recursive: true });
			log.info(`Removed stale skill: ${entry.name}`);
		}
	}

	// Copy skill directories
	for (const ext of extensions) {
		if (!ext.skillDir) continue;
		const dst = path.join(skillsDir, ext.name);
		fs.rmSync(dst, { recursive: true, force: true });
		fs.cpSync(ext.skillDir, dst, { recursive: true });
		log.info(`Installed skill: ${ext.name}`);
	}
}

/**
 * Install built-in skills shipped with Mercury.
 *
 * Copies from `resources/skills/` into `<globalDir>/skills/`.
 * Built-in skills are for mrctl built-in commands (tasks, roles, etc.).
 */
export function installBuiltinSkills(
	builtinSkillsDir: string,
	globalDir: string,
	log: Logger,
): void {
	if (!fs.existsSync(builtinSkillsDir)) {
		log.debug(`No built-in skills directory: ${builtinSkillsDir}`);
		return;
	}

	const skillsDir = path.join(globalDir, "skills");
	fs.mkdirSync(skillsDir, { recursive: true });

	for (const entry of fs.readdirSync(builtinSkillsDir, {
		withFileTypes: true,
	})) {
		if (!entry.isDirectory()) continue;
		const src = path.join(builtinSkillsDir, entry.name);
		const dst = path.join(skillsDir, entry.name);
		fs.cpSync(src, dst, { recursive: true });
		log.debug(`Installed built-in skill: ${entry.name}`);
	}
}
