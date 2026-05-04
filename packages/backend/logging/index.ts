/**
 * Shared logging module — single pino root logger + child factory.
 *
 * Usage:
 *   import { rootLogger } from "@ping/backend/logging";
 *   const logger = rootLogger.child({ module: "MyService" });
 *   logger.info("hello");
 *
 * In dev (NODE_ENV !== "production"):  pretty-printed via pino-pretty
 * In prod:                              JSON (structured, machine-readable)
 *
 * LOG_LEVEL env var controls minimum level (default: "info").
 */

import pino from "pino";
import path from "path";

const isDev = process.env.NODE_ENV !== "production";
const LOG_DIR = process.env.LOG_DIR || "./data/logs";

// Session-stamped log file — each server start gets its own file
const sessionTimestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
const startupLogFile = path.resolve(LOG_DIR, `startup-${sessionTimestamp}.log`);
// Also keep a "latest" symlink-style file for easy access
const latestLogFile = path.resolve(LOG_DIR, "startup.log");

export const rootLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  // Redact known secret patterns from log output
  redact: {
    paths: [
      "accessToken", "refreshToken", "authToken", "token",
      "password", "secret", "apiKey", "api_key",
      "*.accessToken", "*.refreshToken", "*.authToken", "*.token",
      "*.password", "*.secret", "*.apiKey", "*.api_key",
    ],
    censor: "[REDACTED]",
  },
  transport: {
    targets: [
      // Console — pretty in dev, JSON in prod
      isDev
        ? {
            target: "pino-pretty",
            options: {
              colorize: true,
              translateTime: "SYS:HH:MM:ss.l",
              ignore: "pid,hostname",
            },
            level: process.env.LOG_LEVEL || "info",
          }
        : {
            target: "pino/file",
            options: { destination: 1 }, // stdout
            level: process.env.LOG_LEVEL || "info",
          },
      // Session-stamped startup log — each server start gets its own file
      {
        target: "pino/file",
        options: {
          destination: startupLogFile,
          mkdir: true,
        },
        level: "info",
      },
      // Latest startup log — always overwritten for easy access
      {
        target: "pino/file",
        options: {
          destination: latestLogFile,
          mkdir: true,
        },
        level: "info",
      },
    ],
  },
});

/** Convenience type for child loggers */
export type AppLogger = pino.Logger;

/**
 * Create a per-goal session logger.
 * Writes debug-level JSON logs to data/logs/sessions/{goalId}.log
 * for post-mortem debugging. Each goal gets its own file.
 */
export function createSessionLogger(goalId: string): pino.Logger {
  const sessionFile = path.resolve(LOG_DIR, "sessions", `${goalId}.log`);
  const dest = pino.destination({ dest: sessionFile, mkdir: true, sync: false });
  return pino({ level: "debug" }, dest);
}
