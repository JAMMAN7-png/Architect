import pino from "pino";

/**
 * Pino logger with pretty-printing in TTY mode and JSON in pipes / CI.
 * Set ARCHITECT_LOG=debug|info|warn|error|silent to override level.
 * Set ARCHITECT_JSON=1 to force JSON output.
 */

const level = (process.env.ARCHITECT_LOG ?? "info").toLowerCase();
const forceJson = process.env.ARCHITECT_JSON === "1";
const isTty = process.stdout.isTTY && !forceJson;

export const logger = pino(
  isTty
    ? {
        level,
        transport: {
          target: "pino-pretty",
          options: {
            colorize: true,
            translateTime: "HH:MM:ss",
            ignore: "pid,hostname",
            singleLine: true,
          },
        },
      }
    : { level },
);

/** Short helper for child loggers. */
export function child(bindings: Record<string, unknown>): pino.Logger {
  return logger.child(bindings);
}
