import {
  ChannelType,
  PermissionFlagsBits,
  type Client,
  type Guild,
  type GuildTextBasedChannel,
  type TextBasedChannel,
} from "discord.js";
import { status } from "minecraft-server-util";
import { config } from "../config.js";
import { liveCheckStore, type LiveCheckRecord } from "../database/database.js";
import { logger } from "../logger.js";
import { withoutEmoji } from "./text.js";

const INTERVAL_MS = 30_000;
const activeGuildChecks = new Set<string>();
let interval: NodeJS.Timeout | undefined;

function isGuildTextChannel(channel: TextBasedChannel): channel is GuildTextBasedChannel {
  return "messages" in channel && "send" in channel;
}

async function fetchConfiguredChannel(
  client: Client,
  guildId: string,
  channelId: string,
): Promise<GuildTextBasedChannel | null> {
  const guild = client.guilds.cache.get(guildId) ?? (await client.guilds.fetch(guildId).catch(() => null));
  if (!guild) return null;
  const channel = guild.channels.cache.get(channelId) ?? (await guild.channels.fetch(channelId).catch(() => null));
  if (!channel?.isTextBased() || !isGuildTextChannel(channel)) return null;
  return channel;
}

function describeError(error: unknown): string {
  if (error instanceof Error && error.message) return withoutEmoji(error.message).slice(0, 240);
  return "The Minecraft status request failed.";
}

export async function readMinecraftStatus(): Promise<string> {
  if (!config.minecraftHost) {
    throw new Error("MC_SERVER_HOST is not configured.");
  }
  const result = await status(config.minecraftHost, config.minecraftPort, { timeout: 5_000 });
  const online = result.players.online;
  const maximum = result.players.max;
  const version = result.version?.name?.trim();
  const description: string[] = [
    "Server Status: Online",
    `Players: ${online}/${maximum}`,
  ];
  if (version) description.push(`Version: ${withoutEmoji(version)}`);

  const motd = result.motd?.clean;
  const cleanMotd = Array.isArray(motd) ? motd.join(" ") : motd;
  if (typeof cleanMotd === "string" && cleanMotd.trim()) {
    description.push(`MOTD: ${withoutEmoji(cleanMotd.replace(/\s+/g, " ")).slice(0, 300)}`);
  }
  return description.join("\n");
}

async function statusText(): Promise<string> {
  try {
    return await readMinecraftStatus();
  } catch (error) {
    if (!config.minecraftHost) {
      return "Server Status: Unavailable\nMC_SERVER_HOST is not configured.";
    }
    logger.warn("Minecraft status request failed.", { error: describeError(error) });
    return "Server Status: Offline";
  }
}

export async function updateConfiguredMessage(
  client: Client,
  record: LiveCheckRecord,
): Promise<boolean> {
  if (activeGuildChecks.has(record.guild_id)) return false;
  activeGuildChecks.add(record.guild_id);
  try {
    const channel = await fetchConfiguredChannel(client, record.guild_id, record.channel_id);
    if (!channel) {
      logger.warn("Live-check channel is unavailable.", { guildId: record.guild_id, channelId: record.channel_id });
      return false;
    }
    const message = await channel.messages.fetch(record.message_id).catch(() => null);
    if (!message) {
      logger.warn("Live-check message is unavailable.", { guildId: record.guild_id, messageId: record.message_id });
      return false;
    }
    await message.edit({
      content: await statusText(),
      allowedMentions: { parse: [] },
    });
    return true;
  } catch (error) {
    logger.warn("Could not update the configured Minecraft status message.", {
      guildId: record.guild_id,
      error: describeError(error),
    });
    return false;
  } finally {
    activeGuildChecks.delete(record.guild_id);
  }
}

export async function configureLiveCheckMessage(
  client: Client,
  guild: Guild,
  channel: GuildTextBasedChannel,
): Promise<{ messageId: string; updated: boolean }> {
  const botMember = guild.members.me ?? (await guild.members.fetchMe());
  const permissions = channel.permissionsFor(botMember);
  if (!permissions?.has([PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory])) {
    throw new Error("I need View Channel, Send Messages, and Read Message History in the selected channel.");
  }

  const previous = liveCheckStore.get(guild.id);
  if (previous) {
    if (previous.channel_id === channel.id) {
      const oldMessage = await channel.messages.fetch(previous.message_id).catch(() => null);
      if (oldMessage) {
        const content = await statusText();
        await oldMessage.edit({ content, allowedMentions: { parse: [] } });
        liveCheckStore.set(guild.id, channel.id, oldMessage.id);
        return { messageId: oldMessage.id, updated: true };
      }
    }

    const oldChannel = await fetchConfiguredChannel(client, guild.id, previous.channel_id);
    const oldMessage = oldChannel
      ? await oldChannel.messages.fetch(previous.message_id).catch(() => null)
      : null;
    if (oldMessage) {
      try {
        await oldMessage.delete();
      } catch (error) {
        throw new Error(
          `The existing status message could not be removed, so the channel was not changed. Discord said: ${describeError(error)}`,
        );
      }
    }
  }

  const message = await channel.send({
    content: await statusText(),
    allowedMentions: { parse: [] },
  });
  liveCheckStore.set(guild.id, channel.id, message.id);
  return { messageId: message.id, updated: false };
}

export async function disableLiveCheck(client: Client, guildId: string): Promise<boolean> {
  const existing = liveCheckStore.get(guildId);
  if (!existing) return false;
  const channel = await fetchConfiguredChannel(client, guildId, existing.channel_id);
  const message = channel
    ? await channel.messages.fetch(existing.message_id).catch(() => null)
    : null;
  if (message) {
    try {
      await message.delete();
    } catch (error) {
      throw new Error(`The status message could not be deleted. Discord said: ${describeError(error)}`);
    }
  }
  liveCheckStore.remove(guildId);
  return true;
}

export function isSupportedLiveCheckChannel(channel: TextBasedChannel): channel is GuildTextBasedChannel {
  return isGuildTextChannel(channel);
}

export async function refreshGuildLiveCheck(client: Client, guildId: string): Promise<boolean> {
  const record = liveCheckStore.get(guildId);
  if (!record) return false;
  return updateConfiguredMessage(client, record);
}

export function startLiveCheckService(client: Client): void {
  if (interval) return;
  interval = setInterval(() => {
    for (const record of liveCheckStore.list()) {
      void updateConfiguredMessage(client, record);
    }
  }, INTERVAL_MS);
  interval.unref();
  for (const record of liveCheckStore.list()) {
    void updateConfiguredMessage(client, record);
  }
  logger.info("Minecraft live-check service started.", {
    intervalSeconds: INTERVAL_MS / 1_000,
    configuredGuilds: liveCheckStore.list().length,
  });
}

export function stopLiveCheckService(): void {
  if (!interval) return;
  clearInterval(interval);
  interval = undefined;
}