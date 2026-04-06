/**
 * Environment configuration loader.
 *
 * Merges default config with environment-specific overrides and env vars.
 * Call getConfig() anywhere to get the current resolved config.
 * Call validateConfig() at startup to fail fast on missing required vars.
 */

import { defaultConfig, type AppConfig } from "./default.js";

// Lazy-loaded singleton
let _config: AppConfig | null = null;

/**
 * Build config from defaults, env-specific overrides, and process.env.
 */
function buildConfig(): AppConfig {
  const nodeEnv = process.env["NODE_ENV"] ?? "development";

  // Start from defaults
  const config: AppConfig = {
    ...defaultConfig,
    nodeEnv,
  };

  // Apply environment-specific overrides (dynamic import not needed — we read env var)
  if (nodeEnv === "production") {
    config.logLevel = "info";
    config.seedEnabled = false;
  } else {
    config.logLevel = "debug";
  }

  // Apply env var overrides (always take precedence)
  if (process.env["API_PORT"]) config.port = parseInt(process.env["API_PORT"]);
  if (process.env["MONGODB_URI"]) config.mongodbUri = process.env["MONGODB_URI"];

  if (process.env["AZURE_OPENAI_ENDPOINT_URL"])
    config.azureOpenAI.endpointUrl = process.env["AZURE_OPENAI_ENDPOINT_URL"];
  if (process.env["AZURE_OPENAI_API_KEY"])
    config.azureOpenAI.apiKey = process.env["AZURE_OPENAI_API_KEY"];
  if (process.env["AZURE_OPENAI_INSTANCE_NAME"])
    config.azureOpenAI.instanceName = process.env["AZURE_OPENAI_INSTANCE_NAME"];
  if (process.env["AZURE_OPENAI_DEPLOYMENT"])
    config.azureOpenAI.deployment = process.env["AZURE_OPENAI_DEPLOYMENT"];
  if (process.env["AZURE_OPENAI_API_VERSION"])
    config.azureOpenAI.apiVersion = process.env["AZURE_OPENAI_API_VERSION"];

  if (process.env["WORKSPACE_BASE_DIR"])
    config.workspaceBaseDir = process.env["WORKSPACE_BASE_DIR"];

  if (process.env["AGENT_RUNTIME"]) {
    const rt = process.env["AGENT_RUNTIME"];
    if (rt === "aisdk" || rt === "langgraph") config.agentRuntime = rt;
  }

  if (process.env["USE_ORCHESTRATOR"])
    config.useOrchestrator = process.env["USE_ORCHESTRATOR"] !== "false";

  if (process.env["SEED_ENABLED"])
    config.seedEnabled = process.env["SEED_ENABLED"] === "true";

  return config;
}

/**
 * Get the resolved application config (singleton — built once per process).
 */
export function getConfig(): AppConfig {
  if (!_config) {
    _config = buildConfig();
  }
  return _config;
}

/**
 * Validate required configuration at startup.
 * Throws an error with a clear message if any required var is missing.
 *
 * Call this in server.ts BEFORE connecting to the database or starting the server.
 */
export function validateConfig(): void {
  const config = getConfig();
  const missing: string[] = [];

  if (!config.mongodbUri) missing.push("MONGODB_URI");
  if (!config.azureOpenAI.endpointUrl) missing.push("AZURE_OPENAI_ENDPOINT_URL");
  if (!config.azureOpenAI.apiKey) missing.push("AZURE_OPENAI_API_KEY");

  if (missing.length > 0) {
    throw new Error(
      `[config] Missing required environment variables:\n` +
        missing.map((v) => `  - ${v}`).join("\n") +
        `\n\nCopy .env.example to .env and fill in the values.\n`,
    );
  }
}

// Re-export types and individual configs for consumers that need them
export type { AppConfig };
export { defaultConfig } from "./default.js";
