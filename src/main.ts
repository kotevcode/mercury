import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMemoryState } from "@chat-adapter/state-memory";
import { type Adapter, Chat, type Message, type Thread } from "chat";
import { createDiscordMessageHandler } from "./adapters/discord.js";
import { setupAdapters } from "./adapters/setup.js";
import { createSlackMessageHandler } from "./adapters/slack.js";
import { loadConfig, resolveProjectPath } from "./config.js";
import { MercuryCoreRuntime } from "./core/runtime.js";
import { ConfigRegistry } from "./extensions/config-registry.js";
import { ensureDerivedImage } from "./extensions/image-builder.js";
import { JobRunner } from "./extensions/jobs.js";
import { ExtensionRegistry } from "./extensions/loader.js";
import {
  installBuiltinSkills,
  installExtensionSkills,
} from "./extensions/skills.js";
import { createWhatsAppMessageHandler } from "./handlers/whatsapp.js";
import { configureLogger, logger } from "./logger.js";
import { createApp } from "./server.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PACKAGE_ROOT = join(__dirname, "..");
const startTime = Date.now();

async function main() {
  const config = loadConfig();

  configureLogger({
    level: config.logLevel,
    format: config.logFormat,
  });

  // ─── Initialize Core ────────────────────────────────────────────────────

  const core = new MercuryCoreRuntime(config);
  await core.initialize();

  // ─── Load Extensions ────────────────────────────────────────────────────

  const registry = new ExtensionRegistry();
  const configRegistry = new ConfigRegistry();
  const extensionsDir = resolveProjectPath(`${config.dataDir}/extensions`);
  const builtinExtDir = join(__dirname, "extensions");
  await registry.loadAll(
    extensionsDir,
    core.db,
    logger,
    configRegistry,
    builtinExtDir,
  );
  logger.info("Extensions loaded", { count: registry.size });

  // Wire extensions into runtime (hooks, context)
  core.initExtensions(registry);

  // Install skills (extension + built-in)
  const globalDir = resolveProjectPath(config.globalDir);
  installExtensionSkills(registry.list(), globalDir, logger);
  installBuiltinSkills(
    join(PACKAGE_ROOT, "resources/skills"),
    globalDir,
    logger,
  );

  // Build derived container image if extensions declare CLIs
  const agentImage = await ensureDerivedImage(
    config.agentContainerImage,
    registry.list(),
    logger,
  );
  core.containerRunner.setImage(agentImage);

  // ─── Setup Adapters ─────────────────────────────────────────────────────

  const adapters = setupAdapters(config);

  // ─── Setup Chat Bot ─────────────────────────────────────────────────────

  const bot = new Chat({
    userName: config.chatSdkUserName,
    adapters,
    state: createMemoryState(),
  });

  // ─── Message Handlers ───────────────────────────────────────────────────

  const handleSlackMessage = createSlackMessageHandler({
    core,
    db: core.db,
    config,
  });

  const handleDiscordMessage = createDiscordMessageHandler({
    core,
    db: core.db,
    config,
  });

  const handleWhatsAppMessage = createWhatsAppMessageHandler({
    core,
    config,
  });

  const handleMessage = async (
    thread: Thread,
    message: Message,
    isNew: boolean,
  ) => {
    if (message.author.isMe) return;

    // Delegate to platform-specific handlers
    if (thread.adapter.name === "slack") {
      return handleSlackMessage(thread, message, isNew);
    }
    if (thread.adapter.name === "discord") {
      return handleDiscordMessage(thread, message, isNew);
    }

    // Default: WhatsApp handler
    return handleWhatsAppMessage(thread, message, isNew);
  };

  bot.onNewMention((thread, message) => {
    void handleMessage(thread, message, true).catch((error) =>
      logger.error(
        "Message handler failed",
        error instanceof Error ? error : undefined,
      ),
    );
  });

  bot.onSubscribedMessage((thread, message) => {
    void handleMessage(thread, message, false).catch((error) =>
      logger.error(
        "Message handler failed",
        error instanceof Error ? error : undefined,
      ),
    );
  });

  // ─── Message Sender (for scheduled tasks) ───────────────────────────────

  const messageSender: import("./types.js").MessageSender = {
    async send(groupId, text) {
      const [platform] = groupId.split(":");
      const adapter = adapters[platform];
      if (!adapter) {
        logger.warn("Message dropped — no adapter for platform", {
          groupId,
          platform,
        });
        return;
      }
      await adapter.postMessage(groupId, text);
    },
  };

  // ─── Start Services ─────────────────────────────────────────────────────

  core.startScheduler(messageSender);

  // Start extension background jobs
  const jobRunner = new JobRunner();
  jobRunner.start(registry.list(), {
    db: core.db,
    config,
    log: logger,
  });
  core.onShutdown(() => jobRunner.stop());

  await bot.initialize();

  // ─── Create HTTP Server ─────────────────────────────────────────────────

  const webhooks = bot.webhooks as Record<
    string,
    (
      request: Request,
      options?: { waitUntil?: (task: Promise<unknown>) => void },
    ) => Promise<Response>
  >;

  const app = createApp({
    core,
    config,
    adapters,
    webhooks,
    startTime,
    registry,
    configRegistry,
  });

  const server = Bun.serve({
    port: config.chatSdkPort,
    fetch: app.fetch,
  });

  // ─── Shutdown Hooks ─────────────────────────────────────────────────────

  core.onShutdown(async () => {
    logger.info("Shutdown: closing chat adapters");
    for (const [name, adapter] of Object.entries(adapters)) {
      try {
        if ("shutdown" in adapter && typeof adapter.shutdown === "function") {
          await (adapter as { shutdown: () => Promise<void> }).shutdown();
          logger.info("Shutdown: adapter disconnected", { adapter: name });
        }
      } catch (err) {
        logger.error("Shutdown: failed to disconnect adapter", {
          adapter: name,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  });

  core.onShutdown(async () => {
    logger.info("Shutdown: stopping HTTP server");
    server.stop(true);
  });

  core.installSignalHandlers();

  // ─── Startup Logs ───────────────────────────────────────────────────────

  logger.info("Server started", {
    port: server.port,
    image: config.agentContainerImage,
    adapters: Object.keys(adapters).join(", "),
  });
  logger.info("Webhook path pattern: POST /webhooks/:platform");
  logger.info("Internal API: /api/*");

  if (adapters.discord) {
    logger.info("Discord enabled (native adapter with persistent connection)");
  }
  if (adapters.whatsapp) {
    logger.info("WhatsApp enabled", {
      authDir: resolveProjectPath(config.whatsappAuthDir),
    });
  }
}

main().catch((error) => {
  logger.error("Startup failed", error instanceof Error ? error : undefined);
  process.exit(1);
});
