import {
  Client,
  GatewayIntentBits,
  Partials,
} from "discord.js";
import { config } from "./config.js";
import { database } from "./database/database.js";
import { registerEvents } from "./events/index.js";
import { logger } from "./logger.js";
import { startHealthServer } from "./services/health-server.js";
import { stopLiveCheckService } from "./services/live-check.js";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildModeration,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
  partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User],
});

let healthServer: import("node:http").Server | undefined;
let isShuttingDown = false;

async function shutdown(reason: string, exitCode = 0): Promise<void> {
  if (isShuttingDown) return;
  isShuttingDown = true;
  logger.info("Shutting down bot.", { reason });
  stopLiveCheckService();
  client.destroy();
  if (healthServer) {
    await new Promise<void>((resolve) => healthServer!.close(() => resolve()));
  }
  if (database.open) database.close();
  process.exitCode = exitCode;
}

async function start(): Promise<void> {
  registerEvents(client);
  healthServer = await startHealthServer();
  await client.login(config.token);
  logger.info("Discord login completed.");
}

process.once("SIGINT", () => void shutdown("SIGINT"));
process.once("SIGTERM", () => void shutdown("SIGTERM"));
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection.", reason);
  void shutdown("unhandled promise rejection", 1);
});
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception.", error);
  void shutdown("uncaught exception", 1);
});

void start().catch((error: unknown) => {
  logger.error("Bot startup failed.", error);
  void shutdown("startup failure", 1);
});