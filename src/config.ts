import "dotenv/config";
import path from "node:path";

function positiveInteger(value: string | undefined, fallback: number, label: string): number {
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
    throw new Error(`${label} must be an integer between 1 and 65535.`);
  }
  return parsed;
}

const token = process.env.DISCORD_TOKEN?.trim();
const clientId = process.env.CLIENT_ID?.trim();
if (!token) throw new Error("DISCORD_TOKEN is required. Copy .env.example to .env and configure it.");
if (!clientId || !/^\d{17,20}$/.test(clientId)) {
  throw new Error("CLIENT_ID is required and must be the Discord application ID.");
}

const databasePath = process.env.DATABASE_PATH?.trim() || "./data/bot.db";

export const config = {
  token,
  clientId,
  prefix: process.env.PREFIX?.trim() || ".",
  minecraftHost: process.env.MC_SERVER_HOST?.trim() || "",
  minecraftPort: positiveInteger(process.env.MC_SERVER_PORT, 25565, "MC_SERVER_PORT"),
  databasePath: databasePath === ":memory:" ? databasePath : path.resolve(databasePath),
  httpPort: positiveInteger(process.env.PORT, 3000, "PORT"),
} as const;

if (!config.prefix || config.prefix.length > 5) {
  throw new Error("PREFIX must contain between 1 and 5 characters.");
}