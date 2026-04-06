/**
 * AgentRoleSchema - Output schema for RoleBuilder
 *
 * Defines the structure of roles discovered by the role builder agent.
 *
 * NOTE: Azure OpenAI strict structured output requires ALL properties in 'required'.
 * Do NOT use .default() or .optional() — they remove the property from 'required'
 * in the generated JSON schema, causing 400 errors.
 * Use .describe() to hint at recommended values instead.
 */

import { z } from "zod";

/**
 * Schema for a single agent role
 */
export const AgentRoleItemSchema = z.object({
  role: z.string().describe("The role name/identifier (lowercase, hyphenated)"),
  goal: z.string().describe("The primary goal or purpose of this role"),
  skills: z
    .array(z.string())
    .describe("List of skills/capabilities this role requires"),
  dependencies: z
    .array(z.string())
    .describe("Other roles this role depends on (empty array if none)"),
});

/**
 * Schema for the complete roles output
 */
export const AgentRoleSchema = z.object({
  roles: z
    .array(AgentRoleItemSchema)
    .describe("List of discovered agent roles"),
  teamGoal: z.string().describe("The overarching team goal (empty string if unspecified)"),
  suggestedWorkflow: z
    .string()
    .describe("Suggested workflow between roles (empty string if none)"),
});

export type AgentRoleItem = z.infer<typeof AgentRoleItemSchema>;
export type AgentRoleOutput = z.infer<typeof AgentRoleSchema>;
