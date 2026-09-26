import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildTextBasedChannel,
  type Message,
  type SlashCommandOptionsOnlyBuilder,
  type User,
} from "discord.js";
import { CommandError, requireGuild, requirePermission } from "../services/permissions.js";
import { isSnowflake } from "../services/text.js";
import type { CommandContext, CommandDefinition } from "./types.js";
import { parseSlashUser, requiredArg, resolvePrefixUser } from "./shared.js";

const BULK_DELETE_MAX_AGE_MS = 14 * 24 * 60 * 60 * 1_000;

function command(
  name: string,
  description: string,
  addOptions?: (builder: SlashCommandBuilder) => SlashCommandBuilder | SlashCommandOptionsOnlyBuilder,
): SlashCommandBuilder | SlashCommandOptionsOnlyBuilder {
  const builder = new SlashCommandBuilder().setName(name).setDescription(description);
  return addOptions ? addOptions(builder) : builder;
}

function currentGuildTextChannel(context: CommandContext): GuildTextBasedChannel {
  const channel = context.channel;
  if (
    !channel?.isTextBased() ||
    !("bulkDelete" in channel) ||
    !("messages" in channel) ||
    !("permissionsFor" in channel)
  ) {
    throw new CommandError("Use this command in a server text channel.");
  }
  if (!("guildId" in channel) || channel.guildId !== context.guild?.id) {
    throw new CommandError("This command can only be used in a server text channel.");
  }
  return channel as GuildTextBasedChannel;
}

function parseLimit(raw: string | undefined, fallback = 100): number {
  if (raw === undefined) return fallback;
  const amount = Number(raw);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
    throw new CommandError("Message count must be an integer from 1 to 100.");
  }
  return amount;
}

async function ensureChannelManageMessages(context: CommandContext, channel: GuildTextBasedChannel) {
  await requirePermission(context, PermissionFlagsBits.ManageMessages);
  const { guild, member } = requireGuild(context);
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  if (!channel.permissionsFor(member)?.has(PermissionFlagsBits.ManageMessages)) {
    throw new CommandError("You need Manage Messages in this channel.");
  }
  if (!channel.permissionsFor(botMember)?.has(PermissionFlagsBits.ManageMessages)) {
    throw new CommandError("I need Manage Messages in this channel.");
  }
}

async function deleteMessages(
  context: CommandContext,
  messages: Message[],
  channel: GuildTextBasedChannel,
): Promise<{ deleted: number; tooOld: number }> {
  await ensureChannelManageMessages(context, channel);
  const cutoff = Date.now() - BULK_DELETE_MAX_AGE_MS + 1_000;
  const eligible = messages.filter((message) => message.createdTimestamp > cutoff);
  const tooOld = messages.length - eligible.length;
  if (eligible.length === 0) return { deleted: 0, tooOld };

  try {
    const deleted = await channel.bulkDelete(eligible, true);
    return { deleted: deleted.size, tooOld: tooOld + (eligible.length - deleted.size) };
  } catch (error) {
    if (error instanceof Error && "code" in error && Number(error.code) === 50034) {
      throw new CommandError("Discord rejected the bulk delete because at least one message is older than 14 days. No old messages were deleted.");
    }
    throw error;
  }
}

function deleteSummary(deleted: number, tooOld: number): string {
  return `Deleted ${deleted} message${deleted === 1 ? "" : "s"}.${tooOld ? ` Skipped ${tooOld} message${tooOld === 1 ? "" : "s"} older than Discord's 14-day bulk-delete limit.` : ""}`;
}

function amountOption(builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder, required = true) {
  return builder.addIntegerOption((option) =>
    option
      .setName("amount")
      .setDescription("Number of recent messages to scan.")
      .setRequired(required)
      .setMinValue(1)
      .setMaxValue(100),
  );
}

export const purgeCommands: CommandDefinition[] = [
  {
    name: "purge",
    category: "Moderation",
    description: "Delete 1 to 100 recent messages.",
    slash: amountOption(command("purge", "Delete recent messages.")),
    parsePrefix(args) {
      return { amount: parseLimit(requiredArg(args, 0, "a message count")) };
    },
    parseSlash(interaction) {
      return { amount: interaction.options.getInteger("amount", true) };
    },
    async execute(context, args) {
      const channel = currentGuildTextChannel(context);
      const amount = Number(args.amount);
      if (!Number.isInteger(amount) || amount < 1 || amount > 100) {
        throw new CommandError("Message count must be an integer from 1 to 100.");
      }
      const recent = await channel.messages.fetch({ limit: amount });
      const result = await deleteMessages(context, [...recent.values()], channel);
      await context.reply(deleteSummary(result.deleted, result.tooOld));
    },
  },
  {
    name: "purgebots",
    category: "Moderation",
    description: "Delete recent messages from bots.",
    slash: amountOption(command("purgebots", "Delete recent messages from bots."), false),
    parsePrefix(args) {
      return { amount: parseLimit(args[0]) };
    },
    parseSlash(interaction) {
      return { amount: interaction.options.getInteger("amount") ?? 100 };
    },
    async execute(context, args) {
      const channel = currentGuildTextChannel(context);
      const recent = await channel.messages.fetch({ limit: Number(args.amount) });
      const selected = [...recent.values()].filter((message) => message.author.bot);
      const result = await deleteMessages(context, selected, channel);
      await context.reply(deleteSummary(result.deleted, result.tooOld));
    },
  },
  {
    name: "purgeuser",
    category: "Moderation",
    description: "Delete recent messages from one user.",
    slash: command("purgeuser", "Delete recent messages from a user.", (builder) =>
      builder
        .addUserOption((option) => option.setName("user").setDescription("User whose messages to delete.").setRequired(true))
        .addIntegerOption((option) =>
          option.setName("amount").setDescription("Number of recent messages to scan.").setMinValue(1).setMaxValue(100),
        ),
    ),
    async parsePrefix(args, context) {
      return {
        user: await resolvePrefixUser(context, requiredArg(args, 0, "a user")),
        amount: parseLimit(args[1]),
      };
    },
    parseSlash(interaction) {
      const user = parseSlashUser(interaction);
      if (!user) throw new CommandError("Choose a user.");
      return { user, amount: interaction.options.getInteger("amount") ?? 100 };
    },
    async execute(context, args) {
      const channel = currentGuildTextChannel(context);
      const user = args.user as User;
      const recent = await channel.messages.fetch({ limit: Number(args.amount) });
      const selected = [...recent.values()].filter((message) => message.author.id === user.id);
      const result = await deleteMessages(context, selected, channel);
      await context.reply(deleteSummary(result.deleted, result.tooOld));
    },
  },
  {
    name: "purgeafter",
    category: "Moderation",
    description: "Delete up to 100 recent messages after a message ID.",
    slash: command("purgeafter", "Delete recent messages after a message ID.", (builder) =>
      builder.addStringOption((option) =>
        option.setName("message_id").setDescription("ID of the message to start after.").setRequired(true).setMinLength(17).setMaxLength(20),
      ),
    ),
    parsePrefix(args) {
      const messageId = requiredArg(args, 0, "a message ID");
      if (!isSnowflake(messageId)) throw new CommandError("Provide a valid Discord message ID.");
      return { messageId };
    },
    parseSlash(interaction: ChatInputCommandInteraction) {
      return { messageId: interaction.options.getString("message_id", true) };
    },
    async execute(context, args) {
      const channel = currentGuildTextChannel(context);
      const messageId = String(args.messageId);
      if (!isSnowflake(messageId)) throw new CommandError("Provide a valid Discord message ID.");
      const after = await channel.messages.fetch(messageId).catch(() => null);
      if (!after) throw new CommandError("That message ID does not exist in this channel.");
      const recent = await channel.messages.fetch({ after: messageId, limit: 100 });
      const result = await deleteMessages(context, [...recent.values()], channel);
      await context.reply(deleteSummary(result.deleted, result.tooOld));
    },
  },
];