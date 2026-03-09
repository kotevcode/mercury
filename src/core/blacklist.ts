import type { Db } from "../storage/db.js";
import type { BlacklistEntry, BlacklistSource } from "../types.js";

const BLACKLIST_ENABLED_KEY = "blacklist.enabled";

const PUNISHMENT_MESSAGES: Record<number, string> = {
  1: "You are being punished for 1 hour.",
  2: "You are being punished for 24 hours.",
};

export interface ActiveBlacklist {
  entry: BlacklistEntry;
  level: number;
  shouldReply: boolean;
  message: string | null;
}

export function isBlacklistEnabled(db: Db, spaceId: string): boolean {
  return db.getSpaceConfig(spaceId, BLACKLIST_ENABLED_KEY) === "true";
}

export function getActiveBlacklist(
  db: Db,
  spaceId: string,
  platformUserId: string,
  existingEntry?: BlacklistEntry,
): ActiveBlacklist | null {
  const entry = existingEntry ?? db.getBlacklistEntry(spaceId, platformUserId);
  if (!entry) return null;

  if (entry.expiresAt !== null && entry.expiresAt <= Date.now()) {
    return null;
  }

  const level = clampBlacklistLevel(entry.strikeCount);
  const message = PUNISHMENT_MESSAGES[level] ?? null;

  if (!message) {
    return { entry, level, shouldReply: false, message: null };
  }

  if (entry.noticeSentAt !== null) {
    return { entry, level, shouldReply: false, message: null };
  }

  db.markBlacklistNoticeSent(spaceId, platformUserId);
  return { entry, level, shouldReply: true, message };
}

export function applyBlacklistPenalty(
  db: Db,
  spaceId: string,
  platformUserId: string,
  input: {
    source: BlacklistSource;
    level?: number;
    reason?: string;
  },
): BlacklistEntry {
  const current = db.getBlacklistEntry(spaceId, platformUserId);
  const level = clampBlacklistLevel(
    input.level ?? (current?.strikeCount ?? 0) + 1,
  );

  return db.upsertBlacklistEntry(spaceId, platformUserId, {
    strikeCount: level,
    source: input.source,
    reason: input.reason ?? current?.reason ?? null,
    expiresAt: blacklistExpiryForLevel(level),
    noticeSentAt: null,
  });
}

export function clearBlacklistPenalty(
  db: Db,
  spaceId: string,
  platformUserId: string,
): boolean {
  return db.deleteBlacklistEntry(spaceId, platformUserId);
}

function clampBlacklistLevel(level: number): number {
  if (level <= 1) return 1;
  if (level === 2) return 2;
  return 3;
}

function blacklistExpiryForLevel(level: number): number | null {
  const now = Date.now();
  switch (clampBlacklistLevel(level)) {
    case 1:
      return now + 60 * 60 * 1000;
    case 2:
      return now + 24 * 60 * 60 * 1000;
    default:
      return null;
  }
}
