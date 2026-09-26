import type {
  Channel,
  Client,
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  Message,
  Role,
  SlashCommandBuilder,
  SlashCommandOptionsOnlyBuilder,
  SlashCommandSubcommandsOnlyBuilder,
  User,
} from "discord.js";

export type CommandCategory = "General" | "Moderation" | "Roles" | "Minecraft Live Check" | "Utility";
export type CommandArgs = Record<string, unknown>;

export interface CommandContext {
  client: Client;
  guild: Guild | null;
  member: GuildMember | null;
  user: User;
  channel: Channel | null;
  message: Message | null;
  interaction: ChatInputCommandInteraction | null;
  commands: CommandDefinition[];
  reply(content: string): Promise<void>;
}

export interface CommandDefinition<TArgs extends CommandArgs = CommandArgs> {
  name: string;
  category: CommandCategory;
  description: string;
  slash: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder | SlashCommandSubcommandsOnlyBuilder;
  parsePrefix(args: string[], context: CommandContext): Promise<TArgs> | TArgs;
  parseSlash(interaction: ChatInputCommandInteraction): Promise<TArgs> | TArgs;
  execute(context: CommandContext, args: TArgs): Promise<void>;
}