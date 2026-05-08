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
 *
 * Stream wiring (May 9 2026 PM-4 — Patch #1):
 *   The underlying `IAgent` is invoked by `GoalManager.executePlannerTurn`
 *   via `factory.wire()` + `agent.runWithHooks()`. PlannerAgent itself no
 *   longer exposes an `execute()` method — callers go through
 *   `getAgent().runWithHooks(...)` directly. The `agentRuntimeFactory` +
 *   `goalId` config fields are kept for back-compat with test fixtures.
 */

import { AgentFactory } from "../agent/AgentFactory.js";
import type { IAgent } from "../agent/types.js";
import type { AgentRuntimeFactory } from "../agent/runtime/AgentRuntimeFactory.js";
import { PromptLoader } from "./PromptLoader.js";

export interface PlannerAgentConfig {
  agentFactory: AgentFactory;
  teamRoles: string[];
  teamId: string;
  /**
   * @deprecated PlannerAgent no longer wires the factory; the wiring
   * happens per-turn in `GoalManager.executePlannerTurn`. Field is kept
   * on the type for back-compat with test fixtures and the AgentManagerV2
   * wiring point.
   */
  agentRuntimeFactory?: AgentRuntimeFactory;
  /** @deprecated Same as `agentRuntimeFactory` above. */
  goalId?: string;
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
        // Fallback: use inline YAML prompt + append team config from XML
        const original = this.agent.definition.systemPrompt || "";
        const fallbackConfig = PromptLoader.loadFile("planner", "team-config-fallback.xml", {
          teamId: this.config.teamId,
          teamRoles: this.config.teamRoles.join(", "),
        });
        this.agent.definition.systemPrompt = `${original}\n\n${fallbackConfig}`;
      }
    }

    await this.agent.initialize();

    // Note: stream wiring happens per-turn in `GoalManager.executePlannerTurn`
    // via `factory.wire()` with a per-turn visitor that calls
    // `onPlannerStream`. The pre-wiring seam that used to live here was
    // removed May 9 2026 PM-4 along with `PlannerAgent.execute()`.
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
