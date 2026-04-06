/**
 * Development configuration overrides.
 * Applied when NODE_ENV=development (default).
 */
import type { AppConfig } from "./default.js";

export const developmentConfig: Partial<AppConfig> = {
  logLevel: "debug",
  seedEnabled: false,
};
