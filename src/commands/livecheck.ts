import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type SlashCommandSubcommandsOnlyBuilder,
  type GuildTextBasedChannel,
} from "discord.js";
import { liveCheckStore } from "../database/database.js";
import { config } from "../config.js";
import {
  configureLiveCheckMessage,
  disableLiveCheck,
  isSupportedLiveCheckChannel,
  refreshGuildLiveCheck,
} from "../services/live-check.js";
import { CommandError, requireGuild, requirePermission } from "../services/permissions.js";
import type { CommandContext, CommandDefinition } from "./types.js";
import { parseSlashChannel, requiredArg, resolvePrefixTextChannel } from "./shared.js";

type Action = "setup" | "status" | "channel" | "disable" | "force" | "help";

function liveCommand(): SlashCommandSubcommandsOnlyBuilder {
  return new SlashCommandBuilder()
    .setName("livecheck")
    .setDescription("Configure and refresh Minecraft server status.")
    .addSubcommand((subcommand) =>
      subcommand
        .setName("setup")
        .setDescription("Create or update the single Minecraft status message.")
        .addChannelOption((option) => option.setName("channel").setDescription("Channel for the status message.")),
    )
    .addSubcommand((subcommand) => subcommand.setName("status").setDescription("Show the current status configuration."))
    .addSubcommand((subcommand) =>
      subcommand
        .setName("channel")
        .setDescription("Show or change the one configured status channel.")
        .addChannelOption((option) => option.setName("channel").setDescription("New status channel.")),
    )
    .addSubcommand((subcommand) => subcommand.setName("disable").setDescription("Disable the status message."))
    .addSubcommand((subcommand) => subcommand.setName("force").setDescription("Refresh the existing status message now."))
    .addSubcommand((subcommand) => subcommand.setName("help").setDescription("Show live-check command usage."));
}

function parseAction(value: string | undefined): Action {
  if (value === "setup" || value === "status" || value === "channel" || value === "disable" || value === "force" || value === "help") {
    return value;
  }
  throw new CommandError("Use .livecheck setup, status, channel, disable, force, or help.");
}

function asTextChannel(value: unknown): GuildTextBasedChannel | null {
  if (!value || typeof value !== "object" || !("isTextBased" in value)) return null;
  const channel = value as import("discord.js").Channel;
  return channel.isTextBased() && "messages" in channel && "send" in channel
    ? (channel as GuildTextBasedChannel)
    : null;
}

async function requireLiveChannel(context: CommandContext, channel: GuildTextBasedChannel) {
  const { guild } = requireGuild(context);
  if (channel.guildId !== guild.id || !isSupportedLiveCheckChannel(channel)) {
    throw new CommandError("Choose a server text channel in this server.");
  }
}

export const liveCheckCommands: CommandDefinition[] = [
  {
    name: "livecheck",
    category: "Minecraft Live Check",
    description: "Check or configure Minecraft server status updates.",
    slash: liveCommand(),
    async parsePrefix(args, context) {
      const action = parseAction(args[0]?.toLowerCase());
      if ((action === "setup" || action === "channel") && args[1]) {
        return { action, channel: await resolvePrefixTextChannel(context, args[1]) };
      }
      if (args.length > 1 && action !== "help" && action !== "status" && action !== "force" && action !== "disable") {
        throw new CommandError("Provide at most one channel mention.");
      }
      return { action, channel: null };
    },
    async parseSlash(interaction) {
      const action = parseAction(interaction.options.getSubcommand());
      const channel = action === "setup" || action === "channel" ? await parseSlashChannel(interaction) : null;
      return { action, channel };
    },
    async execute(context, args) {
      const { guild } = requireGuild(context);
      const action = args.action as Action;

      if (action === "help") {
        await context.reply(
          [
            "Minecraft Live Check",
            ".livecheck setup [#channel] — create the status message (defaults to this channel)",
            ".livecheck status — show the configured channel and message",
            ".livecheck channel [#channel] — show or move the status message",
            ".livecheck disable — remove the status message and stop updates",
            ".livecheck force — update the existing message now",
            ".livecheck help — show this help",
            "Slash commands are available as /livecheck setup, status, channel, disable, force, and help.",
          ].join("\n"),
        );
        return;
      }

      if (action === "status") {
        const record = liveCheckStore.get(guild.id);
        if (!record) {
          await context.reply("Minecraft live check is not configured in this server.");
          return;
        }
        await context.reply(
          [
            "Minecraft live check is enabled.",
            `Channel: <#${record.channel_id}>`,
            `Status message ID: ${record.message_id}`,
            `Minecraft target: ${config.minecraftHost ? `${config.minecraftHost}:${config.minecraftPort}` : "MC_SERVER_HOST is not configured"}`,
            "The existing message is refreshed every 30 seconds.",
          ].join("\n"),
        );
        return;
      }

      if (action === "force") {
        const record = liveCheckStore.get(guild.id);
        if (!record) throw new CommandError("Minecraft live check is not configured. Run .livecheck setup first.");
        const updated = await refreshGuildLiveCheck(context.client, guild.id);
        if (!updated) throw new CommandError("The configured status message could not be updated. Check its channel and bot permissions.");
        await context.reply("The existing Minecraft status message was refreshed.");
        return;
      }

      if (action === "disable") {
        await requirePermission(context, PermissionFlagsBits.ManageChannels);
        const removed = await disableLiveCheck(context.client, guild.id);
        if (!removed) {
          await context.reply("Minecraft live check is already disabled.");
          return;
        }
        await context.reply("Minecraft live check is disabled and its status message was removed.");
        return;
      }

      if (action === "channel" && !args.channel) {
        const record = liveCheckStore.get(guild.id);
        await context.reply(
          record ? `Configured status channel: <#${record.channel_id}>.` : "Minecraft live check is not configured.",
        );
        return;
      }

      await requirePermission(context, PermissionFlagsBits.ManageChannels);
      const channel =
        asTextChannel(args.channel) ??
        asTextChannel(context.channel);
      if (!channel) {
        throw new CommandError("Use this command in a server text channel or provide a text channel.");
      }
      await requireLiveChannel(context, channel);
      try {
        const result = await configureLiveCheckMessage(context.client, guild, channel);
        await context.reply(
          `${result.updated ? "Updated the existing" : "Created the single"} Minecraft status message in <#${channel.id}>. It will refresh every 30 seconds.`,
        );
      } catch (error) {
        if (error instanceof CommandError) throw error;
        throw new CommandError(error instanceof Error ? error.message : "Could not configure the Minecraft status message.");
      }
    },
  },
];
