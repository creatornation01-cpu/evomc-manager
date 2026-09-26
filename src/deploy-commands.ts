import { REST, Routes } from "discord.js";
import { commandDefinitions } from "./commands/index.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

async function deployCommands(): Promise<void> {
  if (commandDefinitions.length > 100) {
    throw new Error(`Discord supports at most 100 global commands; found ${commandDefinitions.length}.`);
  }
  const rest = new REST({ version: "10" }).setToken(config.token);
  await rest.put(Routes.applicationCommands(config.clientId), {
    body: commandDefinitions.map((definition) => definition.slash.toJSON()),
  });
  logger.info("Global slash commands registered.", { count: commandDefinitions.length });
}

void deployCommands().catch((error: unknown) => {
  logger.error("Slash command registration failed.", error);
  process.exitCode = 1;
});