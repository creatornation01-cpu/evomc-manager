import {
  PermissionFlagsBits,
  type GuildMember,
  type PermissionResolvable,
  type User,
} from "discord.js";
import type { CommandContext } from "../commands/types.js";

export class CommandError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CommandError";
  }
}

const permissionNames = new Map<bigint, string>([
  [PermissionFlagsBits.BanMembers, "Ban Members"],
  [PermissionFlagsBits.KickMembers, "Kick Members"],
  [PermissionFlagsBits.ModerateMembers, "Moderate Members"],
  [PermissionFlagsBits.ManageMessages, "Manage Messages"],
  [PermissionFlagsBits.ManageRoles, "Manage Roles"],
  [PermissionFlagsBits.ManageChannels, "Manage Channels"],
  [PermissionFlagsBits.ManageNicknames, "Manage Nicknames"],
]);

export function requireGuild(context: CommandContext) {
  if (!context.guild || !context.member) {
    throw new CommandError("This command can only be used in a server.");
  }
  return { guild: context.guild, member: context.member };
}

export async function requirePermission(
  context: CommandContext,
  permission: PermissionResolvable,
): Promise<void> {
  const { member } = requireGuild(context);
  const flag = typeof permission === "bigint" ? permission : undefined;
  const name = flag ? permissionNames.get(flag) ?? "the required permission" : "the required permission";
  if (!member.permissions.has(permission)) {
    throw new CommandError(`You need the ${name} permission to use this command.`);
  }
  const botMember = context.guild!.members.me ?? (await context.guild!.members.fetchMe());
  if (!botMember.permissions.has(permission)) {
    throw new CommandError(`I need the ${name} permission to do that.`);
  }
}

export async function getTargetMember(context: CommandContext, user: User): Promise<GuildMember> {
  const { guild } = requireGuild(context);
  try {
    return await guild.members.fetch(user.id);
  } catch {
    throw new CommandError(`I could not find ${user.tag} as a member of this server.`);
  }
}

export async function assertManageableTarget(
  context: CommandContext,
  target: GuildMember,
  action: string,
): Promise<void> {
  const { guild, member: actor } = requireGuild(context);
  const botMember = guild.members.me ?? (await guild.members.fetchMe());

  assertActorCanManage(context, target, action);
  if (botMember.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new CommandError(`My highest role must be above ${target.user.tag}'s highest role.`);
  }
}

export function assertActorCanManage(
  context: CommandContext,
  target: GuildMember,
  action: string,
): void {
  const { guild, member: actor } = requireGuild(context);
  if (target.id === context.client.user?.id) {
    throw new CommandError(`I cannot ${action} myself.`);
  }
  if (target.id === actor.id) {
    throw new CommandError(`You cannot ${action} yourself.`);
  }
  if (target.id === guild.ownerId) {
    throw new CommandError(`The server owner cannot be ${action}.`);
  }
  if (actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(target.roles.highest) <= 0) {
    throw new CommandError(`Your highest role must be above ${target.user.tag}'s highest role.`);
  }
}

export async function assertManageableRole(context: CommandContext, role: import("discord.js").Role) {
  const { guild, member: actor } = requireGuild(context);
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (role.managed) throw new CommandError("That role is managed by an integration and cannot be changed.");
  if (role.id === guild.id) throw new CommandError("The @everyone role cannot be changed with this command.");
  if (actor.id !== guild.ownerId && actor.roles.highest.comparePositionTo(role) <= 0) {
    throw new CommandError("Your highest role must be above the role you want to change.");
  }
  if (botMember.roles.highest.comparePositionTo(role) <= 0) {
    throw new CommandError("My highest role must be above the role you want to change.");
  }
}