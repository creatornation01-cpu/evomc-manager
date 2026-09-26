import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";
import { logger } from "../logger.js";

if (config.databasePath !== ":memory:") {
  fs.mkdirSync(path.dirname(config.databasePath), { recursive: true });
}

export const database = new Database(config.databasePath);
database.pragma("journal_mode = WAL");
database.pragma("foreign_keys = ON");
database.pragma("busy_timeout = 5000");
database.exec(`
  CREATE TABLE IF NOT EXISTS warnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    guild_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    reason TEXT NOT NULL,
    moderator_id TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS warnings_guild_user_created
    ON warnings (guild_id, user_id, created_at DESC);

  CREATE TABLE IF NOT EXISTS livecheck_config (
    guild_id TEXT PRIMARY KEY,
    channel_id TEXT NOT NULL,
    message_id TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  );
`);

logger.info("SQLite database initialized.");

export interface WarningRecord {
  id: number;
  guild_id: string;
  user_id: string;
  reason: string;
  moderator_id: string;
  created_at: number;
}

export interface LiveCheckRecord {
  guild_id: string;
  channel_id: string;
  message_id: string;
  updated_at: number;
}

export const warningStore = {
  add(guildId: string, userId: string, reason: string, moderatorId: string): number {
    const result = database
      .prepare(
        "INSERT INTO warnings (guild_id, user_id, reason, moderator_id, created_at) VALUES (?, ?, ?, ?, ?)",
      )
      .run(guildId, userId, reason, moderatorId, Date.now());
    return Number(result.lastInsertRowid);
  },
  list(guildId: string, userId: string): WarningRecord[] {
    return database
      .prepare(
        "SELECT id, guild_id, user_id, reason, moderator_id, created_at FROM warnings WHERE guild_id = ? AND user_id = ? ORDER BY created_at DESC",
      )
      .all(guildId, userId) as WarningRecord[];
  },
  remove(guildId: string, warningId: number, userId?: string): boolean {
    const result = userId
      ? database
          .prepare("DELETE FROM warnings WHERE guild_id = ? AND id = ? AND user_id = ?")
          .run(guildId, warningId, userId)
      : database.prepare("DELETE FROM warnings WHERE guild_id = ? AND id = ?").run(guildId, warningId);
    return result.changes > 0;
  },
  clear(guildId: string, userId: string): number {
    return database
      .prepare("DELETE FROM warnings WHERE guild_id = ? AND user_id = ?")
      .run(guildId, userId).changes;
  },
};

export const liveCheckStore = {
  get(guildId: string): LiveCheckRecord | undefined {
    return database
      .prepare("SELECT guild_id, channel_id, message_id, updated_at FROM livecheck_config WHERE guild_id = ?")
      .get(guildId) as LiveCheckRecord | undefined;
  },
  list(): LiveCheckRecord[] {
    return database
      .prepare("SELECT guild_id, channel_id, message_id, updated_at FROM livecheck_config")
      .all() as LiveCheckRecord[];
  },
  set(guildId: string, channelId: string, messageId: string): void {
    database
      .prepare(
        "INSERT INTO livecheck_config (guild_id, channel_id, message_id, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(guild_id) DO UPDATE SET channel_id = excluded.channel_id, message_id = excluded.message_id, updated_at = excluded.updated_at",
      )
      .run(guildId, channelId, messageId, Date.now());
  },
  remove(guildId: string): boolean {
    return (
      database.prepare("DELETE FROM livecheck_config WHERE guild_id = ?").run(guildId).changes > 0
    );
  },
};