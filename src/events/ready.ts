import { Events, type Client } from "discord.js";
import { logger } from "../logger.js";
import { startLiveCheckService } from "../services/live-check.js";

export function registerReadyEvent(client: Client): void {
  client.once(Events.ClientReady, (readyClient) => {
    logger.info("Discord bot is ready.", {
      bot: readyClient.user.tag,
      guilds: readyClient.guilds.cache.size,
    });
    startLiveCheckService(client);
  });
}