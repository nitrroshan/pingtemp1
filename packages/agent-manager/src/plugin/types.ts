/**
 * Plugin Architecture Types — Claude Code Model
 *
 * Core interfaces for the plugin system. Maps 1:1 to Claude Code concepts:
 *   - IPlugin      = Plugin (bundles skills + MCP servers + storage)
 *   - IMcpServer   = MCP Server (tool provider)
 *   - ISkill       = Skill (prompt playbook — instructions, NOT tools)
 *   - IPlanStore   = Plan persistence (file-based default, CRDT upgradeable)
 *   - ITaskStore   = Task persistence
 */

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL CONTEXT
// ═══════════════════════════════════════════════════════════════════════════════

/** Tells an MCP server WHO is requesting tools */
export interface ToolContext {
  /** Planner gets plan tools; workers get task-execution tools */
  consumer: "planner" | "worker";
  /** Worker role (e.g., "researcher") — undefined for planner */
  role?: string;
  /** Current task ID — undefined for planner */
  taskId?: string;
  /** Goal ID — used for goal-scoped branch naming and context */
  goalId?: string;
  /** Git repo URL for workspace isolation (v2.0) */
  repoUrl?: string;
  /** Git branch to clone from (v2.0) */
  repoBranch?: string;
  /** Auth token for private repo clone/push (GitHub Connect) */
  authToken?: string;
}

/** Context provided to skills for conditional instruction generation */
export interface SkillContext {
  role?: string;
  taskId?: string;
  goalId?: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// MCP SERVER — Tool provider
// ═══════════════════════════════════════════════════════════════════════════════

/** MCP Server provides executable tools. Context-driven: different consumers get different tools. */
export interface IMcpServer {
  readonly id: string;
  readonly name: string;
  /** Return tools for the given context. May return empty array. */
  getTools(context: ToolContext): any[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// SKILL — Prompt playbook (instructions, NOT a tool)
// ═══════════════════════════════════════════════════════════════════════════════

/** Skill is a prompt playbook — instructions that shape agent behavior. */
export interface ISkill {
  readonly id: string;
  readonly name: string;
  /** Short description — always in context for discovery */
  readonly description: string;
  /** always = inject full text upfront; on-demand = description only until invoked */
  readonly loadMode: "always" | "on-demand";
  /** Full instructions text */
  getInstructions(context: SkillContext): string;
  /** Optional: restrict which tools the agent can use when this skill is active */
  allowedTools?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN STORAGE — Marker interface
// ═══════════════════════════════════════════════════════════════════════════════

/** Marker interface — plugins define their own storage shape */
export interface IPluginStorage {
  /** Optional plan store upgrade (e.g., L2 CRDT-backed) */
  planStore?: IPlanStore;
  /** Optional task store upgrade */
  taskStore?: ITaskStore;
  [key: string]: any;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLUGIN — Bundles skills + MCP servers + optional storage
// ═══════════════════════════════════════════════════════════════════════════════

/** Plugin bundles skills, MCP servers, and optional storage. Like a Claude Code plugin. */
export interface IPlugin {
  readonly id: string;
  readonly name: string;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  /** MCP servers this plugin provides (tool providers) */
  getMcpServers(): IMcpServer[];
  /** Skills this plugin provides (prompt playbooks) */
  getSkills(): ISkill[];
  /** Optional storage layer */
  getStorage?(): IPluginStorage;
  /** Optional async setup before getTools — e.g. create workspace for a task */
  prepareForTask?(context: ToolContext): Promise<void>;
  /** Called when a task completes — e.g. publish outputs, merge branch */
  onTaskComplete?(taskId: string, goalId?: string): Promise<{ success: boolean; error?: string }>;
  /** Called when a task fails — e.g. cleanup failed workspace */
  onTaskFailed?(taskId: string): Promise<void>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PLAN STORE — Orchestration state persistence
// ═══════════════════════════════════════════════════════════════════════════════

export type PlanStatus =
  | "pending"
  | "approved"
  | "executing"
  | "completed"
  | "failed"
  | "archived";

export interface StoredPlanMetadata {
  planId: string;
  teamId: string;
  goalId: string;
  goal: string;
  createdAt: string;
  status: PlanStatus;
  parentPlanId?: string;
  version: number;
}

export interface StoredPlan {
  plan: any;
  metadata: StoredPlanMetadata;
}

/** Plan persistence abstraction. Ships with FilePlanStore; L2 can upgrade to CRDT. */
export interface IPlanStore {
  savePlan(
    plan: any,
    opts: { goalId: string; status?: PlanStatus; parentPlanId?: string; version?: number },
  ): Promise<void>;
  loadPlan(goalId: string, planId: string): Promise<StoredPlan | null>;
  listPlansByGoal(goalId: string): Promise<StoredPlan[]>;
  getActivePlan(goalId: string): Promise<StoredPlan | null>;
  archivePlan(goalId: string, planId: string): Promise<void>;
  updatePlanStatus(goalId: string, planId: string, status: PlanStatus): Promise<void>;
}

/** Task persistence abstraction. */
export interface ITaskStore {
  addTask(task: any): void;
  getTask(taskId: string): any | undefined;
  updateStatus(taskId: string, status: string): void;
  getReadyTasks(): any[];
}
