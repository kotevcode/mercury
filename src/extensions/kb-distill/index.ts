/**
 * KB Distillation extension — extracts lasting knowledge from conversations.
 *
 * Registers:
 * - Job: distill — runs on interval (configurable, default disabled)
 * - Config: interval_ms — distillation interval in milliseconds (0 = disabled)
 * - Widget: last run status in dashboard
 */

import { resolveProjectPath } from "../../config.js";
import type { MercuryExtensionAPI } from "../types.js";
import { kbDistill } from "./distill.js";

export default function kbDistillExt(mercury: MercuryExtensionAPI): void {
  mercury.config("interval_ms", {
    description:
      "KB distillation interval in milliseconds (0 = disabled). Default: 0",
    default: "0",
    validate: (v) => {
      const n = Number.parseInt(v, 10);
      return !Number.isNaN(n) && n >= 0;
    },
  });

  mercury.job("distill", {
    interval: 3600_000, // 1 hour
    async run(ctx) {
      // Check if distillation is enabled (non-zero interval config)
      // The job always ticks on its fixed interval, but skips if disabled.
      // Per-group config overrides would require iterating all groups.
      const intervalMs = ctx.config.kbDistillIntervalMs;
      if (intervalMs <= 0) return;

      ctx.log.info("Running KB distillation");
      try {
        await kbDistill({
          dataDir: resolveProjectPath(ctx.config.dataDir),
          backfill: false,
        });
        mercury.store.set("last-run", new Date().toISOString());
        mercury.store.set("last-status", "success");
        ctx.log.info("KB distillation complete");
      } catch (err) {
        mercury.store.set("last-run", new Date().toISOString());
        mercury.store.set("last-status", "failed");
        ctx.log.error(
          "KB distillation failed",
          err instanceof Error ? err : undefined,
        );
      }
    },
  });

  mercury.widget({
    label: "KB Distillation",
    render: () => {
      const lastRun = mercury.store.get("last-run") ?? "never";
      const lastStatus = mercury.store.get("last-status") ?? "—";
      return `<div><strong>Last run:</strong> ${lastRun}<br><strong>Status:</strong> ${lastStatus}</div>`;
    },
  });
}
