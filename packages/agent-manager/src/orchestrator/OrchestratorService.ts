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
 *
 * For PLANNER_MODE=legacy rollback, see LegacyOrchestratorService.ts
 */

import type { WorkerPool } from "../services/WorkerPool.js";
import type { TaskStore } from "./TaskStore.js";
import type { DependencyResolver } from "./DependencyResolver.js";
import type { NotificationQueue } from "./NotificationQueue.js";
import type { UserInteractionManager } from "./UserInteractionManager.js";
import { toGoalId } from "../plugin/utils.js";
import type {
  OrchestratorState,
  OrchestratorCallbacks,
  OrchestratorMessage,
} from "./types.js";

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

  // Optional services
  userInteractionManager?: UserInteractionManager;
  notificationQueue?: NotificationQueue;
  planStore?: any;

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

  // Optional services
  private uim?: UserInteractionManager;
  private notificationQueue?: NotificationQueue;
  private planStore: any;

  // State — only 2 states in planner mode (planner manages its own phases)
  private state: OrchestratorState = "idle";
  private sessionId: string;
  private currentGoalId: string | null = null;
  private messages: OrchestratorMessage[] = [];
  private autoExecute: boolean;

  // Serialization chains (prevent race conditions)
  private dispatchChain: Promise<void> = Promise.resolve();
  private messageChain: Promise<string> = Promise.resolve("");

  // Pending plan (between submit_plan and approve)
  private pendingPlan: any = null;

  constructor(config: OrchestratorServiceConfig) {
    this.teamId = config.teamId;
    this.teamRoles = config.teamRoles;
    this.taskStore = config.taskStore;
    this.workerPool = config.workerPool;
    this.dagResolver = config.dagResolver;
    this.uim = config.userInteractionManager;
    this.notificationQueue = config.notificationQueue;
    this.planStore = config.planStore;
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
  setAutoExecute(enabled: boolean) { this.autoExecute = enabled; }
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

  /** Task became ready → dispatch to WorkerPool (if autoExecute ON) */
  private async onTaskReady({ taskId, role }: { taskId: string; role: string }): Promise<void> {
    console.log(`[OrchestratorService] onTaskReady: ${taskId} (${role})`);

    if (!this.autoExecute) return;

    this.dispatchChain = this.dispatchChain
      .then(() => this.dispatchTask(taskId, role))
      .catch((err) => console.error(`[OrchestratorService] Dispatch error for ${taskId}:`, err));
  }

  /** Task completed → check if all done, notify planner */
  private onTaskComplete({ taskId, output }: { taskId: string; output: any }): void {
    console.log(`[OrchestratorService] onTaskComplete: ${taskId}`);
    const task = this.taskStore.get(taskId);

    this.callbacks.onTaskUpdate?.({
      taskId, status: "completed", role: task?.assigned_role, output, timestamp: Date.now(),
    });

    if (this.taskStore.isAllComplete()) {
      this.state = "idle";
      this.notifyPlanner("All tasks completed successfully.");
      this.callbacks.onProgress?.({
        teamId: this.teamId, state: "idle",
        message: "All tasks completed successfully",
        timestamp: new Date().toISOString(),
      });
    }
  }

  /** Task failed → notify planner for decision */
  private onTaskFailed({ taskId, error }: { taskId: string; error: string }): void {
    console.error(`[OrchestratorService] onTaskFailed: ${taskId}: ${error}`);
    const task = this.taskStore.get(taskId);

    this.callbacks.onTaskUpdate?.({
      taskId, status: "failed", role: task?.assigned_role, timestamp: Date.now(),
    });

    this.notifyPlanner(
      `❌ Task "${task?.description || taskId}" (${task?.assigned_role || "unknown"}) failed: ${error}\n` +
      `Use get_status to see current state. Options: replan, add_tasks, remove_task.`,
    );
  }

  /** Worker completed via complete_task tool → publish workspace, mark complete */
  private async onWorkerDone(data: {
    taskId: string; role: string; summary: string;
    deliverables?: string[]; nextSteps?: string[]; timestamp: number;
  }): Promise<void> {
    console.log(`[OrchestratorService] Worker done: ${data.taskId}`);

    // Publish workspace + merge branch
    let mergeWarning = "";
    try {
      const workspace = this.workerPool.getWorkspace(data.taskId);
      if (workspace) await workspace.publish(this.currentGoalId || undefined);
      const merge = await this.workerPool.mergeAndCleanup(data.taskId);
      if (!merge.success) {
        mergeWarning = `Warning: workspace merge failed for task ${data.taskId}: ${merge.error}. ` +
          `Work is on branch but not merged to main.`;
        console.warn(`[OrchestratorService] ${mergeWarning}`);
      }
    } catch (err) {
      mergeWarning = `Warning: workspace cleanup failed for task ${data.taskId}: ${err}`;
      console.warn(`[OrchestratorService] ${mergeWarning}`);
    }

    // Mark complete in TaskStore → triggers onTaskComplete via RoleTaskQueue
    const newlyReady = this.taskStore.completeTask(data.taskId, {
      summary: data.summary + (mergeWarning ? `\n${mergeWarning}` : ""),
      deliverables: data.deliverables,
      nextSteps: data.nextSteps, completedBy: "agent", timestamp: data.timestamp,
    });

    for (const readyTask of newlyReady) {
      this.callbacks.onTaskUpdate?.({
        taskId: readyTask.id, status: "ready", role: readyTask.assigned_role, timestamp: Date.now(),
      });
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // INTERNAL HELPERS
  // ═══════════════════════════════════════════════════════════════════

  /** Dispatch a single task to WorkerPool. */
  private async dispatchTask(taskId: string, role: string): Promise<void> {
    const task = this.taskStore.get(taskId);
    if (!task || task.status === "completed" || task.status === "failed") return;

    this.taskStore.updateStatus(taskId, "in_progress");

    this.callbacks.onProgress?.({
      teamId: this.teamId, state: "executing",
      message: `Starting task: ${task.description}`, taskId, role,
      timestamp: new Date().toISOString(),
    });

    try {
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

      await this.workerPool.runTask({
        id: taskId, assigned_role: role, description: enrichedDescription,
        priority: task.priority || 0,
        context: { previousOutputs, artifacts },
        createdAt: Date.now(), status: "in_progress",
      });

      // If worker finished without calling complete_task (generated text and stopped),
      // auto-complete the task. The worker's text response is its output.
      const afterTask = this.taskStore.get(taskId);
      if (afterTask && afterTask.status === "in_progress") {
        console.log(`[OrchestratorService] Worker finished without complete_task, auto-completing ${taskId}`);
        const newlyReady = this.taskStore.completeTask(taskId, {
          summary: "Task completed (auto-completed — worker finished without calling complete_task)",
          completedBy: "auto",
          timestamp: Date.now(),
        });
        for (const readyTask of newlyReady) {
          this.callbacks.onTaskUpdate?.({
            taskId: readyTask.id, status: "ready", role: readyTask.assigned_role, timestamp: Date.now(),
          });
        }
      }
    } catch (error: any) {
      if (this.taskStore.get(taskId)?.status !== "completed") {
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
