/**
 * Knowledge Tools
 *
 * Tools for the planner's research phase:
 * - research_domain: Deep-dive on a topic via internal LLM call
 * - analyze_requirements: Goal decomposition into structured requirements
 * - get_team_capabilities: Query available roles such as agents and skills
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { AgentFactory } from "../../agent/AgentFactory.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const ResearchDomainSchema = z.object({
  topic: z
    .string()
    .describe("The specific topic to research (e.g., 'Next.js App Router patterns', 'PostgreSQL indexing strategies')"),
  focusAreas: z
    .array(z.string())
    .optional()
    .describe("Specific aspects to focus on (e.g., ['performance', 'security', 'scalability'])"),
});

export const AnalyzeRequirementsSchema = z.object({
  goal: z
    .string()
    .describe("The user's goal to decompose"),
  context: z
    .string()
    .optional()
    .describe("Additional context from conversation (constraints, preferences)"),
});

export const GetTeamCapabilitiesSchema = z.object({
  filter: z
    .string()
    .optional()
    .describe("Optional filter to narrow results (e.g., 'frontend', 'backend')"),
});

// ─── Tool Factories ───────────────────────────────────────────────────────────

export interface KnowledgeToolContext {
  agentFactory: AgentFactory;
  /** Optional: callable to perform LLM research (defaults to returning prompt-based analysis) */
  researchFn?: (prompt: string) => Promise<string>;
}

/**
 * Create the research_domain tool.
 * Uses an internal LLM call (or research function) to deep-dive on a topic.
 */
export function createResearchDomainTool(ctx: KnowledgeToolContext) {
  return tool(
    async (input) => {
      const focusStr = input.focusAreas?.length
        ? `\nFocus specifically on: ${input.focusAreas.join(", ")}`
        : "";

      const prompt = `Research the following topic thoroughly and provide actionable insights for a software development team:\n\nTopic: ${input.topic}${focusStr}\n\nProvide:\n1. Key concepts and patterns\n2. Common pitfalls to avoid\n3. Best practices\n4. Architecture recommendations\n5. Trade-offs to consider`;

      if (ctx.researchFn) {
        return await ctx.researchFn(prompt);
      }

      // Fallback: return the research prompt for the planner to reason about
      return `[Research prompt prepared for: ${input.topic}]\n${prompt}\n\n(Note: research_domain currently returns prompts — the planner can use its own knowledge to reason about this topic, or L3 Knowledge Base integration will provide real research in Phase 4.)`;
    },
    {
      name: "research_domain",
      description: `Research a specific domain topic before planning. Use this to:
- Understand architecture patterns for the tech stack
- Learn about common pitfalls in the problem domain
- Gather best practices before decomposing the goal
Call this BEFORE creating a plan — research first, plan second.`,
      schema: ResearchDomainSchema,
    },
  );
}

/**
 * Create the analyze_requirements tool.
 * Decomposes a goal into structured components, risks, and unknowns.
 */
export function createAnalyzeRequirementsTool(ctx: KnowledgeToolContext) {
  return tool(
    async (input) => {
      const prompt = `Decompose this goal into structured requirements:\n\nGoal: ${input.goal}${input.context ? `\nContext: ${input.context}` : ""}\n\nAnalyze and return:\n1. Core components needed\n2. Hard constraints (must-haves)\n3. Soft constraints (nice-to-haves)\n4. Risks and unknowns\n5. Assumptions being made\n6. Suggested phases/milestones`;

      if (ctx.researchFn) {
        return await ctx.researchFn(prompt);
      }

      return `[Requirements analysis for: ${input.goal}]\n${prompt}\n\n(Note: analyze_requirements currently returns prompts — the planner uses its own reasoning to decompose requirements. L3 Knowledge Base integration will enrich this in Phase 4.)`;
    },
    {
      name: "analyze_requirements",
      description: `Decompose a user's goal into structured requirements. Returns:
- Core components needed
- Hard vs soft constraints  
- Risks and unknowns
- Assumptions
Use after clarifying with user but before creating the plan.`,
      schema: AnalyzeRequirementsSchema,
    },
  );
}

/**
 * Create the get_team_capabilities tool.
 * Queries AgentFactory for available roles and their skills.
 */
export function createGetTeamCapabilitiesTool(ctx: KnowledgeToolContext) {
  return tool(
    async (input) => {
      const definitions = ctx.agentFactory.listDefinitions();

      let filtered = definitions.filter(
        (d) => !d.role.startsWith("system/"), // Exclude system agents
      );

      if (input.filter) {
        const lowerFilter = input.filter.toLowerCase();
        filtered = filtered.filter(
          (d) =>
            d.id.toLowerCase().includes(lowerFilter) ||
            d.name.toLowerCase().includes(lowerFilter) ||
            d.role.toLowerCase().includes(lowerFilter) ||
            (d.description || "").toLowerCase().includes(lowerFilter),
        );
      }

      if (filtered.length === 0) {
        return "No matching agent roles found." + (input.filter ? ` (filter: "${input.filter}")` : "");
      }

      return filtered.map((d) => {
        return `**${d.name}** (role: ${d.role})\n  ${d.description || "(no description)"}\n  Goal: ${d.goal || "(no goal)"}`;
      }).join("\n\n");
    },
    {
      name: "get_team_capabilities",
      description: `Query the team's available agent roles and their capabilities. Returns:
- Role names and IDs
- Descriptions and goals
- Skills available to each role
Use this to understand what your team can do before assigning tasks.`,
      schema: GetTeamCapabilitiesSchema,
    },
  );
}
