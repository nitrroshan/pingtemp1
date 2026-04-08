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

const isDev = process.env.NODE_ENV !== "production";

export const rootLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: isDev
    ? {
        target: "pino-pretty",
        options: {
          colorize: true,
          translateTime: "SYS:HH:MM:ss.l",
          ignore: "pid,hostname",
        },
      }
    : undefined, // JSON in production
});

/** Convenience type for child loggers */
export type AppLogger = pino.Logger;
