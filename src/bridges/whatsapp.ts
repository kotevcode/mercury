import fs from "node:fs";
import path from "node:path";
import type { proto, WAMessage } from "@whiskeysockets/baileys";
import type { Message } from "chat";
import type { WhatsAppBaileysAdapter } from "../adapters/whatsapp.js";
import {
  detectWhatsAppMedia,
  downloadWhatsAppMedia,
} from "../adapters/whatsapp-media.js";
import { logger } from "../logger.js";
import type {
  EgressFile,
  IngressMessage,
  MessageAttachment,
  NormalizeContext,
  PlatformBridge,
} from "../types.js";

export class WhatsAppBridge implements PlatformBridge {
  readonly platform = "whatsapp";

  constructor(private readonly adapter: WhatsAppBaileysAdapter) {}

  parseThread(threadId: string): { externalId: string; isDM: boolean } {
    const parts = threadId.split(":");
    const externalId = parts.slice(1).join(":");
    const isDM = !threadId.includes("@g.us");
    return { externalId, isDM };
  }

  async normalize(
    threadId: string,
    message: unknown,
    ctx: NormalizeContext,
    spaceId: string,
  ): Promise<IngressMessage | null> {
    const msg = message as Message<proto.IWebMessageInfo>;
    if (msg.author.isMe) return null;

    const text = msg.text.trim();
    const metadata = msg.metadata as {
      isReplyToBot?: boolean;
    };
    const isReplyToBot = metadata?.isReplyToBot ?? false;

    // Download media in the bridge layer (like Discord/Slack) so it lands
    // in the resolved space workspace, not the raw conversation directory.
    const attachments: MessageAttachment[] = [];
    const rawMsg = msg.raw as WAMessage | undefined;
    const sock = this.adapter.socket;

    if (rawMsg && sock && ctx.media.enabled) {
      const mediaInfo = detectWhatsAppMedia(rawMsg.message);
      if (mediaInfo) {
        const workspace = ctx.getWorkspace(spaceId);
        try {
          const attachment = await downloadWhatsAppMedia(rawMsg, sock, {
            maxSizeBytes: ctx.media.maxSizeBytes,
            outputDir: workspace,
          });
          if (attachment) {
            attachments.push(attachment);
          }
        } catch (error) {
          logger.error("Failed to download media in bridge", {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    if (!text && attachments.length === 0) return null;

    const { externalId, isDM } = this.parseThread(threadId);

    return {
      platform: "whatsapp",
      spaceId,
      conversationExternalId: externalId,
      callerId: `whatsapp:${msg.author.userId || "unknown"}`,
      authorName: msg.author.userName,
      text,
      isDM,
      isReplyToBot,
      attachments,
    };
  }

  async sendReply(
    threadId: string,
    text: string,
    files?: EgressFile[],
  ): Promise<void> {
    if (files && files.length > 0) {
      await this.sendFiles(threadId, text, files);
    } else if (text) {
      await this.adapter.postMessage(threadId, text);
    }
  }

  private async sendFiles(
    threadId: string,
    text: string,
    files: EgressFile[],
  ): Promise<void> {
    const { chatJid } = this.adapter.decodeThreadId(threadId);
    const sock = this.adapter.socket;

    if (!sock) {
      logger.warn("WhatsApp socket unavailable, falling back to text-only");
      if (text) await this.adapter.postMessage(threadId, text);
      return;
    }

    let textSent = !text;

    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const isLast = i === files.length - 1;
      const caption = isLast && !textSent ? text : undefined;

      let buffer: Buffer;
      try {
        buffer = fs.readFileSync(file.path);
      } catch (err) {
        logger.error("Failed to read egress file", {
          path: file.path,
          error: err instanceof Error ? err.message : String(err),
        });
        continue;
      }

      try {
        const mime = file.mimeType;

        if (mime.startsWith("image/")) {
          await sock.sendMessage(chatJid, {
            image: buffer,
            caption,
            mimetype: mime,
          });
        } else if (mime.startsWith("video/")) {
          await sock.sendMessage(chatJid, {
            video: buffer,
            caption,
            mimetype: mime,
          });
        } else if (mime.startsWith("audio/")) {
          await sock.sendMessage(chatJid, {
            audio: buffer,
            mimetype: mime,
            ptt: false,
          });
          if (caption) {
            await sock.sendMessage(chatJid, { text: caption });
          }
        } else {
          await sock.sendMessage(chatJid, {
            document: buffer,
            fileName: file.filename,
            mimetype: mime,
            caption,
          });
        }
        if (caption) textSent = true;
      } catch (err) {
        logger.error("Failed to send file via WhatsApp", {
          filename: file.filename,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (!textSent) {
      await sock.sendMessage(chatJid, { text });
    }
  }
}
