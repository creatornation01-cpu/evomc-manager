const emojiPattern =
  /[\p{Extended_Pictographic}\p{Regional_Indicator}\uFE0F\uFE0E\u200D\u20E3]/gu;

export function withoutEmoji(value: string): string {
  return value.replace(emojiPattern, "").replace(/[ \t]{2,}/g, " ").trim();
}

export function tokenize(input: string): string[] {
  const result: string[] = [];
  const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const match of input.matchAll(pattern)) {
    result.push(match[1] ?? match[2] ?? match[3] ?? "");
  }
  return result;
}

export function parseDuration(input: string): number | null {
  const match = /^(\d{1,5})(s|m|h|d|w)$/i.exec(input.trim());
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier =
    unit === "s"
      ? 1_000
      : unit === "m"
        ? 60_000
        : unit === "h"
          ? 3_600_000
          : unit === "d"
            ? 86_400_000
            : 604_800_000;
  return amount * multiplier;
}

export function formatDuration(durationMs: number): string {
  const seconds = Math.floor(durationMs / 1_000);
  const units: Array<[string, number]> = [
    ["d", 86_400],
    ["h", 3_600],
    ["m", 60],
    ["s", 1],
  ];
  let remaining = seconds;
  const parts: string[] = [];
  for (const [label, size] of units) {
    const amount = Math.floor(remaining / size);
    if (amount > 0) {
      parts.push(`${amount}${label}`);
      remaining %= size;
    }
  }
  return parts.join(" ") || "0s";
}

export function parseHexColor(input: string): number | null {
  const normalized = input.trim().replace(/^#/, "");
  if (!/^[\da-f]{6}$/i.test(normalized)) return null;
  return Number.parseInt(normalized, 16);
}

export function cleanReason(value: string): string {
  const cleaned = withoutEmoji(value).trim();
  return cleaned.slice(0, 500) || "No reason provided";
}

export function extractUserIds(input: string): string[] {
  return [...input.matchAll(/<@!?(\d{17,20})>|(?<!\d)(\d{17,20})(?!\d)/g)].map(
    (match) => match[1] ?? match[2]!,
  );
}

export function isSnowflake(value: string): boolean {
  return /^\d{17,20}$/.test(value);
}