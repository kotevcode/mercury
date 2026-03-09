export type MessageRole = "user" | "assistant" | "tool" | "ambient";

/**
 * Media type classification.
 * Generic across platforms — each adapter maps its native types to these.
 */
export type MediaType = "image" | "video" | "audio" | "voice" | "document";

/**
 * Attachment metadata for messages.
 * Platform-agnostic — adapters populate these fields from platform-specific data.
 */
export interface MessageAttachment {
  /** Local file path (relative to group workspace) */
  path: string;
  /** Media type classification */
  type: MediaType;
  /** MIME type (e.g., "image/jpeg", "audio/ogg") */
  mimeType: string;
  /** Original filename if available */
  filename?: string;
  /** File size in bytes */
  sizeBytes?: number;
}

export interface StoredMessage {
  id: number;
  spaceId: string;
  role: MessageRole;
  content: string;
  /** Attachments (images, voice notes, documents, etc.) */
  attachments?: MessageAttachment[];
  createdAt: number;
  updatedAt: number;
}

export interface ScheduledTask {
  id: number;
  spaceId: string;
  cron: string | null; // null for at-tasks
  at: string | null; // ISO 8601 timestamp, null for cron-tasks
  prompt: string;
  active: number;
  silent: number;
  nextRunAt: number;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

export interface Space {
  /** User-chosen slug, primary key. e.g. "family", "work" */
  id: string;
  /** Human display name. e.g. "Family Ops" */
  name: string;
  /** Comma-separated tags for metadata grouping */
  tags: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface Conversation {
  id: number;
  /** "whatsapp" | "discord" | "slack" | "api" */
  platform: string;
  /** Platform-native ID (WhatsApp JID, Discord channel ID, etc.) */
  externalId: string;
  /** "dm" | "group" | "channel" | "thread" */
  kind: string;
  /** Title observed from platform, if available */
  observedTitle: string | null;
  /** Linked space slug, or null if unlinked */
  spaceId: string | null;
  firstSeenAt: number;
  lastSeenAt: number;
}

export interface SpaceRole {
  spaceId: string;
  platformUserId: string;
  role: string;
  grantedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export interface SpaceConfigEntry {
  spaceId: string;
  key: string;
  value: string;
  updatedBy: string | null;
  createdAt: number;
  updatedAt: number;
}

export type BlacklistSource = "admin" | "automatic";

export interface BlacklistEntry {
  spaceId: string;
  platformUserId: string;
  strikeCount: number;
  source: BlacklistSource;
  reason: string | null;
  expiresAt: number | null;
  noticeSentAt: number | null;
  createdAt: number;
  updatedAt: number;
}

export type TriggerMatch = "prefix" | "mention" | "always";

export interface TriggerConfig {
  match: TriggerMatch;
  patterns: string[]; // e.g. ["@Mick", "Mick"]
  caseSensitive: boolean;
}

/**
 * Abstraction for sending messages to groups.
 * Implemented by chat-sdk, used by runtime for scheduled task replies.
 */
export interface MessageSender {
  /**
   * Send a text message (and optional file attachments) to a group.
   * @param groupId - The group identifier (encodes platform, e.g., "whatsapp:123@lid:456@lid")
   * @param text - The message text to send
   * @param files - Optional file attachments to send with the message
   */
  send(groupId: string, text: string, files?: EgressFile[]): Promise<void>;
}

// ─── Ingress / Egress Pipeline Types ────────────────────────────────────

/**
 * Normalized inbound message — every adapter produces this.
 * All fields are required (no optional booleans or arrays) to enforce
 * that adapters make explicit decisions about every field.
 */
export interface IngressMessage {
  /** Platform identifier: "whatsapp" | "slack" | "discord" */
  platform: string;
  /** Resolved space ID */
  spaceId: string;
  /** Platform-native conversation ID (NOT the space ID) */
  conversationExternalId: string;
  /** Platform-qualified caller: "whatsapp:jid", "discord:123", "slack:U123" */
  callerId: string;
  /** Display name of the message author */
  authorName?: string;
  /** Message text with mentions normalized */
  text: string;
  /** Whether this is a direct message (1:1) */
  isDM: boolean;
  /** Whether the message is a reply to the bot */
  isReplyToBot: boolean;
  /** Already-downloaded attachments (local paths) */
  attachments: MessageAttachment[];
}

/**
 * File the model wants to send back (scanned from workspace outbox/ directory).
 */
export interface EgressFile {
  /** Absolute local file path */
  path: string;
  /** Display name for the recipient */
  filename: string;
  /** MIME type (detected from extension) */
  mimeType: string;
  /** File size in bytes */
  sizeBytes: number;
}

/**
 * What a container run produces.
 * Replaces the plain string return from containerRunner.reply().
 */
export interface ContainerResult {
  /** Text reply from the model */
  reply: string;
  /** Files scanned from workspace outbox/ (new or modified during the run) */
  files: EgressFile[];
}

/**
 * Context passed to PlatformBridge.normalize() for media download decisions.
 */
export interface NormalizeContext {
  /** Bot's display name (for mention normalization) */
  botUserName: string;
  /** Get workspace path for a space (for media download destination) */
  getWorkspace: (spaceId: string) => string;
  /** Media download settings */
  media: { enabled: boolean; maxSizeBytes: number };
}

/**
 * Complete platform integration contract.
 *
 * Each platform (WhatsApp, Discord, Slack) implements this interface to cover
 * both inbound normalization and outbound reply+file sending.
 */
export interface PlatformBridge {
  readonly platform: string;

  // --- Pure helpers (used before full normalize, e.g. for typing indicator) ---

  /** Extract conversation identity and DM state from a thread ID */
  parseThread(threadId: string): { externalId: string; isDM: boolean };

  // --- Ingress ---

  /**
   * Normalize a raw platform message into IngressMessage.
   * Handles mention replacement, reply-to-bot detection, media download.
   * Returns null to skip the message (e.g., bot's own messages, empty).
   */
  normalize(
    threadId: string,
    message: unknown,
    ctx: NormalizeContext,
    spaceId: string,
  ): Promise<IngressMessage | null>;

  // --- Egress ---

  /** Send a reply with optional file attachments */
  sendReply(
    threadId: string,
    text: string,
    files?: EgressFile[],
  ): Promise<void>;
}
