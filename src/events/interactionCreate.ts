import { Events, type Client } from "discord.js";
import { handleSlashInteraction } from "../commands/handler.js";
import { logger } from "../logger.js";

export function registerInteractionCreateEvent(client: Client): void {
  client.on(Events.InteractionCreate, (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    void handleSlashInteraction(client, interaction).catch((error: unknown) => {
      logger.error("Unhandled slash-command event error.", error);
    });
  });
}