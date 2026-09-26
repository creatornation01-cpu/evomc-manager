import { generalCommands } from "./general.js";
import { liveCheckCommands } from "./livecheck.js";
import { moderationCommands } from "./moderation.js";
import { purgeCommands } from "./purge.js";
import { roleCommands } from "./roles.js";

export const commandDefinitions = [
  ...generalCommands,
  ...moderationCommands,
  ...purgeCommands,
  ...roleCommands,
  ...liveCheckCommands,
];