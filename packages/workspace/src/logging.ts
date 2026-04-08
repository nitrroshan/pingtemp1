import pino from "pino";

const isDev = process.env.NODE_ENV !== "production";

export const rootLogger = pino({
  level: process.env.LOG_LEVEL || "info",
  transport: isDev
    ? { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:HH:MM:ss.l", ignore: "pid,hostname" } }
    : undefined,
});
