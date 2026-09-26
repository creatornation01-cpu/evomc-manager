import {
  ChannelType,
  PermissionsBitField,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type Role,
  type User,
} from "discord.js";
import type { CommandContext } from "./types.js";
import { CommandError, requireGuild } from "../services/permissions.js";
import { isSnowflake } from "../services/text.js";

export function requiredArg(args: string[], index: number, label: string): string {
  const value = args[index];
  if (!value) throw new CommandError(`Usage error: provide ${label}.`);
  return value;
}

export function trailingText(args: string[], start: number, label: string): string {
  const value = args.slice(start).join(" ").trim();
  if (!value) throw new CommandError(`Usage error: provide ${label}.`);
  return value;
}

export function parseSlashUser(
  interaction: ChatInputCommandInteraction,
  optionName = "user",
): User | null {
  return interaction.options.getUser(optionName);
}

export async function resolvePrefixUser(context: CommandContext, raw: string): Promise<User> {
  const id = raw.match(/^<@!?(\d{17,20})>$/)?.[1] ?? raw;
  if (!isSnowflake(id)) throw new CommandError(`"${raw}" is not a valid user mention or ID.`);
  try {
    return await context.client.users.fetch(id);
  } catch {
    throw new CommandError(`I could not find the user "${raw}".`);
  }
}

export async function parseSlashRole(
  interaction: ChatInputCommandInteraction,
  optionName = "role",
): Promise<Role | null> {
  const selected = interaction.options.getRole(optionName);
  if (!selected || !interaction.guild) return null;
  return (
    interaction.guild.roles.cache.get(selected.id) ??
    (await interaction.guild.roles.fetch(selected.id).catch(() => null))
  );
}

export async function resolvePrefixRole(context: CommandContext, raw: string): Promise<Role> {
  const { guild } = requireGuild(context);
  const id = raw.match(/^<@&(\d{17,20})>$/)?.[1] ?? raw;
  if (isSnowflake(id)) {
    const role = await guild.roles.fetch(id).catch(() => null);
    if (role) return role;
  }
  const matches = guild.roles.cache.filter((role) => role.name.toLowerCase() === raw.toLowerCase());
  if (matches.size === 1) return matches.first()!;
  if (matches.size > 1) throw new CommandError("That role name is ambiguous. Use a role mention or ID.");
  throw new CommandError(`I could not find the role "${raw}".`);
}

export async function parseSlashChannel(
  interaction: ChatInputCommandInteraction,
  optionName = "channel",
): Promise<GuildTextBasedChannel | null> {
  const selected = interaction.options.getChannel(optionName);
  if (!selected || !interaction.guild) return null;
  const channel =
    interaction.guild.channels.cache.get(selected.id) ??
    (await interaction.guild.channels.fetch(selected.id).catch(() => null));
  if (!channel) return null;
  if (!channel.isTextBased() || !("send" in channel) || !("messages" in channel)) {
    throw new CommandError("Choose a server text channel.");
  }
  return channel as GuildTextBasedChannel;
}

export async function resolvePrefixTextChannel(
  context: CommandContext,
  raw: string,
): Promise<GuildTextBasedChannel> {
  const { guild } = requireGuild(context);
  const id = raw.match(/^<#(\d{17,20})>$/)?.[1] ?? raw;
  const channel = isSnowflake(id)
    ? await guild.channels.fetch(id).catch(() => null)
    : guild.channels.cache.find(
        (candidate) =>
          candidate.type === ChannelType.GuildText && candidate.name.toLowerCase() === raw.toLowerCase(),
      );
  if (!channel?.isTextBased() || !("send" in channel) || !("messages" in channel)) {
    throw new CommandError(`I could not find a server text channel matching "${raw}".`);
  }
  return channel as GuildTextBasedChannel;
}

export function rolePositionPermissionSummary(role: Role): string {
  const permissions = new PermissionsBitField(role.permissions);
  const names = permissions.toArray();
  if (!names.length) return "No permissions";
  return names.slice(0, 12).join(", ") + (names.length > 12 ? ` and ${names.length - 12} more` : "");
}