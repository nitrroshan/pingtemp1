/**
 * GoalManager — Goal Lifecycle Manager
 *
 * Responsibility: Own goal state, plan approval, task completion detection,
 * failure cascade, restart recovery. Delegates dispatch to OrchestratorService.
 *
 * Extracted from OrchestratorService (Phase 3.5, SRP refactor).
 * Single-goal for now. Phase 4 adds Map<goalId, GoalContext>.
 */

import type { TaskStore } from "./TaskStore.js";
import type { DependencyResolver } from "./DependencyResolver.js";
import type { WorkerPool } from "../services/WorkerPool.js";
import type { PluginRegistry } from "../plugin/PluginRegistry.js";
import type { CrdtProxy } from "./OrchestratorService.js";
import type { OrchestratorState, GoalManagerCallbacks, IGoalManager } from "./types.js";
import { toGoalId } from "../plugin/utils.js";
import { PromptLoader } from "./PromptLoader.js";
import { rootLogger } from "../logging.js";

const log = rootLogger.child({ module: "GoalManager" });

// ═══════════════════════════════════════════════════════════════════
// CONFIG
// ═══════════════════════════════════════════════════════════════════

export interface GoalManagerConfig {
  teamId: string;
  teamRoles: string[];
  taskStore: TaskStore;
  dagResolver: DependencyResolver;
  workerPool: WorkerPool;
  pluginRegistry?: PluginRegistry;
  planStore?: any;
  crdtTaskSync?: CrdtProxy;
  crdtGoalStore?: CrdtProxy;
  autoExecute: boolean;
  callbacks: GoalManagerCallbacks;
}

// ═══════════════════════════════════════════════════════════════════
// GOAL MANAGER
// ═══════════════════════════════════════════════════════════════════

export class GoalManager implements IGoalManager {
  private teamId: string;
  private teamRoles: string[];
  private taskStore: TaskStore;
  private dagResolver: DependencyResolver;
  private workerPool: WorkerPool;
  private pluginRegistry?: PluginRegistry;
  private planStore: any;
  private crdtTaskSyncProxy?: CrdtProxy;
  private crdtGoalStoreProxy?: CrdtProxy;
  private autoExecute: boolean;
  private callbacks: GoalManagerCallbacks;

  // Goal state (single-goal — Phase 4 makes this per-goal via Map)
  private state: OrchestratorState = "idle";
  private currentGoalId: string | null = null;
  private pendingPlan: any = null;

  constructor(config: GoalManagerConfig) {
    this.teamId = config.teamId;
    this.teamRoles = config.teamRoles;
    this.taskStore = config.taskStore;
    this.dagResolver = config.dagResolver;
    this.workerPool = config.workerPool;
    this.pluginRegistry = config.pluginRegistry;
    this.planStore = config.planStore;
    this.crdtTaskSyncProxy = config.crdtTaskSync;
    this.crdtGoalStoreProxy = config.crdtGoalStore;
    this.autoExecute = config.autoExecute;
    this.callbacks = config.callbacks;
    log.info(`GoalManager created for team ${config.teamId}`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE ACCESSORS
  // ═══════════════════════════════════════════════════════════════════

  getState(): OrchestratorState { return this.state; }
  setState(state: OrchestratorState): void { this.state = state; }
  getGoalId(): string | null { return this.currentGoalId; }
  getPendingPlan(): any | null { return this.pendingPlan; }
  setPendingPlan(plan: any | null): void { this.pendingPlan = plan; }
  setAutoExecute(enabled: boolean): void { this.autoExecute = enabled; }
  getAutoExecute(): boolean { return this.autoExecute; }

  // ═══════════════════════════════════════════════════════════════════
  // PLAN APPROVAL (moved from OrchestratorService.approvePlan)
  // ═══════════════════════════════════════════════════════════════════

  async approvePlan(): Promise<{ success: boolean; tasksQueued?: number; error?: string }> {
    if (!this.pendingPlan) {
      return { success: false, error: "No pending plan to approve" };
    }

    try {
      const planToApprove = this.pendingPlan;
      const planId = planToApprove.planId;
      this.pendingPlan = null;

      // Clear previous state
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
      const goalId = toGoalId(planToApprove.goal || planId);
      for (const task of planToApprove.tasks) {
        const taskContext = (task as any).context || {};
        const taskType = (task as any).type || taskContext.type || "work";
        this.taskStore.create({
          id: task.id,
          title: task.title,
          description: `${task.title}: ${task.description}`,
          assigned_role: task.assignedRole.toLowerCase(),
          status: "pending",
          priority: task.priority,
          type: taskType,
          expectedOutput: task.expectedOutput,
          goalId,
          planId,
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
            notes: taskContext.notes || "",
            files: taskContext.files || [],
            artifacts: taskContext.artifacts || [],
            relatedTasks: taskContext.relatedTasks || [],
            references: (task as any).references || [],
            type: taskType,
          },
        });
        tasksQueued++;
      }

      // Rebuild DAG from TaskStore
      this.dagResolver.rebuild(this.taskStore);

      // Update state
      this.state = "executing";
      this.currentGoalId = goalId;
      this.workerPool.setTeamId(this.teamId);

      // ─── CRDT Persistence ───
      if (this.crdtTaskSyncProxy?.resolveForGoal) {
        this.crdtTaskSyncProxy.resolveForGoal(goalId);
      }

      // Update CollaborationPlugin goalId
      const collabPlugin = this.pluginRegistry?.get("collaboration");
      if (collabPlugin && typeof (collabPlugin as any).setGoalId === "function") {
        (collabPlugin as any).setGoalId(goalId);
        log.info(`[approvePlan] CollaborationPlugin goalId set to "${goalId}"`);

        if (typeof (collabPlugin as any).setCollabCallbacks === "function") {
          (collabPlugin as any).setCollabCallbacks({
            onMentionedRoles: (roles: string[], sourceTaskId: string, docName: string, sourceRole?: string, postContent?: string) => {
              // Delegate mention routing back to OrchestratorService via callbacks
              // (spawnCollabWorkers stays in OrchestratorService — it's dispatch logic)
            },
          });
        }
      }

      // Update WorkerPool with resolved CRDT instance
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

      // Persist goal, plan, and tasks to CRDT
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
        try {
          await crdtTaskSync.persistPlan(planToApprove, goalId);
        } catch (err) {
          log.error(`[approvePlan] Failed to persist plan to CRDT: ${err}`);
        }
      }

      // Persist plan to disk
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
  // TASK LIFECYCLE CALLBACKS (wired from RoleTaskQueue via TaskStore)
  // ═══════════════════════════════════════════════════════════════════

  /** Task became ready → notify frontend, delegate dispatch to OrchestratorService */
  onTaskReady({ taskId, role }: { taskId: string; role: string }): void {
    log.info(`onTaskReady: ${taskId} (${role})`);

    this.callbacks.onTaskUpdate?.({
      taskId, status: "ready", role, timestamp: Date.now(),
    });

    // Delegate dispatch decision to OrchestratorService
    // (handles autoExecute check, ChatAgent routing, concurrency limits)
    this.callbacks.onDispatchTask(taskId, role);
  }

  /** Task completed → check if all done, notify planner */
  onTaskComplete({ taskId, output }: { taskId: string; output: any }): void {
    log.info(`onTaskComplete: ${taskId}`);
    const task = this.taskStore.get(taskId);

    this.callbacks.onTaskUpdate?.({
      taskId, status: "completed", role: task?.assigned_role, output, timestamp: Date.now(),
    });

    if (this.taskStore.isAllComplete()) {
      if (this.state === "researching") {
        this.state = "idle";
        this.callbacks.onNotifyPlanner(
          PromptLoader.loadTemplate("orchestrator", "research-complete"),
        );
        this.callbacks.onProgress?.({
          teamId: this.teamId, state: "idle",
          message: "Research complete — ready for planning",
          timestamp: new Date().toISOString(),
        });
      } else {
        const allTasks = this.taskStore.getAll();
        const failedTasks = allTasks.filter(t => t.status === "failed");
        const discardedTasks = allTasks.filter(t => t.status === "discarded");
        const completedTasks = allTasks.filter(t => t.status === "completed");

        this.state = "idle";

        if (failedTasks.length > 0) {
          this.callbacks.onNotifyPlanner(
            `⚠️ All tasks finished but ${failedTasks.length} failed:\n` +
            failedTasks.map(t => `- ${t.id} (${t.assigned_role}): ${t.description?.slice(0, 80)}`).join("\n") +
            `\n\n${completedTasks.length} completed, ${discardedTasks.length} discarded.` +
            `\n\nACTION REQUIRED — call a tool NOW:` +
            `\n- Call \`get_status\` to review details` +
            `\n- Call \`reassign_task\` to retry failed tasks` +
            `\n- Call \`replan\` to replace the plan` +
            `\n- Or tell the user the results if no recovery is possible` +
            `\nDo NOT just describe what happened — take action.`,
          );
          if (completedTasks.length === 0) {
            this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, status: "failed" });
          }
          this.callbacks.onProgress?.({
            teamId: this.teamId, state: "idle",
            message: `${completedTasks.length} completed, ${failedTasks.length} failed`,
            timestamp: new Date().toISOString(),
          });
        } else {
          const crdtSyncComplete = this.crdtTaskSyncProxy?.get?.();
          if (crdtSyncComplete?.syncPlanStatus) {
            crdtSyncComplete.syncPlanStatus("completed").catch((err: any) => {
              log.warn(`Failed to sync plan completion to CRDT: ${err}`);
            });
          }
          this.callbacks.onNotifyPlanner(PromptLoader.loadTemplate("orchestrator", "all-complete"));
          this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, status: "completed" });
          this.callbacks.onProgress?.({
            teamId: this.teamId, state: "idle",
            message: "All tasks completed successfully",
            timestamp: new Date().toISOString(),
          });
        }
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FAILURE HANDLING
  // ═══════════════════════════════════════════════════════════════════

  /**
   * Handle dependency failure — applies onDependencyFail strategy to downstream tasks.
   * Strategies: "replan" (default), "fail" (cascade), "skip" (mark complete with note)
   */
  handleTaskFailure(taskId: string, reason: string): void {
    const task = this.taskStore.get(taskId);
    if (!task) return;

    const dependants = this.taskStore.getAll().filter(
      (t) => t.prerequisites?.has(taskId) && t.status !== "completed" && t.status !== "failed"
    );

    if (dependants.length === 0) return;

    for (const dep of dependants) {
      const strategy = (dep.context as any)?.onDependencyFail || "replan";

      switch (strategy) {
        case "fail":
          this.taskStore.updateStatus(dep.id, "failed");
          this.callbacks.onTaskUpdate?.({
            taskId: dep.id, status: "failed", role: dep.assigned_role, timestamp: Date.now(),
          });
          log.info(`[DependencyFail] Cascaded failure: ${taskId} → ${dep.id} (${dep.assigned_role})`);
          this.handleTaskFailure(dep.id, `Upstream dependency ${taskId} failed`);
          break;

        case "skip":
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
          log.info(`[DependencyFail] Awaiting planner decision for ${dep.id} (blocked by ${taskId})`);
          break;
      }
    }
  }

  /** Task failed → notify plugins, sync CRDT, cascade, notify planner */
  onTaskFailed({ taskId, error }: { taskId: string; error: string }): void {
    log.error(`onTaskFailed: ${taskId}: ${error}`);
    const task = this.taskStore.get(taskId);

    if (task) {
      task.output = { error, failedAt: new Date().toISOString(), summary: `FAILED: ${error}` };
    }

    this.pluginRegistry?.onTaskFailed(taskId).catch((err) => {
      log.warn(`Plugin onTaskFailed error for ${taskId}: ${err}`);
    });

    // CRDT sync
    const crdtSync = this.crdtTaskSyncProxy?.get?.();
    if (crdtSync) {
      crdtSync.syncStatus(taskId, "failed").catch((err: any) => {
        log.warn(`CRDT sync failed for task ${taskId}: ${err}`);
      });
      crdtSync.updateIndex(this.taskStore.getAll()).catch(() => {});
    }

    // Check research phase completion
    const allTasksDone = this.taskStore.getAll().every(
      (t) => t.status === "completed" || t.status === "failed"
    );
    if (this.state === "researching" && allTasksDone) {
      this.state = "idle";
      this.callbacks.onNotifyPlanner(
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

    // Cascade to dependants
    this.handleTaskFailure(taskId, error);

    // Notify planner with blocked downstream info
    const blockedTasks = this.taskStore.getAll()
      .filter(t => t.prerequisites?.has(taskId) && t.status !== "completed" && t.status !== "failed")
      .map(t => `${t.id} (${t.assigned_role})`)
      .join(", ") || null;

    this.callbacks.onNotifyPlanner(
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

  // ═══════════════════════════════════════════════════════════════════
  // WORKER DONE (complete_task tool called by agent)
  // ═══════════════════════════════════════════════════════════════════

  /** Worker completed via complete_task tool → notify plugins, mark complete */
  async onWorkerDone(data: {
    taskId: string; role: string; summary: string;
    deliverables?: string[]; nextSteps?: string[]; timestamp: number;
  }): Promise<void> {
    log.info(`[GoalManager] Worker done: ${data.taskId}`);

    const currentTask = this.taskStore.get(data.taskId);

    // Collab workers have IDs like "collab-task-5-discussion-frontend" — not in TaskStore
    if (!currentTask && data.taskId.startsWith("collab-")) {
      log.debug(`Collab worker ${data.taskId} completed — no TaskStore entry (expected)`);
      return;
    }

    if (currentTask && (currentTask.status === "completed" || currentTask.status === "discarded")) {
      log.debug(`Task ${data.taskId} already ${currentTask.status} — skipping onWorkerDone`);
      return;
    }

    // Mark that agent called complete_task — prevents auto-complete race
    if (currentTask) {
      currentTask.completionSource = "tool";
    }

    // Notify plugins (workspace publish + merge)
    if (this.pluginRegistry) {
      try {
        const result = await this.pluginRegistry.onTaskComplete(data.taskId, this.currentGoalId || undefined);
        if (!result.success) {
          const mergeError = `Workspace merge failed: ${result.error}`;
          log.error(`[GoalManager] ${mergeError}`);
          try { this.taskStore.updateStatus(data.taskId, "failed"); } catch { /* already failed */ }
          this.taskStore.queue.failTask(data.taskId, mergeError);
          this.callbacks.onTaskUpdate?.({ taskId: data.taskId, status: "failed", timestamp: data.timestamp });

          // Merge conflicts → create resolution task
          if (result.error?.includes("Merge conflicts")) {
            const failedTask = this.taskStore.get(data.taskId);
            if (failedTask) {
              const resolveId = `resolve-${data.taskId}`;
              try {
                this.taskStore.create({
                  id: resolveId,
                  title: `Resolve merge conflicts from: ${failedTask.title || data.taskId}`,
                  description: `Merge conflicts detected after task completion. ${result.error}. ` +
                    `Resolve the conflicts on branch and commit the resolution.`,
                  assigned_role: failedTask.assigned_role,
                  goalId: failedTask.goalId,
                  planId: failedTask.planId,
                  status: "pending",
                  prerequisites: new Map(),
                  dependants: failedTask.dependants || [],
                });
                log.info(`Created merge resolution task: ${resolveId} for role ${failedTask.assigned_role}`);
              } catch (err) {
                log.warn(`Failed to create resolution task: ${err}`);
              }
            }
          }
          return;
        }
      } catch (err) {
        const mergeError = `Plugin cleanup crashed for task ${data.taskId}: ${err}`;
        log.error(`[GoalManager] ${mergeError}`);
        try { this.taskStore.updateStatus(data.taskId, "failed"); } catch { /* already failed */ }
        this.taskStore.queue.failTask(data.taskId, mergeError);
        this.callbacks.onTaskUpdate?.({ taskId: data.taskId, status: "failed", timestamp: data.timestamp });
        return;
      }
    }

    // Auto-close discussion CRDT
    const completingTask = this.taskStore.get(data.taskId);
    if (completingTask && (completingTask.type === "discussion" || completingTask.type === "collaboration")) {
      try {
        const crdtSync = this.crdtTaskSyncProxy?.get?.();
        if (crdtSync) {
          const discussionDoc = await crdtSync.space.openDoc(`${data.taskId}/discussion`);
          const configMap = discussionDoc.getMap("config");
          if (configMap.get("status") !== "closed") {
            configMap.set("status", "closed");
            log.info(`Auto-closed discussion for completed task ${data.taskId}`);
          }
        }
      } catch (err) {
        log.debug(`Failed to auto-close discussion for ${data.taskId}: ${err}`);
      }
    }

    // Mark complete in TaskStore → triggers onTaskComplete via RoleTaskQueue
    this.taskStore.completeTask(data.taskId, {
      summary: data.summary,
      deliverables: data.deliverables,
      nextSteps: data.nextSteps, completedBy: "agent", timestamp: data.timestamp,
    });

    // CRDT persistence
    const crdtSyncDone = this.crdtTaskSyncProxy?.get?.();
    if (crdtSyncDone) {
      await crdtSyncDone.syncStatus(data.taskId, "completed", {
        summary: data.summary,
        deliverables: data.deliverables,
        nextSteps: data.nextSteps,
      });
      await crdtSyncDone.updateIndex(this.taskStore.getAll());
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // STATE MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════

  reset(): void {
    this.state = "idle";
    this.pendingPlan = null;
    this.currentGoalId = null;
  }

  async resetPlan(): Promise<{ deleted: boolean; planId?: string }> {
    try {
      if (this.planStore) {
        const s = await this.planStore.getLatestActivePlan();
        if (s && (s.metadata.status === "executing" || s.metadata.status === "approved")) {
          await this.planStore.archivePlan(s.plan.planId, s.metadata.goalId);
          const crdtSync = this.crdtTaskSyncProxy?.get?.();
          if (crdtSync?.syncPlanStatus) {
            await crdtSync.syncPlanStatus("interrupted").catch(() => {});
          }
          this.reset();
          return { deleted: true, planId: s.plan.planId };
        }
      }
      this.reset();
      return { deleted: false };
    } catch {
      this.reset();
      return { deleted: false };
    }
  }

  async interruptPlan(): Promise<void> {
    if (!this.planStore) return;
    try {
      const s = await this.planStore.getLatestActivePlan();
      if (s?.metadata.status === "executing") {
        await this.planStore.updatePlanStatus(s.plan.planId, s.metadata.goalId, "interrupted");
        const crdtSync = this.crdtTaskSyncProxy?.get?.();
        if (crdtSync?.syncPlanStatus) {
          await crdtSync.syncPlanStatus("interrupted").catch(() => {});
        }
      }
    } catch { /* best effort */ }
  }

  // ═══════════════════════════════════════════════════════════════════
  // RESTART RECOVERY
  // ═══════════════════════════════════════════════════════════════════

  async loadActivePlan(): Promise<void> {
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

        // Restore task statuses from CRDT
        let crdtTasks: Map<string, any> | null = null;
        if (this.currentGoalId && this.crdtTaskSyncProxy) {
          try {
            this.crdtTaskSyncProxy.resolveForGoal(this.currentGoalId);
            this.crdtGoalStoreProxy?.resolveForGoal?.(this.currentGoalId);
            const crdtSync = this.crdtTaskSyncProxy.get?.();
            if (crdtSync?.loadAllTasks) {
              const loaded = await crdtSync.loadAllTasks();
              if (loaded.length > 0) {
                crdtTasks = new Map(loaded.map((t: any) => [t.id, t]));
                log.info(`[loadActivePlan] Restored ${loaded.length} tasks from CRDT`);
              }
            }
          } catch (err) {
            log.warn(`[loadActivePlan] Failed to read CRDT task state: ${err}`);
          }
        }

        for (const t of stored.plan.tasks) {
          const crdtTask = crdtTasks?.get(t.id);
          let status = crdtTask?.status ?? "pending";
          if (status === "in_progress") status = "ready";

          const prerequisites = crdtTask?.prerequisites
            ?? new Map(t.dependencies.map((d: string) => [d, false] as [string, boolean]));

          this.taskStore.create({
            id: t.id,
            description: crdtTask?.description ?? `${t.title}: ${t.description}`,
            assigned_role: t.assignedRole.toLowerCase(),
            status,
            output: crdtTask?.output,
            prerequisites,
            dependants: dep.get(t.id) || [],
            context: crdtTask?.context ?? { title: t.title, planId: stored.plan.planId, goal: stored.plan.goal },
          });
        }
        this.state = "executing";

        if (this.taskStore.isAllComplete()) {
          this.state = "idle";
          log.info("[loadActivePlan] All tasks already completed — plan finished");
        }
      }

      if (stored.metadata.status === "completed") {
        this.state = "idle";
      }
    } catch (error) {
      log.error(`[GoalManager] Failed to load active plan: ${error}`);
    }
  }

  dispose(): void {
    // Nothing to dispose in single-goal mode.
    // Phase 4: dispose per-goal planners and ChatAgents.
  }
}
