/**
 * AgentDefinitionSchema - Output schema for DefinitionBuilder
 *
 * One-shot schema that outputs complete AgentDefinition[].
 * Combines role discovery + config generation into single LLM call.
 *
 * NOTE: Azure OpenAI structured output requires ALL properties to be in 'required'.
 * Do NOT use .default() or .optional() — they remove the property from 'required'
 * in the generated JSON schema, causing 400 errors.
 * Use .describe() to hint at recommended values instead.
 */

import { z } from "zod";

/**
 * Schema for model configuration
 *
 * NOTE: Azure OpenAI strict structured output requires ALL properties in 'required'.
 * Do NOT use .default() or .optional() — they remove the property from 'required'
 * in the generated JSON schema, causing 400 errors.
 */
const ModelConfigSchema = z.object({
  provider: z
    .enum(["anthropic", "openai", "azure-openai"])
    .describe("LLM provider (use 'azure-openai' if unsure)"),
  model: z
    .string()
    .describe("Model name (empty string if using deployment instead)"),
  deployment: z.string().describe("Azure deployment name (empty string if not Azure)"),
  temperature: z.number().min(0).max(2).describe("Temperature (0.0 to 2.0)"),
  maxTokens: z.number().describe("Max tokens (e.g. 4096)"),
});

/**
 * Schema for tool configuration
 */
const ToolConfigSchema = z.object({
  name: z.string().describe("Tool name"),
  type: z
    .enum(["builtin", "mcp", "custom"])
    .describe("Tool type (use 'builtin' if unsure)"),
  configJson: z
    .string()
    .describe("Tool configuration as JSON string (use '{}' if none)"),
});

/**
 * Schema for internal agent config
 */
const InternalConfigSchema = z.object({
  model: ModelConfigSchema.describe("Model configuration"),
  tools: z
    .array(ToolConfigSchema)
    .describe("Tools the agent can use (empty array if none)"),
});

/**
 * Schema for a single agent definition
 * This is the complete definition needed to create an AiSdkAgent
 */
export const AgentDefinitionItemSchema = z.object({
  // Identity
  id: z.string().describe("Unique identifier (lowercase, hyphenated)"),
  name: z.string().describe("Human-readable name"),
  role: z.string().describe("Role identifier (lowercase)"),
  description: z.string().describe("Description of the agent (empty string if none)"),

  // Type - always 'internal' for worker agents
  type: z
    .enum(["internal", "external", "agentic-ui"])
    .describe("Agent type (use 'internal' for worker agents)"),

  // Behavior
  goal: z.string().describe("Primary goal of this agent"),
  systemPrompt: z.string().describe("System prompt for the agent"),

  // Configuration
  config: InternalConfigSchema.describe("Agent configuration"),

  // Team info
  dependencies: z
    .array(z.string())
    .describe("Roles this agent depends on (empty array if none)"),
  skills: z
    .array(z.string())
    .describe("Skills/capabilities this agent has (empty array if none)"),
});

/**
 * Schema for the complete definitions output
 */
export const AgentDefinitionListSchema = z.object({
  definitions: z
    .array(AgentDefinitionItemSchema)
    .describe("List of agent definitions"),
  teamGoal: z.string().describe("The overarching team goal (empty string if unspecified)"),
  suggestedWorkflow: z
    .string()
    .describe("Suggested workflow description (empty string if none)"),
});

export type AgentDefinitionItem = z.infer<typeof AgentDefinitionItemSchema>;
export type AgentDefinitionListOutput = z.infer<
  typeof AgentDefinitionListSchema
>;
