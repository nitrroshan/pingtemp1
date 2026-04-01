/**
 * Agent configuration interface
 * Defines the structure for configuring an AI agent with role, goals, prompts, and tools
 */
export interface AgentConfig {
  name: string;
  /** The role assigned to the agent */
  role: string;

  /** The primary goal or objective of the agent */
  goal: string;

  /** description providing additional context about the agent's purpose */
  description?: string;

  /** system prompt to guide the agent's behavior */
  systemPrompt?: string;

  /** response format specification for structured outputs */
  responseFormat?: any;

  /**  array of tools available to the agent */
  tools?: any[]; // default empty

  /** MCP (Model Context Protocol) client configurations */
  mcpClientConfigs?: {}; // default empty
}
