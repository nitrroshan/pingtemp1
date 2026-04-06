/**
 * Default configuration — shared by all environments.
 * Values here can be overridden by environment-specific configs.
 */
export const defaultConfig = {
  // Server
  port: 3002,
  nodeEnv: "development" as string,

  // MongoDB
  mongodbUri: "mongodb://localhost:27017/ping",

  // Azure OpenAI
  azureOpenAI: {
    endpointUrl: "",
    apiKey: "",
    instanceName: "",
    deployment: "gpt-4o-2",
    apiVersion: "2025-01-01-preview",
  },

  // Workspace
  workspaceBaseDir: "./data/workspaces",

  // Agent runtime
  agentRuntime: "aisdk" as "aisdk" | "langgraph",

  // Orchestrator
  useOrchestrator: true,

  // Seed
  seedEnabled: false,

  // Logging
  logLevel: "info" as "debug" | "info" | "warn" | "error",
};

export type AppConfig = typeof defaultConfig;
