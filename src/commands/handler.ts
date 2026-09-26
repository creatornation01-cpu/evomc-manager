import {
  Events,
  type ChatInputCommandInteraction,
  type Client,
  type Message,
} from "discord.js";
import { config } from "../config.js";
import { logger } from "../logger.js";
import { CommandError } from "../services/permissions.js";
import { tokenize, withoutEmoji } from "../services/text.js";
import { commandDefinitions } from "./index.js";
import type { CommandContext, CommandDefinition } from "./types.js";

const COOLDOWN_MS = 800;
const cooldowns = new Map<string, number>();

function makeMessageContext(client: Client, message: Message): CommandContext {
  return {
    client,
    guild: message.guild,
    member: message.member,
    user: message.author,
    channel: message.channel,
    message,
    interaction: null,
    commands: commandDefinitions,
    async reply(content) {
      await message.reply({
        content: withoutEmoji(content).slice(0, 2_000),
        allowedMentions: { parse: [] },
      });
    },
  };
}

async function makeInteractionContext(
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<CommandContext> {
  const member = interaction.guild
    ? interaction.guild.members.cache.get(interaction.user.id) ??
      (await interaction.guild.members.fetch(interaction.user.id).catch(() => null))
    : null;
  return {
    client,
    guild: interaction.guild,
    member,
    user: interaction.user,
    channel: interaction.channel,
    message: null,
    interaction,
    commands: commandDefinitions,
    async reply(content) {
      await interaction.editReply({
        content: withoutEmoji(content).slice(0, 2_000),
        allowedMentions: { parse: [] },
      });
    },
  };
}

function commandCooldown(context: CommandContext, commandName: string): void {
  const key = `${context.user.id}:${commandName}`;
  const now = Date.now();
  const availableAt = cooldowns.get(key) ?? 0;
  if (availableAt > now) {
    throw new CommandError(`Please wait ${((availableAt - now) / 1_000).toFixed(1)} seconds before using this command again.`);
  }
  cooldowns.set(key, now + COOLDOWN_MS);
  if (cooldowns.size > 10_000) {
    for (const [cooldownKey, expiry] of cooldowns) {
      if (expiry < now) cooldowns.delete(cooldownKey);
    }
  }
}

function userFacingDiscordError(error: unknown): string {
  if (error instanceof CommandError) return error.message;
  const discordError = error as { code?: string | number; message?: string };
  switch (String(discordError?.code ?? "")) {
    case "50001":
      return "I do not have access to that server resource. Check my channel and server permissions.";
    case "50013":
      return "Discord denied that action. Check my permissions, channel permissions, and role position.";
    case "10007":
      return "That user is no longer a member of this server.";
    case "10008":
      return "That message no longer exists.";
    case "10011":
      return "That role no longer exists.";
    case "10003":
      return "That channel no longer exists.";
    case "50034":
      return "Discord does not allow bulk-deleting messages older than 14 days.";
    default:
      return "Discord could not complete that action. Check the bot's permissions and try again.";
  }
}

async function runCommand<TArgs extends Record<string, unknown>>(
  context: CommandContext,
  definition: CommandDefinition<TArgs>,
  parse: () => Promise<TArgs> | TArgs,
): Promise<void> {
  try {
    commandCooldown(context, definition.name);
    const args = await parse();
    await definition.execute(context, args);
  } catch (error) {
    const known = error instanceof CommandError;
    const details = error instanceof Error ? error.message : String(error);
    if (!known) {
      logger.error("Command execution failed.", {
        command: definition.name,
        guildId: context.guild?.id ?? null,
        userId: context.user.id,
        error: error instanceof Error ? error : details,
      });
    } else {
      logger.warn("Command rejected.", {
        command: definition.name,
        guildId: context.guild?.id ?? null,
        userId: context.user.id,
        reason: details,
      });
    }
    await context.reply(userFacingDiscordError(error));
  }
}

export async function handlePrefixMessage(client: Client, message: Message): Promise<void> {
  if (message.author.bot || message.webhookId || !message.content.startsWith(config.prefix)) return;
  const tokens = tokenize(message.content.slice(config.prefix.length).trim());
  if (tokens.length === 0) return;
  const name = tokens.shift()!.toLowerCase();
  const definition = commandDefinitions.find((command) => command.name === name);
  if (!definition) return;
  await runCommand(makeMessageContext(client, message), definition, () =>
    definition.parsePrefix(tokens, makeMessageContext(client, message)),
  );
}

export async function handleSlashInteraction(
  client: Client,
  interaction: ChatInputCommandInteraction,
): Promise<void> {
  const definition = commandDefinitions.find((command) => command.name === interaction.commandName);
  if (!definition) return;

  try {
    await interaction.deferReply({ ephemeral: true });
  } catch (error) {
    logger.warn("Could not defer a slash command response.", {
      command: interaction.commandName,
      error: error instanceof Error ? error.message : String(error),
    });
    return;
  }

  const context = await makeInteractionContext(client, interaction);
  await runCommand(context, definition, () => definition.parseSlash(interaction));
}

export function registerCommandErrorListeners(client: Client): void {
  client.on(Events.Error, (error) => logger.error("Discord client error.", error));
  client.on(Events.Warn, (warning) => logger.warn("Discord client warning.", { warning }));
}