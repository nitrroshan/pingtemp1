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
import { AiSdkAgent } from "./agent/internal/AiSdkAgent.js";
import type { AgentDefinition, AgentEvent } from "./agent/types.js";
import type { TaskWithContext } from "./util/RoleTaskQueue.types.js";
import { OrchestratorService } from "./orchestrator/OrchestratorService.js";
import type { ITaskProvider } from "./orchestrator/ITaskProvider.js";
import type { PlanProposedEvent } from "./orchestrator/types.js";
import { TaskStore } from "./orchestrator/TaskStore.js";
import { DependencyResolver } from "./orchestrator/DependencyResolver.js";
import { PlannerAgent } from "./orchestrator/PlannerAgent.js";
import { ChatAgent } from "./chatAgent/ChatAgent.js";
import type { ChatAgentSnapshot } from "./chatAgent/ChatAgent.js";
import { UserInteractionManager } from "./orchestrator/UserInteractionManager.js";
import { NotificationQueue } from "./orchestrator/NotificationQueue.js";
import { createPlannerTools } from "./orchestrator/tools/index.js";
import { PluginRegistry } from "./plugin/PluginRegistry.js";
import type { IPlugin } from "./plugin/types.js";
import { FileTaskStore } from "./persistence/FileTaskStore.js";
import { PromptLoader } from "./orchestrator/PromptLoader.js";

const logger = rootLogger.child({ module: "AgentManager" });

export interface ManagerStreamCallbacks {
  onStream?: (data: { taskId: string; agentId: string; part: any; goalId?: string }) => void;
  onEvent?: (data: { taskId: string; event: any }) => void;
  onDone?: (data: { taskId: string; role: string; output: any }) => void;
  onError?: (data: { taskId: string; error: string }) => void;
  onTaskUpdate?: (data: { taskId: string; status: string; role?: string; output?: any }) => void;
  onPlanUpdate?: (data: { action: string; goalId?: string; tasksQueued?: number; timestamp: number }) => void;
  onPlanProposed?: (data: PlanProposedEvent) => void;
  /** Channel B — coarse-grained worker task updates for ChatAgent + Frontend sidebar */
  onWorkerTaskUpdate?: (update: import("./types/TaskUpdate.js").TaskUpdate) => void;
  /** Goal status changed — plan completed or all tasks failed */
  onGoalStatusChange?: (data: { teamId: string; goalId: string; status: "completed" | "failed" }) => void;
}



/**
 * Generic worker prompt for agents without plugin-sourced system prompts.
 * Loaded from agent/prompts/generic-worker/system.xml.
 */
function getGenericWorkerPrompt(role: string): string {
  return PromptLoader.load("generic-worker", { role });
}

export class AgentManager {
  private workerPool: WorkerPool;
  private definitions: AgentDefinition[] = [];

  /** Stream callbacks registered by SocketServerV2 */
  private streamCallbacks: ManagerStreamCallbacks | null = null;

  // Orchestrator mode properties
  private orchestrator: OrchestratorService | null = null;
  private taskStoreInstance: TaskStore | null = null;
  private userInteractionManager: UserInteractionManager | null = null;
  private filePersistence: FileTaskStore | null = null;
  private pluginRegistry: PluginRegistry = new PluginRegistry();
  private teamId: string = "default";

  /** v3.0: Database persistence for tasks (set by SocketServerV2 from ServiceRegistry) */
  private taskPersistence: import("./orchestrator/contracts/ITaskPersistence.js").ITaskPersistence | null = null;

  /** Set database persistence service for tasks */
  setTaskPersistence(service: import("./orchestrator/contracts/ITaskPersistence.js").ITaskPersistence): void {
    this.taskPersistence = service;
  }

  /** Feature flag: whether chat agents are enabled */
  private chatAgentsEnabled = false;
  /** Optional callback to load prior conversation from storage (injected by AgentManagerRegistry) */
  private loadConversationFn: ((teamId: string, agentId: string) => Promise<Array<{ role: "user" | "assistant" | "system"; content: string }>>) | null = null;

  constructor() {
    this.workerPool = new WorkerPool();
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

  /** Get the worker pool (for wiring auth token resolver, etc.) */
  getWorkerPool(): WorkerPool {
    return this.workerPool;
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

    // Get CRDT task/goal stores from CollaborationPlugin (if registered)
    // These persist tasks and goals to CRDT for durability + agent access via collab tool
    // The L2CollaborationPlugin is stored as `crdt` in IPluginStorage
    const l2Plugin = collabStorage?.crdt as any;

    // SOLID architecture — TaskStore + OrchestratorService + PlannerAgent as peers
    this.taskStoreInstance = new TaskStore();
    const dagResolver = new DependencyResolver();

    // Session ID for planner conversation thread
    const sessionId = `team-${teamId}`;

    // NotificationQueue: batches rapid task events (5 completions in 100ms → 1 planner turn)
    // The onFlush callback delegates to GoalManager.executePlannerTurn (wired after orchestrator creation)
    const notificationQueue = new NotificationQueue({
      debounceMs: 100,
      onFlush: (goalId, batchedMessage) => {
        this.orchestrator?.getGoalManager().executePlannerTurn(goalId, batchedMessage).catch((err) => {
          console.error("[AgentManager] Batched planner turn error:", err);
        });
      },
    });
    // Create a lazy CRDT resolver — goal-scoped stores created when approvePlan sets goalId
    const crdtResolver = {
      taskSync: null as any,
      goalStore: null as any,
      resolveForGoal(goalId: string) {
        if (l2Plugin?.getCrdtTaskSync) {
          this.taskSync = l2Plugin.getCrdtTaskSync(goalId);
          this.goalStore = l2Plugin.getCrdtGoalStore(goalId);
        }
      },
    };

    // Planner factory — GoalManager calls this to create per-goal planners
    const agentFactory = getAgentFactory();
    const self = this;
    const createPlanner = async (goalId: string): Promise<PlannerAgent> => {
      const planner = new PlannerAgent({ agentFactory, teamRoles, teamId });
      await planner.initialize();
      // Create goal-scoped orchestrator context for planner tools
      const goalOrchestratorContext = {
        taskProvider: self.taskStoreInstance as ITaskProvider,
        callbacks: self.orchestrator!.getCallbacks(),
        planStore,
        teamId,
        currentGoalId: goalId,
        teamRoles,
        planBuilder: { invoke: async () => { throw new Error("PlanBuilder not used"); } },
        getState: () => self.orchestrator!.getGoalState(goalId),
        setState: (state: any) => self.orchestrator!.setGoalState(goalId, state),
        getPendingPlan: (gid?: string) => self.orchestrator!.getPendingPlan(gid ?? goalId),
        setPendingPlan: (plan: any, gid?: string) => self.orchestrator!.setPendingPlan(plan, gid ?? goalId),
        taskPersistence: self.taskPersistence,
      };
      const tools = createPlannerTools({
        orchestratorContext: goalOrchestratorContext,
        agentFactory,
        dagResolver,
        onMutation: (event) => {
          self.streamCallbacks?.onTaskUpdate?.({ taskId: "plan", status: "mutation", ...event });
          self.orchestrator?.onPlanMutation(event);
        },
      });
      await planner.setTools(tools);
      return planner;
    };

    // ChatAgent factory — GoalManager calls this to create per-goal chat agents
    const createChatAgent = (goalId: string, role: string): ChatAgent => {
      return new ChatAgent({
        role: role.toLowerCase(),
        teamId,
        goalId,
        taskStore: self.taskStoreInstance!,
        onDispatchTask: async (taskId, r) => {
          if (self.orchestrator) {
            await self.orchestrator.directDispatchTask(taskId, r);
          }
        },
        onNotifyPlanner: (message) => {
          self.orchestrator?.notifyPlannerFromRole(goalId, message);
        },
        loadConversation: self.loadConversationFn
          ? () => self.loadConversationFn!(teamId, `chat-${goalId}-${role.toLowerCase()}`)
          : undefined,
      });
    };

    // Create OrchestratorService (reactive runtime)
    this.orchestrator = new OrchestratorService({
      teamId,
      teamRoles,
      taskStore: this.taskStoreInstance,
      workerPool: this.workerPool,
      dagResolver,
      notificationQueue,
      planStore,
      crdtTaskSync: { get: () => crdtResolver.taskSync, resolveForGoal: crdtResolver.resolveForGoal.bind(crdtResolver) },
      crdtGoalStore: { get: () => crdtResolver.goalStore, resolveForGoal: crdtResolver.resolveForGoal.bind(crdtResolver) },
      pluginRegistry: this.pluginRegistry,
      autoExecute: false,
      // Phase 4.5: Agent factories — GoalManager creates per-goal agents
      createPlanner,
      createChatAgent,
      onPlannerStream: (data) => this.streamCallbacks?.onStream?.(data),
      chatAgentsEnabled: this.chatAgentsEnabled,
      taskPersistence: this.taskPersistence,
      callbacks: {
        onStream: (data) => this.streamCallbacks?.onStream?.(data),
        onEvent: (data) => this.streamCallbacks?.onEvent?.(data),
        onDone: (data) => this.streamCallbacks?.onDone?.(data),
        onError: (data) => this.streamCallbacks?.onError?.(data),
        onTaskUpdate: (data) => this.streamCallbacks?.onTaskUpdate?.(data),
        onWorkerTaskUpdate: (update) => {
          // Route to ChatAgent via GoalManager
          this.orchestrator?.getGoalManager().ingestTaskUpdateToChatAgent(update);
          // Forward to Socket.IO via streamCallbacks
          this.streamCallbacks?.onWorkerTaskUpdate?.(update);
        },
        onPlanProposed: (data) => {
          this.streamCallbacks?.onPlanProposed?.(data);
          // Auto-approve with explicit goalId from the plan that was just proposed
          const gid = (data as any)?.goalId;
          this.approveOrchestratorPlan(gid).catch((err) => {
            console.error("[AgentManager] Auto-approve failed:", err);
          });
        },
        onGoalStatusChange: (data) => this.streamCallbacks?.onGoalStatusChange?.(data),
      },
    });

    await this.orchestrator.initialize();

    // Inject task services AFTER orchestrator init
    this.workerPool.setTaskServices({
      taskStore: this.taskStoreInstance,
      dagResolver,
      teamRoles,
      crdtTaskSync: null, // resolved lazily via crdtResolver when goal is known
    });

    logger.info(`[AgentManager] OrchestratorService + GoalManager initialized (planners are per-goal)`);
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

  // ===========================================================================
  // Chat Agent API (Phase 1)
  // ===========================================================================

  /**
   * Enable chat agents for this manager.
   * Call after initializeOrchestrator() when feature flag is on.
   * @param roles - roles to enable chat agents for
   * @param loadConversation - optional callback to load prior conversation from storage
   */
  enableChatAgents(
    roles: string[],
    loadConversation?: (teamId: string, agentId: string) => Promise<Array<{ role: "user" | "assistant" | "system"; content: string }>>,
  ): void {
    if (!this.taskStoreInstance) {
      logger.warn("Cannot enable chat agents — TaskStore not initialized");
      return;
    }
    this.chatAgentsEnabled = true;
    this.loadConversationFn = loadConversation ?? null;

    // Propagate flag to GoalManager (it captured false at construction time)
    this.orchestrator?.setChatAgentsEnabled(true);

    // NO agent creation here — GoalManager.approvePlan() creates them with real goalId

    // Wire ChatAgent dispatch: OrchestratorService routes ready tasks through ChatAgent
    if (this.orchestrator) {
      this.orchestrator.setChatAgentDispatch(async (taskId: string, role: string) => {
        const task = this.taskStoreInstance?.get(taskId);
        const gid = task?.goalId;
        const chatAgent = gid ? this.getChatAgent(role, gid) : null;
        if (chatAgent) {
          await chatAgent.handleTask(taskId, role);
        } else {
          logger.warn(`No ChatAgent for role '${role}' goal '${gid}', dispatching directly`);
          await this.orchestrator!.directDispatchTask(taskId, role);
        }
      });
    }

    logger.info(`Chat agents enabled for ${roles.length} roles: ${roles.join(", ")}`);
  }

  /**
   * Get ChatAgent for a role, optionally scoped to a goal.
   * Delegates to GoalManager (Phase 4.5).
   */
  getChatAgent(role: string, goalId?: string): ChatAgent | null {
    if (!this.chatAgentsEnabled) return null;
    return this.orchestrator?.getChatAgent(role, goalId) ?? null;
  }

  /**
   * Send a user message to a ChatAgent and stream the response.
   */
  async *chatAgentMessage(role: string, content: string, goalId?: string): AsyncGenerator<AgentEvent> {
    if (!goalId) {
      throw new Error(`goalId is required for chatAgentMessage (role=${role})`);
    }
    const agent = this.getChatAgent(role, goalId);
    if (!agent) {
      const goalManager = this.orchestrator?.getGoalManager();
      const allGoals = goalManager?.getAllGoalSummaries() ?? [];
      logger.error(`Chat agent not available for role '${role}' goalId='${goalId}'. ` +
        `chatAgentsEnabled=${this.chatAgentsEnabled}, goals=[${allGoals.map(g => `${g.goalId}(${g.state})`).join(',')}]`);
      throw new Error(`Chat agent not available for role '${role}'. Chat agents may not be enabled.`);
    }
    yield* agent.handleUserMessage(content);
  }

  /**
   * Check if chat agents are enabled and available.
   */
  isChatAgentEnabled(): boolean {
    return this.chatAgentsEnabled;
  }

  /**
   * Get serialized ModelMessage[] from a worker agent (for context persistence).
   */
  getWorkerContext(taskId: string): string | null {
    const messages = this.workerPool.getAgentMessages(taskId);
    if (!messages?.length) return null;
    try {
      return JSON.stringify(messages);
    } catch {
      return null;
    }
  }

  /**
   * Get serialized ModelMessage[] from a ChatAgent (for context persistence).
   */
  getChatAgentContext(role: string, goalId?: string): string | null {
    const chatAgent = this.getChatAgent(role, goalId);
    if (!chatAgent) return null;
    return chatAgent.getContextSnapshot();
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

  /** Delegate auto-approve to OrchestratorService. */
  setAutoApproveForRole(role: string, enabled: boolean): void {
    this.orchestrator?.setAutoApproveForRole(role, enabled);
  }

  /** Delegate auto-approve to OrchestratorService. */
  setAutoApproveAllRoles(enabled: boolean): void {
    this.orchestrator?.setAutoApproveAllRoles(enabled);
  }

  isAutoApproveEnabled(role: string): boolean {
    return this.orchestrator?.isAutoApproveEnabled(role) ?? false;
  }

  getAutoApproveRoles(): string[] {
    return this.orchestrator?.getAutoApproveRoles() ?? [];
  }

  /**
   * Send message to orchestrator (conversational planning mode)
   * Returns orchestrator's response
   */
  async orchestratorMessage(content: string, goalId: string, repoUrl?: string, repoBranch?: string): Promise<{ response: string; goalId: string }> {
    if (!this.orchestrator) {
      throw new Error(
        "Orchestrator not initialized. Call initializeOrchestrator() first.",
      );
    }

    // Enrich content with repo context so the planner includes it in submit_plan
    let enrichedContent = content;
    if (repoUrl) {
      enrichedContent += `\n\n[Workspace: repo=${repoUrl}${repoBranch ? `, branch=${repoBranch}` : ''}]`;
    }

    const response = await this.orchestrator.handleMessage(enrichedContent, goalId, repoUrl, repoBranch);
    return { response, goalId };
  }

  /**
   * Approve the pending plan (triggers task creation in TaskStore)
   * After tasks are created, auto-approve will be checked for each task
   */
  async approveOrchestratorPlan(goalId?: string): Promise<{
    success: boolean;
    tasksQueued?: number;
    autoStarted?: number;
    error?: string;
  }> {
    if (!this.orchestrator) {
      return { success: false, error: "Orchestrator not initialized" };
    }
    const result = await this.orchestrator.approvePlan(goalId);

    // Emit plan:update callback for socket broadcast
    if (result.success) {
      const emitGoalId = goalId || this.orchestrator?.getGoalManager().getGoalId() || undefined;
      if (!goalId) {
        console.warn(`[AgentManager] approveOrchestratorPlan called without goalId — falling back to activeGoalId=${emitGoalId}`);
      }
      this.streamCallbacks?.onPlanUpdate?.({
        action: "approved",
        goalId: emitGoalId,
        tasksQueued: result.tasksQueued,
        timestamp: Date.now(),
      });
    }

    return result;
  }

  /**
   * Get orchestrator state
   */
  getOrchestratorState(): string | null {
    return this.orchestrator?.getState() ?? null;
  }

  /**
   * Get current goal ID from orchestrator (for scoping messages/data by goal)
   */
  getCurrentGoalId(): string | null {
    return this.orchestrator?.getCurrentGoalId() ?? null;
  }

  /**
   * Get summaries of all goals for frontend display (Phase 4).
   */
  getAllGoalSummaries(): import("./orchestrator/types.js").GoalSummary[] {
    return this.orchestrator?.getAllGoalSummaries?.() ?? [];
  }

  /**
   * Get pending plan from orchestrator
   */
  getOrchestratorPendingPlan(goalId?: string): any | null {
    return this.orchestrator?.getPendingPlan(goalId) ?? null;
  }

  /**
   * Check if orchestrator mode is enabled
   */
  get isOrchestratorMode(): boolean {
    return true;
  }

  /**
   * @deprecated Use getTaskStore() instead.
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
      priority: task.priority || 0,
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

    // v3.0: Persist to database
    this.taskPersistence?.updateTaskStatus(taskId, "completed", finalOutput).catch(() => {});

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

    const allTasks = this.taskStoreInstance?.getAllTasks() ?? [];
    const planId = this.orchestrator?.getPendingPlan()?.planId;

    return {
      state,
      pendingTasks: allTasks.filter(t => t.status === "pending" || t.status === "ready").length,
      activeTasks: this.workerPool.workerCount,
      completedTasks: allTasks.filter(t => t.status === "completed").length,
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
      task.description = changes.description;
    }
    if (changes.priority !== undefined) {
      task.priority = changes.priority;
    }
    if (changes.assignedRole !== undefined) {
      task.assigned_role = changes.assignedRole.toLowerCase();
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
    const allStatusTasks = this.taskStoreInstance?.getAllTasks() ?? [];

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
        failed: allStatusTasks.filter(t => t.status === "failed").length,
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

  // ===========================================================================
  // Ad-hoc Task Execution (used by CLI + SocketServerV2)
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
  // ===========================================================================
  // Status & Cleanup
  // ===========================================================================

  get activeWorkerCount(): number {
    return this.workerPool.workerCount;
  }

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
