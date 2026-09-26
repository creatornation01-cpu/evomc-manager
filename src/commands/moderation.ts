import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
  type Role,
  type SlashCommandOptionsOnlyBuilder,
  type User,
} from "discord.js";
import { warningStore } from "../database/database.js";
import {
  assertActorCanManage,
  assertManageableRole,
  assertManageableTarget,
  CommandError,
  getTargetMember,
  requireGuild,
  requirePermission,
} from "../services/permissions.js";
import { cleanReason, parseDuration } from "../services/text.js";
import type { CommandContext, CommandDefinition } from "./types.js";
import {
  parseSlashRole,
  parseSlashUser,
  requiredArg,
  resolvePrefixRole,
  resolvePrefixUser,
  trailingText,
} from "./shared.js";

const DAY = 86_400_000;

function command(
  name: string,
  description: string,
  addOptions?: (builder: SlashCommandBuilder) => SlashCommandBuilder | SlashCommandOptionsOnlyBuilder,
): SlashCommandBuilder | SlashCommandOptionsOnlyBuilder {
  const builder = new SlashCommandBuilder().setName(name).setDescription(description);
  return addOptions ? addOptions(builder) : builder;
}

function slashUser(interaction: ChatInputCommandInteraction, name = "user"): User {
  const user = parseSlashUser(interaction, name);
  if (!user) throw new CommandError("Choose a user.");
  return user;
}

async function requireModerationAction(
  context: CommandContext,
  user: User,
  action: string,
  permission: bigint,
): Promise<GuildMember> {
  await requirePermission(context, permission);
  const target = await getTargetMember(context, user);
  await assertManageableTarget(context, target, action);
  return target;
}

function reasonOption(builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder) {
  return builder.addStringOption((option) =>
    option.setName("reason").setDescription("Reason for this action.").setMaxLength(500),
  );
}

export const moderationCommands: CommandDefinition[] = [
  {
    name: "ban",
    category: "Moderation",
    description: "Ban a user from this server.",
    slash: reasonOption(
      command("ban", "Ban a user from this server.", (builder) =>
        builder.addUserOption((option) => option.setName("user").setDescription("User to ban.").setRequired(true)),
      ),
    ),
    async parsePrefix(args, context) {
      return {
        user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")),
        reason: args.slice(1).join(" "),
      };
    },
    parseSlash(interaction) {
      return { user: slashUser(interaction), reason: interaction.options.getString("reason") ?? "" };
    },
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.BanMembers);
      const { guild } = requireGuild(context);
      const user = args.user as User;
      const target = await guild.members.fetch(user.id).catch(() => null);
      if (target) await assertManageableTarget(context, target, "ban");
      const reason = cleanReason(String(args.reason ?? ""));
      await guild.members.ban(user, { reason, deleteMessageSeconds: 0 });
      await context.reply(`Banned ${user.tag}. Reason: ${reason}`);
    },
  },
  {
    name: "unban",
    category: "Moderation",
    description: "Remove a user's ban from this server.",
    slash: command("unban", "Remove a user's ban.", (builder) =>
      builder
        .addStringOption((option) =>
          option.setName("user_id").setDescription("Discord user ID to unban.").setRequired(true).setMinLength(17).setMaxLength(20),
        )
        .addStringOption((option) =>
          option.setName("reason").setDescription("Reason for this action.").setMaxLength(500),
        ),
    ),
    parsePrefix(args) {
      const userId = requiredArg(args, 0, "a user ID");
      if (!/^\d{17,20}$/.test(userId)) throw new CommandError("Provide a valid Discord user ID.");
      return { userId, reason: args.slice(1).join(" ") };
    },
    parseSlash(interaction) {
      return {
        userId: interaction.options.getString("user_id", true),
        reason: interaction.options.getString("reason") ?? "",
      };
    },
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.BanMembers);
      const { guild } = requireGuild(context);
      const userId = String(args.userId);
      const reason = cleanReason(String(args.reason ?? ""));
      const ban = await guild.bans.fetch(userId).catch(() => null);
      if (!ban) throw new CommandError("That user is not banned from this server.");
      await guild.members.unban(userId, reason);
      await context.reply(`Unbanned ${ban.user.tag}. Reason: ${reason}`);
    },
  },
  {
    name: "kick",
    category: "Moderation",
    description: "Remove a user from this server.",
    slash: reasonOption(
      command("kick", "Remove a user from this server.", (builder) =>
        builder.addUserOption((option) => option.setName("user").setDescription("User to kick.").setRequired(true)),
      ),
    ),
    async parsePrefix(args, context) {
      return {
        user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")),
        reason: args.slice(1).join(" "),
      };
    },
    parseSlash(interaction) {
      return { user: slashUser(interaction), reason: interaction.options.getString("reason") ?? "" };
    },
    async execute(context, args) {
      const user = args.user as User;
      const target = await requireModerationAction(
        context,
        user,
        "kick",
        PermissionFlagsBits.KickMembers,
      );
      const reason = cleanReason(String(args.reason ?? ""));
      await target.kick(reason);
      await context.reply(`Kicked ${user.tag}. Reason: ${reason}`);
    },
  },
  {
    name: "timeout",
    category: "Moderation",
    description: "Temporarily prevent a user from interacting.",
    slash: reasonOption(
      command("timeout", "Apply a temporary timeout.", (builder) =>
        builder
          .addUserOption((option) => option.setName("user").setDescription("User to timeout.").setRequired(true))
          .addStringOption((option) =>
            option.setName("duration").setDescription("Duration such as 10m, 2h, or 3d.").setRequired(true).setMaxLength(10),
          ),
      ),
    ),
    async parsePrefix(args, context) {
      return {
        user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")),
        duration: requiredArg(args, 1, "a duration such as 10m or 2h"),
        reason: args.slice(2).join(" "),
      };
    },
    parseSlash(interaction) {
      return {
        user: slashUser(interaction),
        duration: interaction.options.getString("duration", true),
        reason: interaction.options.getString("reason") ?? "",
      };
    },
    async execute(context, args) {
      const user = args.user as User;
      const durationMs = parseDuration(String(args.duration));
      if (!durationMs || durationMs > 28 * DAY) {
        throw new CommandError("Duration must be between 1 second and 28 days, for example 10m, 2h, or 3d.");
      }
      const target = await requireModerationAction(
        context,
        user,
        "timeout",
        PermissionFlagsBits.ModerateMembers,
      );
      const reason = cleanReason(String(args.reason ?? ""));
      await target.timeout(durationMs, reason);
      await context.reply(`Timed out ${user.tag} for ${String(args.duration)}. Reason: ${reason}`);
    },
  },
  {
    name: "untimeout",
    category: "Moderation",
    description: "Remove a user's timeout.",
    slash: reasonOption(
      command("untimeout", "Remove a user's timeout.", (builder) =>
        builder.addUserOption((option) => option.setName("user").setDescription("User to untimeout.").setRequired(true)),
      ),
    ),
    async parsePrefix(args, context) {
      return {
        user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")),
        reason: args.slice(1).join(" "),
      };
    },
    parseSlash(interaction) {
      return { user: slashUser(interaction), reason: interaction.options.getString("reason") ?? "" };
    },
    async execute(context, args) {
      const user = args.user as User;
      const target = await requireModerationAction(
        context,
        user,
        "untimeout",
        PermissionFlagsBits.ModerateMembers,
      );
      await target.timeout(null, cleanReason(String(args.reason ?? "")));
      await context.reply(`Removed the timeout for ${user.tag}.`);
    },
  },
  {
    name: "mute",
    category: "Moderation",
    description: "Mute a user with a temporary Discord timeout.",
    slash: reasonOption(
      command("mute", "Mute a user with a Discord timeout.", (builder) =>
        builder
          .addUserOption((option) => option.setName("user").setDescription("User to mute.").setRequired(true))
          .addStringOption((option) =>
            option.setName("duration").setDescription("Duration such as 10m, 2h, or 3d. Defaults to 1h.").setMaxLength(10),
          ),
      ),
    ),
    async parsePrefix(args, context) {
      return {
        user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")),
        duration: args[1] ?? "1h",
        reason: args.slice(2).join(" "),
      };
    },
    parseSlash(interaction) {
      return {
        user: slashUser(interaction),
        duration: interaction.options.getString("duration") ?? "1h",
        reason: interaction.options.getString("reason") ?? "",
      };
    },
    async execute(context, args) {
      const user = args.user as User;
      const duration = String(args.duration);
      const durationMs = parseDuration(duration);
      if (!durationMs || durationMs > 28 * DAY) {
        throw new CommandError("Duration must be between 1 second and 28 days.");
      }
      const target = await requireModerationAction(
        context,
        user,
        "mute",
        PermissionFlagsBits.ModerateMembers,
      );
      await target.timeout(durationMs, cleanReason(String(args.reason ?? "")));
      await context.reply(`Muted ${user.tag} for ${duration}.`);
    },
  },
  {
    name: "unmute",
    category: "Moderation",
    description: "Remove a user's mute timeout.",
    slash: command("unmute", "Remove a user's mute timeout.", (builder) =>
      builder.addUserOption((option) => option.setName("user").setDescription("User to unmute.").setRequired(true)),
    ),
    async parsePrefix(args, context) {
      return { user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")) };
    },
    parseSlash(interaction) {
      return { user: slashUser(interaction) };
    },
    async execute(context, args) {
      const user = args.user as User;
      const target = await requireModerationAction(
        context,
        user,
        "unmute",
        PermissionFlagsBits.ModerateMembers,
      );
      await target.timeout(null, "Unmuted by a moderator.");
      await context.reply(`Unmuted ${user.tag}.`);
    },
  },
  {
    name: "warn",
    category: "Moderation",
    description: "Save a permanent warning for a member.",
    slash: command("warn", "Add a persistent warning.", (builder) =>
      builder
        .addUserOption((option) => option.setName("user").setDescription("Member to warn.").setRequired(true))
        .addStringOption((option) =>
          option.setName("reason").setDescription("Reason for the warning.").setRequired(true).setMaxLength(500),
        ),
    ),
    async parsePrefix(args, context) {
      return {
        user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")),
        reason: trailingText(args, 1, "a reason"),
      };
    },
    parseSlash(interaction) {
      return {
        user: slashUser(interaction),
        reason: interaction.options.getString("reason", true),
      };
    },
    async execute(context, args) {
      const { guild, member } = requireGuild(context);
      await requirePermission(context, PermissionFlagsBits.ModerateMembers);
      const user = args.user as User;
      const target = await getTargetMember(context, user);
      assertActorCanManage(context, target, "warn");
      const reason = cleanReason(String(args.reason));
      const warningId = warningStore.add(guild.id, user.id, reason, member.id);
      await context.reply(`Warning ${warningId} recorded for ${user.tag}. Reason: ${reason}`);
    },
  },
  {
    name: "unwarn",
    category: "Moderation",
    description: "Remove one saved warning by ID.",
    slash: command("unwarn", "Remove a saved warning.", (builder) =>
      builder
        .addIntegerOption((option) =>
          option.setName("warning_id").setDescription("Warning ID to remove.").setRequired(true).setMinValue(1),
        )
        .addUserOption((option) => option.setName("user").setDescription("Restrict the search to this user.")),
    ),
    parsePrefix(args, context) {
      const id = Number(requiredArg(args, 0, "a warning ID"));
      if (!Number.isInteger(id) || id < 1) throw new CommandError("Warning ID must be a positive integer.");
      return { warningId: id, userId: args[1] };
    },
    parseSlash(interaction) {
      return {
        warningId: interaction.options.getInteger("warning_id", true),
        user: interaction.options.getUser("user"),
      };
    },
    async execute(context, args) {
      const { guild } = requireGuild(context);
      await requirePermission(context, PermissionFlagsBits.ModerateMembers);
      let userId: string | undefined;
      if (args.user instanceof Object && "id" in args.user) {
        userId = String((args.user as User).id);
      } else if (typeof args.userId === "string" && args.userId) {
        userId = (await resolvePrefixUser(context, args.userId)).id;
      }
      const removed = warningStore.remove(guild.id, Number(args.warningId), userId);
      if (!removed) throw new CommandError("No warning with that ID was found in this server.");
      await context.reply(`Warning ${Number(args.warningId)} removed.`);
    },
  },
  {
    name: "warnings",
    category: "Moderation",
    description: "List saved warnings for a member.",
    slash: command("warnings", "List a member's saved warnings.", (builder) =>
      builder.addUserOption((option) => option.setName("user").setDescription("Member to look up.")),
    ),
    async parsePrefix(args, context) {
      return { user: args[0] ? await resolvePrefixUser(context, args[0]) : context.user };
    },
    parseSlash(interaction) {
      return { user: interaction.options.getUser("user") ?? interaction.user };
    },
    async execute(context, args) {
      const { guild } = requireGuild(context);
      await requirePermission(context, PermissionFlagsBits.ModerateMembers);
      const user = args.user as User;
      const warnings = warningStore.list(guild.id, user.id);
      if (warnings.length === 0) {
        await context.reply(`${user.tag} has no saved warnings.`);
        return;
      }
      const lines = warnings.slice(0, 15).map((warning) => {
        const time = `<t:${Math.floor(warning.created_at / 1_000)}:f>`;
        return `ID ${warning.id} | ${time} | Moderator <@${warning.moderator_id}> | ${warning.reason}`;
      });
      const remaining = warnings.length - lines.length;
      await context.reply(
        `Warnings for ${user.tag} (${warnings.length} total):\n${lines.join("\n")}${remaining > 0 ? `\n${remaining} older warnings omitted.` : ""}`,
      );
    },
  },
  {
    name: "clearwarnings",
    category: "Moderation",
    description: "Clear all saved warnings for one member.",
    slash: command("clearwarnings", "Clear all warnings for a member.", (builder) =>
      builder.addUserOption((option) => option.setName("user").setDescription("Member whose warnings to clear.").setRequired(true)),
    ),
    async parsePrefix(args, context) {
      return { user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")) };
    },
    parseSlash(interaction) {
      return { user: slashUser(interaction) };
    },
    async execute(context, args) {
      const { guild } = requireGuild(context);
      await requirePermission(context, PermissionFlagsBits.ModerateMembers);
      const user = args.user as User;
      const count = warningStore.clear(guild.id, user.id);
      await context.reply(`Cleared ${count} warning${count === 1 ? "" : "s"} for ${user.tag}.`);
    },
  },
  {
    name: "slowmode",
    category: "Moderation",
    description: "Set a channel slowmode from 0 to 21600 seconds.",
    slash: command("slowmode", "Set a channel's slowmode delay.", (builder) =>
      builder.addIntegerOption((option) =>
        option
          .setName("seconds")
          .setDescription("Slowmode delay in seconds.")
          .setRequired(true)
          .setMinValue(0)
          .setMaxValue(21600),
      ),
    ),
    parsePrefix(args) {
      const seconds = Number(requiredArg(args, 0, "a number of seconds"));
      if (!Number.isInteger(seconds) || seconds < 0 || seconds > 21600) {
        throw new CommandError("Slowmode must be between 0 and 21600 seconds.");
      }
      return { seconds };
    },
    parseSlash(interaction) {
      return { seconds: interaction.options.getInteger("seconds", true) };
    },
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.ManageChannels);
      const { guild } = requireGuild(context);
      const channel = context.channel;
      if (!channel || !("setRateLimitPerUser" in channel)) {
        throw new CommandError("Use this command in a server text channel that supports slowmode.");
      }
      const seconds = Number(args.seconds);
      await channel.setRateLimitPerUser(seconds, "Slowmode changed by a moderator.");
      await context.reply(`Slowmode set to ${seconds} seconds in this channel.`);
      void guild;
    },
  },
  {
    name: "lock",
    category: "Moderation",
    description: "Prevent @everyone from sending messages in a channel.",
    slash: command("lock", "Lock a channel for @everyone.", (builder) =>
      builder.addChannelOption((option) => option.setName("channel").setDescription("Channel to lock.")),
    ),
    parsePrefix: () => ({}),
    parseSlash: (interaction) => ({ channel: interaction.options.getChannel("channel") }),
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.ManageChannels);
      const { guild } = requireGuild(context);
      const channel = (args.channel as import("discord.js").Channel | null) ?? context.channel;
      if (!channel || !("permissionOverwrites" in channel)) {
        throw new CommandError("Choose a server channel with permission overwrites.");
      }
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: false });
      await context.reply(`Locked <#${channel.id}> for @everyone.`);
    },
  },
  {
    name: "unlock",
    category: "Moderation",
    description: "Allow @everyone to send messages in a channel.",
    slash: command("unlock", "Unlock a channel for @everyone.", (builder) =>
      builder.addChannelOption((option) => option.setName("channel").setDescription("Channel to unlock.")),
    ),
    parsePrefix: () => ({}),
    parseSlash: (interaction) => ({ channel: interaction.options.getChannel("channel") }),
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.ManageChannels);
      const { guild } = requireGuild(context);
      const channel = (args.channel as import("discord.js").Channel | null) ?? context.channel;
      if (!channel || !("permissionOverwrites" in channel)) {
        throw new CommandError("Choose a server channel with permission overwrites.");
      }
      await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null });
      await context.reply(`Unlocked <#${channel.id}> for @everyone.`);
    },
  },
  {
    name: "nick",
    category: "Moderation",
    description: "Set a member's server nickname.",
    slash: command("nick", "Set a member's nickname.", (builder) =>
      builder
        .addUserOption((option) => option.setName("user").setDescription("Member whose nickname to set.").setRequired(true))
        .addStringOption((option) => option.setName("nickname").setDescription("New nickname.").setRequired(true).setMaxLength(32)),
    ),
    async parsePrefix(args, context) {
      return {
        user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")),
        nickname: trailingText(args, 1, "a nickname"),
      };
    },
    parseSlash(interaction) {
      return {
        user: slashUser(interaction),
        nickname: interaction.options.getString("nickname", true),
      };
    },
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.ManageNicknames);
      const user = args.user as User;
      const target = await getTargetMember(context, user);
      await assertManageableTarget(context, target, "change the nickname of");
      const nickname = String(args.nickname);
      if (!nickname.trim() || nickname.length > 32) {
        throw new CommandError("Nickname must contain 1 to 32 characters.");
      }
      await target.setNickname(nickname, "Nickname changed by a moderator.");
      await context.reply(`Updated ${user.tag}'s nickname.`);
    },
  },
  {
    name: "resetnick",
    category: "Moderation",
    description: "Clear a member's server nickname.",
    slash: command("resetnick", "Clear a member's nickname.", (builder) =>
      builder.addUserOption((option) => option.setName("user").setDescription("Member whose nickname to clear.").setRequired(true)),
    ),
    async parsePrefix(args, context) {
      return { user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")) };
    },
    parseSlash(interaction) {
      return { user: slashUser(interaction) };
    },
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.ManageNicknames);
      const user = args.user as User;
      const target = await getTargetMember(context, user);
      await assertManageableTarget(context, target, "change the nickname of");
      await target.setNickname(null, "Nickname reset by a moderator.");
      await context.reply(`Cleared ${user.tag}'s nickname.`);
    },
  },
  {
    name: "addrole",
    category: "Moderation",
    description: "Give a member a role.",
    slash: command("addrole", "Give a role to a member.", (builder) =>
      builder
        .addUserOption((option) => option.setName("user").setDescription("Member to update.").setRequired(true))
        .addRoleOption((option) => option.setName("role").setDescription("Role to give.").setRequired(true)),
    ),
    async parsePrefix(args, context) {
      return {
        user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")),
        role: await resolvePrefixRole(context, requiredArg(args, 1, "a role")),
      };
    },
    async parseSlash(interaction) {
      const role = await parseSlashRole(interaction);
      if (!role) throw new CommandError("Choose a role to add.");
      return { user: slashUser(interaction), role };
    },
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.ManageRoles);
      const user = args.user as User;
      const role = args.role as Role;
      await assertManageableRole(context, role);
      const target = await getTargetMember(context, user);
      if (target.roles.cache.has(role.id)) throw new CommandError(`${user.tag} already has ${role.name}.`);
      await target.roles.add(role, "Role added by a moderator.");
      await context.reply(`Added ${role.name} to ${user.tag}.`);
    },
  },
  {
    name: "removerole",
    category: "Moderation",
    description: "Remove a role from a member.",
    slash: command("removerole", "Remove a role from a member.", (builder) =>
      builder
        .addUserOption((option) => option.setName("user").setDescription("Member to update.").setRequired(true))
        .addRoleOption((option) => option.setName("role").setDescription("Role to remove.").setRequired(true)),
    ),
    async parsePrefix(args, context) {
      return {
        user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")),
        role: await resolvePrefixRole(context, requiredArg(args, 1, "a role")),
      };
    },
    async parseSlash(interaction) {
      const role = await parseSlashRole(interaction);
      if (!role) throw new CommandError("Choose a role to remove.");
      return { user: slashUser(interaction), role };
    },
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.ManageRoles);
      const user = args.user as User;
      const role = args.role as Role;
      await assertManageableRole(context, role);
      const target = await getTargetMember(context, user);
      if (!target.roles.cache.has(role.id)) throw new CommandError(`${user.tag} does not have ${role.name}.`);
      await target.roles.remove(role, "Role removed by a moderator.");
      await context.reply(`Removed ${role.name} from ${user.tag}.`);
    },
  },
  {
    name: "massrole",
    category: "Moderation",
    description: "Add or remove a role from up to 25 members.",
    slash: command("massrole", "Add or remove a role for selected members.", (builder) =>
      builder
        .addStringOption((option) =>
          option
            .setName("action")
            .setDescription("Whether to add or remove the role.")
            .setRequired(true)
            .addChoices({ name: "Add", value: "add" }, { name: "Remove", value: "remove" }),
        )
        .addRoleOption((option) => option.setName("role").setDescription("Role to change.").setRequired(true))
        .addStringOption((option) =>
          option.setName("members").setDescription("Up to 25 member mentions or IDs, separated by spaces.").setRequired(true).setMaxLength(1_000),
        ),
    ),
    async parsePrefix(args, context) {
      const action = requiredArg(args, 0, "add or remove");
      if (action !== "add" && action !== "remove") {
        throw new CommandError("Use .massrole add @role @member... or .massrole remove @role @member...");
      }
      const role = await resolvePrefixRole(context, requiredArg(args, 1, "a role"));
      return { action, role, members: args.slice(2).join(" ") };
    },
    async parseSlash(interaction) {
      const role = await parseSlashRole(interaction);
      if (!role) throw new CommandError("Choose a role.");
      return {
        action: interaction.options.getString("action", true),
        role,
        members: interaction.options.getString("members", true),
      };
    },
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.ManageRoles);
      const { guild } = requireGuild(context);
      const role = args.role as Role;
      await assertManageableRole(context, role);
      const action = String(args.action);
      if (action !== "add" && action !== "remove") throw new CommandError("Action must be add or remove.");
      const ids = [...new Set(String(args.members).match(/<@!?(\d{17,20})>|(?<!\d)(\d{17,20})(?!\d)/g) ?? [])]
        .map((value) => value.match(/\d{17,20}/)![0]!);
      if (ids.length < 1 || ids.length > 25) {
        throw new CommandError("Provide between 1 and 25 member mentions or IDs.");
      }
      const successes: string[] = [];
      const failures: string[] = [];
      for (const id of ids) {
        const target = await guild.members.fetch(id).catch(() => null);
        if (!target) {
          failures.push(`${id}: member not found`);
          continue;
        }
        if (target.roles.cache.has(role.id) === (action === "add")) {
          failures.push(`${target.user.tag}: no change needed`);
          continue;
        }
        try {
          if (action === "add") await target.roles.add(role, "Mass role updated by a moderator.");
          else await target.roles.remove(role, "Mass role updated by a moderator.");
          successes.push(target.user.tag);
        } catch (error) {
          failures.push(`${target.user.tag}: ${error instanceof Error ? error.message : "request failed"}`);
        }
      }
      const details = failures.slice(0, 8).join("\n");
      await context.reply(
        `${action === "add" ? "Added" : "Removed"} ${role.name} for ${successes.length} member${successes.length === 1 ? "" : "s"}.${failures.length ? `\n${failures.length} not changed:\n${details}` : ""}`,
      );
    },
  },
  {
    name: "announce",
    category: "Moderation",
    description: "Post a moderator announcement in a text channel.",
    slash: command("announce", "Send an announcement to a channel.", (builder) =>
      builder
        .addChannelOption((option) => option.setName("channel").setDescription("Destination text channel.").setRequired(true))
        .addStringOption((option) => option.setName("message").setDescription("Announcement text.").setRequired(true).setMaxLength(2_000)),
    ),
    async parsePrefix(args, context) {
      const { resolvePrefixTextChannel } = await import("./shared.js");
      const channel = await resolvePrefixTextChannel(context, requiredArg(args, 0, "a destination text channel"));
      return { channel, message: trailingText(args, 1, "announcement text") };
    },
    async parseSlash(interaction: ChatInputCommandInteraction) {
      const selection = interaction.options.getChannel("channel");
      const channel =
        selection && interaction.guild
          ? interaction.guild.channels.cache.get(selection.id) ??
            (await interaction.guild.channels.fetch(selection.id).catch(() => null))
          : null;
      if (!channel?.isTextBased() || !("send" in channel)) {
        throw new CommandError("Choose a server text channel.");
      }
      return {
        channel,
        message: interaction.options.getString("message", true),
      };
    },
    async execute(context, args) {
      await requirePermission(context, PermissionFlagsBits.ManageMessages);
      const { guild } = requireGuild(context);
      const channel = args.channel as import("discord.js").GuildTextBasedChannel;
      const message = String(args.message);
      if (channel.guildId !== guild.id) throw new CommandError("Choose a channel in this server.");
      if (!message.trim() || message.length > 2_000) {
        throw new CommandError("Announcement text must contain 1 to 2000 characters.");
      }
      if (message !== message.replace(/[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\uFE0E\u200D\u20E3]/gu, "")) {
        throw new CommandError("Announcements cannot contain emoji.");
      }
      await channel.send({ content: message, allowedMentions: { parse: [] } });
      await context.reply(`Announcement sent to <#${channel.id}>.`);
    },
  },
];