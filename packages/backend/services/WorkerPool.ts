/**
 * WorkerPool - Simple registry for active workers
 *
 * Core responsibilities:
 * - Cache AgentDefinitions by role
 * - Create AiSdkAgent instances for tasks
 * - Bridge AsyncGenerator → EventEmitter for Socket.IO
 * - Clean up workers when done
 */

import { Logger } from "tslog";
import { AiSdkAgent } from "../agent/internal/AiSdkAgent.js";
import {
  createReportStatusTool,
  createCompleteTaskTool,
} from "../agent/internal/tools/index.js";
import { skillResolver } from "../skills/SkillResolver.js";
import { WorkspaceManager } from "../memory/L1/workspace/WorkspaceManager.js";
import { AgentWorkspace } from "../memory/L1/workspace/AgentWorkspace.js";
import { createWorkspaceTools } from "../memory/L1/workspace/tools/workspace-tools.js";
import { createCollabTool } from "../memory/L2/tools/index.js";
import type { MemoryCoordinator } from "../memory/MemoryCoordinator.js";
import type {
  AgentDefinition,
  AgentInput,
  AgentEvent,
  InternalConfig,
} from "../agent/types.js";
import type { TaskWithContext } from "../util/RoleTaskQueue.types.js";
import dotenv from "dotenv";

dotenv.config();

const logger = new Logger({ name: "WorkerPool" });

export interface WorkerCallbacks {
  onStream?: (data: { taskId: string; agentId: string; part: any }) => void;
  onEvent?: (data: { taskId: string; event: any }) => void;
  onDone?: (data: { taskId: string; role: string; output: any }) => void;
  onError?: (data: { taskId: string; error: string }) => void;
  onAgentComplete?: (data: { taskId: string; role: string; summary: string; deliverables: string[]; nextSteps: string[]; timestamp: number }) => void;
  onStatusUpdate?: (data: { taskId: string; role: string; status: string; summary: string; progress?: number; timestamp: number }) => void;
}

/**
 * Default model config - uses environment variables
 * This overrides any LLM-generated deployment names
 */
const DEFAULT_MODEL_CONFIG = {
  provider: "azure-openai" as const,
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-2",
  temperature: 0.7,
  maxTokens: 4096,
};

export class WorkerPool {
  /** Cached definitions by role */
  private definitions = new Map<string, AgentDefinition>();

  /** Active workers by task ID */
  private workers = new Map<string, AiSdkAgent>();

  /** Workspaces by task ID (for git branch isolation) */
  private workspaces = new Map<string, AgentWorkspace>();

  /** Workspace manager for branch operations */
  private workspaceManager: WorkspaceManager | null = null;

  /** Whether workspace support is enabled */
  private workspaceEnabled = false;

  /** Memory coordinator for artifact/collab integration */
  private memoryCoordinator: MemoryCoordinator | null = null;

  /** Current team ID for collab context */
  private teamId: string | null = null;

  /** Current goal ID for collab context */
  private goalId: string | null = null;

  /** Maps role → agent MongoDB _id (for DB skill lookup) */
  private roleAgentIdMap = new Map<string, string>();

  /** Base (non-skill) tools per worker — skills are refreshed per request */
  private workerBaseTools = new Map<string, any[]>();

  /** Callbacks for worker lifecycle events */
  private callbacks: WorkerCallbacks = {};

  /**
   * Maximum number of tasks that can run concurrently.
   * Wired from TeamSettings.maxConcurrency by AgentManagerV2.
   * Default: 5 (unconstrained for teams that haven't configured it).
   */
  private maxConcurrency: number = 5;

  // ===========================================================================
  // Definition Management
  // ===========================================================================

  /**
   * Set memory coordinator for artifact/collab integration
   */
  setMemoryCoordinator(coordinator: MemoryCoordinator): void {
    this.memoryCoordinator = coordinator;
    logger.info("MemoryCoordinator set for WorkerPool");
  }

  /**
   * Set role → MongoDB agent ID map (for DB skill lookup)
   */
  setRoleAgentIdMap(map: Record<string, string>): void {
    this.roleAgentIdMap.clear();
    for (const [role, id] of Object.entries(map)) {
      this.roleAgentIdMap.set(role.toLowerCase(), id);
    }
    logger.debug(`RoleAgentIdMap set: ${Object.keys(map).join(", ")}`);
  }

  /**
   * Set goal context for collab space
   */
  setGoalContext(teamId: string, goalId: string): void {
    this.teamId = teamId;
    this.goalId = goalId;
    logger.debug(`Goal context set: ${teamId}/${goalId}`);
  }

  /**
   * Get the current goal ID (v2.2)
   */
  getGoalId(): string | null {
    return this.goalId;
  }

  /**
   * Get the current team ID (v2.2)
   */
  getTeamId(): string | null {
    return this.teamId;
  }

  /**
   * Get memory coordinator (for external access if needed)
   */
  getMemoryCoordinator(): MemoryCoordinator | null {
    return this.memoryCoordinator;
  }

  /**
   * Set callbacks for worker lifecycle events
   */
  setCallbacks(callbacks: WorkerCallbacks): void {
    this.callbacks = callbacks;
  }

  /**
   * Set the maximum number of tasks that can execute concurrently.
   * Called by AgentManagerV2 when it loads the team's settings.
   * Value comes from TeamSettings.maxConcurrency (default: 3).
   */
  setMaxConcurrency(limit: number): void {
    this.maxConcurrency = Math.max(1, limit);
    logger.info(`WorkerPool maxConcurrency set to ${this.maxConcurrency}`);
  }

  /** Return the current concurrency limit */
  getMaxConcurrency(): number {
    return this.maxConcurrency;
  }

  /**
   * Enable workspace support for git branch isolation
   * @param repoPath - Path to the git repository
   */
  async enableWorkspace(repoPath: string): Promise<void> {
    this.workspaceManager = new WorkspaceManager({ repoPath });
    await this.workspaceManager.initializeWorkspace();
    this.workspaceEnabled = true;
    logger.info(`Workspace enabled at: ${repoPath}`);
  }

  /**
   * Check if workspace support is enabled
   */
  isWorkspaceEnabled(): boolean {
    return this.workspaceEnabled;
  }

  /**
   * Register agent definitions (from DefinitionBuilder)
   */
  registerDefinitions(definitions: AgentDefinition[]): void {
    for (const def of definitions) {
      const role = def.role.toLowerCase();
      this.definitions.set(role, def);
      logger.debug(`Registered: ${role}`);
    }
  }

  /**
   * Get a role's definition
   */
  getDefinition(role: string): AgentDefinition | undefined {
    return this.definitions.get(role.toLowerCase());
  }

  /**
   * Check if role exists
   */
  hasRole(role: string): boolean {
    return this.definitions.has(role.toLowerCase());
  }

  // ===========================================================================
  // Task Execution (combines create + execute)
  // ===========================================================================

  /**
   * Run a task: creates worker if needed, executes, emits events
   *
   * Overload 1: Chat mode - simple params
   * @param taskId - Unique task identifier
   * @param role - Role to use for this task
   * @param message - Message to send to the agent
   */
  async runTask(taskId: string, role: string, message: string): Promise<any>;

  /**
   * Overload 2: Queue mode - TaskWithContext (includes dependency context)
   * @param task - Task with context from RoleTaskQueue
   */
  async runTask(task: TaskWithContext): Promise<any>;

  /**
   * Implementation handles both signatures
   */
  async runTask(
    taskIdOrTask: string | TaskWithContext,
    role?: string,
    message?: string,
  ): Promise<any> {
    let taskId: string;
    let roleKey: string;
    let finalMessage: string;

    if (typeof taskIdOrTask === "string") {
      // Chat mode: simple params
      taskId = taskIdOrTask;
      roleKey = role!.toLowerCase();
      finalMessage = message!;
    } else {
      // Queue mode: TaskWithContext
      const task = taskIdOrTask;
      taskId = task.id;
      roleKey = task.assigned_role.toLowerCase();
      finalMessage = this.buildMessageWithContext(task);
      logger.debug(
        `Queue mode: ${taskId} with ${task.context.previousOutputs.length} previous outputs`,
      );
    }

    // Enforce concurrency limit from TeamSettings.maxConcurrency
    const activeWorkers = this.workers.size;
    if (activeWorkers >= this.maxConcurrency) {
      logger.warn(
        `WorkerPool at capacity (${activeWorkers}/${this.maxConcurrency}) for task ${taskId}. ` +
        `Increase TeamSettings.maxConcurrency if you need more parallel workers.`,
      );
    }

    // Get or create worker
    let agent: AiSdkAgent | undefined = this.workers.get(taskId);

    if (!agent) {
      const definition = this.definitions.get(roleKey);
      if (!definition) {
        throw new Error(`Role not registered: ${role}`);
      }

      // Override model config with defaults (LLM-generated deployments don't exist)
      const config = definition.config as InternalConfig;
      const fixedDefinition: AgentDefinition = {
        ...definition,
        id: `${roleKey}-${taskId}`,
        config: {
          ...config,
          model: {
            ...config.model,
            ...DEFAULT_MODEL_CONFIG, // Override with real deployment
          },
        },
      };

      logger.debug(
        `Creating worker for ${roleKey} with deployment: ${DEFAULT_MODEL_CONFIG.deployment}`,
      );

      agent = new AiSdkAgent(fixedDefinition);
      await agent.initialize();

      // Collect additional tools
      const additionalTools: any[] = [];

      // Add report_status tool for task lifecycle
      const reportStatusTool = createReportStatusTool(
        taskId,
        roleKey,
        (data) => this.callbacks.onStatusUpdate?.(data),
      );
      additionalTools.push(reportStatusTool);

      // Add complete_task tool for agent-initiated completion
      const completeTaskTool = createCompleteTaskTool(
        taskId,
        roleKey,
        (data) => this.callbacks.onAgentComplete?.(data),
      );
      additionalTools.push(completeTaskTool);

      // Add workspace tools if enabled
      if (this.workspaceEnabled && this.workspaceManager) {
        const workspace = await this.workspaceManager.createWorkspace(
          roleKey,
          taskId,
        );
        this.workspaces.set(taskId, workspace);

        const workspaceTools = createWorkspaceTools(workspace);
        additionalTools.push(...workspaceTools);
        logger.debug(
          `Workspace created for task ${taskId} on branch ${workspace.branchName}`,
        );
      }

      // Add memory tools (collab + knowledge) if MemoryCoordinator is available
      if (this.memoryCoordinator) {
        // Add unified collab tool (L2: CRDT docs + plans + output manifests)
        const l2 = this.memoryCoordinator.L2;
        if (l2) {
          const space = l2.getOrCreateSpace(this.goalId || "default");
          const repoPath = this.workspaceManager
            ? this.workspaceManager.workspacesRoot
            : ".";
          const collabTool = createCollabTool(space, roleKey, l2, repoPath);
          additionalTools.push(collabTool);
          logger.debug(
            `Added unified collab tool for task ${taskId} (${roleKey})`,
          );
        }

        // Add knowledge tools if L3 is available
        const l3 = this.memoryCoordinator.L3;
        if (l3) {
          const knowledgeTools = l3.createTools(roleKey, taskId);
          additionalTools.push(...knowledgeTools);
          logger.debug(
            `Added ${knowledgeTools.length} knowledge tools for task ${taskId}`,
          );
        }
      }

      // Inject base (non-skill) tools
      const currentTools = (agent as any).loadedTools || {};
      const currentToolsArray = Array.isArray(currentTools) ? currentTools : Object.values(currentTools);
      const baseTools = [...currentToolsArray, ...additionalTools];
      await agent.setTools(baseTools);

      // Store base tools for per-request skill refresh
      this.workerBaseTools.set(taskId, baseTools);
      this.workers.set(taskId, agent);
      this.workerRoles.set(taskId, roleKey);
      logger.info(
        `Created worker: ${taskId} (${roleKey}) with ${additionalTools.length} additional tools`,
      );
    }

    // Refresh skills from DB on EVERY request (hot-reload)
    await this.refreshSkillTools(taskId, roleKey, agent!);

    // Execute and stream events
    let output: any = null;

    if (!agent) {
      throw new Error(`Worker for task ${taskId} was not created`);
    }

    // Auto-update agent status: working
    await this.updateAgentStatus(roleKey, "working", { taskId });

    try {
      const input: AgentInput = {
        message: finalMessage,
        threadId: taskId, // Use taskId as thread for conversation continuity
      };

      for await (const event of agent.execute(input)) {
        // Forward stream_part events directly on onStream callback
        if (event.type === "stream_part") {
          this.callbacks.onStream?.({
            taskId,
            agentId: roleKey,
            part: event.part,
          });
          continue; // Don't emit stream_parts on onEvent (legacy channel)
        }

        // Invoke event callback for all other events (legacy progress channel)
        this.callbacks.onEvent?.({ taskId, event });

        // Capture output
        if (event.type === "done") {
          output = event.output;
          this.lastResponses.set(taskId, output); // Store for getLastResponse
          const role = this.workerRoles.get(taskId) || "worker";
          this.callbacks.onDone?.({ taskId, role, output });

          // Auto-update agent status: idle
          await this.updateAgentStatus(roleKey, "idle", { taskId });

          // Output manifests are now written by AgentWorkspace.publish()
          // No need to auto-register here — manifests land in .ping/outputs/
        }

        if (event.type === "error") {
          this.callbacks.onError?.({ taskId, error: event.error });
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.callbacks.onError?.({ taskId, error: msg });

      // Auto-update agent status: error
      await this.updateAgentStatus(roleKey, "error", { taskId, error: msg });

      throw error;
    }

    return output;
  }

  // ===========================================================================
  // Cleanup
  // ===========================================================================

  /**
   * Dispose a specific worker
   */
  async dispose(taskId: string): Promise<void> {
    const agent = this.workers.get(taskId);
    if (agent) {
      await agent.stop();
      this.workers.delete(taskId);
      this.workerRoles.delete(taskId);
      this.lastResponses.delete(taskId);
      this.workspaces.delete(taskId);
      // Note: branch is kept until mergeAndCleanup is called
      logger.info(`Disposed: ${taskId}`);
    }
  }

  /**
   * Merge workspace branch to main and cleanup
   * Call this when task is completed and approved
   */
  async mergeAndCleanup(
    taskId: string,
  ): Promise<{ success: boolean; error?: string }> {
    if (!this.workspaceEnabled || !this.workspaceManager) {
      return { success: true }; // No-op if workspace not enabled
    }

    return this.workspaceManager.mergeAndCleanup(taskId);
  }

  /**
   * Get workspace for a task
   */
  getWorkspace(taskId: string): AgentWorkspace | undefined {
    return this.workspaces.get(taskId);
  }

  /**
   * Dispose all workers and clear cached workspaces so stale workspaces
   * from a previous plan are not reused.
   */
  async disposeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.workers.keys()).map((id) => this.dispose(id)),
    );

    // Clear WorkspaceManager cache to prevent stale workspace reuse
    this.workspaceManager?.clearWorkspaces();
  }

  // ===========================================================================
  // Status
  // ===========================================================================

  get workerCount(): number {
    return this.workers.size;
  }

  get roleCount(): number {
    return this.definitions.size;
  }

  /** Store role per task for getActiveWorkers */
  private workerRoles = new Map<string, string>();

  // ===========================================================================
  // Agent Status CRDT (auto-update on task lifecycle)
  // ===========================================================================

  /**
   * Update agent status in the L2 CRDT (agent-statuses doc).
   * Called automatically on task start, completion, and failure.
   */

  /**
   * Refresh skill tools for a worker from DB + YAML config.
   * Called on EVERY runTask() so skill assignments are picked up immediately.
   *
   * TODO(live-skill-refresh): Replace per-request DB query with event-driven cache.
   * Blocked on: TeamService integration (TeamService should be injected, not created per-call).
   * See: docs/features/skills-integration/live-skill-refresh/feature_implementation_planning.md
   */
  private async refreshSkillTools(
    taskId: string,
    roleKey: string,
    agent: AiSdkAgent,
  ): Promise<void> {
    const definition = this.definitions.get(roleKey);
    const config = definition?.config as InternalConfig | undefined;
    const yamlSkillIds: string[] = (config?.skills as string[] | undefined) || [];

    // Fetch skills assigned via SkillSelector (stored in DB)
    let dbSkillIds: string[] = [];
    const agentMongoId = this.roleAgentIdMap.get(roleKey);
    if (agentMongoId) {
      try {
        const { TeamService } = await import("../team/TeamService.js");
        const teamService = new TeamService();
        const dbSkills = await teamService.getAgentSkills(agentMongoId);
        dbSkillIds = dbSkills
          .filter(s => s.enabled !== false)
          .map(s => s.skillId);
      } catch (error: any) {
        logger.warn(`DB skill lookup failed for ${roleKey}: ${error.message}`);
      }
    }

    // Merge YAML + DB skills (deduplicate)
    const skillIds = [...new Set([...yamlSkillIds, ...dbSkillIds])];

    // Get base tools (non-skill tools set at worker creation)
    const baseTools = this.workerBaseTools.get(taskId) || [];

    if (skillIds.length === 0) {
      // No skills assigned — ensure agent has only base tools
      await agent.setTools(baseTools);
      return;
    }

    try {
      const { tools: skillTools } = await skillResolver.resolve(skillIds);
      const skillToolArray = Object.values(skillTools);
      if (skillToolArray.length > 0) {
        logger.info(
          `Refreshed ${skillToolArray.length} skill tools for ${roleKey} (task ${taskId})`,
        );
      }
      await agent.setTools([...baseTools, ...skillToolArray]);
    } catch (error: any) {
      logger.warn(`Skill refresh failed for ${roleKey}: ${error.message}`);
      // Fall back to base tools only
      await agent.setTools(baseTools);
    }
  }

  private async updateAgentStatus(
    roleKey: string,
    status: "working" | "idle" | "error",
    details: { taskId: string; error?: string },
  ): Promise<void> {
    const l2 = this.memoryCoordinator?.L2;
    if (!l2) return;

    try {
      const space = l2.getOrCreateSpace(this.goalId || "default");
      const doc = await space.openDoc("agent-statuses");
      doc.getMap("agent-statuses").set(roleKey, {
        status,
        currentTask: status === "working" ? details.taskId : null,
        lastTask: details.taskId,
        error: details.error || null,
        updatedAt: new Date().toISOString(),
      });
    } catch (err) {
      // Non-fatal — don't break task execution for status writes
      logger.debug(`Failed to update agent status for ${roleKey}: ${err}`);
    }
  }

  /**
   * Get active workers info
   */
  getActiveWorkers(): Array<{ taskId: string; role: string; status: string }> {
    const result: Array<{ taskId: string; role: string; status: string }> = [];
    for (const [taskId] of this.workers.entries()) {
      result.push({
        taskId,
        role: this.workerRoles.get(taskId) || "unknown",
        status: "active",
      });
    }
    return result;
  }

  /**
   * Store last response per task for completion
   */
  private lastResponses = new Map<string, any>();

  /**
   * Get last response from a worker
   */
  getLastResponse(taskId: string): any {
    return this.lastResponses.get(taskId);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Build message with context from dependency outputs and orchestrator conversation
   * Injects previous task outputs and orchestrator context into the message for the agent
   */
  private buildMessageWithContext(task: TaskWithContext): string {
    let msg = task.description;

    if (task.context.previousOutputs.length > 0) {
      msg += "\n\n## Context from previous tasks:\n";
      for (const prev of task.context.previousOutputs) {
        msg += `\n### Task ${prev.taskId}:\n`;
        msg += JSON.stringify(prev.output, null, 2) + "\n";
      }
    }

    if (task.context.artifacts.length > 0) {
      msg += `\n\n## Available artifacts:\n${task.context.artifacts.join("\n")}`;
    }

    return msg;
  }
}
