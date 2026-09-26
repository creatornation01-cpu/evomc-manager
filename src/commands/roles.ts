import {
  PermissionFlagsBits,
  SlashCommandBuilder,
  type Role,
  type SlashCommandOptionsOnlyBuilder,
} from "discord.js";
import { CommandError, assertManageableRole, requireGuild, requirePermission } from "../services/permissions.js";
import { parseHexColor } from "../services/text.js";
import type { CommandContext, CommandDefinition } from "./types.js";
import { parseSlashRole, requiredArg, resolvePrefixRole } from "./shared.js";

const PRESETS = {
  HERO: ["#38BDF8", "#93C5FD"],
  CHAMPION: ["#FFF176", "#FFC107"],
  ELITE: ["#BBF7D0", "#4ADE80"],
  MASTER: ["#5433FF", "#20BDFF"],
  SUPREME: ["#8B0000", "#FF304F"],
} as const;

type PresetName = keyof typeof PRESETS;

function roleOption(builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder) {
  return builder.addRoleOption((option) =>
    option.setName("role").setDescription("Role to change.").setRequired(true),
  );
}

function colorOption(
  builder: SlashCommandBuilder | SlashCommandOptionsOnlyBuilder,
  name: string,
  description: string,
) {
  return builder.addStringOption((option) => option.setName(name).setDescription(description).setMaxLength(7));
}

function normalizePreset(value: string): PresetName | null {
  const normalized = value.toUpperCase() as PresetName;
  return normalized in PRESETS ? normalized : null;
}

function colorsFromArguments(
  color1Input: string | undefined,
  color2Input: string | undefined,
  presetInput: string | undefined,
): { color1: string; color2: string } {
  if (presetInput) {
    const preset = normalizePreset(presetInput);
    if (!preset) throw new CommandError("Unknown preset. Choose HERO, CHAMPION, ELITE, MASTER, or SUPREME.");
    return { color1: PRESETS[preset][0], color2: PRESETS[preset][1] };
  }
  if (!color1Input || !color2Input) {
    throw new CommandError("Provide two HEX colors or one preset name, for example #38BDF8 #93C5FD or HERO.");
  }
  if (parseHexColor(color1Input) === null || parseHexColor(color2Input) === null) {
    throw new CommandError("Colors must be six-digit HEX values such as #38BDF8.");
  }
  return { color1: `#${color1Input.replace(/^#/, "")}`, color2: `#${color2Input.replace(/^#/, "")}` };
}

async function setGradientColors(
  context: CommandContext,
  role: Role,
  color1: string,
  color2: string,
  solid: boolean,
): Promise<void> {
  await requirePermission(context, PermissionFlagsBits.ManageRoles);
  const { guild } = requireGuild(context);
  await assertManageableRole(context, role);

  const roleWithColors = role as Role & {
    setColors?: (colors: {
      primaryColor: number;
      secondaryColor: number | null;
      tertiaryColor: number | null;
    }) => Promise<Role>;
  };
  if (typeof roleWithColors.setColors !== "function") {
    throw new CommandError(
      "Gradient role colors are not supported by this Discord library version. No role settings were changed.",
    );
  }

  const primaryColor = parseHexColor(color1);
  const secondaryColor = parseHexColor(color2);
  if (primaryColor === null || (!solid && secondaryColor === null)) {
    throw new CommandError("Colors must be valid six-digit HEX values.");
  }
  try {
    await roleWithColors.setColors({
      primaryColor,
      secondaryColor: solid ? null : secondaryColor,
      tertiaryColor: null,
    });
  } catch (error) {
    const apiError = error as { code?: string | number; status?: number; message?: string };
    const detail = apiError.message?.slice(0, 400) ?? "Discord returned no error details.";
    throw new CommandError(
      `Discord rejected the ${solid ? "solid" : "gradient"} role color change. The role was not reported as changed. API code: ${apiError.code ?? "unknown"}; HTTP status: ${apiError.status ?? "unknown"}; response: ${detail}`,
    );
  }
}

function readRoleColors(role: Role): { primary: string; secondary: string | null; tertiary: string | null } | null {
  const roleWithColors = role as Role & {
    colors?: { primaryColor?: number; secondaryColor?: number | null; tertiaryColor?: number | null };
  };
  if (!roleWithColors.colors) return null;
  const format = (value: number | null | undefined) =>
    typeof value === "number" ? `#${value.toString(16).padStart(6, "0").toUpperCase()}` : null;
  const primary = format(roleWithColors.colors.primaryColor);
  if (!primary) return null;
  return {
    primary,
    secondary: format(roleWithColors.colors.secondaryColor),
    tertiary: format(roleWithColors.colors.tertiaryColor),
  };
}

export const roleCommands: CommandDefinition[] = [
  {
    name: "gradientrole",
    category: "Roles",
    description: "Set a role to a Discord gradient color style.",
    slash: colorOption(
      colorOption(
        roleOption(
          new SlashCommandBuilder()
            .setName("gradientrole")
            .setDescription("Apply Discord's native gradient colors to a role."),
        ),
        "color1",
        "First HEX color, such as #38BDF8.",
      ),
      "color2",
      "Second HEX color, such as #93C5FD.",
    ).addStringOption((option) =>
      option
        .setName("preset")
        .setDescription("Optional predefined two-color gradient.")
        .addChoices(
          { name: "HERO", value: "HERO" },
          { name: "CHAMPION", value: "CHAMPION" },
          { name: "ELITE", value: "ELITE" },
          { name: "MASTER", value: "MASTER" },
          { name: "SUPREME", value: "SUPREME" },
        ),
    ),
    async parsePrefix(args, context) {
      const role = await resolvePrefixRole(context, requiredArg(args, 0, "a role"));
      if (args.length === 2 && normalizePreset(args[1]!)) {
        return { role, preset: args[1] };
      }
      return { role, color1: args[1], color2: args[2] };
    },
    async parseSlash(interaction) {
      const role = await parseSlashRole(interaction);
      if (!role) throw new CommandError("Choose a role.");
      return {
        role,
        color1: interaction.options.getString("color1") ?? undefined,
        color2: interaction.options.getString("color2") ?? undefined,
        preset: interaction.options.getString("preset") ?? undefined,
      };
    },
    async execute(context, args) {
      const role = args.role as Role;
      const colors = colorsFromArguments(
        typeof args.color1 === "string" ? args.color1 : undefined,
        typeof args.color2 === "string" ? args.color2 : undefined,
        typeof args.preset === "string" ? args.preset : undefined,
      );
      await setGradientColors(context, role, colors.color1, colors.color2, false);
      await context.reply(
        `Set ${role.name} to Discord gradient colors ${colors.color1} and ${colors.color2}.`,
      );
    },
  },
  {
    name: "solidrole",
    category: "Roles",
    description: "Set a role to a Discord solid color style.",
    slash: colorOption(
      roleOption(
        new SlashCommandBuilder()
          .setName("solidrole")
          .setDescription("Apply a native solid color to a role."),
      ),
      "color",
      "Solid HEX color, such as #38BDF8.",
    ),
    async parsePrefix(args, context) {
      const role = await resolvePrefixRole(context, requiredArg(args, 0, "a role"));
      return { role, color: requiredArg(args, 1, "a HEX color") };
    },
    async parseSlash(interaction) {
      const role = await parseSlashRole(interaction);
      if (!role) throw new CommandError("Choose a role.");
      return { role, color: interaction.options.getString("color", true) };
    },
    async execute(context, args) {
      const role = args.role as Role;
      const color = String(args.color);
      if (parseHexColor(color) === null) {
        throw new CommandError("Color must be a six-digit HEX value such as #38BDF8.");
      }
      await setGradientColors(context, role, color, color, true);
      await context.reply(`Set ${role.name} to the solid color ${color}.`);
    },
  },
  {
    name: "gradientinfo",
    category: "Roles",
    description: "Show a role's Discord color style and colors.",
    slash: roleOption(
      new SlashCommandBuilder()
        .setName("gradientinfo")
        .setDescription("Show a role's native color style and values."),
    ),
    async parsePrefix(args, context) {
      return { role: await resolvePrefixRole(context, requiredArg(args, 0, "a role")) };
    },
    async parseSlash(interaction) {
      const role = await parseSlashRole(interaction);
      if (!role) throw new CommandError("Choose a role.");
      return { role };
    },
    async execute(context, args) {
      const role = args.role as Role;
      const colors = readRoleColors(role);
      if (!colors) {
        await context.reply(
          `${role.name} is using a solid role color (${role.hexColor}). Discord did not provide gradient color data for this role.`,
        );
        return;
      }
      const style = colors.secondary || colors.tertiary ? "Gradient" : "Solid";
      await context.reply(
        [
          `Role: ${role.name}`,
          `Color style: ${style}`,
          `Primary: ${colors.primary}`,
          `Secondary: ${colors.secondary ?? "None"}`,
          `Tertiary: ${colors.tertiary ?? "None"}`,
        ].join("\n"),
      );
    },
  },
];

export const roleColorPresets = PRESETS;