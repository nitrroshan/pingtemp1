/**
 * Default configuration — shared across all environments.
 * Values here are overridden by environment-specific configs.
 */

import type { AppConfig } from "./index.js";
import { DEV_DEFAULTS } from "./featureFlags.js";

const defaultConfig: AppConfig = {
  // Server
  port: 3002,
  nodeEnv: "development",

  // Deployment mode: local (file-based), cloud (MongoDB), hybrid (PostgreSQL + MongoDB)
  mode: "local",

  // MongoDB (used for chat in cloud/hybrid mode)
  mongodbUri: "",

  // PostgreSQL (used for relational data in hybrid mode)
  databaseUrl: "",

  // Azure OpenAI (required — validated at startup)
  azureOpenAi: {
    apiKey: "",
    endpointUrl: "",
    instanceName: "",
    deployment: "gpt-4o-2",
  },

  // Optional LLM providers
  anthropicApiKey: undefined,
  openaiApiKey: undefined,

  // Feature flags
  useOrchestrator: true,
  useApiV2: true,
  featureFlags: { ...DEV_DEFAULTS },

  // Agent runtime
  workspaceBaseDir: "./data/workspaces",
  collabPort: 1234,
  collabMode: "embedded",
  collabUrl: "ws://localhost:1234",
  storageType: "fs",
  agentsDir: undefined,
};

export default defaultConfig;
