/**
 * WorkerPool - Simple registry for active workers
 *
 * Core responsibilities:
 * - Cache AgentDefinitions by role
 * - Create AiSdkAgent instances for tasks
 * - Bridge AsyncGenerator → EventEmitter for Socket.IO
 * - Clean up workers when done
 */

import { rootLogger } from "../logging.js";
import { AiSdkAgent } from "../agent/internal/AiSdkAgent.js";
import { assembleLifecycleTools } from "./tools/index.js";
import { PluginRegistry } from "../plugin/PluginRegistry.js";
import type { ToolContext } from "../plugin/types.js";
import { loadTaskLifecycleSkill } from "../skills/taskLifecycleSkill.js";
import type {
  AgentDefinition,
  AgentInput,
  AgentEvent,
  InternalConfig,
} from "../agent/types.js";
import type { TaskWithContext } from "../util/RoleTaskQueue.types.js";
import dotenv from "dotenv";

dotenv.config();

const logger = rootLogger.child({ module: "WorkerPool" });

export interface WorkerCallbacks {
  onStream?: (data: { taskId: string; agentId: string; part: any; goalId?: string }) => void;
  onEvent?: (data: { taskId: string; event: any }) => void;
  onDone?: (data: { taskId: string; role: string; output: any }) => void;
  onError?: (data: { taskId: string; error: string }) => void;
  onAgentComplete?: (data: { taskId: string; role: string; summary: string; deliverables: string[]; nextSteps: string[]; producedDocs?: Array<{ uri: string; name: string; description?: string }>; decisions?: string[]; timestamp: number }) => void;
  onStatusUpdate?: (data: { taskId: string; role: string; status: string; summary: string; progress?: number; timestamp: number }) => void;
  /** Fired when an agent creates a task via request_task tool */
  onTaskCreated?: (data: { taskId: string; createdBy: string; targetRole: string; relationship: string; parentTaskId: string }) => void;
  /** Fired when an agent bounces a task via bounce_task tool */
  onBounce?: (data: { taskId: string; role: string; reason: string; suggestedRole?: string; timestamp: number }) => void;
  /** Fired when an agent mentions roles in a discussion — triggers priority collab worker spawn */
  onMentionedRoles?: (data: { roles: string[]; sourceTaskId: string; docName: string; sourceRole?: string; postContent?: string }) => void;
  /** Channel B — coarse-grained task-level updates for ChatAgent + Frontend sidebar */
  onTaskUpdate?: (update: import("../types/TaskUpdate.js").TaskUpdate) => void;
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

  /** Plugin registry for plugin-based tool assembly */
  private pluginRegistry: PluginRegistry | null = null;

  /** Current team ID */
  private teamId: string | null = null;

  /** Maps role → agent MongoDB _id (for DB skill lookup) */
  private roleAgentIdMap = new Map<string, string>();

  /** Base (non-skill) tools per worker — skills are refreshed per request */
  private workerBaseTools = new Map<string, any[]>();

  /** Callbacks for worker lifecycle events */
  private callbacks: WorkerCallbacks = {};

  /** Shared services for agent-initiated task tools (injected by AgentManager) */
  private taskStore: { getAll(): any[]; get(id: string): any; create(t: any): void; remove(id: string): boolean; updateStatus(id: string, s: string): void } | null = null;
  private dagResolver: { rebuild(source: any): void; validateDependencies?(taskId: string, deps: string[]): string | null } | null = null;
  private teamRoles: string[] = [];
  private crdtTaskSync: {
    persistTask(t: any): Promise<void>;
    syncStatus(id: string, s: string, o?: any): Promise<void>;
    updateIndex(tasks: any[]): Promise<void>;
    updateAgentStatus(role: string, status: 'busy' | 'idle', taskId?: string): Promise<void>;
    initCollabDocs?(taskId: string, config: any): Promise<void>;
    readonly space: any;
  } | null = null;
  private currentGoalId: string | null = null;
  private taskPersistence: any = null;

  /** Resolver for auth token (e.g., GitHub OAuth) — set by AgentManager from user session */
  private authTokenResolver: (() => Promise<string | null>) | null = null;

  /** Set the auth token resolver (called by AgentManager with user session info) */
  setAuthTokenResolver(resolver: () => Promise<string | null>): void {
    this.authTokenResolver = resolver;
  }

  // ===========================================================================
  // Definition Management
  // ===========================================================================

  /**
   * Set plugin registry for plugin-based tool assembly.
   */
  setPluginRegistry(registry: PluginRegistry): void {
    this.pluginRegistry = registry;
    logger.info("PluginRegistry set for WorkerPool");
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
   * Set team ID
   */
  setTeamId(teamId: string): void {
    this.teamId = teamId;
  }

  /**
   * Set shared services for agent-initiated task tools (request_task, bounce_task).
   * Called by AgentManager after orchestrator initialization.
   */
  setTaskServices(services: {
    taskStore: any;
    dagResolver: any;
    teamRoles: string[];
    crdtTaskSync?: any;
    goalId?: string | null;
    taskPersistence?: any;
  }): void {
    this.taskStore = services.taskStore;
    this.dagResolver = services.dagResolver;
    this.teamRoles = services.teamRoles;
    this.crdtTaskSync = services.crdtTaskSync || null;
    this.currentGoalId = services.goalId || null;
    this.taskPersistence = services.taskPersistence || null;
  }

  /**
   * Get the current team ID
   */
  getTeamId(): string | null {
    return this.teamId;
  }

  /**
   * Set callbacks for worker lifecycle events
   */
  setCallbacks(callbacks: WorkerCallbacks): void {
    this.callbacks = callbacks;
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
   * Check if a worker with the given taskId is currently active
   */
  hasActiveWorker(taskId: string): boolean {
    return this.workers.has(taskId);
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
    let taskGoalId: string | undefined;
    let taskRepoUrl: string | undefined;
    let taskRepoBranch: string | undefined;

    if (typeof taskIdOrTask === "string") {
      // Chat mode: simple params
      taskId = taskIdOrTask;
      roleKey = role!.toLowerCase();
      finalMessage = message!;
      // Try to get goalId from TaskStore
      const storedTask = this.taskStore?.get(taskId);
      taskGoalId = storedTask?.goalId;
      taskRepoUrl = storedTask?.context?.repoUrl;
      taskRepoBranch = storedTask?.context?.repoBranch;
    } else {
      // Queue mode: TaskWithContext
      const task = taskIdOrTask;
      taskId = task.id;
      roleKey = task.assigned_role.toLowerCase();
      finalMessage = this.buildMessageWithContext(task);
      // Read from TaskStore (authoritative source — has full context including repoUrl)
      const storedTask = this.taskStore?.get(task.id);
      taskGoalId = storedTask?.goalId || (task as any).goalId;
      taskRepoUrl = storedTask?.context?.repoUrl;
      taskRepoBranch = storedTask?.context?.repoBranch;
      logger.debug(
        `Queue mode: ${taskId} with ${task.context.previousOutputs.length} previous outputs`,
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

      // Assemble task-lifecycle tools (report_status, complete_task, request_task, bounce_task)
      // Resolve goalId from the task itself, not the global scalar
      // Per-task identity — read from TaskStore, not pool-level scalars
      const perTaskData = this.taskStore?.get(taskId);
      const taskPlanId = perTaskData?.planId || perTaskData?.context?.planId || null;

      const { tools: lifecycleTools } = assembleLifecycleTools({
        taskId,
        roleKey,
        callbacks: this.callbacks,
        taskServices: {
          taskStore: this.taskStore,
          dagResolver: this.dagResolver,
          teamRoles: this.teamRoles || [],
          crdtTaskSync: this.crdtTaskSync,
          planId: taskPlanId || null,
          goalId: taskGoalId || null,
          taskPersistence: this.taskPersistence,
          teamId: this.teamId || undefined,
        },
      });
      const additionalTools: any[] = [...lifecycleTools];

      // ── Plugin-based tool assembly ──────────────────────────────────────
      if (this.pluginRegistry) {
        // Resolve auth token for workspace push (e.g., GitHub OAuth)
        let authToken: string | undefined;
        if (taskRepoUrl && this.authTokenResolver) {
          try { authToken = (await this.authTokenResolver()) ?? undefined; } catch { /* best effort */ }
        }

        const toolContext: ToolContext = {
          consumer: "worker",
          role: roleKey,
          taskId,
          goalId: taskGoalId || undefined,
          repoUrl: taskRepoUrl,
          repoBranch: taskRepoBranch,
          authToken,
        };

        // Prepare plugins (e.g. create workspace branch) before resolving tools
        await this.pluginRegistry.prepareForTask(toolContext);

        const pluginTools = this.pluginRegistry.getTools(toolContext);
        additionalTools.push(...pluginTools);

        // Inject plugin skill instructions into agent system prompt
        const skillInstructions = this.pluginRegistry.getSkillInstructions({
          role: roleKey,
          taskId,
        });
        if (skillInstructions.length > 0) {
          agent.appendSystemPrompt(skillInstructions);
        }

        logger.debug(
          `Plugin tools: ${pluginTools.length} tools, ${skillInstructions.length} skills for ${roleKey}`,
        );
      }

      // ── System skill: task-lifecycle (always injected) ─────────────────
      // Core orchestration instructions — report_status, complete_task,
      // request_task, bounce_task, and the missing-context protocol.
      // This reaches ALL agents (plugin-based and generic) since it's
      // injected here, not in any plugin or worker prompt.
      const taskLifecycleInstructions = loadTaskLifecycleSkill();
      if (taskLifecycleInstructions) {
        agent.appendSystemPrompt([taskLifecycleInstructions]);
      }

      // Inject base (non-skill) tools
      const currentTools = (agent as any).loadedTools || {};
      const currentToolsArray = Array.isArray(currentTools) ? currentTools : Object.values(currentTools);
      const baseTools = [...currentToolsArray, ...additionalTools];
      await agent.setTools(baseTools);

      // ── Write identity file to workspace ─────────────────────────────────────────
      // Simple JSON file the agent can read via workspace_read_file(".ping/identity.json")
      if (this.pluginRegistry) {
        const wsPlugin = this.pluginRegistry.get("workspace") as { writeIdentityFile?: (params: any) => Promise<void> } | undefined;
        if (wsPlugin?.writeIdentityFile) {
          try {
            const definition = this.definitions.get(roleKey);
            await wsPlugin.writeIdentityFile({
              taskId,
              role: roleKey,
              name: definition?.name || roleKey,
              goal: definition?.goal || `Execute ${roleKey} tasks`,
              skills: (definition?.config as any)?.skills,
              teamId: this.teamId,
              teamRoles: this.teamRoles,
            });
          } catch (err) {
            logger.debug(`Identity file write skipped for ${taskId}: ${err}`);
          }
        }
      }

      // Store base tools for per-request skill refresh
      this.workerBaseTools.set(taskId, baseTools);
      this.workers.set(taskId, agent);
      this.workerRoles.set(taskId, roleKey);
      logger.info(
        `Created worker: ${taskId} (${roleKey}) with ${additionalTools.length} additional tools`,
      );
    }

    // Skills are loaded via PluginRegistry — no per-request DB refresh needed

    // Execute and stream events
    let output: any = null;

    if (!agent) {
      throw new Error(`Worker for task ${taskId} was not created`);
    }

    try {
      // CRDT: mark agent as busy
      if (this.crdtTaskSync) {
        this.crdtTaskSync.updateAgentStatus(roleKey, 'busy', taskId).catch(() => {});
      }

      const input: AgentInput = {
        message: finalMessage,
        threadId: taskId, // Use taskId as thread for conversation continuity
      };

      // Channel B: emit "started"
      const role = this.workerRoles.get(taskId) || roleKey;
      this.callbacks.onTaskUpdate?.({ type: "started", taskId, role, ts: Date.now() });

      let stepCount = 0;
      let totalTokens = 0;
      const PROGRESS_INTERVAL = 3; // Emit progress every N steps

      for await (const event of agent.execute(input)) {
        // Forward stream_part events directly on onStream callback
        if (event.type === "stream_part") {
          this.callbacks.onStream?.({
            taskId,
            agentId: roleKey,
            part: event.part,
            goalId: taskGoalId,
          });

          // Channel B: synthesize from stream_part subtypes
          const part = event.part;
          if (part?.type === "finish-step") {
            stepCount++;
            totalTokens += part.usage?.totalTokens || 0;
            // Emit progress every N steps
            if (stepCount % PROGRESS_INTERVAL === 0) {
              this.callbacks.onTaskUpdate?.({
                type: "progress", taskId, role,
                note: `Step ${stepCount}`,
                stepIdx: stepCount,
                tokensSoFar: totalTokens,
                ts: Date.now(),
              });
            }
          } else if (part?.type === "tool-output-available") {
            // Check if this is a milestone tool
            const toolName = part.toolName || "";
            const { MILESTONE_TOOLS } = await import("../types/TaskUpdate.js");
            if (MILESTONE_TOOLS.has(toolName)) {
              this.callbacks.onTaskUpdate?.({
                type: "tool_milestone", taskId, role,
                tool: toolName,
                summary: typeof part.output === "string" ? part.output.slice(0, 200) : JSON.stringify(part.output).slice(0, 200),
                ts: Date.now(),
              });
            }
          }

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

          // Channel B: emit "completed"
          this.callbacks.onTaskUpdate?.({
            type: "completed", taskId, role,
            summary: typeof output === "string" ? output.slice(0, 500) : "Task completed",
            ts: Date.now(),
          });
        }

        if (event.type === "error") {
          this.callbacks.onError?.({ taskId, error: event.error });

          // Channel B: emit "failed"
          this.callbacks.onTaskUpdate?.({
            type: "failed", taskId, role,
            error: event.error || "Unknown error",
            ts: Date.now(),
          });
        }
      }
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.callbacks.onError?.({ taskId, error: msg });

      // Channel B: emit "failed" on exception
      const role = this.workerRoles.get(taskId) || roleKey;
      this.callbacks.onTaskUpdate?.({
        type: "failed", taskId, role,
        error: msg,
        ts: Date.now(),
      });

      throw error;
    } finally {
      // CRDT: mark agent as idle
      if (this.crdtTaskSync) {
        this.crdtTaskSync.updateAgentStatus(roleKey, 'idle', taskId).catch(() => {});
      }
    }

    return output;
  }

  // ===========================================================================
  /**
   * Get the full ModelMessage[] from a worker agent (for context persistence).
   * Returns null if worker not found or already disposed.
   */
  getAgentMessages(taskId: string): any[] | null {
    const agent = this.workers.get(taskId);
    if (!agent) return null;
    return agent.getMessages();
  }

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
      logger.info(`Disposed: ${taskId}`);
    }
  }

  /**
   * Check if workspace support is enabled (via plugins)
   */
  isWorkspaceEnabled(): boolean {
    return this.pluginRegistry !== null;
  }

  /**
   * Dispose all workers
   */
  async disposeAll(): Promise<void> {
    await Promise.all(
      Array.from(this.workers.keys()).map((id) => this.dispose(id)),
    );
    // Fix #4: Clear all Maps to prevent memory leaks from orphaned tasks
    this.workerBaseTools.clear();
    // Fix #16: Clear stale task service references
    this.taskStore = null;
    this.dagResolver = null;
    this.crdtTaskSync = null;
  }

  /**
   * Dispose workers for a specific goal's tasks only (Phase 4).
   * Other goals' workers are preserved.
   */
  async disposeByGoal(goalId: string): Promise<void> {
    const toDispose: string[] = [];
    for (const [taskId, worker] of this.workers) {
      // Check if this worker's task belongs to the given goal
      const task = this.taskStore?.get(taskId);
      if (task?.goalId === goalId) {
        toDispose.push(taskId);
      }
    }
    await Promise.all(toDispose.map((id) => this.dispose(id)));
    logger.info(`Disposed ${toDispose.length} workers for goal ${goalId}`);
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
   * Build message with DocumentRef-based context from dependencies.
   * Agents read actual content via collab read / workspace_read_file — no raw summaries injected.
   */
  private buildMessageWithContext(task: TaskWithContext): string {
    let msg = task.description;
    const ctx = task.context as any;

    // Input Documents (DocumentRefs from upstream producedDocs)
    const inputDocs = Array.isArray(ctx.inputDocs) ? ctx.inputDocs : [];
    if (inputDocs.length > 0) {
      msg += `\n\n## Input Documents`;
      msg += `\nThese documents were produced by upstream tasks. Read them for context:`;
      for (const doc of inputDocs) {
        const scheme = doc.uri?.startsWith("crdt:") ? "collab read" : doc.uri?.startsWith("workspace:") ? "workspace_read_file" : "fetch";
        const path = doc.uri?.replace(/^(crdt:|workspace:)/, "") || doc.uri;
        msg += `\n- **${doc.name}**: \`${scheme} ${path}\`${doc.description ? ` — ${doc.description}` : ""}`;
      }
    }

    // Upstream Decisions
    const decisions = Array.isArray(ctx.upstreamDecisions) ? ctx.upstreamDecisions : [];
    if (decisions.length > 0) {
      msg += `\n\n## Upstream Decisions`;
      for (const d of decisions) {
        msg += `\n- ${d}`;
      }
    }

    // Workspace artifacts (file paths)
    if (task.context.artifacts.length > 0) {
      msg += `\n\n## Workspace Files`;
      msg += `\nFiles from upstream tasks (already merged to your workspace):`;
      msg += `\n${task.context.artifacts.join("\n")}`;
      msg += `\nUse \`workspace_list_files\` to see all available files.`;
    }

    return msg;
  }
}
