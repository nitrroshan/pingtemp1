/**
 * OrchestratorService — Reactive Task Runtime
 *
 * Responsibility: React to task lifecycle events, dispatch workers, forward streams.
 * "I'm the runtime. I execute what the planner decides."
 *
 * Architecture (from architecture-diagram.md):
 * - OrchestratorService and PlannerAgent are PEERS — neither owns the other
 * - Both operate on shared services (TaskStore, WorkerPool, DependencyResolver)
 * - PlannerAgent calls tools → tools call TaskStore directly
 * - OrchestratorService reacts to callbacks from RoleTaskQueue
 * - AgentManager (composition root) wires both to shared services
 */

import type { WorkerPool } from "../services/WorkerPool.js";
import type { TaskStore } from "./TaskStore.js";
import type { DependencyResolver } from "./DependencyResolver.js";
import type { NotificationQueue } from "./NotificationQueue.js";
import type { UserInteractionManager } from "./UserInteractionManager.js";
import type { PluginRegistry } from "../plugin/PluginRegistry.js";
import { toGoalId } from "../plugin/utils.js";
import { classifyError } from "./types/workerTypes.js";
import { rootLogger } from "../logging.js";
import { PromptLoader } from "./PromptLoader.js";
import type {
  OrchestratorState,
  OrchestratorCallbacks,
  OrchestratorMessage,
} from "./types.js";

const log = rootLogger.child({ module: "OrchestratorService" });

/** Max auto-retry attempts for retriable errors (429, timeout, external_service) */
const MAX_TASK_RETRIES = 3;
/** Max concurrent task dispatches to avoid overwhelming the LLM provider */
const MAX_CONCURRENT_DISPATCHES = 2;

// ═══════════════════════════════════════════════════════════════════
// CRDT Proxy Interface (lazy resolution per goal)
// ═══════════════════════════════════════════════════════════════════

/** Lazy proxy for goal-scoped CRDT stores. Resolved when approvePlan sets goalId. */
export interface CrdtProxy<T = any> {
  get(): T | null;
  resolveForGoal(goalId: string): void;
}

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

export interface OrchestratorServiceConfig {
  teamId: string;
  teamRoles: string[];

  // Shared services (injected by AgentManager)
  taskStore: TaskStore;
  workerPool: WorkerPool;
  dagResolver: DependencyResolver;
  pluginRegistry?: PluginRegistry;

  // Optional services
  userInteractionManager?: UserInteractionManager;
  notificationQueue?: NotificationQueue;
  planStore?: any;

  // CRDT task persistence (injected by AgentManager from CollaborationPlugin)
  crdtTaskSync?: CrdtProxy;
  crdtGoalStore?: CrdtProxy;

  // Callbacks → AgentManager → SocketServerV2 → Frontend
  callbacks?: OrchestratorCallbacks;

  // Execution config
  autoExecute?: boolean;
}

// ═══════════════════════════════════════════════════════════════════
// SERVICE
// ═══════════════════════════════════════════════════════════════════

export class OrchestratorService {
  // Config
  private teamId: string;
  private teamRoles: string[];
  private callbacks: OrchestratorCallbacks;

  // Shared services (injected — not owned)
  private taskStore: TaskStore;
  private workerPool: WorkerPool;
  private dagResolver: DependencyResolver;
  private pluginRegistry?: PluginRegistry;

  // Optional services
  private uim?: UserInteractionManager;
  private notificationQueue?: NotificationQueue;
  private planStore: any;
  // CRDT persistence — lazy proxies that resolve per-goal
  private crdtTaskSyncProxy: CrdtProxy | undefined;
  private crdtGoalStoreProxy: CrdtProxy | undefined;

  // State — only 2 states in planner mode (planner manages its own phases)
  private state: OrchestratorState = "idle";
  private sessionId: string;
  private currentGoalId: string | null = null;
  private messages: OrchestratorMessage[] = [];
  private autoExecute: boolean;

  // Dispatch tracking
  private activeDispatches = new Set<string>();   // taskIds currently being dispatched (prevent double-dispatch)
  private manualDispatchChain: Promise<void> = Promise.resolve(); // serialized manual dispatches only
  private messageChain: Promise<string> = Promise.resolve(""); // serialized user messages

  // Retry tracking: taskId → attempt count
  private taskAttempts = new Map<string, number>();
  // Deferred dispatch queue (when concurrency limit reached)
  private deferredDispatches: Array<{ taskId: string; role: string }> = [];

  // Pending plan (between submit_plan and approve)
  private pendingPlan: any = null;

  constructor(config: OrchestratorServiceConfig) {
    this.teamId = config.teamId;
    this.teamRoles = config.teamRoles;
    this.taskStore = config.taskStore;
    this.workerPool = config.workerPool;
    this.dagResolver = config.dagResolver;
    this.pluginRegistry = config.pluginRegistry;
    this.uim = config.userInteractionManager;
    this.notificationQueue = config.notificationQueue;
    this.planStore = config.planStore;
    this.crdtTaskSyncProxy = config.crdtTaskSync;
    this.crdtGoalStoreProxy = config.crdtGoalStore;
    this.callbacks = config.callbacks || {};
    this.sessionId = `team-${config.teamId}`;
    this.autoExecute = config.autoExecute ?? false;
  }

  /**
   * Initialize the runtime.
   * Wire task lifecycle callbacks from RoleTaskQueue → this.
   * Wire worker callbacks from WorkerPool → this.
   */
  async initialize(): Promise<void> {
    // Wire task lifecycle: RoleTaskQueue → OrchestratorService
    this.taskStore.setQueueCallbacks({
      onTaskReady: (data) => this.onTaskReady(data),
      onTaskComplete: (data) => this.onTaskComplete(data),
      onTaskFailed: (data) => this.onTaskFailed(data),
    });

    // Wire worker streaming: WorkerPool → OrchestratorService → callbacks → Socket.IO
    this.workerPool.setCallbacks({
      onStream: (data) => this.callbacks.onStream?.(data),
      onEvent: (data) => this.callbacks.onEvent?.(data),
      onDone: (data) => this.callbacks.onDone?.(data),
      onError: (data) => this.callbacks.onError?.(data),
      onAgentComplete: (data) => this.onWorkerDone(data),
      // R2-#4 FIX: Wire agent-initiated task callbacks so planner is notified
      onTaskCreated: (data) => {
        log.info(`Agent-created task: ${data.taskId} by ${data.createdBy} → ${data.targetRole}`);
        this.callbacks.onTaskUpdate?.({
          taskId: data.taskId, status: "pending", role: data.targetRole, timestamp: Date.now(),
        });
        // Notify planner so it can track agent-created tasks
        this.notifyPlanner(
          PromptLoader.loadTemplate("orchestrator", "task-created", {
            createdBy: data.createdBy,
            taskId: data.taskId,
            targetRole: data.targetRole,
            blocksSuffix: data.relationship === "blocks-me" ? ` (blocks ${data.parentTaskId})` : "",
          }),
        );
        // R6-6 FIX: Dispatch newly ready tasks (agent-created independent tasks have no prereqs)
        if (this.autoExecute) {
          this.dispatchReadyTasks();
        }
      },
      onBounce: (data) => {
        log.info(`Task bounced: ${data.taskId} by ${data.role} — ${data.reason}`);

        // R9-2 FIX: Handle dependency failure for bounced task
        // Bounced tasks are marked "failed" — notify planner with blocked downstream info
        this.handleTaskFailure(data.taskId, `Bounced by ${data.role}: ${data.reason}`);

        this.notifyPlanner(
          PromptLoader.loadTemplate("orchestrator", "task-bounced", {
            taskId: data.taskId,
            role: data.role,
            reason: data.reason,
            suggestedSuffix: data.suggestedRole ? `. Suggested role: ${data.suggestedRole}` : "",
          }),
        );
      },
    });

    // Load active plan for restart recovery
    await this.loadActivePlan();

    this.state = "idle";
    console.log(`[OrchestratorService] Initialized for team ${this.teamId}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API (called by AgentManager, which delegates from SocketServerV2)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle a user message. Routes to the planner (via onPlannerInput callback).
   * In planner mode, the orchestrator doesn't run the LLM — the planner does.
   */
  async handleMessage(content: string): Promise<string> {
    const result = this.messageChain.then(() => this._handleMessage(content));
    this.messageChain = result.catch(() => "");
    return result;
  }

  private async _handleMessage(content: string): Promise<string> {
    this.messages.push({ role: "user", content, timestamp: new Date().toISOString() });

    if (this.state === "idle") {
      this.state = "executing";
    }

    // Each user message = new planner turn with full conversation history.
    // The planner talks naturally (text output) and calls tools (research, plan, etc.).
    // When it generates text, the turn ends. User's next message starts a new turn.
    // No blocking, no UserInteractionManager — just chat.
    this.callbacks.onPlannerInput?.(content).catch((err) => {
      console.error("[OrchestratorService] Planner error:", err);
    });

    return ""; // Response comes via stream, not return value
  }

  /**
   * Approve the pending plan. Adds tasks to TaskStore → RoleTaskQueue → dispatch.
   */
  async approvePlan(): Promise<{ success: boolean; tasksQueued?: number; error?: string }> {
    if (!this.pendingPlan) {
      return { success: false, error: "No pending plan to approve" };
    }

    try {
      const planToApprove = this.pendingPlan;
      const planId = planToApprove.planId;
      this.pendingPlan = null;

      // Clear previous state- This needs to update as in puture we want to support multiple plans handled in sequence without restarting the service
      await this.workerPool.disposeAll();
      this.taskStore.clear();

      // Build dependants map
      const dependantsMap = new Map<string, string[]>();
      for (const task of planToApprove.tasks) {
        for (const depId of task.dependencies) {
          const existing = dependantsMap.get(depId) || [];
          existing.push(task.id);
          dependantsMap.set(depId, existing);
        }
      }

      // Add tasks to TaskStore (single writer)
      let tasksQueued = 0;
      for (const task of planToApprove.tasks) {
        const taskContext = (task as any).context || {};
        this.taskStore.create({
          id: task.id,
          description: `${task.title}: ${task.description}`,
          assigned_role: task.assignedRole.toLowerCase(),
          status: "pending",
          prerequisites: new Map<string, boolean>(
            task.dependencies.map((depId: string) => [depId, false] as [string, boolean]),
          ),
          dependants: dependantsMap.get(task.id) || [],
          context: {
            title: task.title,
            planId,
            goal: planToApprove.goal,
            priority: task.priority,
            complexity: task.complexity,
            expectedOutput: task.expectedOutput,
            // Include structured context from PlanBuilder
            notes: taskContext.notes || "",
            files: taskContext.files || [],
            artifacts: taskContext.artifacts || [],
            relatedTasks: taskContext.relatedTasks || [],
            // Cross-plan references (v1.1): task can reference prior plan outputs
            references: (task as any).references || [],
          },
        });
        tasksQueued++;
      }

      // Rebuild DAG from TaskStore
      this.dagResolver.rebuild(this.taskStore);

      // Update state
      this.state = "executing";
      const goalId = toGoalId(planToApprove.goal || planId);
      this.currentGoalId = goalId;
      this.workerPool.setTeamId(this.teamId);

      // ─── CRDT Persistence ───────────────────────────────────────────
      // Resolve CRDT stores for this goal (lazy — goal-scoped)
      if (this.crdtTaskSyncProxy?.resolveForGoal) {
        this.crdtTaskSyncProxy.resolveForGoal(goalId);
      }

      // R5-1 FIX: Update CollaborationPlugin goalId so collab tool reads from correct space
      const collabPlugin = this.pluginRegistry?.get("collaboration");
      if (collabPlugin && typeof (collabPlugin as any).setGoalId === 'function') {
        (collabPlugin as any).setGoalId(goalId);
        log.info(`[approvePlan] CollaborationPlugin goalId set to "${goalId}"`);
      }

      // R2-#1 FIX: Update WorkerPool with resolved CRDT instance
      const resolvedCrdtSync = this.crdtTaskSyncProxy?.get?.();
      if (resolvedCrdtSync) {
        this.workerPool.setTaskServices({
          taskStore: this.taskStore,
          dagResolver: this.dagResolver,
          teamRoles: this.teamRoles,
          crdtTaskSync: resolvedCrdtSync,
          planId,
          goalId,
        });
      }

      // Persist goal, plan, and tasks to CRDT (durable, agent-browseable)
      const crdtGoalStore = this.crdtGoalStoreProxy?.get?.();
      if (crdtGoalStore) {
        await crdtGoalStore.saveGoal(
          goalId,
          planToApprove.goal || planId,
          planToApprove.goal || "",
        );
        await crdtGoalStore.updateStatus("executing", planId);
      }

      const crdtTaskSync = this.crdtTaskSyncProxy?.get?.();
      if (crdtTaskSync) {
        // R6-4 FIX: Persist each task to CRDT with error handling
        let persistedCount = 0;
        const allTasks = this.taskStore.getAll();
        for (const task of allTasks) {
          try {
            await crdtTaskSync.persistTask(task);
            persistedCount++;
          } catch (err) {
            log.error(`[approvePlan] Failed to persist task ${task.id} to CRDT: ${err}`);
          }
        }
        log.info(`[approvePlan] Persisted ${persistedCount}/${allTasks.length} tasks to CRDT`);
        // Persist plan overview to CRDT
        try {
          await crdtTaskSync.persistPlan(planToApprove, goalId);
        } catch (err) {
          log.error(`[approvePlan] Failed to persist plan to CRDT: ${err}`);
        }
        // Update task index
        try {
          await crdtTaskSync.updateIndex(allTasks);
        } catch (err) {
          log.error(`[approvePlan] Failed to update CRDT task index: ${err}`);
        }
      }
      // ────────────────────────────────────────────────────────────────

      // Persist plan
      if (this.planStore) {
        await this.planStore.savePlan(planToApprove, { goalId, status: "approved" });
        await this.planStore.updatePlanStatus(planId, goalId, "executing");
      }

      // Notify frontend
      this.callbacks.onPlanApproved?.({
        planId,
        teamId: this.teamId,
        tasksQueued,
        timestamp: new Date().toISOString(),
      });

      return { success: true, tasksQueued };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE QUERIES (read-only — used by tools and AgentManager)
  // ═══════════════════════════════════════════════════════════════════

  getState(): OrchestratorState { return this.state; }
  setState(state: OrchestratorState) { this.state = state; }
  getPendingPlan() { return this.pendingPlan; }
  setPendingPlan(plan: any) { this.pendingPlan = plan; }
  getAutoExecute(): boolean { return this.autoExecute; }
  setAutoExecute(enabled: boolean) {
    this.autoExecute = enabled;
    // When toggled ON, dispatch any tasks already sitting in "ready" state
    if (enabled) this.dispatchReadyTasks();
  }
  getTeamId(): string { return this.teamId; }
  getTeamRoles(): string[] { return this.teamRoles; }
  getCurrentGoalId(): string | null { return this.currentGoalId; }
  getCallbacks(): OrchestratorCallbacks { return this.callbacks; }
  getTaskStore(): TaskStore { return this.taskStore; }
  getDagResolver(): DependencyResolver { return this.dagResolver; }
  getUserInteractionManager(): UserInteractionManager | undefined { return this.uim; }

  // ═══════════════════════════════════════════════════════════════════
  // TASK LIFECYCLE CALLBACKS (wired from RoleTaskQueue via TaskStore)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Scan all tasks for "ready" status and dispatch them.
   * Called when autoExecute is toggled ON to flush tasks that became ready while OFF.
   */
  private dispatchReadyTasks(): void {
    const readyTasks = this.taskStore.getByStatus("ready");
    for (const task of readyTasks) {
      if (this.activeDispatches.has(task.id)) continue;
      // Re-use the same onTaskReady path which handles concurrency limits
      this.onTaskReady({ taskId: task.id, role: task.assigned_role });
    }
  }

  /** Task became ready → dispatch to WorkerPool (if autoExecute ON), else notify frontend */
  private async onTaskReady({ taskId, role }: { taskId: string; role: string }): Promise<void> {
    log.info(`onTaskReady: ${taskId} (${role})`);

    // Always notify frontend that the task is ready
    this.callbacks.onTaskUpdate?.({
      taskId, status: "ready", role, timestamp: Date.now(),
    });

    if (!this.autoExecute) return;

    // Guard against double-dispatch (onTaskReady can fire from both create() and completeTask()).
    if (this.activeDispatches.has(taskId)) return;

    // Concurrency limit: defer if too many active dispatches
    if (this.activeDispatches.size >= MAX_CONCURRENT_DISPATCHES) {
      log.info(`Concurrency limit reached (${this.activeDispatches.size}/${MAX_CONCURRENT_DISPATCHES}), deferring ${taskId}`);
      this.deferredDispatches.push({ taskId, role });
      return;
    }

    this.activeDispatches.add(taskId);

    this.dispatchTask(taskId, role).catch((err) => {
      log.error(`Auto-dispatch error for ${taskId}:`, err);
    }).finally(() => {
      this.activeDispatches.delete(taskId);
      this.drainDeferredDispatches();
    });
  }

  /** Drain deferred dispatches when a slot opens up */
  private drainDeferredDispatches(): void {
    while (
      this.deferredDispatches.length > 0 &&
      this.activeDispatches.size < MAX_CONCURRENT_DISPATCHES
    ) {
      const next = this.deferredDispatches.shift()!;
      if (this.activeDispatches.has(next.taskId)) continue;

      // Re-check task state (may have been cancelled/completed while waiting)
      const task = this.taskStore.get(next.taskId);
      if (!task || task.status === "completed" || task.status === "failed") continue;

      this.activeDispatches.add(next.taskId);
      this.dispatchTask(next.taskId, next.role).catch((err) => {
        log.error(`Deferred dispatch error for ${next.taskId}:`, err);
      }).finally(() => {
        this.activeDispatches.delete(next.taskId);
        this.drainDeferredDispatches();
      });
    }
  }

  /**
   * Manually dispatch a ready task. Used when autoExecute is OFF and the user
   * triggers start-task from the frontend.
   */
  async manualDispatch(taskId: string): Promise<void> {
    const task = this.taskStore.get(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (task.status !== "ready" && task.status !== "pending") {
      throw new Error(`Task ${taskId} is not ready (status: ${task.status})`);
    }
    if (this.activeDispatches.has(taskId)) {
      throw new Error(`Task ${taskId} is already being dispatched`);
    }
    this.activeDispatches.add(taskId);

    const role = task.assigned_role;
    // Manual dispatch is serialized (caller awaits) so UI gets immediate feedback
    this.manualDispatchChain = this.manualDispatchChain
      .then(() => this.dispatchTask(taskId, role))
      .catch((err) => { log.error(`Dispatch error for ${taskId}:`, err); })
      .finally(() => this.activeDispatches.delete(taskId));
    await this.manualDispatchChain;
  }

  /** Task completed → check if all done, notify planner */
  private onTaskComplete({ taskId, output }: { taskId: string; output: any }): void {
    log.info(`onTaskComplete: ${taskId}`);
    this.taskAttempts.delete(taskId); // Clean up retry tracking
    const task = this.taskStore.get(taskId);

    this.callbacks.onTaskUpdate?.({
      taskId, status: "completed", role: task?.assigned_role, output, timestamp: Date.now(),
    });

    if (this.taskStore.isAllComplete()) {
      // Check if we're in research phase → transition to planning, not idle
      if (this.state === "researching") {
        this.state = "idle"; // Back to idle — planner can now call submit_plan
        this.notifyPlanner(
          PromptLoader.loadTemplate("orchestrator", "research-complete"),
        );
        this.callbacks.onProgress?.({
          teamId: this.teamId, state: "idle",
          message: "Research complete — ready for planning",
          timestamp: new Date().toISOString(),
        });
      } else {
        this.state = "idle";
        this.notifyPlanner(PromptLoader.loadTemplate("orchestrator", "all-complete"));
        this.callbacks.onProgress?.({
          teamId: this.teamId, state: "idle",
          message: "All tasks completed successfully",
          timestamp: new Date().toISOString(),
        });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // R9-2 FIX: Dependency failure cascade
  // When a task fails or bounces, handle its downstream dependants
  // based on the onDependencyFail strategy (default: notify planner)
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle dependency failure — applies onDependencyFail strategy to downstream tasks.
   * Called from both onTaskFailed() and onBounce().
   *
   * Strategies:
   * - "replan" (default for bounced tasks): notify planner, keep dependants pending
   * - "fail": cascade failure to all dependants recursively
   * - "skip": mark dependants as completed with skip note
   */
  private handleTaskFailure(taskId: string, reason: string): void {
    const task = this.taskStore.get(taskId);
    if (!task) return;

    // Find direct dependants
    const dependants = this.taskStore.getAll().filter(
      (t) => t.prerequisites?.has(taskId) && t.status !== "completed" && t.status !== "failed"
    );

    if (dependants.length === 0) return;

    for (const dep of dependants) {
      const strategy = (dep.context as any)?.onDependencyFail || "replan";

      switch (strategy) {
        case "fail":
          // Cascade failure
          this.taskStore.updateStatus(dep.id, "failed");
          this.callbacks.onTaskUpdate?.({
            taskId: dep.id, status: "failed", role: dep.assigned_role, timestamp: Date.now(),
          });
          log.info(`[DependencyFail] Cascaded failure: ${taskId} → ${dep.id} (${dep.assigned_role})`);
          // Recurse for transitive dependants
          this.handleTaskFailure(dep.id, `Upstream dependency ${taskId} failed`);
          break;

        case "skip":
          // Mark as completed with skip note
          this.taskStore.completeTask(dep.id, {
            summary: `Skipped: upstream dependency ${taskId} failed`,
            skipped: true,
            skipReason: reason,
          });
          this.callbacks.onTaskUpdate?.({
            taskId: dep.id, status: "completed", role: dep.assigned_role, timestamp: Date.now(),
          });
          log.info(`[DependencyFail] Skipped: ${dep.id} (upstream ${taskId} failed)`);
          break;

        case "replan":
        default:
          // Keep pending — planner will decide what to do
          // The planner notification from onTaskFailed/onBounce includes blocked task info
          log.info(`[DependencyFail] Awaiting planner decision for ${dep.id} (blocked by ${taskId})`);
          break;
      }
    }
  }

  /** Task failed → notify plugins, notify planner for decision */
  private onTaskFailed({ taskId, error }: { taskId: string; error: string }): void {
    log.error(`onTaskFailed: ${taskId}: ${error}`);
    const task = this.taskStore.get(taskId);

    // Notify plugins (workspace cleanup, etc.)
    this.pluginRegistry?.onTaskFailed(taskId).catch((err) => {
      log.warn(`Plugin onTaskFailed error for ${taskId}: ${err}`);
    });

    // ─── CRDT Persistence ───
    // Fix #3: Explicit null guard with warning log
    const crdtSync = this.crdtTaskSyncProxy?.get?.();
    if (crdtSync) {
      crdtSync.syncStatus(taskId, "failed").catch((err: any) => {
        log.warn(`CRDT sync failed for task ${taskId}: ${err}`);
      });
      crdtSync.updateIndex(this.taskStore.getAll()).catch(() => {});
    } else {
      log.debug(`CRDT not resolved — skipping failed status sync for ${taskId}`);
    }
    // ───────────────────────

    // R2-#2 FIX: Check if we're in researching state and all tasks are done (including failures)
    const allTasksDone = this.taskStore.getAll().every(
      (t) => t.status === "completed" || t.status === "failed"
    );
    if (this.state === "researching" && allTasksDone) {
      this.state = "idle";
      this.notifyPlanner(
        PromptLoader.loadTemplate("orchestrator", "research-failed"),
      );
      this.callbacks.onProgress?.({
        teamId: this.teamId, state: "idle",
        message: "Research phase completed with failures",
        timestamp: new Date().toISOString(),
      });
    }

    this.callbacks.onTaskUpdate?.({
      taskId, status: "failed", role: task?.assigned_role, timestamp: Date.now(),
    });

    // R9-2 FIX: Handle dependency failure cascade for downstream tasks
    this.handleTaskFailure(taskId, error);

    // Identify downstream tasks blocked by this failure (for planner notification)
    const blockedTasks = this.taskStore.getAll()
      .filter(t => t.prerequisites?.has(taskId) && t.status !== "completed" && t.status !== "failed")
      .map(t => `${t.id} (${t.assigned_role})`)
      .join(", ") || null;

    this.notifyPlanner(
      PromptLoader.loadTemplate("orchestrator", "task-failed", {
        description: task?.description || taskId,
        role: task?.assigned_role || "unknown",
        error,
        blockedSuffix: blockedTasks
          ? `⚠️ Blocked downstream tasks: ${blockedTasks}\n`
          : "",
      }),
    );
  }

  /** Worker completed via complete_task tool → notify plugins, mark complete */
  private async onWorkerDone(data: {
    taskId: string; role: string; summary: string;
    deliverables?: string[]; nextSteps?: string[]; timestamp: number;
  }): Promise<void> {
    console.log(`[OrchestratorService] Worker done: ${data.taskId}`);

    // Notify plugins (workspace publish + merge, etc.)
    let mergeWarning = "";
    if (this.pluginRegistry) {
      try {
        const result = await this.pluginRegistry.onTaskComplete(data.taskId, this.currentGoalId || undefined);
        if (!result.success) {
          mergeWarning = `Warning: plugin onTaskComplete failed for task ${data.taskId}: ${result.error}. ` +
            `Work may be on branch but not merged to main.`;
          console.warn(`[OrchestratorService] ${mergeWarning}`);
        }
      } catch (err) {
        mergeWarning = `Warning: plugin cleanup failed for task ${data.taskId}: ${err}`;
        console.warn(`[OrchestratorService] ${mergeWarning}`);
      }
    }

    // Mark complete in TaskStore → triggers onTaskComplete via RoleTaskQueue
    // Newly ready dependants are queued → onTaskReady fires → auto-dispatch if enabled
    this.taskStore.completeTask(data.taskId, {
      summary: data.summary + (mergeWarning ? `\n${mergeWarning}` : ""),
      deliverables: data.deliverables,
      nextSteps: data.nextSteps, completedBy: "agent", timestamp: data.timestamp,
    });

    // ─── CRDT Persistence ───────────────────────────────────────────
    // Fix #3: Explicit null guard with warning log
    const crdtSyncDone = this.crdtTaskSyncProxy?.get?.();
    if (crdtSyncDone) {
      await crdtSyncDone.syncStatus(data.taskId, "completed", {
        summary: data.summary,
        deliverables: data.deliverables,
        nextSteps: data.nextSteps,
      });
      await crdtSyncDone.updateIndex(this.taskStore.getAll());
    } else {
      log.debug(`CRDT not resolved — skipping completed status sync for ${data.taskId}`);
    }
    // ────────────────────────────────────────────────────────────────
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /** Dispatch a single task to WorkerPool. */
  private async dispatchTask(taskId: string, role: string): Promise<void> {
    const task = this.taskStore.get(taskId);
    if (!task || task.status === "completed" || task.status === "failed") return;

    this.taskStore.updateStatus(taskId, "in_progress");

    this.callbacks.onTaskUpdate?.({
      taskId, status: "in_progress", role, timestamp: Date.now(),
    });

    this.callbacks.onProgress?.({
      teamId: this.teamId, state: "executing",
      message: `Starting task: ${task.description}`, taskId, role,
      timestamp: new Date().toISOString(),
    });

    try {
      // ─── CollabTaskDispatcher: Initialize CRDT docs for collaboration tasks ───
      // Fix #14: Use encapsulated initCollabDocs() instead of accessing .space directly
      const taskType = (task.context as any)?.type;
      if (taskType === "collaboration" && this.crdtTaskSyncProxy?.get?.()) {
        try {
          const collabConfig = (task.context as any)?.collaboration || {};
          await this.crdtTaskSyncProxy.get().initCollabDocs(taskId, collabConfig);
          log.info(`Initialized collaboration CRDT docs for task ${taskId}`);
        } catch (err) {
          log.warn(`Failed to initialize collab docs for ${taskId}: ${err}`);
        }
      }
      // ──────────────────────────────────────────────────────────────────────────

      // Context is pre-built by TaskStore.enrichDependantContext() at upstream completion time.
      // Planner-provided context (notes, files, artifacts) is already on task.context from create().
      // We just read — no assembly logic here.
      const taskCtx = (typeof task.context === "object" ? task.context : {}) as Record<string, any>;

      const previousOutputs = Array.isArray(taskCtx.upstreamOutputs) ? taskCtx.upstreamOutputs : [];
      const artifacts = [
        ...(Array.isArray(taskCtx.upstreamArtifacts) ? taskCtx.upstreamArtifacts : []),
        ...(Array.isArray(taskCtx.files) ? taskCtx.files : []),
        ...(Array.isArray(taskCtx.artifacts) ? taskCtx.artifacts : []),
      ];

      // ─── CRDT Context Enrichment ─────────────────────────────────────
      // Inject CRDT references so agents can use `collab read` to access task details
      let crdtRefs: Record<string, any> | undefined;
      const crdtSyncDispatch = this.crdtTaskSyncProxy?.get?.();
      if (crdtSyncDispatch) {
        crdtRefs = crdtSyncDispatch.getCrdtRefs(taskId, task);
        // Sync status to in_progress in CRDT
        await crdtSyncDispatch.syncStatus(taskId, "in_progress");
      } else {
        log.debug(`CRDT not resolved — agent won't have collab read access for ${taskId}`);
      }
      // ────────────────────────────────────────────────────────────────

      // Enrich description with planner notes + upstream notes + expected output
      let enrichedDescription = task.description;

      const allNotes: string[] = [
        ...(Array.isArray(taskCtx.notes) ? taskCtx.notes : taskCtx.notes ? [taskCtx.notes] : []),
        ...(Array.isArray(taskCtx.upstreamNotes) ? taskCtx.upstreamNotes : []),
      ];
      if (allNotes.length > 0) {
        enrichedDescription += `\n\nNotes:\n${allNotes.map((n: string) => `- ${n}`).join("\n")}`;
      }
      if (taskCtx.expectedOutput) {
        enrichedDescription += `\n\nExpected output: ${taskCtx.expectedOutput}`;
      }

      // ─── Cross-Plan Reference Resolution (v1.1) ─────────────────────
      const references = Array.isArray(taskCtx.references) ? taskCtx.references : [];
      const unresolvedRefs: string[] = [];  // R2-#5: Track failures
      if (references.length > 0 && this.planStore) {
        const priorOutputs: string[] = [];
        for (const ref of references) {
          try {
            // ref format: "plan-001/task-003" or "{goalId}/task-003"
            const [refPlanOrGoal, refTaskId] = ref.split("/");
            if (!refTaskId) {
              unresolvedRefs.push(`${ref} (invalid format)`);
              continue;
            }

            // Try loading from PlanStore
            const allPlans = await this.planStore.listAllPlans();
            const matchPlan = allPlans.find((p: any) => p.planId === refPlanOrGoal || p.goalId === refPlanOrGoal);
            if (matchPlan) {
              const stored = await this.planStore.loadPlan(matchPlan.planId, matchPlan.goalId);
              const refTask = stored?.plan?.tasks?.find((t: any) => t.id === refTaskId);
              if (refTask?.output) {
                const summary = typeof refTask.output === "string" ? refTask.output : JSON.stringify(refTask.output).slice(0, 500);
                priorOutputs.push(`- ${ref}: ${summary}`);
              } else {
                unresolvedRefs.push(`${ref} (task found, no output)`);
              }
            } else {
              unresolvedRefs.push(`${ref} (plan/goal not found)`);
            }
          } catch (err) {
            unresolvedRefs.push(`${ref} (error: ${err})`);
          }
        }
        if (priorOutputs.length > 0) {
          enrichedDescription += `\n\n## Prior Work (from previous plans)\n${priorOutputs.join("\n")}`;
        }
        // R2-#5 FIX: Warn agent about unresolved references
        if (unresolvedRefs.length > 0) {
          log.warn(`Task ${taskId}: ${unresolvedRefs.length}/${references.length} cross-plan refs unresolved`);
          enrichedDescription += `\n\n⚠️ Unresolved references (${unresolvedRefs.length}): ${unresolvedRefs.join(", ")}`;
        }
      }
      // ────────────────────────────────────────────────────────────────

      // Fix #15: Add CRDT references to agent prompt so agents know how to access task details
      if (crdtRefs) {
        enrichedDescription += `\n\n## Context Sources (use collab read to access)`;
        enrichedDescription += `\n- Your task: collab read ${crdtRefs.task}`;
        enrichedDescription += `\n- Plan: collab read ${crdtRefs.plan}`;
        enrichedDescription += `\n- Goal: collab read ${crdtRefs.goal}`;
        if (crdtRefs.dependencies?.length) {
          enrichedDescription += `\n- Completed dependencies: ${crdtRefs.dependencies.join(", ")}`;
        }
        if (crdtRefs.dependants?.length) {
          enrichedDescription += `\n- Downstream (depends on you): ${crdtRefs.dependants.join(", ")}`;
        }
      }

      // R8: Inject team roster so agents know who they can create tasks for
      if (this.teamRoles.length > 0) {
        const otherRoles = this.teamRoles.filter(r => r.toLowerCase() !== role.toLowerCase());
        if (otherRoles.length > 0) {
          enrichedDescription += `\n\n## Your Team`;
          enrichedDescription += `\nOther roles you can collaborate with or create tasks for:`;
          enrichedDescription += otherRoles.map(r => `\n- ${r}`).join("");
          enrichedDescription += `\n\nIf you need work from another role, use request_task({ targetRole: "role-name", relationship: "blocks-me" }).`;
          enrichedDescription += `\nIf this task is wrong for your role, use bounce_task().`;
        }
      }

      await this.workerPool.runTask({
        id: taskId, assigned_role: role, description: enrichedDescription,
        priority: task.priority || 0,
        context: { previousOutputs, artifacts, crdtRefs },
        createdAt: Date.now(), status: "in_progress",
      });

      // If worker finished without calling complete_task (generated text and stopped),
      // auto-complete the task. The worker's text response is its output.
      const afterTask = this.taskStore.get(taskId);
      if (afterTask && afterTask.status === "in_progress") {
        console.log(`[OrchestratorService] Worker finished without complete_task, auto-completing ${taskId}`);
        this.taskStore.completeTask(taskId, {
          summary: "Task completed (auto-completed — worker finished without calling complete_task)",
          completedBy: "auto",
          timestamp: Date.now(),
        });
        // Newly ready tasks are handled by RoleTaskQueue → onTaskReady callback.
        // No need to emit onTaskUpdate(ready) here — onTaskReady does it.
      }
    } catch (error: any) {
      if (this.taskStore.get(taskId)?.status === "completed") return;

      // Classify the error to determine if auto-retry is safe
      const attempt = this.taskAttempts.get(taskId) || 1;
      const report = classifyError(taskId, role, error, attempt);

      log.warn(`Task ${taskId} failed (attempt ${attempt}/${MAX_TASK_RETRIES}): [${report.errorCategory}] ${report.message.slice(0, 200)}`);

      if (report.retriable && attempt < MAX_TASK_RETRIES) {
        // Exponential backoff: 10s, 30s, 60s (generous for 429 retry-after)
        const backoffMs = Math.min(10_000 * Math.pow(2, attempt - 1), 60_000);
        log.info(`Auto-retrying task ${taskId} in ${backoffMs / 1000}s (attempt ${attempt + 1}/${MAX_TASK_RETRIES})`);

        this.taskAttempts.set(taskId, attempt + 1);

        this.callbacks.onTaskUpdate?.({
          taskId, status: "ready", role, timestamp: Date.now(),
        });

        // Reset to ready so state machine allows re-dispatch
        try { this.taskStore.updateStatus(taskId, "failed"); } catch { /* already failed */ }
        try { this.taskStore.updateStatus(taskId, "ready"); } catch { /* guard */ }

        // Schedule retry after backoff
        setTimeout(() => {
          const retryTask = this.taskStore.get(taskId);
          if (!retryTask || retryTask.status !== "ready") return;

          if (this.activeDispatches.has(taskId)) return;
          this.activeDispatches.add(taskId);

          this.dispatchTask(taskId, role).catch((err) => {
            log.error(`Retry dispatch error for ${taskId}:`, err);
          }).finally(() => {
            this.activeDispatches.delete(taskId);
            this.drainDeferredDispatches();
          });
        }, backoffMs);
      } else {
        // Non-retriable or max retries exceeded — fail permanently
        if (attempt >= MAX_TASK_RETRIES) {
          log.error(`Task ${taskId} exhausted all ${MAX_TASK_RETRIES} retry attempts, failing permanently`);
        }
        this.taskAttempts.delete(taskId);
        try { this.taskStore.updateStatus(taskId, "failed"); } catch { /* already failed */ }
        this.taskStore.queue.failTask(taskId, error.message);
      }
    }
  }

  /** Notify planner via NotificationQueue (debounce) or direct callback. */
  private notifyPlanner(message: string): void {
    if (this.notificationQueue) {
      this.notificationQueue.push(message);
    } else {
      this.callbacks.onPlannerInput?.(message);
    }
  }

  /** Load active plan from disk for restart recovery. */
  private async loadActivePlan(): Promise<void> {
    if (!this.planStore) return;
    try {
      const stored = await this.planStore.getLatestActivePlan();
      if (!stored) return;
      this.currentGoalId = stored.metadata.goalId || null;

      if (stored.metadata.status === "approved") {
        this.pendingPlan = stored.plan;
        this.state = "awaiting_approval";
      } else if (stored.metadata.status === "executing") {
        const dep = new Map<string, string[]>();
        for (const t of stored.plan.tasks) {
          for (const d of t.dependencies) {
            const e = dep.get(d) || []; e.push(t.id); dep.set(d, e);
          }
        }
        for (const t of stored.plan.tasks) {
          this.taskStore.create({
            id: t.id,
            description: `${t.title}: ${t.description}`,
            assigned_role: t.assignedRole.toLowerCase(),
            status: "pending",
            prerequisites: new Map(t.dependencies.map((d: string) => [d, false] as [string, boolean])),
            dependants: dep.get(t.id) || [],
            context: { title: t.title, planId: stored.plan.planId, goal: stored.plan.goal },
          });
        }
        this.state = "executing";
      }
    } catch (error) {
      console.error("[OrchestratorService] Failed to load active plan:", error);
    }
  }

  reset(): void { this.state = "idle"; this.pendingPlan = null; this.messages = []; }

  async resetPlan(): Promise<{ deleted: boolean; planId?: string }> {
    try {
      if (this.planStore) {
        const s = await this.planStore.getLatestActivePlan();
        if (s && (s.metadata.status === "executing" || s.metadata.status === "approved")) {
          await this.planStore.archivePlan(s.plan.planId, s.metadata.goalId);
          this.reset(); return { deleted: true, planId: s.plan.planId };
        }
      }
      this.reset(); return { deleted: false };
    } catch { this.reset(); return { deleted: false }; }
  }

  async interruptPlan(): Promise<void> {
    if (!this.planStore) return;
    try {
      const s = await this.planStore.getLatestActivePlan();
      if (s?.metadata.status === "executing") {
        await this.planStore.updatePlanStatus(s.plan.planId, s.metadata.goalId, "interrupted");
      }
    } catch { /* best effort */ }
  }

  dispose(): void { this.uim?.cancelAll(); this.notificationQueue?.dispose(); }
}
