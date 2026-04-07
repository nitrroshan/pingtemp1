/**
 * PlannerAgent
 *
 * Thin wrapper that initializes the planner agent via AgentFactory,
 * loads system prompt from XML files via PromptLoader, and injects tools.
 *
 * Prompt structure (in agent/prompts/planner/):
 * - system.xml: base prompt with <cognitive-workflow>, <rules>, etc.
 * - team-config.xml: runtime injection with {{teamId}}, {{teamRoles}}
 *
 * XML tags make it clear to developers what's static vs injected.
 */

import { AgentFactory } from "../agent/AgentFactory.js";
import type { IAgent } from "../agent/types.js";
import { PromptLoader } from "./PromptLoader.js";

export interface PlannerAgentConfig {
  agentFactory: AgentFactory;
  teamRoles: string[];
  teamId: string;
}

export class PlannerAgent {
  private agent: IAgent | null = null;
  private config: PlannerAgentConfig;

  constructor(config: PlannerAgentConfig) {
    this.config = config;
  }

  /**
   * Initialize the planner agent.
   * Loads prompt from XML files, injects team config, initializes runtime.
   */
  async initialize(): Promise<void> {
    this.agent = this.config.agentFactory.createById("planner");

    if (!this.agent) {
      throw new Error("Failed to create planner agent — 'planner' definition not found");
    }

    // Load system prompt from XML files with runtime variables
    if (this.agent.definition) {
      // Build team members summary from agent definitions
      const memberSummaries = this.buildTeamMembersSummary();

      if (PromptLoader.has("planner")) {
        this.agent.definition.systemPrompt = PromptLoader.load("planner", {
          teamId: this.config.teamId,
          teamRoles: this.config.teamRoles.join(", "),
          teamMembers: memberSummaries,
        });
      } else {
        // Fallback: use inline YAML prompt + append team config
        const original = this.agent.definition.systemPrompt || "";
        this.agent.definition.systemPrompt = `${original}

<team-config>
## TEAM CONFIGURATION
**Team ID**: ${this.config.teamId}
**Available Team Roles**: ${this.config.teamRoles.join(", ")}

CRITICAL: When creating plans, you MUST assign tasks ONLY to these roles.
DO NOT invent new roles. Only use roles from the list above.
</team-config>
`;
      }
    }

    await this.agent.initialize();
  }

  /**
   * Inject tools into the planner agent (must be called after initialize).
   */
  async setTools(tools: any[]): Promise<void> {
    if (!this.agent) throw new Error("PlannerAgent not initialized");
    if ("setTools" in this.agent) {
      await (this.agent as any).setTools(tools);
    }
  }

  /**
   * Get the underlying IAgent instance.
   */
  getAgent(): IAgent {
    if (!this.agent) throw new Error("PlannerAgent not initialized");
    return this.agent;
  }

  /**
   * Execute the planner with a message.
   */
  execute(params: { message: string; threadId: string }) {
    if (!this.agent) throw new Error("PlannerAgent not initialized");
    return this.agent.execute(params);
  }

  /**
   * Build a summary of team members from AgentFactory definitions.
   * Each member gets: role, name, one-line description.
   * Full details available via get_team_capabilities tool.
   */
  private buildTeamMembersSummary(): string {
    const definitions = this.config.agentFactory.listDefinitions();

    const members = definitions
      .filter((d) => !d.role.startsWith("system/")) // exclude system agents
      .filter((d) => this.config.teamRoles.some(
        (r) => r.toLowerCase() === d.role.toLowerCase() || r.toLowerCase() === d.id.toLowerCase(),
      ));

    if (members.length === 0) {
      // Fallback: just list roles without descriptions
      return this.config.teamRoles
        .map((role) => `<member role="${role}">Available for task assignment.</member>`)
        .join("\n");
    }

    return members
      .map((d) => `<member role="${d.role}" name="${d.name}">${d.description || d.goal || "Available for task assignment."}</member>`)
      .join("\n");
  }
}
