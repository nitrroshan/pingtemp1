/**
 * Environment configuration system.
 *
 * Merges: default → environment-specific → process.env overrides.
 * Returns a frozen singleton via getConfig().
 */

import defaultConfig from "./default.js";
import developmentConfig from "./development.js";
import productionConfig from "./production.js";
import type { FeatureFlags } from "./featureFlags.js";
import { FF_ENV_MAP } from "./featureFlags.js";

export type { FeatureFlags } from "./featureFlags.js";

// ── Types ────────────────────────────────────────────────────

export interface AppConfig {
  port: number;
  nodeEnv: string;

  mongodbUri: string;

  azureOpenAi: {
    apiKey: string;
    endpointUrl: string;
    instanceName: string;
    deployment: string;
  };

  anthropicApiKey: string | undefined;
  openaiApiKey: string | undefined;

  useOrchestrator: boolean;
  useApiV2: boolean;

  featureFlags: FeatureFlags;

  workspaceBaseDir: string;
  collabPort: number;
  collabMode: "embedded" | "external";
  collabUrl: string;
  storageType: "fs" | "azure" | "s3";
  agentsDir: string | undefined;
}

/** Utility: all fields optional, recursively. */
export type DeepPartial<T> = {
  [P in keyof T]?: T[P] extends object ? DeepPartial<T[P]> : T[P];
};

// ── Merge helper ─────────────────────────────────────────────

function deepMerge(
  base: Record<string, unknown>,
  override: Record<string, unknown>,
): Record<string, unknown> {
  const result = { ...base };
  for (const key of Object.keys(override)) {
    const val = override[key];
    if (
      val !== undefined &&
      typeof val === "object" &&
      val !== null &&
      !Array.isArray(val)
    ) {
      result[key] = deepMerge(
        (result[key] ?? {}) as Record<string, unknown>,
        val as Record<string, unknown>,
      );
    } else if (val !== undefined) {
      result[key] = val;
    }
  }
  return result;
}

// ── Build config ─────────────────────────────────────────────

function buildConfig(): AppConfig {
  const env = process.env.NODE_ENV || "development";

  // 1. Start with defaults
  const envOverrides: DeepPartial<AppConfig> =
    env === "production" ? productionConfig : developmentConfig;

  // 2. Merge environment-specific overrides
  const merged = deepMerge(
    defaultConfig as unknown as Record<string, unknown>,
    envOverrides as unknown as Record<string, unknown>,
  ) as unknown as AppConfig;

  let config: AppConfig = { ...merged };

  // 3. Apply process.env overrides (highest priority)
  config.port = parseInt(process.env.API_PORT || String(config.port), 10);
  config.nodeEnv = process.env.NODE_ENV || config.nodeEnv;
  config.mongodbUri = process.env.MONGODB_URI || config.mongodbUri;

  config.azureOpenAi = {
    apiKey: process.env.AZURE_OPENAI_API_KEY || config.azureOpenAi.apiKey,
    endpointUrl:
      process.env.AZURE_OPENAI_ENDPOINT_URL ||
      config.azureOpenAi.endpointUrl,
    instanceName:
      process.env.AZURE_OPENAI_INSTANCE_NAME ||
      config.azureOpenAi.instanceName,
    deployment:
      process.env.AZURE_OPENAI_DEPLOYMENT ||
      process.env.AZURE_OPENAI_API_DEPLOYMENT_NAME ||
      config.azureOpenAi.deployment,
  };

  config.anthropicApiKey = process.env.ANTHROPIC_API_KEY || config.anthropicApiKey;
  config.openaiApiKey = process.env.OPENAI_API_KEY || config.openaiApiKey;

  config.useOrchestrator =
    process.env.USE_ORCHESTRATOR !== "false" && config.useOrchestrator;
  config.useApiV2 =
    process.env.USE_API_V2 !== "false" && config.useApiV2;

  config.workspaceBaseDir =
    process.env.WORKSPACE_BASE_DIR || config.workspaceBaseDir;
  config.collabPort = process.env.COLLAB_PORT
    ? parseInt(process.env.COLLAB_PORT, 10)
    : config.collabPort;
  config.collabMode =
    (process.env.COLLAB_MODE as "embedded" | "external") || config.collabMode;
  config.collabUrl = process.env.COLLAB_URL || config.collabUrl;
  config.storageType =
    (process.env.STORAGE_TYPE as "fs" | "azure" | "s3") || config.storageType;
  config.agentsDir = process.env.AGENTS_DIR || config.agentsDir;

  // Apply FF_* env overrides to featureFlags
  for (const [envKey, flagKey] of Object.entries(FF_ENV_MAP)) {
    const val = process.env[envKey];
    if (val !== undefined) {
      if (val === "true" || val === "false") {
        (config.featureFlags as any)[flagKey] = val === "true";
      } else {
        (config.featureFlags as any)[flagKey] = val;
      }
    }
  }

  // Sync legacy top-level flags with featureFlags
  config.featureFlags.useOrchestrator = config.useOrchestrator;
  config.featureFlags.useApiV2 = config.useApiV2;

  return Object.freeze(config);
}

// ── Singleton ────────────────────────────────────────────────

let _config: AppConfig | null = null;

export function getConfig(): AppConfig {
  if (!_config) {
    _config = buildConfig();
  }
  return _config;
}

/**
 * Validate that all required environment variables are present.
 * Call at startup — throws with a clear message listing all missing vars.
 */
export function validateConfig(): void {
  const config = getConfig();
  const missing: string[] = [];

  if (!config.mongodbUri) missing.push("MONGODB_URI");
  if (!config.azureOpenAi.endpointUrl)
    missing.push("AZURE_OPENAI_ENDPOINT_URL");
  if (!config.azureOpenAi.apiKey) missing.push("AZURE_OPENAI_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables:\n` +
        missing.map((v) => `  - ${v}`).join("\n") +
        `\n\nSee packages/backend/.env.example for reference.`,
    );
  }
}
