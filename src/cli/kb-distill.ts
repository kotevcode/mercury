#!/usr/bin/env bun

/**
 * KB Distillation CLI — re-exports from the extension.
 *
 * Usage:
 *   mercury kb-distill              # Process today's messages
 *   mercury kb-distill --backfill   # Process all historical messages
 */

export type { KbDistillOptions } from "../extensions/kb-distill/distill.js";
export { exportMessages, kbDistill } from "../extensions/kb-distill/distill.js";
