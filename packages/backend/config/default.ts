/**
 * Default configuration — shared across all environments.
 * Values here are overridden by environment-specific configs.
 */

import type { AppConfig } from "./index.js";

const defaultConfig: AppConfig = {
  // Server
  port: 3002,
  nodeEnv: "development",

  // MongoDB
  mongodbUri: "mongodb://localhost:27017/ping",

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

  // Agent runtime
  workspaceBaseDir: "./data/workspaces",
  collabPort: 1234,
  agentsDir: undefined,
};

export default defaultConfig;
