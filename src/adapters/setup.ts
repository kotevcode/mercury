import { createSlackAdapter } from "@chat-adapter/slack";
import type { Adapter } from "chat";
import type { AppConfig } from "../config.js";
import { resolveProjectPath } from "../config.js";
import { ensureGroupWorkspace } from "../storage/memory.js";
import { createDiscordNativeAdapter } from "./discord-native.js";
import { createWhatsAppBaileysAdapter } from "./whatsapp.js";

export function setupAdapters(config: AppConfig): Record<string, Adapter> {
  const adapters: Record<string, Adapter> = {};

  if (config.enableSlack) {
    if (!process.env.MERCURY_SLACK_BOT_TOKEN) {
      throw new Error(
        "MERCURY_ENABLE_SLACK=true but MERCURY_SLACK_BOT_TOKEN is not set",
      );
    }
    if (!process.env.MERCURY_SLACK_SIGNING_SECRET) {
      throw new Error(
        "MERCURY_ENABLE_SLACK=true but MERCURY_SLACK_SIGNING_SECRET is not set",
      );
    }
    adapters.slack = createSlackAdapter({
      botToken: process.env.MERCURY_SLACK_BOT_TOKEN,
      signingSecret: process.env.MERCURY_SLACK_SIGNING_SECRET,
    });
  }

  if (config.enableDiscord) {
    if (!process.env.MERCURY_DISCORD_BOT_TOKEN) {
      throw new Error(
        "MERCURY_ENABLE_DISCORD=true but MERCURY_DISCORD_BOT_TOKEN is not set",
      );
    }
    adapters.discord = createDiscordNativeAdapter({
      userName: config.chatSdkUserName,
    });
  }

  if (config.enableWhatsApp) {
    adapters.whatsapp = createWhatsAppBaileysAdapter({
      userName: config.chatSdkUserName,
      authDir: resolveProjectPath(config.whatsappAuthDir),
      mediaEnabled: config.mediaEnabled,
      mediaMaxSizeBytes: config.mediaMaxSizeMb * 1024 * 1024,
      getGroupWorkspace: (groupId: string) => {
        return ensureGroupWorkspace(
          resolveProjectPath(config.groupsDir),
          groupId,
        );
      },
    });
  }

  if (Object.keys(adapters).length === 0) {
    throw new Error(
      "No adapters enabled. Set MERCURY_ENABLE_WHATSAPP, MERCURY_ENABLE_DISCORD, or MERCURY_ENABLE_SLACK to true",
    );
  }

  return adapters;
}
