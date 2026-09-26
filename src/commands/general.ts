import {
  PermissionFlagsBits,
  PermissionsBitField,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type Role,
  type SlashCommandOptionsOnlyBuilder,
  type User,
} from "discord.js";
import type { CommandContext, CommandDefinition } from "./types.js";
import {
  parseSlashRole,
  parseSlashUser,
  requiredArg,
  resolvePrefixRole,
  resolvePrefixUser,
} from "./shared.js";
import { CommandError, requireGuild } from "../services/permissions.js";

function makeCommand(
  name: string,
  description: string,
  addOptions?: (builder: SlashCommandBuilder) => SlashCommandBuilder | SlashCommandOptionsOnlyBuilder,
): SlashCommandBuilder | SlashCommandOptionsOnlyBuilder {
  const builder = new SlashCommandBuilder().setName(name).setDescription(description);
  return addOptions ? addOptions(builder) : builder;
}

export const generalCommands: CommandDefinition[] = [
  {
    name: "help",
    category: "Utility",
    description: "Show commands grouped by category.",
    slash: makeCommand("help", "Show the available commands."),
    parsePrefix: () => ({}),
    parseSlash: () => ({}),
    async execute(context) {
      const categories = ["General", "Moderation", "Roles", "Minecraft Live Check", "Utility"] as const;
      const body = categories
        .map((category) => {
          const commands = context.commands
            .filter((command) => command.category === category)
            .map((command) => `.${command.name}`);
          return `${category}: ${commands.join(", ") || "No commands."}`;
        })
        .join("\n");
      await context.reply(body);
    },
  },
  {
    name: "ping",
    category: "Utility",
    description: "Show the bot's gateway latency.",
    slash: makeCommand("ping", "Show the bot's gateway latency."),
    parsePrefix: () => ({}),
    parseSlash: () => ({}),
    async execute(context) {
      await context.reply(`Gateway latency: ${context.client.ws.ping} ms.`);
    },
  },
  {
    name: "botinfo",
    category: "Utility",
    description: "Show bot uptime and runtime information.",
    slash: makeCommand("botinfo", "Show bot runtime information."),
    parsePrefix: () => ({}),
    parseSlash: () => ({}),
    async execute(context) {
      const uptime = context.client.uptime ?? 0;
      const seconds = Math.floor(uptime / 1_000);
      const days = Math.floor(seconds / 86_400);
      const hours = Math.floor((seconds % 86_400) / 3_600);
      const minutes = Math.floor((seconds % 3_600) / 60);
      const bot = context.client.user;
      await context.reply(
        [
          `Bot: ${bot?.tag ?? "Unknown"}`,
          `Servers: ${context.client.guilds.cache.size.toLocaleString()}`,
          `Uptime: ${days}d ${hours}h ${minutes}m`,
          `Node.js: ${process.version}`,
          `discord.js: ${process.env.npm_package_dependencies_discord_js ?? "14.x"}`,
          `Application ID: ${bot?.id ?? "Unavailable"}`,
        ].join("\n"),
      );
    },
  },
  {
    name: "serverinfo",
    category: "General",
    description: "Show information about this server.",
    slash: makeCommand("serverinfo", "Show information about this server."),
    parsePrefix: () => ({}),
    parseSlash: () => ({}),
    async execute(context) {
      const { guild } = requireGuild(context);
      const owner = await guild.fetchOwner().catch(() => null);
      await context.reply(
        [
          `Server: ${guild.name}`,
          `Server ID: ${guild.id}`,
          `Owner: ${owner?.user.tag ?? guild.ownerId}`,
          `Created: <t:${Math.floor(guild.createdTimestamp / 1_000)}:F>`,
          `Members: ${guild.memberCount.toLocaleString()}`,
          `Roles: ${guild.roles.cache.size.toLocaleString()}`,
          `Channels: ${guild.channels.cache.size.toLocaleString()}`,
          `Boost level: ${guild.premiumTier}`,
        ].join("\n"),
      );
    },
  },
  {
    name: "userinfo",
    category: "General",
    description: "Show information about a server member or user.",
    slash: makeCommand("userinfo", "Show information about a user.", (builder) =>
      builder.addUserOption((option) => option.setName("user").setDescription("User to inspect.")),
    ),
    async parsePrefix(args, context) {
      return { user: args[0] ? await resolvePrefixUser(context, args[0]) : context.user };
    },
    parseSlash(interaction) {
      return { user: parseSlashUser(interaction) ?? interaction.user };
    },
    async execute(context, args) {
      const user = args.user as User;
      const member = context.guild ? await context.guild.members.fetch(user.id).catch(() => null) : null;
      const roles = member
        ? member.roles.cache
            .filter((role) => role.id !== context.guild!.id)
            .sort((a, b) => b.position - a.position)
            .map((role) => role.name)
            .slice(0, 12)
        : [];
      await context.reply(
        [
          `User: ${user.tag}`,
          `User ID: ${user.id}`,
          `Account created: <t:${Math.floor(user.createdTimestamp / 1_000)}:F>`,
          member ? `Joined server: <t:${Math.floor(member.joinedTimestamp! / 1_000)}:F>` : "Not a member of this server.",
          member ? `Nickname: ${member.nickname ?? "None"}` : "",
          roles.length ? `Roles: ${roles.join(", ")}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
  },
  {
    name: "avatar",
    category: "General",
    description: "Show a user's avatar link.",
    slash: makeCommand("avatar", "Show a user's avatar link.", (builder) =>
      builder.addUserOption((option) => option.setName("user").setDescription("User whose avatar to show.")),
    ),
    async parsePrefix(args, context) {
      return { user: args[0] ? await resolvePrefixUser(context, args[0]) : context.user };
    },
    parseSlash(interaction) {
      return { user: parseSlashUser(interaction) ?? interaction.user };
    },
    async execute(context, args) {
      const user = args.user as User;
      const avatar = user.displayAvatarURL({ size: 1024, extension: "png" });
      await context.reply(`${user.tag}'s avatar: ${avatar}`);
    },
  },
  {
    name: "roleinfo",
    category: "General",
    description: "Show information and permissions for a role.",
    slash: makeCommand("roleinfo", "Show details about a role.", (builder) =>
      builder.addRoleOption((option) => option.setName("role").setDescription("Role to inspect.").setRequired(true)),
    ),
    async parsePrefix(args, context) {
      return { role: await resolvePrefixRole(context, requiredArg(args, 0, "a role")) };
    },
    async parseSlash(interaction) {
      const role = await parseSlashRole(interaction);
      if (!role) throw new CommandError("Choose a role to inspect.");
      return { role };
    },
    async execute(context, args) {
      const role = args.role as Role;
      const permissions = new PermissionsBitField(role.permissions).toArray();
      await context.reply(
        [
          `Role: ${role.name}`,
          `Role ID: ${role.id}`,
          `Color: ${role.hexColor}`,
          `Members: ${role.members.size}`,
          `Position: ${role.position}`,
          `Mentionable: ${role.mentionable ? "Yes" : "No"}`,
          `Created: <t:${Math.floor(role.createdTimestamp / 1_000)}:F>`,
          `Permissions: ${permissions.slice(0, 15).join(", ") || "None"}${permissions.length > 15 ? ` and ${permissions.length - 15} more` : ""}`,
        ].join("\n"),
      );
    },
  },
  {
    name: "channelinfo",
    category: "General",
    description: "Show information about a server channel.",
    slash: makeCommand("channelinfo", "Show details about a channel.", (builder) =>
      builder.addChannelOption((option) => option.setName("channel").setDescription("Channel to inspect.")),
    ),
    parsePrefix: (args, context) => {
      if (!args[0]) return { channel: context.channel };
      const { guild } = requireGuild(context);
      const id = args[0]!.match(/^<#(\d{17,20})>$/)?.[1] ?? args[0]!;
      const channel = guild.channels.cache.get(id);
      if (!channel) throw new CommandError("I could not find that channel.");
      return { channel };
    },
    async parseSlash(interaction: ChatInputCommandInteraction) {
      const selection = interaction.options.getChannel("channel");
      const channelId = selection?.id ?? interaction.channelId;
      const channel =
        (interaction.guild?.channels.cache.get(channelId) ??
          (interaction.guild ? await interaction.guild.channels.fetch(channelId).catch(() => null) : null)) ??
        null;
      return { channel };
    },
    async execute(context, args) {
      const channel = args.channel as import("discord.js").Channel | null;
      if (!channel) throw new CommandError("I could not find that channel.");
      await context.reply(
        [
          `Channel: ${"name" in channel ? `#${channel.name}` : channel.id}`,
          `Channel ID: ${channel.id}`,
          `Type: ${channel.type}`,
          `Created: ${channel.createdTimestamp ? `<t:${Math.floor(channel.createdTimestamp / 1_000)}:F>` : "Unavailable"}`,
        ].join("\n"),
      );
    },
  },
  {
    name: "invite",
    category: "Utility",
    description: "Create an invite link for this bot.",
    slash: makeCommand("invite", "Get an invite link for this bot."),
    parsePrefix: () => ({}),
    parseSlash: () => ({}),
    async execute(context) {
      const permissions = PermissionsBitField.resolve([
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.BanMembers,
        PermissionFlagsBits.KickMembers,
        PermissionFlagsBits.ModerateMembers,
        PermissionFlagsBits.ManageMessages,
        PermissionFlagsBits.ManageRoles,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageNicknames,
      ]);
      await context.reply(
        `Install link: https://discord.com/oauth2/authorize?client_id=${context.client.user!.id}&scope=bot%20applications.commands&permissions=${permissions.toString()}`,
      );
    },
  },
];