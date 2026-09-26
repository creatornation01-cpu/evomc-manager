import type { Client } from "discord.js";
import {
  registerCommandErrorListeners,
} from "../commands/handler.js";
import { registerInteractionCreateEvent } from "./interactionCreate.js";
import { registerMessageCreateEvent } from "./messageCreate.js";
import { registerReadyEvent } from "./ready.js";

export function registerEvents(client: Client): void {
  registerReadyEvent(client);
  registerMessageCreateEvent(client);
  registerInteractionCreateEvent(client);
  registerCommandErrorListeners(client);
}