import { Events, type Client } from "discord.js";
import { handlePrefixMessage } from "../commands/handler.js";
import { logger } from "../logger.js";

export function registerMessageCreateEvent(client: Client): void {
  client.on(Events.MessageCreate, (message) => {
    void handlePrefixMessage(client, message).catch((error: unknown) => {
      logger.error("Unhandled prefix-command event error.", error);
    });
  });
}