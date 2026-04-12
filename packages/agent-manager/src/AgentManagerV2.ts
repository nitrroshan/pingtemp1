/**
 * AgentManager - Orchestrator using PlannerAgent + TaskStore + WorkerPool
 *
 * Flow:
 * 1. User sends goal → PlannerAgent (cognitive workflow)
 * 2. PlannerAgent calls submit_plan → OrchestratorService (reactive runtime)
 * 3. OrchestratorService dispatches tasks → WorkerPool → AiSdkAgent workers
 * 4. Workers stream results → SocketServerV2 → Frontend
 *
 * Events are forwarded from WorkerPool for Socket.IO integration.
 */

import { rootLogger } from "./logging.js";
import { getAgentFactory } from "./agent/AgentFactory.js";
import { WorkerPool } from "./services/WorkerPool.js";
import { RoleTaskQueue } from "./util/RoleTaskQueue.js";
import { AiSdkAgent } from "./agent/internal/AiSdkAgent.js";
import type { AgentDefinition } from "./agent/types.js";
import type { TaskWithContext } from "./util/RoleTaskQueue.types.js";
import { OrchestratorService } from "./orchestrator/OrchestratorService.js";
import type { PlanProposedEvent } from "./orchestrator/types.js";
import { TaskStore } from "./orchestrator/TaskStore.js";
import { DependencyResolver } from "./orchestrator/DependencyResolver.js";
import { PlannerAgent } from "./orchestrator/PlannerAgent.js";
import { UserInteractionManager } from "./orchestrator/UserInteractionManager.js";
import { NotificationQueue } from "./orchestrator/NotificationQueue.js";
import { createPlannerTools } from "./orchestrator/tools/index.js";
import { PluginRegistry } from "./plugin/PluginRegistry.js";
import type { IPlugin } from "./plugin/types.js";
import { FileTaskStore } from "./persistence/FileTaskStore.js";

const logger = rootLogger.child({ module: "AgentManager" });

export interface ManagerStreamCallbacks {
  onStream?: (data: { taskId: string; agentId: string; part: any }) => void;
  onEvent?: (data: { taskId: string; event: any }) => void;
  onDone?: (data: { taskId: string; role: string; output: any }) => void;
  onError?: (data: { taskId: string; error: string }) => void;
  onTaskUpdate?: (data: { taskId: string; status: string; role?: string; output?: any }) => void;
  onPlanUpdate?: (data: { action: string; tasksQueued?: number; timestamp: number }) => void;
  onPlanProposed?: (data: PlanProposedEvent) => void;
}

/**
 * Task from plan builder
 */
interface PlannedTask {
  id: string;
  title: string;
  description: string;
  assignedRole: string;
  priority: number;
  dependencies: string[];
}

/**
 * Execution plan from plan builder
 */
interface TaskPlan {
  tasks: PlannedTask[];
  rationale?: string;
}

/**
 * Generic worker prompt for agents without plugin-sourced system prompts.
 * Used as fallback when a team is created via LLM role discovery (no plugin).
 */
function getGenericWorkerPrompt(role: string): string {
  return `You are a **${role}** agent in a multi-agent team. Execute tasks assigned to your role with expertise and precision.

## Your Tools

You have been provided with a set of tools. Some are always available, others may vary by task. Use \`my_tools\` to see the full list at any time.

### Always Available — Core Workflow

| Tool | Purpose |
|------|---------|
| **report_status** | Send a status update (progress %, blockers, notes). Use frequently so the orchestrator can track you. |
| **complete_task** | Signal that your task is finished. Provide a short summary. Call this when done — do NOT simply stop responding. |

### Workspace — File & Version Control

You work inside a **git-based workspace** (a branch isolated to your task). Key tools:

- **workspace_create_file / workspace_write_file** — create or overwrite files. Always supply the full file content.
- **workspace_read_file** — read a file from your workspace.
- **workspace_list_files** — list files/directories. Use this to orient yourself.
- **workspace_delete_file / workspace_file_exists** — manage files.
- **workspace_grep / workspace_glob / workspace_keyword_search** — search across files. Use before duplicating work.
- **workspace_search_and_replace** — regex-powered find-and-replace within a file.
- **workspace_commit** — commit your changes with a clear message. **Commit frequently** (after each logical step).
- **workspace_publish** — publish your workspace when the task is complete (called automatically by complete_task, but you can call manually if needed).
- **workspace_status / workspace_info** — check current workspace state and branch info.
- **workspace_get_history** — view commit log.
- **workspace_file_stats** — file sizes/counts for planning.

### Scratchpad — Private Working Memory

- **scratch_note** — jot down private notes or reasoning (not shared).
- **scratch_todo** — track your internal subtask checklist.
- **scratch_remember** — store a key-value fact for later recall.
- **scratch_file** — save a scratch file (draft, temp data).
- **promote_to_workspace** — move a scratch file into your real workspace when it's ready.

### Collaboration — Shared Team State (L2)

- **collab** — access shared CRDT documents that all agents can read and write.
  - \`discover\` → browse categories: \`crdt\`, \`plans\`, \`outputs\`
  - \`list\` → see keys in a doc (structured data keys)
  - \`read\` → fetch a key's value (structured JSON from Y.Map)
  - \`read-block\` → **read the editor content** — returns text written by humans and agents in the collaborative editor
  - \`write\` → set structured JSON data (for agent-statuses, configs, machine-readable data)
  - \`write-block\` → **preferred for shared documents** — insert rich text (headings, paragraphs, bullets) into the collaborative editor visible to humans and other agents

  **When to use which:**
  - Use \`write\` for: \`agent-statuses\` (status updates), structured configs, API contracts (JSON data)
  - Use \`write-block\` for: reports, research findings, specs, summaries — anything meant to be **read by humans or other agents as text**
  - Use \`read\` for: reading structured JSON data (agent-statuses, configs)
  - Use \`read-block\` for: **reading the collaborative document** — see what humans typed and what other agents wrote via write-block
  - \`write-block\` supports markdown: \`# Heading\`, \`## Subheading\`, \`- bullet points\`, plain paragraphs
  - Use \`key\` parameter as a section title (e.g., key: "Research Findings")

  **Use collab to:**
  - Report blockers or issues to the team (\`write\` to \`agent-statuses\` doc with your role as key)
  - Share research, analysis, or summaries (\`write-block\` to a shared doc like \`crdt\` or a custom doc)
  - **Read the shared document** (\`read-block\` on \`crdt\` or any doc) — see what humans and other agents wrote
  - Read decisions from \`chat-outcomes\`
  - Check what other agents have produced (\`outputs\` category)
  - Create new shared docs by writing to any name — auto-created on first use

### Identity

- **who_am_i** — your role, task ID, workspace info.
- **my_progress** — your commit history and activity summary.
- **my_tools** — full list of available tools with descriptions.
- **my_context** — task context, notes, and prerequisites.

## Guidelines

1. **Start** by reading your task context (\`my_context\`) and checking existing workspace files (\`workspace_list_files\`).
2. **Plan** your approach — use \`scratch_todo\` to break the task into steps.
3. **Execute** — create/edit files, commit after each meaningful change.
4. **Collaborate** — share findings with the team using \`collab write-block\` (preferred for text content). Use \`collab write\` only for structured data like \`agent-statuses\`.
5. **Report** — call \`report_status\` periodically (especially before and after major steps).
6. **Finish** — call \`complete_task\` with a summary when done. Never just stop.

Do NOT invent tools you don't have. If unsure, use \`my_tools\` to check.
`;
}

export class AgentManager {
  private workerPool: WorkerPool;
  private definitions: AgentDefinition[] = [];
  private plan: TaskPlan | null = null;

  /** Central task queue for role-based execution with approval flow */
  private taskQueue = new RoleTaskQueue();

  /** Task outputs for dependency injection */
  private taskOutputs = new Map<string, any>();

  /** Stream callbacks registered by SocketServerV2 */
  private streamCallbacks: ManagerStreamCallbacks | null = null;

  // Orchestrator mode properties
  private orchestrator: OrchestratorService | null = null;
  private taskStoreInstance: TaskStore | null = null;
  private plannerAgent: PlannerAgent | null = null;
  private userInteractionManager: UserInteractionManager | null = null;
  private filePersistence: FileTaskStore | null = null;
  private pluginRegistry: PluginRegistry = new PluginRegistry();
  private teamId: string = "default";

  /** Roles with auto-approve enabled - tasks start immediately without manual approval */
  private autoApproveRoles = new Set<string>();
  /** Global auto-approve flag - when true, all roles auto-approve */
  private autoApproveAll = false;

  constructor() {
    this.workerPool = new WorkerPool();
    this.setupCompletionHandler();

    logger.info(`AgentManager initialized`);
  }

  /**
   * Register a plugin with the agent manager.
   * Call this before initializeOrchestrator().
   */
  registerPlugin(plugin: IPlugin): void {
    this.pluginRegistry.register(plugin);
  }

  /** Get the plugin registry */
  getPluginRegistry(): PluginRegistry {
    return this.pluginRegistry;
  }

  /**
   * Register stream callbacks for real-time event delivery (used by SocketServerV2)
   */
  registerStreamCallbacks(callbacks: ManagerStreamCallbacks): void {
    this.streamCallbacks = callbacks;
  }

  // ===========================================================================
  // Orchestrator Mode API
  // ===========================================================================

  /**
   * Initialize orchestrator mode for a team
   * Call this before using orchestrator features
   *
   * @param teamId - Team identifier
   * @param teamRoles - Array of role names (lowercase)
   * @param roleAgentIdMap - Optional mapping of role → agent DB ID
   * @param agentData - Optional array of agent records with systemPrompt, goal, pluginConfig
   *                     (from DB, populated when team was created from a plugin)
   */
  async initializeOrchestrator(
    teamId: string,
    teamRoles: string[],
    roleAgentIdMap?: Record<string, string>,
    agentData?: Array<{ role: string; name: string; goal?: string; systemPrompt?: string; pluginConfig?: string }>,
  ): Promise<void> {
    this.teamId = teamId;

    // Initialize file-based task persistence (survives restarts)
    this.filePersistence = new FileTaskStore(teamId);
    await this.filePersistence.load();

    const workspaceDir = process.env.WORKSPACE_BASE_DIR || "./data/workspaces";
    const teamRepoPath = `${workspaceDir}/${teamId}`;

    // Initialize all registered plugins
    await this.pluginRegistry.initializeAll();
    logger.info(`[AgentManager] ${this.pluginRegistry.list().length} plugins initialized`);

    // Create worker agent definitions for team roles
    // When agentData is available (plugin-based teams), use custom systemPrompt + config.
    // Otherwise, fall back to generic prompt + default Azure config.
    logger.info(
      `[AgentManager] Creating worker definitions for roles: ${teamRoles.join(", ")}`,
    );

    // Build a lookup from agentData (if provided)
    const agentDataMap = new Map<string, { name: string; goal?: string; systemPrompt?: string; pluginConfig?: string }>();
    if (agentData) {
      for (const ad of agentData) {
        agentDataMap.set(ad.role.toLowerCase(), ad);
      }
    }

    const workerDefinitions: AgentDefinition[] = teamRoles.map((role) => {
      const roleKey = role.toLowerCase();
      const ad = agentDataMap.get(roleKey);

      // If we have plugin data with a custom system prompt, use it
      if (ad?.systemPrompt) {
        let config: any = {
          model: {
            provider: "azure-openai" as const,
            deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-2",
            temperature: 0.7,
            maxTokens: 4096,
          },
          tools: [],
        };

        // Override config from plugin definition (model, tools, skills, etc.)
        if (ad.pluginConfig) {
          try {
            const parsed = JSON.parse(ad.pluginConfig);
            config = { ...config, ...parsed };
          } catch {
            logger.warn(`[AgentManager] Failed to parse pluginConfig for ${roleKey}`);
          }
        }

        return {
          id: roleKey,
          name: ad.name || role,
          role: roleKey,
          type: "internal" as const,
          goal: ad.goal || `Execute ${role} tasks`,
          systemPrompt: ad.systemPrompt,
          config,
        };
      }

      // Fallback: generic prompt for non-plugin agents
      return {
        id: roleKey,
        name: role,
        role: roleKey,
        type: "internal" as const,
        goal: `Execute ${role} tasks`,
        systemPrompt: getGenericWorkerPrompt(role),
        config: {
          model: {
            provider: "azure-openai" as const,
            deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-2",
            temperature: 0.7,
            maxTokens: 4096,
          },
          tools: [],
        },
      };
    });

    // Register worker definitions with WorkerPool
    this.workerPool.registerDefinitions(workerDefinitions);
    if (roleAgentIdMap) {
      this.workerPool.setRoleAgentIdMap(roleAgentIdMap);
    }
    logger.info(
      `[AgentManager] Registered ${workerDefinitions.length} worker definitions`,
    );

    // Inject PluginRegistry into WorkerPool (plugin-based tool assembly)
    this.workerPool.setPluginRegistry(this.pluginRegistry);
    logger.info("[AgentManager] PluginRegistry injected into WorkerPool");

    // Workspace is enabled via plugins (WorkspacePlugin handles L1 git isolation)

    // Get PlanStore from L2 plugin (if registered) to inject into OrchestratorService
    const collabStorage = this.pluginRegistry.getPluginStorage("collaboration");
    const planStore = collabStorage?.planStore as any;

    // SOLID architecture — TaskStore + OrchestratorService + PlannerAgent as peers
    this.taskStoreInstance = new TaskStore();
    const dagResolver = new DependencyResolver();

    // Session ID for planner conversation thread
    const sessionId = `team-${teamId}`;

    // Planner callback — extracted so NotificationQueue and direct callbacks share it
    const executePlannerTurn = async (message: string) => {
      if (!this.plannerAgent) return;
      try {
        const agent = this.plannerAgent.getAgent();
        for await (const event of agent.execute({ message, threadId: sessionId })) {
          if (event.type === "stream_part") {
            this.streamCallbacks?.onStream?.({
              taskId: sessionId,
              agentId: "planner",
              part: event.part,
            });
          }
        }
      } catch (err) {
        console.error("[AgentManager] Planner execution error:", err);
      }
    };

    // NotificationQueue: batches rapid task events (5 completions in 100ms → 1 planner turn)
    const notificationQueue = new NotificationQueue({
      debounceMs: 100,
      onFlush: (batchedMessage) => executePlannerTurn(batchedMessage),
    });

    // Create OrchestratorService (reactive runtime)
    this.orchestrator = new OrchestratorService({
      teamId,
      teamRoles,
      taskStore: this.taskStoreInstance,
      workerPool: this.workerPool,
      dagResolver,
      notificationQueue,
      planStore,
      pluginRegistry: this.pluginRegistry,
      autoExecute: false,
      callbacks: {
        onStream: (data) => this.streamCallbacks?.onStream?.(data),
        onEvent: (data) => this.streamCallbacks?.onEvent?.(data),
        onDone: (data) => this.streamCallbacks?.onDone?.(data),
        onError: (data) => this.streamCallbacks?.onError?.(data),
        onTaskUpdate: (data) => this.streamCallbacks?.onTaskUpdate?.(data),
        onPlanProposed: (data) => {
          this.streamCallbacks?.onPlanProposed?.(data);
          // Auto-approve: planner already consulted user via natural chat
          this.approveOrchestratorPlan().catch((err) => {
            console.error("[AgentManager] Auto-approve failed:", err);
          });
        },
        // Wire onPlannerInput → PlannerAgent.execute() (new turn)
        // Used for user messages (bypasses NotificationQueue for immediate response)
        onPlannerInput: (message) => executePlannerTurn(message),
      },
    });

    await this.orchestrator.initialize();

    // Create PlannerAgent (peer to OrchestratorService)
    const agentFactory = getAgentFactory();

    this.plannerAgent = new PlannerAgent({
      agentFactory,
      teamRoles,
      teamId,
    });
    await this.plannerAgent.initialize();

    // Create and inject planner tools (close over shared services)
    const orchestratorContext = {
      memoryManager: this.taskStoreInstance as any, // TaskStore satisfies the interface
      callbacks: this.orchestrator.getCallbacks(),
      planStore,
      teamId,
      currentGoalId: null,
      teamRoles,
      planBuilder: { invoke: async () => { throw new Error("PlanBuilder not used"); } },
      getState: () => this.orchestrator!.getState(),
      setState: (state: any) => this.orchestrator!.setState(state),
      getPendingPlan: () => this.orchestrator!.getPendingPlan(),
      setPendingPlan: (plan: any) => this.orchestrator!.setPendingPlan(plan),
    };

    const tools = createPlannerTools({
      orchestratorContext,
      agentFactory,
      dagResolver,
      onMutation: (event) => {
        this.streamCallbacks?.onTaskUpdate?.({
          taskId: "plan",
          status: "mutation",
          ...event,
        });
      },
    });
    await this.plannerAgent.setTools(tools);

    logger.info(`[AgentManager] PlannerAgent + OrchestratorService + TaskStore initialized`);
  }

  /**
   * Set auto-execute mode for tasks
   * When disabled, tasks wait for manual approval via approveTaskForChat()
   * @param enabled - true to auto-execute tasks, false to require manual approval
   */
  setAutoExecute(enabled: boolean): void {
    if (!this.orchestrator) {
      logger.warn(
        "[AgentManager] Orchestrator not initialized. Auto-execute setting ignored.",
      );
      return;
    }
    this.orchestrator.setAutoExecute(enabled);
    logger.info(
      `[AgentManager] Auto-execute mode: ${enabled ? "enabled" : "disabled"}`,
    );
  }

  /**
   * Get current auto-execute mode
   */
  getAutoExecute(): boolean {
    return this.orchestrator?.getAutoExecute() ?? true;
  }

  /**
   * Manually dispatch a ready task (used when autoExecute is OFF)
   */
  async manualDispatchTask(taskId: string): Promise<void> {
    if (!this.orchestrator) {
      throw new Error("Orchestrator not initialized");
    }
    await this.orchestrator.manualDispatch(taskId);
  }

  // ===========================================================================
  // Auto-Approve API
  // ===========================================================================

  /**
   * Enable/disable auto-approve for a specific role
   * When enabled, tasks assigned to this role are automatically approved and started
   * @param role - Role name (case-insensitive)
   * @param enabled - true to auto-approve, false to require manual approval
   */
  setAutoApproveForRole(role: string, enabled: boolean): void {
    const normalizedRole = role.toLowerCase();
    if (enabled) {
      this.autoApproveRoles.add(normalizedRole);
      logger.info(
        `[AgentManager] Auto-approve enabled for role: ${normalizedRole}`,
      );
    } else {
      this.autoApproveRoles.delete(normalizedRole);
      logger.info(
        `[AgentManager] Auto-approve disabled for role: ${normalizedRole}`,
      );
    }
  }

  /**
   * Enable/disable auto-approve for ALL roles
   * When enabled, all tasks are automatically approved and started without manual approval
   * @param enabled - true to auto-approve all, false to use per-role settings
   */
  setAutoApproveAllRoles(enabled: boolean): void {
    this.autoApproveAll = enabled;
    logger.info(
      `[AgentManager] Auto-approve ALL roles: ${enabled ? "enabled" : "disabled"}`,
    );
  }

  /**
   * Check if auto-approve is enabled for a role
   */
  isAutoApproveEnabled(role: string): boolean {
    return this.autoApproveAll || this.autoApproveRoles.has(role.toLowerCase());
  }

  /**
   * Get list of roles with auto-approve enabled
   */
  getAutoApproveRoles(): string[] {
    if (this.autoApproveAll) {
      return ["*"]; // Indicates all roles
    }
    return Array.from(this.autoApproveRoles);
  }

  /**
   * Try to auto-approve and start a task if auto-approve is enabled for its role
   * Called internally when tasks are created/ready
   * @returns true if task was auto-started, false if manual approval required
   */
  private async tryAutoApproveTask(taskId: string): Promise<boolean> {
    if (!this.taskStoreInstance) return false;

    const task = this.taskStoreInstance.get(taskId);
    if (!task) return false;

    // Check if auto-approve is enabled for this role
    if (!this.isAutoApproveEnabled(task.assigned_role)) {
      return false;
    }

    // Skip if already in progress or completed
    if (task.status === "in_progress" || task.status === "completed") {
      return false;
    }

    logger.info(
      `[AutoApprove] Auto-approving task ${taskId} for role ${task.assigned_role}`,
    );

    try {
      // Approve for chat (moves to ready)
      if (task.status !== "ready") {
        this.approveTaskForChat(taskId);
      }

      // Start execution immediately
      await this.startTaskExecution(taskId);

      logger.info(
        `[AutoApprove] Task ${taskId} auto-started for role ${task.assigned_role}`,
      );
      return true;
    } catch (error) {
      logger.error(
        `[AutoApprove] Failed to auto-start task ${taskId}: ${error}`,
      );
      return false;
    }
  }

  /**
   * Send message to orchestrator (conversational planning mode)
   * Returns orchestrator's response
   */
  async orchestratorMessage(content: string): Promise<string> {
    if (!this.orchestrator) {
      throw new Error(
        "Orchestrator not initialized. Call initializeOrchestrator() first.",
      );
    }
    return this.orchestrator.handleMessage(content);
  }

  /**
   * Approve the pending plan (triggers task creation in TaskStore)
   * After tasks are created, auto-approve will be checked for each task
   */
  async approveOrchestratorPlan(): Promise<{
    success: boolean;
    tasksQueued?: number;
    autoStarted?: number;
    error?: string;
  }> {
    if (!this.orchestrator) {
      return { success: false, error: "Orchestrator not initialized" };
    }
    const result = await this.orchestrator.approvePlan();

    // Emit plan:update callback for socket broadcast
    if (result.success) {
      this.streamCallbacks?.onPlanUpdate?.({
        action: "approved",
        tasksQueued: result.tasksQueued,
        timestamp: Date.now(),
      });
    }

    // If tasks were queued, check for auto-approve
    if (result.success && result.tasksQueued && result.tasksQueued > 0) {
      const autoStarted = await this.processAutoApproveTasks();
      return { ...result, autoStarted };
    }

    return result;
  }

  /**
   * Process all pending tasks and auto-start those with auto-approve enabled
   * @returns Number of tasks that were auto-started
   */
  private async processAutoApproveTasks(): Promise<number> {
    if (!this.taskStoreInstance) return 0;

    const allTasks = this.taskStoreInstance.getAllTasks();
    let autoStarted = 0;

    for (const task of allTasks) {
      // Only process tasks that are pending/ready and not yet in progress
      if (task.status === "pending" || task.status === "ready") {
        const wasAutoStarted = await this.tryAutoApproveTask(task.id);
        if (wasAutoStarted) autoStarted++;
      }
    }

    if (autoStarted > 0) {
      logger.info(`[AutoApprove] Auto-started ${autoStarted} tasks`);
    }

    return autoStarted;
  }

  /**
   * Get orchestrator state
   */
  getOrchestratorState(): string | null {
    return this.orchestrator?.getState() ?? null;
  }

  /**
   * Get pending plan from orchestrator
   */
  getOrchestratorPendingPlan(): any | null {
    return this.orchestrator?.getPendingPlan() ?? null;
  }

  /**
   * Check if orchestrator mode is enabled
   */
  get isOrchestratorMode(): boolean {
    return true;
  }

  /**
   * Get memory manager (deprecated — returns null, use getTaskStore())
   */
  getMemoryManager(): null {
    return null;
  }

  /**
   * Get TaskStore (for task execution monitoring — agent mode)
   */
  getTaskStore(): TaskStore | null {
    return this.taskStoreInstance;
  }

  /**
   * Get UserInteractionManager (for routing user responses to pending ask_user calls)
   */
  getUserInteractionManager(): UserInteractionManager | null {
    return this.userInteractionManager;
  }

  /**
   * Get memory coordinator (for full memory access including knowledge)
   */


  /**
   * Get workspace for a running task (for inspection/testing)
   * Returns undefined if workspace is not enabled or task has no workspace
   */
  getTaskWorkspace(
    taskId: string,
  ):
    any | undefined {
    const wsPlugin = this.pluginRegistry.get("workspace");
    return wsPlugin?.getStorage?.()?.manager?.getWorkspace?.(taskId);
  }

  /**
   * Check if workspace support is enabled
   */
  isWorkspaceEnabled(): boolean {
    return this.workerPool.isWorkspaceEnabled();
  }

  /**
   * Check if knowledge base is available
   */
  hasKnowledgeBase(): boolean {
    return this.pluginRegistry.get("knowledge") !== undefined;
  }

  // ===========================================================================
  // Task Lifecycle API (v2 - user-driven completion)
  // ===========================================================================

  /**
   * Approve a task - moves from proposed → ready, allows user to start chatting
   * This is the v2 approval that enables direct chat, NOT auto-execution
   */
  approveTaskForChat(taskId: string): { taskId: string; role: string } {
    if (!this.taskStoreInstance) {
      throw new Error("TaskStore not initialized");
    }

    const task = this.taskStoreInstance.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // Update status to ready (approved, awaiting user to start chat)
    this.taskStoreInstance.updateStatus(taskId, "ready");
    this.filePersistence?.updateStatus(taskId, "ready");
    logger.info(
      `Task ${taskId} approved for chat with role: ${task.assigned_role}`,
    );

    return { taskId, role: task.assigned_role };
  }

  /**
   * Start a task - actually begins agent execution for an approved task
   * Returns the task ID and initial response from the agent
   */
  async startTaskExecution(
    taskId: string,
  ): Promise<{ taskId: string; role: string; response: string }> {
    if (!this.taskStoreInstance) {
      throw new Error("TaskStore not initialized");
    }

    const task = this.taskStoreInstance.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status !== "ready" && task.status !== "in_progress") {
      throw new Error(
        `Task ${taskId} is not ready (status: ${task.status}). Approve it first with approveTaskForChat()`,
      );
    }

    // If already auto-dispatched and has a response, return it instead of re-dispatching
    if (task.status === "in_progress") {
      const existingResponse = this.workerPool.getLastResponse(taskId);
      if (existingResponse) {
        logger.info(
          `Task ${taskId} already dispatched (auto-exec), returning existing response`,
        );
        this.taskRoles.set(taskId, task.assigned_role);
        return {
          taskId,
          role: task.assigned_role,
          response:
            typeof existingResponse === "string"
              ? existingResponse
              : JSON.stringify(existingResponse),
        };
      }
    }

    // Mark as in_progress
    if (task.status !== "in_progress") {
      this.taskStoreInstance.updateStatus(taskId, "in_progress");
      this.filePersistence?.updateStatus(taskId, "in_progress");
    }
    logger.info(`Task ${taskId} execution started`);

    // Get structured context from task
    const taskContext = (task.context || {}) as Record<string, any>;

    // Create TaskWithContext for WorkerPool
    const taskWithContext = {
      id: taskId,
      assigned_role: task.assigned_role,
      description: task.description,
      priority: (task as any).priority || 0,
      context: {
        previousOutputs: Array.isArray(taskContext.upstreamOutputs) ? taskContext.upstreamOutputs : [],
        artifacts: [
          ...(Array.isArray(taskContext.files) ? taskContext.files : []),
          ...(Array.isArray(taskContext.artifacts) ? taskContext.artifacts : []),
        ],
      },
      createdAt: Date.now(),
      status: "in_progress" as const,
    };

    // Start the task in WorkerPool
    const output = await this.workerPool.runTask(taskWithContext);

    this.taskRoles.set(taskId, task.assigned_role);

    this.streamCallbacks?.onTaskUpdate?.({
      taskId,
      status: "in_progress",
      role: task.assigned_role,
    });

    return {
      taskId,
      role: task.assigned_role,
      response: typeof output === "string" ? output : JSON.stringify(output),
    };
  }

  /**
   * Complete a task - user marks task done, unlocks dependents
   * Called when user is satisfied with agent's work
   * Also merges workspace branch if workspace is enabled
   */
  async completeTaskByUser(
    taskId: string,
    output?: any,
  ): Promise<{ success: boolean; mergeError?: string }> {
    if (!this.taskStoreInstance) {
      throw new Error("TaskStore not initialized");
    }

    const task = this.taskStoreInstance.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    // If no output provided, use last response from worker
    const finalOutput = output ?? this.getLastWorkerResponse(taskId);

    // Merge workspace branch first (if enabled)
    const mergeResult = await this.pluginRegistry.onTaskComplete(taskId);
    if (!mergeResult.success) {
      logger.warn(`Plugin onTaskComplete failed for task ${taskId}: ${mergeResult.error}`);
      // Continue with completion but include merge error
    }

    // Complete task via TaskStore
    this.taskStoreInstance.completeTask(taskId, finalOutput);
    this.filePersistence?.updateStatus(taskId, "completed");
    this.filePersistence?.setOutput(taskId, finalOutput);

    logger.info(
      `Task ${taskId} completed by user${mergeResult.error ? " (merge failed)" : ""}`,
    );

    this.streamCallbacks?.onTaskUpdate?.({
      taskId,
      status: "completed",
      role: task.assigned_role,
      output: finalOutput,
    });

    return {
      success: true,
      ...(mergeResult.error && { mergeError: mergeResult.error }),
    };
  }

  /**
   * Get the last response from a worker (for task completion)
   */
  private getLastWorkerResponse(taskId: string): any {
    // WorkerPool stores workers by taskId
    return this.workerPool.getLastResponse(taskId);
  }

  // ===========================================================================
  // Workflow Status API
  // ===========================================================================

  /**
   * Get current workflow status
   */
  getWorkflowStatus(): {
    state: "idle" | "planning" | "awaiting_approval" | "executing";
    pendingTasks: number;
    activeTasks: number;
    completedTasks: number;
    currentPlan?: string;
  } {
    const orchestratorState = this.getOrchestratorState();

    let state: "idle" | "planning" | "awaiting_approval" | "executing" = "idle";
    if (orchestratorState === "planning") state = "planning";
    else if (orchestratorState === "awaiting_approval")
      state = "awaiting_approval";
    else if (orchestratorState === "executing") state = "executing";

    const metrics = this.taskQueue.getMetrics();

    const planId = this.orchestrator?.getPendingPlan()?.planId;

    return {
      state,
      pendingTasks: metrics.tasksQueued,
      activeTasks: this.workerPool.workerCount,
      completedTasks: metrics.tasksCompleted,
      ...(planId && { currentPlan: planId }),
    };
  }

  /**
   * Get active agents/workers
   */
  getActiveAgents(): Array<{ role: string; taskId: string; status: string }> {
    const workers = this.workerPool.getActiveWorkers();
    return workers.map((w) => ({
      role: w.role,
      taskId: w.taskId,
      status: w.status,
    }));
  }

  // ===========================================================================
  // Team & Task Management API (v2)
  // ===========================================================================

  /**
   * Discover roles needed for a task without side effects
   * Pure function that returns role definitions based on task analysis
   *
   * @param taskDescription - Description of work to be done
   * @returns Array of suggested agent definitions
   */
  async discoverRoles(taskDescription: string): Promise<AgentDefinition[]> {
    logger.info(`Discovering roles for: "${taskDescription.slice(0, 80)}..."`);

    const factory = getAgentFactory();
    const builder = factory.getDefinitionBuilder() as AiSdkAgent;
    await builder.initialize();

    const result = await builder.run(
      `Design a team of AI agents for: ${taskDescription}`,
    );

    if (!result?.definitions) {
      throw new Error("DefinitionBuilder failed to produce definitions");
    }

    logger.info(`Discovered ${result.definitions.length} roles`);
    return result.definitions;
  }

  /**
   * Register a new agent to the team at runtime
   * Adds to WorkerPool definitions without requiring workflow reconfiguration
   *
   * @param definition - Agent definition to register
   */
  registerAgent(definition: AgentDefinition): void {
    // Add to local definitions
    this.definitions.push(definition);

    // Register with WorkerPool
    this.workerPool.registerDefinitions([definition]);

    logger.info(`Registered new agent: ${definition.role} (${definition.id})`);
  }

  /**
   * Unregister an agent from the team
   * Note: Cannot unregister agents with active tasks
   *
   * @param agentId - ID of agent to remove
   */
  unregisterAgent(agentId: string): void {
    const idx = this.definitions.findIndex((d) => d.id === agentId);
    if (idx === -1) {
      throw new Error(`Agent ${agentId} not found`);
    }

    const agentDef = this.definitions[idx]!;

    // Check for active tasks
    const activeWorkers = this.getActiveAgents();
    const hasActiveTasks = activeWorkers.some((w) => w.role === agentDef.role);
    if (hasActiveTasks) {
      throw new Error(`Cannot unregister agent ${agentId}: has active tasks`);
    }

    this.definitions.splice(idx, 1);
    logger.info(`Unregistered agent: ${agentDef.role} (${agentDef.id})`);
  }

  /**
   * Modify a pending task's properties
   * Only works on tasks that are not yet in progress
   *
   * @param taskId - ID of task to modify
   * @param changes - Properties to update
   */
  modifyTask(
    taskId: string,
    changes: {
      description?: string;
      priority?: number;
      assignedRole?: string;
    },
  ): void {
    if (!this.taskStoreInstance) {
      throw new Error("TaskStore not initialized");
    }

    const task = this.taskStoreInstance.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === "in_progress" || task.status === "completed") {
      throw new Error(`Cannot modify task ${taskId}: status is ${task.status}`);
    }

    // Apply changes
    if (changes.description !== undefined) {
      (task as any).description = changes.description;
    }
    if (changes.priority !== undefined) {
      (task as any).context = {
        ...(task as any).context,
        priority: changes.priority,
      };
    }
    if (changes.assignedRole !== undefined) {
      (task as any).assigned_role = changes.assignedRole.toLowerCase();
    }

    logger.info({ taskId, changes }, `Modified task ${taskId}`);
  }

  /**
   * Discard a pending task (remove from queue without executing)
   * Only works on tasks that are not yet in progress
   *
   * @param taskId - ID of task to discard
   */
  discardTask(taskId: string): void {
    if (!this.taskStoreInstance) {
      throw new Error("TaskStore not initialized");
    }

    const task = this.taskStoreInstance.get(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found`);
    }

    if (task.status === "in_progress") {
      throw new Error(
        `Cannot discard task ${taskId}: currently in progress. Use stopTask() instead.`,
      );
    }

    if (task.status === "completed") {
      throw new Error(`Cannot discard task ${taskId}: already completed`);
    }

    // Remove from TaskStore
    this.taskStoreInstance.updateStatus(taskId, "failed");
    this.filePersistence?.updateStatus(taskId, "failed");

    // Also try to remove from RoleTaskQueue if present
    try {
      this.taskQueue.failTask(taskId, "Discarded by user");
    } catch {
      // Task may not be in queue, that's ok
    }

    logger.info(`Discarded task ${taskId}`);
  }

  /**
   * Get comprehensive workflow status including all tasks
   */
  getStatus(): {
    state: "idle" | "planning" | "awaiting_approval" | "executing";
    teamId: string;
    agents: Array<{ id: string; role: string; active: boolean }>;
    tasks: {
      pending: number;
      inProgress: number;
      completed: number;
      failed: number;
    };
    currentPlan?: string;
  } {
    const workflowStatus = this.getWorkflowStatus();
    const activeAgents = this.getActiveAgents();
    const activeRoles = new Set(activeAgents.map((a) => a.role));

    return {
      state: workflowStatus.state,
      teamId: this.teamId,
      agents: this.definitions.map((d) => ({
        id: d.id,
        role: d.role,
        active: activeRoles.has(d.role),
      })),
      tasks: {
        pending: workflowStatus.pendingTasks,
        inProgress: workflowStatus.activeTasks,
        completed: workflowStatus.completedTasks,
        failed: this.taskQueue.getMetrics().tasksFailed,
      },
      ...(workflowStatus.currentPlan && {
        currentPlan: workflowStatus.currentPlan,
      }),
    };
  }

  /**
   * Get individual task status by ID
   * @param taskId - Task ID to look up
   * @returns Task object or null if not found
   */
  getTaskStatus(taskId: string): {
    id: string;
    description: string;
    assigned_role: string;
    status: string;
    dependencies?: string[];
    output?: any;
  } | null {
    if (!this.taskStoreInstance) {
      return null;
    }
    const task = this.taskStoreInstance.get(taskId);
    if (!task) {
      return null;
    }
    return {
      id: task.id,
      description: task.description,
      assigned_role: task.assigned_role,
      status: task.status,
      dependencies: Array.from(task.prerequisites?.keys() ?? []),
      output: task.output,
    };
  }

  /**
   * Listen for task completions to queue dependent tasks
   */
  private setupCompletionHandler(): void {
    this.taskQueue.setCallbacks({
      onTaskComplete: ({ taskId, output }) => {
        logger.info(`Task ${taskId} completed, checking dependents`);
        this.taskOutputs.set(taskId, output);
        this.queueReadyDependents(taskId);
      },
      onTaskFailed: ({ taskId, error }) => {
        logger.error(`Task ${taskId} failed: ${error}`);
      },
    });
  }

  /**
   * Queue tasks that were waiting on the completed task
   */
  private queueReadyDependents(completedTaskId: string): void {
    if (!this.plan) return;

    for (const task of this.plan.tasks) {
      // Skip if already queued or completed
      const existingTask = this.taskQueue.getTask(task.id);
      if (existingTask) continue;

      // Check if this task depends on the completed one
      if (!task.dependencies.includes(completedTaskId)) continue;

      // Check if ALL dependencies are now satisfied
      const allDepsComplete = task.dependencies.every((depId) =>
        this.taskOutputs.has(depId),
      );

      if (allDepsComplete) {
        this.queuePlannedTask(task);
      }
    }
  }

  /**
   * Convert PlannedTask to TaskWithContext and queue it
   */
  private queuePlannedTask(task: PlannedTask): void {
    const previousOutputs = task.dependencies.map((depId) => ({
      taskId: depId,
      output: this.taskOutputs.get(depId) ?? null,
    }));

    const taskWithContext: TaskWithContext = {
      id: task.id,
      description: task.description,
      assigned_role: task.assignedRole.toLowerCase(),
      priority: task.priority,
      context: {
        previousOutputs,
        artifacts: [],
      },
      createdAt: Date.now(),
      status: "queued",
    };

    this.taskQueue.queueTask(taskWithContext);
    logger.info(`Queued task ${task.id} for role ${task.assignedRole}`);
  }

  // ===========================================================================
  // Step 1: Configure Workflow (discover roles)
  // ===========================================================================

  /**
   * Use DefinitionBuilder to discover and configure agents for a task
   * @deprecated Use the orchestrator flow instead:
   *   1. initializeOrchestrator() - sets up orchestrator
   *   2. handleUserMessage() - conversational planning
   *   3. approvePlan() - queues tasks to MemoryManager
   * Or use discoverRoles() for pure role discovery without side effects.
   */
  async configureWorkflow(taskDescription: string): Promise<AgentDefinition[]> {
    console.warn(
      "[DEPRECATED] configureWorkflow() is deprecated. Use orchestrator flow or discoverRoles() instead.",
    );
    logger.info(`Configuring workflow: "${taskDescription.slice(0, 80)}..."`);

    const factory = getAgentFactory();
    const builder = factory.getDefinitionBuilder() as AiSdkAgent;
    await builder.initialize();

    const result = await builder.run(
      `Design a team of AI agents for: ${taskDescription}`,
    );

    if (!result?.definitions) {
      throw new Error("DefinitionBuilder failed to produce definitions");
    }

    this.definitions = result.definitions;

    // Register with WorkerPool
    this.workerPool.registerDefinitions(this.definitions);

    logger.info(`Configured ${this.definitions.length} agents`);
    logger.debug(`Team goal: ${result.teamGoal || "N/A"}`);

    return this.definitions;
  }

  // ===========================================================================
  // Step 2: Create Plan
  // ===========================================================================

  /**
   * Use PlanBuilder to create execution plan for configured roles
   * @deprecated Use the orchestrator flow instead:
   *   1. initializeOrchestrator() - sets up orchestrator
   *   2. handleUserMessage() - conversational planning
   *   3. approvePlan() - queues tasks to MemoryManager
   */
  async createPlan(taskDescription: string): Promise<TaskPlan> {
    console.warn(
      "[DEPRECATED] createPlan() is deprecated. Use orchestrator flow instead.",
    );
    if (this.definitions.length === 0) {
      throw new Error("No agents configured. Call configureWorkflow() first.");
    }

    logger.info("Creating execution plan...");

    const factory = getAgentFactory();
    const planBuilder = factory.getPlanBuilder() as AiSdkAgent;
    await planBuilder.initialize();

    const rolesList = this.definitions.map((d) => d.role).join(", ");
    const result = await planBuilder.run(
      `Goal: ${taskDescription}\nAvailable roles: ${rolesList}\n\nCreate a detailed execution plan.`,
    );

    if (!result?.tasks) {
      // Fallback: single task per role
      logger.warn("PlanBuilder returned no tasks, using default plan");
      this.plan = {
        tasks: this.definitions.map((d, i) => ({
          id: `task-${i + 1}`,
          title: `Task for ${d.role}`,
          description: taskDescription,
          assignedRole: d.role,
          priority: 1,
          dependencies: [],
        })),
        rationale: "Default plan: each role handles the task independently",
      };
    } else {
      this.plan = result as TaskPlan;
    }

    logger.info(`Plan created with ${this.plan.tasks.length} tasks`);
    return this.plan;
  }

  // ===========================================================================
  // Step 3: Execute Tasks
  // ===========================================================================

  /** Track which role handles each task */
  private taskRoles = new Map<string, string>();

  /**
   * @deprecated Use orchestrator mode with startTaskExecution() instead
   *
   * Start a new task - creates taskId and routes to role (LEGACY MODE)
   * This is for non-orchestrator usage where tasks are created ad-hoc.
   * For orchestrator mode, use: approveTaskForChat() → startTaskExecution()
   *
   * @returns { taskId, response }
   */
  async startTask(
    role: string,
    message: string,
  ): Promise<{ taskId: string; response: any }> {
    const taskId = `task-${Date.now()}`;
    this.taskRoles.set(taskId, role.toLowerCase());

    logger.info(`Starting new task: ${taskId} → ${role}`);
    const response = await this.workerPool.runTask(taskId, role, message);

    return { taskId, response };
  }

  /**
   * Continue an existing task - uses the same role/worker
   */
  async continueTask(taskId: string, message: string): Promise<any> {
    const role = this.taskRoles.get(taskId);
    if (!role) {
      throw new Error(`Unknown task: ${taskId}. Use startTask() first.`);
    }

    logger.info(`Continuing task: ${taskId} (${role})`);
    return this.workerPool.runTask(taskId, role, message);
  }

  /**
   * Stop a specific task and dispose its worker
   */
  async stopTask(taskId: string): Promise<void> {
    logger.info(`Stopping task: ${taskId}`);
    this.taskRoles.delete(taskId);
    await this.workerPool.dispose(taskId);
  }

  /**
   * Execute all planned tasks (respects dependencies)
   * @deprecated Use the orchestrator flow instead:
   *   1. approvePlan() - queues tasks to MemoryManager
   *   2. Tasks auto-execute via WorkerPool, or use manual flow:
   *      - approveTaskForChat(taskId)
   *      - startTaskExecution(taskId)
   *      - completeTaskByUser(taskId)
   */
  async executeAllTasks(): Promise<Map<string, any>> {
    console.warn(
      "[DEPRECATED] executeAllTasks() is deprecated. Use orchestrator flow with approvePlan() instead.",
    );
    if (!this.plan) {
      throw new Error("No plan created. Call createPlan() first.");
    }

    const results = new Map<string, any>();
    const completed = new Set<string>();

    // Simple dependency-aware execution
    const pending = [...this.plan.tasks];

    while (pending.length > 0) {
      // Find tasks with all dependencies satisfied
      const ready = pending.filter((t) =>
        t.dependencies.every((dep) => completed.has(dep)),
      );

      if (ready.length === 0 && pending.length > 0) {
        throw new Error("Circular dependency detected in task plan");
      }

      // Execute ready tasks in parallel
      await Promise.all(
        ready.map(async (task) => {
          try {
            const { taskId, response } = await this.startTask(
              task.assignedRole,
              task.description,
            );
            results.set(taskId, response);
            completed.add(task.id);
            logger.info(`Completed: ${taskId}`);
          } catch (error) {
            logger.error({ err: error, taskId: task.id }, `Failed: ${task.id}`);
            results.set(task.id, { error: String(error) });
            completed.add(task.id); // Mark as done even if failed
          }
        }),
      );

      // Remove completed tasks from pending
      for (const task of ready) {
        const idx = pending.indexOf(task);
        if (idx >= 0) pending.splice(idx, 1);
      }
    }

    return results;
  }

  // ===========================================================================
  // Queue-Based Execution with Approval Flow
  // ===========================================================================

  /**
   * Queue all planned tasks (those with no dependencies are immediately ready)
   */
  queueAllPlannedTasks(): void {
    if (!this.plan) {
      throw new Error("No plan created. Call createPlan() first.");
    }

    // Queue tasks with no dependencies first
    for (const task of this.plan.tasks) {
      if (task.dependencies.length === 0) {
        this.queuePlannedTask(task);
      }
    }

    const metrics = this.taskQueue.getMetrics();
    logger.info(`Queued ${metrics.tasksQueued} initial tasks from plan`);
  }

  /**
   * Get pending task for approval (peek without removing)
   */
  getPendingApproval(role: string): TaskWithContext | undefined {
    return this.taskQueue.peek(role);
  }

  /**
   * Approve and execute a task (non-blocking)
   */
  approveTask(taskId: string): void {
    const task = this.taskQueue.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found in queue`);
    }

    // Poll to remove from queue
    const polled = this.taskQueue.poll(task.assigned_role);
    if (!polled || polled.id !== taskId) {
      // Put it back if we got the wrong one (edge case)
      if (polled) this.taskQueue.queueTask(polled);
      throw new Error(
        `Task ${taskId} is not next in queue for role ${task.assigned_role}`,
      );
    }

    logger.info(`Approved task ${taskId}, executing...`);
    this.executeQueuedTask(polled);
  }

  /**
   * Pick a specific task for execution (may not be next in queue)
   */
  pickTask(taskId: string): void {
    const task = this.taskQueue.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found in queue`);
    }

    // Remove from queue regardless of position
    // This requires iterating and re-queuing others
    const role = task.assigned_role;
    const tasksToRequeue: TaskWithContext[] = [];
    let found: TaskWithContext | null = null;

    // Drain until we find it
    let polled = this.taskQueue.poll(role);
    while (polled) {
      if (polled.id === taskId) {
        found = polled;
        break;
      }
      tasksToRequeue.push(polled);
      polled = this.taskQueue.poll(role);
    }

    // Re-queue the ones we removed
    for (const t of tasksToRequeue) {
      this.taskQueue.queueTask(t);
    }

    if (found) {
      logger.info(`Picked task ${taskId} for execution`);
      this.executeQueuedTask(found);
    } else {
      throw new Error(`Task ${taskId} not found in queue`);
    }
  }

  /**
   * Skip a task (remove from queue without executing)
   */
  skipTask(taskId: string): void {
    const task = this.taskQueue.getTask(taskId);
    if (!task) {
      throw new Error(`Task ${taskId} not found in queue`);
    }

    // Mark as failed with skip reason
    this.taskQueue.failTask(taskId, "Skipped by user");
    logger.info(`Skipped task ${taskId}`);
  }

  /**
   * Execute a queued task (non-blocking)
   * Runs the task and updates queue status on completion
   */
  private executeQueuedTask(task: TaskWithContext): void {
    this.workerPool
      .runTask(task)
      .then((output) => {
        this.taskQueue.completeTask(task.id, output);
        // Note: completion handler will queue dependents
      })
      .catch((error) => {
        this.taskQueue.failTask(task.id, String(error));
      });
  }

  /**
   * Check if a role has pending tasks
   */
  hasPendingTasksForRole(role: string): boolean {
    return this.taskQueue.hasTasksFor(role);
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): { total: number; byRole: Record<string, number> } {
    const metrics = this.taskQueue.getMetrics();
    const stats = {
      total: metrics.tasksQueued - metrics.tasksCompleted - metrics.tasksFailed,
      byRole: {} as Record<string, number>,
    };
    for (const role of this.configuredRoles) {
      stats.byRole[role] = this.taskQueue.getQueueSize(role);
    }
    return stats;
  }

  // ===========================================================================
  // Convenience: One-shot execution
  // ===========================================================================

  /**
   * Full workflow: configure → plan → execute
   * @deprecated Use the orchestrator flow instead:
   *   1. initializeOrchestrator()
   *   2. handleUserMessage() for conversational planning
   *   3. approvePlan() to queue tasks
   */
  async run(taskDescription: string): Promise<Map<string, any>> {
    console.warn(
      "[DEPRECATED] run() is deprecated. Use orchestrator flow instead.",
    );
    await this.configureWorkflow(taskDescription);
    await this.createPlan(taskDescription);
    return this.executeAllTasks();
  }

  // ===========================================================================
  // Status & Cleanup
  // ===========================================================================

  get configuredRoles(): string[] {
    return this.definitions.map((d) => d.role);
  }

  get plannedTasks(): PlannedTask[] {
    return this.plan?.tasks ?? [];
  }

  get activeWorkerCount(): number {
    return this.workerPool.workerCount;
  }

  // ===========================================================================
  // Compatibility Methods (for existing API)
  // ===========================================================================

  /**
   * Compatibility: configureNewWorkflow maps to configureWorkflow + createPlan
   * @deprecated Use the orchestrator flow instead:
   *   1. initializeOrchestrator()
   *   2. handleUserMessage() for conversational planning
   *   3. approvePlan() to queue tasks
   */
  async configureNewWorkflow(
    workflowDescription: string,
  ): Promise<AgentDefinition[]> {
    console.warn(
      "[DEPRECATED] configureNewWorkflow() is deprecated. Use orchestrator flow instead.",
    );
    await this.configureWorkflow(workflowDescription);
    await this.createPlan(workflowDescription);
    return this.definitions;
  }

  /**
   * Compatibility: getRoles returns configured definitions as AgentConfig-like objects
   * @deprecated Use discoverRoles() for pure role discovery, or use orchestrator flow:
   *   1. initializeOrchestrator() - sets up orchestrator with team roles
   *   2. orchestratorMessage() - conversational planning
   */
  async getRoles(taskDescription: string): Promise<AgentDefinition[]> {
    console.warn(
      "[DEPRECATED] getRoles() is deprecated. Use discoverRoles() or orchestrator flow instead.",
    );
    if (this.definitions.length === 0) {
      // Use discoverRoles() instead of deprecated configureNewWorkflow()
      this.definitions = await this.discoverRoles(taskDescription);
      this.workerPool.registerDefinitions(this.definitions);
    }
    return this.definitions;
  }

  // /**
  //  * Compatibility: createTask triggers the full workflow
  //  */
  // async createTask(taskDescription: string): Promise<void> {
  //   const desc = typeof taskDescription === "string"
  //     ? taskDescription
  //     : JSON.stringify(taskDescription);
  //   await this.run(desc);
  // }

  /**
   * Reset the current plan — deletes from disk so it won't restore on next init.
   */
  async resetPlan(): Promise<{ deleted: boolean; planId?: string }> {
    if (!this.orchestrator) {
      return { deleted: false };
    }
    const result = await this.orchestrator.resetPlan();
    // Also clear tasks and workers
    this.taskStoreInstance?.clear();
    await this.workerPool.disposeAll();
    this.plan = null;
    return result;
  }

  async dispose(): Promise<void> {
    // Mark plan as interrupted so it doesn't auto-restore on next init
    if (this.orchestrator) {
      await this.orchestrator.interruptPlan();
      this.orchestrator.dispose();
    }
    await this.workerPool.disposeAll();
    this.definitions = [];
    this.plan = null;
    logger.info("AgentManager disposed");
  }

  /**
   * Flush buffered data to disk without disposing.
   * Call during graceful shutdown to persist pending writes.
   */
  async flush(): Promise<void> {
    if (this.filePersistence) {
      await this.filePersistence.flush();
    }
  }
}

// Singleton instance
let instance: AgentManager | null = null;

export function getAgentManager(): AgentManager {
  if (!instance) {
    instance = new AgentManager();
  }
  return instance;
}
