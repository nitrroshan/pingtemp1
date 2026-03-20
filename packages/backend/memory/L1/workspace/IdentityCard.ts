/**
 * IdentityCard — Agent self-awareness (Zone 4)
 *
 * Provides a live, queryable self-description for each agent:
 * - Static identity: role, skills, team context
 * - Dynamic state: progress, tool manifest, loaded context, decisions
 * - System prompt injection for LLM context
 *
 * @see AGENT_WORKSPACE_RESEARCH.md §8 — Zone 4: Identity Card
 */

import type { AgentWorkspace } from "./AgentWorkspace.js";

// =============================================================================
// Types
// =============================================================================

/**
 * Minimal agent definition (subset of full AgentDefinition to avoid circular deps)
 */
export interface IdentityAgentDef {
  id: string;
  name: string;
  role: string;
  goal: string;
  skills?: string[];
  systemPrompt?: string;
}

/**
 * Task context for identity card
 */
export interface IdentityTaskContext {
  id: string;
  description: string;
  priority?: number;
  attempt?: number;
  dependencies?: Array<{ taskId: string; status: string; output?: string }>;
}

/**
 * Team context for identity card
 */
export interface IdentityTeamContext {
  teamId: string;
  teamGoal?: string;
  planOverview?: string;
}

/**
 * Snapshot of the agent's progress
 */
export interface ProgressSnapshot {
  filesCreated: string[];
  filesModified: string[];
  scratchFiles: string[];
  commits: Array<{ hash: string; message: string; timestamp: Date }>;
  todosCompleted: number;
  todosTotal: number;
  elapsedMs: number;
}

/**
 * Tool metadata for manifest
 */
export interface ToolInfo {
  name: string;
  description: string;
}

/**
 * Agent context information
 */
export interface ContextInfo {
  task: IdentityTaskContext;
  team?: IdentityTeamContext;
  loadedKnowledge: string[];
  dependencyOutputs: string[];
}

/**
 * Decision record
 */
export interface Decision {
  timestamp: Date;
  description: string;
  rationale?: string;
}

/**
 * Full identity snapshot (for whoami / toJSON)
 */
export interface IdentitySnapshot {
  identity: {
    id: string;
    name: string;
    role: string;
    goal: string;
    skills: string[];
  };
  task: IdentityTaskContext;
  progress: ProgressSnapshot;
  tools: ToolInfo[];
  context: ContextInfo;
}

// =============================================================================
// IdentityCard
// =============================================================================

export class IdentityCard {
  // Static identity
  public readonly id: string;
  public readonly name: string;
  public readonly role: string;
  public readonly goal: string;
  public readonly skills: string[];

  // Context
  private task: IdentityTaskContext;
  private teamContext?: IdentityTeamContext;
  private loadedKnowledge: string[] = [];
  private dependencyOutputs: string[] = [];

  // Decision log
  private decisions: Decision[] = [];

  // Tool manifest (populated externally via setTools)
  private tools: ToolInfo[] = [];

  // Timing
  private readonly startedAt = Date.now();

  // Workspace reference for dynamic state
  private workspace: AgentWorkspace;

  constructor(
    agentDef: IdentityAgentDef,
    task: IdentityTaskContext,
    workspace: AgentWorkspace,
    teamContext?: IdentityTeamContext,
  ) {
    this.id = agentDef.id;
    this.name = agentDef.name;
    this.role = agentDef.role;
    this.goal = agentDef.goal;
    this.skills = agentDef.skills ?? [];
    this.task = task;
    this.workspace = workspace;
    this.teamContext = teamContext;
  }

  // ===========================================================================
  // Mutations (called during task lifecycle)
  // ===========================================================================

  /**
   * Record a decision the agent made
   */
  logDecision(description: string, rationale?: string): void {
    this.decisions.push({
      timestamp: new Date(),
      description,
      rationale,
    });
  }

  /**
   * Set tool manifest (called after tools are assembled)
   */
  setTools(tools: ToolInfo[]): void {
    this.tools = tools;
  }

  /**
   * Add loaded knowledge references
   */
  addKnowledgeRefs(refs: string[]): void {
    this.loadedKnowledge.push(
      ...refs.filter((r) => !this.loadedKnowledge.includes(r)),
    );
  }

  /**
   * Add dependency outputs
   */
  addDependencyOutputs(outputs: string[]): void {
    this.dependencyOutputs.push(
      ...outputs.filter((o) => !this.dependencyOutputs.includes(o)),
    );
  }

  // ===========================================================================
  // Dynamic state queries
  // ===========================================================================

  /**
   * Get progress snapshot by inspecting workspace state
   */
  async getProgress(): Promise<ProgressSnapshot> {
    const status = await this.workspace.getWorkspaceStatus();
    const history = await this.workspace.getHistory(50);
    const todos = this.workspace.scratchpad.listTodos();
    const scratchFiles = await this.workspace.scratchpad.listFiles();

    return {
      filesCreated: status.files.map((f) => f.path),
      filesModified: status.files
        .filter(
          (f) => f.lastModified.getTime() !== f.lastModified.getTime(), // Will always be false — use git diff for real detection
        )
        .map((f) => f.path),
      scratchFiles,
      commits: history.map((c) => ({
        hash: c.hash,
        message: c.message,
        timestamp: c.date,
      })),
      todosCompleted: todos.filter((t) => t.completed).length,
      todosTotal: todos.length,
      elapsedMs: Date.now() - this.startedAt,
    };
  }

  /**
   * Get tool manifest
   */
  getToolManifest(): ToolInfo[] {
    return [...this.tools];
  }

  /**
   * Get current context summary
   */
  getCurrentContext(): ContextInfo {
    return {
      task: this.task,
      team: this.teamContext,
      loadedKnowledge: [...this.loadedKnowledge],
      dependencyOutputs: [...this.dependencyOutputs],
    };
  }

  /**
   * Get decision log
   */
  getDecisionLog(): Decision[] {
    return [...this.decisions];
  }

  // ===========================================================================
  // Serialization
  // ===========================================================================

  /**
   * Compact text for LLM system prompt injection
   */
  toSystemPromptBlock(): string {
    const lines: string[] = [];

    lines.push(`You are ${this.name}, a ${this.role}.`);
    lines.push(`Your goal: ${this.goal}`);

    if (this.skills.length > 0) {
      lines.push(`Skills: ${this.skills.join(", ")}`);
    }

    lines.push("");
    lines.push(`Current Task: ${this.task.description}`);
    if (this.task.attempt && this.task.attempt > 1) {
      lines.push(`Attempt: ${this.task.attempt}`);
    }

    if (this.tools.length > 0) {
      lines.push("");
      lines.push("Your Tools:");
      for (const tool of this.tools) {
        lines.push(`- ${tool.name}: ${tool.description}`);
      }
    }

    if (this.loadedKnowledge.length > 0) {
      lines.push("");
      lines.push("Context Loaded:");
      for (const ref of this.loadedKnowledge) {
        lines.push(`- ${ref}`);
      }
    }

    if (this.teamContext) {
      lines.push("");
      lines.push(`Team: ${this.teamContext.teamId}`);
      if (this.teamContext.teamGoal) {
        lines.push(`Team Goal: ${this.teamContext.teamGoal}`);
      }
    }

    return lines.join("\n");
  }

  /**
   * Full JSON snapshot for whoami tool
   */
  async toJSON(): Promise<IdentitySnapshot> {
    return {
      identity: {
        id: this.id,
        name: this.name,
        role: this.role,
        goal: this.goal,
        skills: this.skills,
      },
      task: this.task,
      progress: await this.getProgress(),
      tools: this.getToolManifest(),
      context: this.getCurrentContext(),
    };
  }
}
