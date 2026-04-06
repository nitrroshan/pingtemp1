/**
 * Production configuration overrides.
 * Applied when NODE_ENV=production.
 */
import type { AppConfig } from "./default.js";

export const productionConfig: Partial<AppConfig> = {
  logLevel: "info",
  seedEnabled: false,
};
