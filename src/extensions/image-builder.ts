/**
 * Derived image builder.
 *
 * When extensions declare CLI tools via `mercury.cli()`, this module
 * generates a Dockerfile extending the base agent image with those
 * CLIs installed, builds it, and caches the result by content hash.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { Logger } from "../logger.js";
import type { ExtensionMeta } from "./types.js";

/**
 * Generate a Dockerfile that extends the base image with extension CLI installs.
 * Returns null if no extensions declare CLIs.
 */
export function generateDockerfile(
  baseImage: string,
  extensions: ExtensionMeta[],
): string | null {
  const cliExtensions = extensions.filter((e) => e.cli);
  if (cliExtensions.length === 0) return null;

  const lines = [`FROM ${baseImage}`];
  for (const ext of cliExtensions) {
    lines.push(`# Extension: ${ext.name}`);
    lines.push(`RUN ${ext.cli!.install}`);
  }
  return lines.join("\n");
}

/**
 * Compute a deterministic hash for cache invalidation.
 * Based on the base image name and sorted install commands.
 */
export function computeImageHash(
  baseImage: string,
  extensions: ExtensionMeta[],
): string {
  const installCommands = extensions
    .filter((e) => e.cli)
    .map((e) => e.cli!.install)
    .sort()
    .join("\n");

  return createHash("sha256")
    .update(`${baseImage}\n${installCommands}`)
    .digest("hex")
    .slice(0, 12);
}

/**
 * Check if a Docker image exists locally.
 */
function imageExists(tag: string): boolean {
  try {
    execSync(`docker image inspect ${tag}`, {
      encoding: "utf8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Build the derived image if needed. Returns the image name to use.
 *
 * - If no extensions declare CLIs, returns the base image unchanged.
 * - If a cached image exists (same hash), returns it.
 * - Otherwise builds a new image and returns its tag.
 * - On build failure, falls back to the base image with a warning.
 */
export async function ensureDerivedImage(
  baseImage: string,
  extensions: ExtensionMeta[],
  log: Logger,
): Promise<string> {
  const dockerfile = generateDockerfile(baseImage, extensions);
  if (!dockerfile) {
    log.debug("No extension CLIs declared, using base image");
    return baseImage;
  }

  const cliCount = extensions.filter((e) => e.cli).length;
  const hash = computeImageHash(baseImage, extensions);
  const derivedTag = `mercury-agent-ext:${hash}`;

  // Check cache
  if (imageExists(derivedTag)) {
    log.info(`Using cached agent image ${derivedTag}`);
    return derivedTag;
  }

  // Build
  log.info(
    `Building derived agent image (${cliCount} extension CLI${cliCount > 1 ? "s" : ""})...`,
  );
  for (const ext of extensions) {
    if (ext.cli) {
      log.info(`  ${ext.name}: ${ext.cli.install}`);
    }
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "mercury-ext-"));
  try {
    fs.writeFileSync(path.join(tmpDir, "Dockerfile"), dockerfile);

    const startTime = Date.now();
    execSync(`docker build -t ${derivedTag} ${tmpDir}`, {
      encoding: "utf8",
      timeout: 300_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const durationMs = Date.now() - startTime;

    log.info(`Built derived agent image ${derivedTag}`, { durationMs });
    return derivedTag;
  } catch (err) {
    log.error(
      `Failed to build derived image, falling back to base image: ${err instanceof Error ? err.message : String(err)}`,
    );
    return baseImage;
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
