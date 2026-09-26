type LogLevel = "INFO" | "WARN" | "ERROR";

function write(level: LogLevel, message: string, details?: unknown): void {
  const suffix =
    details instanceof Error
      ? ` ${details.stack ?? details.message}`
      : details === undefined
        ? ""
        : ` ${JSON.stringify(details)}`;
  const line = `${new Date().toISOString()} ${level} ${message}${suffix}\n`;
  if (level === "ERROR") process.stderr.write(line);
  else process.stdout.write(line);
}

export const logger = {
  info: (message: string, details?: unknown) => write("INFO", message, details),
  warn: (message: string, details?: unknown) => write("WARN", message, details),
  error: (message: string, details?: unknown) => write("ERROR", message, details),
};