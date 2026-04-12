/**
 * CrdtTaskSync — Bidirectional TaskStore ↔ CRDT persistence bridge
 *
 * Source of truth: CRDT (Hocuspocus Y.Map per task)
 * Runtime engine: TaskStore (in-memory Map — single writer for state machine)
 *
 * CRDT doc hierarchy:
 *   {teamId}/{goalId}/{taskId}/task   — Task Y.Map
 *   {teamId}/{goalId}/plan            — Plan Y.Map
 *   {teamId}/{goalId}/_index          — Task index Y.Map (byRole, byStatus)
 *
 * projectToFilesystem auto-projects these to:
 *   .ping/collaboration/{taskId}/task.json
 *   .ping/collaboration/plan.json
 *   .ping/collaboration/_index.json
 *
 * @see docs/features/task-orchestration/markdown-tasks/feature_architecture.md
 * @see docs/features/task-orchestration/markdown-tasks/diagrams/01-task-lifecycle.md
 */

import type { CollaborationSpace } from "./CollaborationSpace.js";
import { rootLogger } from "../../logging.js";

const logger = rootLogger.child({ module: "CrdtTaskSync" });

// ═══════════════════════════════════════════════════════════════════════════════
// Types — aligned with Task.types.ts from @ping/agent-manager
// ═══════════════════════════════════════════════════════════════════════════════

export type TaskStatus = "ready" | "pending" | "in_progress" | "completed" | "failed";

/** Shape of task data stored in CRDT Y.Map("task") */
export interface CrdtTaskData {
  id: string;
  title: string;
  assignedRole: string;
  status: TaskStatus;
  priority: number;
  complexity?: string;
  type?: string;                  // work | review | collaboration | subtask | decision | research
  dependencies: string[];
  createdBy: string;              // planner | agent:{role} | user
  parentTask?: string | null;
  planId?: string | null;
  expectedOutput?: string;
  onDependencyFail?: string;      // fail | skip | replan
  body: string;                   // Rich markdown body (acceptance criteria, context, notes)
  output?: any;
  completedAt?: string | null;
  createdAt: string;
  references?: string[];          // Cross-plan references: ["plan-000/task-003"]
}

/** Minimal Task interface matching what TaskStore expects */
export interface TaskLike {
  id: string;
  description: string;
  assigned_role: string;
  status: TaskStatus;
  priority?: number;
  context?: Record<string, any>;
  output?: any;
  prerequisites: Map<string, boolean>;
  dependants: string[];
  artifacts?: string[];
  knowledgeRefs?: string[];
}

// ═══════════════════════════════════════════════════════════════════════════════
// CrdtTaskSync
// ═══════════════════════════════════════════════════════════════════════════════

export class CrdtTaskSync {
  constructor(private _space: CollaborationSpace) {}

  /** Access the underlying CollaborationSpace (for CollabTaskDispatcher) */
  get space(): CollaborationSpace {
    return this._space;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PERSIST — Write from TaskStore → CRDT
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Persist a task to CRDT. Called after taskStore.create().
   * Creates a CRDT doc at `{taskId}/task` within the goal-scoped CollaborationSpace.
   *
   * Full Hocuspocus path: {teamId}/{goalId}/{taskId}/task
   */
  async persistTask(task: TaskLike): Promise<void> {
    const docName = `${task.id}/task`;
    try {
      const doc = await this._space.openDoc(docName);
      const map = doc.getMap("task");

      const ctx = (task.context || {}) as Record<string, any>;

      map.set("id", task.id);
      map.set("title", ctx.title || task.description.split(":")[0]?.trim() || task.id);
      map.set("assignedRole", task.assigned_role);
      map.set("status", task.status);
      map.set("priority", task.priority || 3);
      map.set("complexity", ctx.complexity || "medium");
      map.set("type", ctx.type || "work");
      map.set("dependencies", Array.from(task.prerequisites.keys()));
      map.set("createdBy", ctx.createdBy || "planner");
      map.set("parentTask", ctx.parentTask || null);
      map.set("planId", ctx.planId || null);
      map.set("expectedOutput", ctx.expectedOutput || "");
      map.set("onDependencyFail", ctx.onDependencyFail || "fail");
      map.set("body", task.description);
      map.set("output", task.output || null);
      map.set("completedAt", null);
      map.set("createdAt", new Date().toISOString());
      if (ctx.references) {
        map.set("references", ctx.references);
      }

      // Set metadata for collab tool discovery
      doc.setMeta({
        description: `Task: ${ctx.title || task.id} (${task.assigned_role})`,
        createdBy: ctx.createdBy || "planner",
      });

      logger.debug(`Persisted task ${task.id} to CRDT at ${docName}`);
    } catch (err) {
      logger.error(`Failed to persist task ${task.id}: ${err}`);
      throw err;
    }
  }

  /**
   * Sync task status change to CRDT. Called after taskStore.updateStatus() or completeTask().
   */
  async syncStatus(taskId: string, newStatus: TaskStatus, output?: any): Promise<void> {
    const docName = `${taskId}/task`;
    try {
      const doc = await this._space.openDoc(docName);
      const map = doc.getMap("task");
      map.set("status", newStatus);
      if (newStatus === "completed") {
        map.set("completedAt", new Date().toISOString());
        if (output != null) {
          map.set("output", output);
        }
      }
      logger.debug(`Synced status ${taskId} → ${newStatus}`);
    } catch (err) {
      logger.error(`Failed to sync status for ${taskId}: ${err}`);
      // Don't throw — status sync failure shouldn't block task execution
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PERSIST PLAN — Write plan overview to CRDT for agent browsing
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Persist plan overview to CRDT. Complements PlanStore JSON files.
   * Creates a CRDT doc at `plan` within the goal-scoped CollaborationSpace.
   *
   * Full Hocuspocus path: {teamId}/{goalId}/plan
   */
  async persistPlan(plan: any, goalId: string): Promise<void> {
    try {
      const doc = await this._space.openDoc("plan");
      const map = doc.getMap("plan");
      map.set("planId", plan.planId);
      map.set("goalId", goalId);
      map.set("goal", plan.goal);
      map.set("status", "executing");
      map.set("version", plan.version || 1);
      map.set("taskCount", plan.tasks?.length || 0);
      map.set("createdAt", new Date().toISOString());

      // Task summary list for easy agent reading
      const taskSummary = (plan.tasks || []).map((t: any) => ({
        id: t.id,
        title: t.title,
        assignedRole: t.assignedRole,
        priority: t.priority,
        dependencies: t.dependencies || [],
      }));
      map.set("tasks", taskSummary);

      // Plan body with strategy notes (if present)
      const body = [
        `# ${plan.goal}`,
        "",
        "## Tasks",
        ...(plan.tasks || []).map((t: any) =>
          `- **${t.id}** — ${t.title} (${t.assignedRole}, P${t.priority})${t.dependencies?.length ? ` — depends on ${t.dependencies.join(", ")}` : ""}`
        ),
      ].join("\n");
      map.set("body", body);

      doc.setMeta({
        description: `Plan: ${plan.goal} (${plan.tasks?.length || 0} tasks)`,
        createdBy: "planner",
      });

      logger.debug(`Persisted plan ${plan.planId} to CRDT`);
    } catch (err) {
      logger.error(`Failed to persist plan: ${err}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // UPDATE INDEX — Lightweight index for agent browsing via collab tool
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update the task index CRDT doc. Called after task creation or status change.
   *
   * Full Hocuspocus path: {teamId}/{goalId}/_index
   */
  async updateIndex(tasks: TaskLike[]): Promise<void> {
    try {
      const doc = await this._space.openDoc("_index");
      const map = doc.getMap("_index");

      // Group by role
      const byRole: Record<string, string[]> = {};
      // Group by status
      const byStatus: Record<string, string[]> = {};

      for (const task of tasks) {
        const role = task.assigned_role;
        if (!byRole[role]) byRole[role] = [];
        byRole[role].push(task.id);

        const status = task.status;
        if (!byStatus[status]) byStatus[status] = [];
        byStatus[status].push(task.id);
      }

      map.set("byRole", byRole);
      map.set("byStatus", byStatus);
      map.set("totalTasks", tasks.length);
      map.set("updatedAt", new Date().toISOString());
    } catch (err) {
      logger.debug(`Index update failed (non-critical): ${err}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // LOAD — Read from CRDT → hydrate TaskStore (crash recovery)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Load all tasks from CRDT. Called during initialize() for crash recovery.
   * Fix #7: Two-pass loading — first collect all tasks, then set prerequisite
   * state correctly based on which dependencies are already completed.
   */
  async loadAllTasks(): Promise<TaskLike[]> {
    try {
      const allDocs = await this._space.listDocs();
      // Task docs match pattern: {taskId}/task (not goal, plan, _index, or discussion docs)
      const taskDocNames = allDocs.filter(
        (d) => d.endsWith("/task") && d !== "goal" && d !== "plan",
      );

      if (taskDocNames.length === 0) {
        logger.debug("No task docs found in CRDT — fresh start");
        return [];
      }

      // First pass: load all raw task data
      const rawTasks: CrdtTaskData[] = [];
      for (const docName of taskDocNames) {
        try {
          const doc = await this._space.openDoc(docName);
          const map = doc.getMap("task");
          const data = map.toJSON() as CrdtTaskData;

          if (!data.id) {
            logger.warn(`Skipping CRDT doc ${docName} — no task ID`);
            continue;
          }

          rawTasks.push(data);
        } catch (err) {
          logger.warn(`Failed to load task from ${docName}: ${err}`);
        }
      }

      // Collect completed task IDs for prerequisite resolution
      const completedIds = new Set(
        rawTasks.filter((t) => t.status === "completed").map((t) => t.id),
      );

      // Second pass: create Task objects with correct prerequisite state
      const tasks: TaskLike[] = rawTasks.map((data) => {
        const task = this.toTask(data);
        // Override prerequisites with correct completion state
        task.prerequisites = new Map(
          (data.dependencies || []).map((d) => [d, completedIds.has(d)] as [string, boolean]),
        );
        return task;
      });

      logger.info(`Loaded ${tasks.length} tasks from CRDT (${completedIds.size} completed)`);
      return tasks;
    } catch (err) {
      logger.error(`Failed to load tasks from CRDT: ${err}`);
      return [];
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // MAPPING — CRDT Y.Map ↔ Task object
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Convert CRDT task data to Task object for TaskStore.
   */
  private toTask(data: CrdtTaskData): TaskLike {
    return {
      id: data.id,
      description: data.body || `${data.title}: ${data.expectedOutput || ""}`,
      assigned_role: (data.assignedRole || "").toLowerCase(),
      status: data.status || "pending",
      priority: data.priority || 3,
      prerequisites: new Map(
        (data.dependencies || []).map((d) => [d, false] as [string, boolean]),
      ),
      dependants: [], // Rebuilt by DependencyResolver
      context: {
        title: data.title,
        planId: data.planId,
        goal: "",  // Loaded from goal doc if needed
        priority: data.priority,
        complexity: data.complexity,
        expectedOutput: data.expectedOutput,
        createdBy: data.createdBy,
        type: data.type,
        parentTask: data.parentTask,
        onDependencyFail: data.onDependencyFail,
        references: data.references,
      },
      output: data.output,
    };
  }

  /**
   * Get CRDT references for a task (used for context enrichment in dispatch).
   */
  getCrdtRefs(
    taskId: string,
    task: TaskLike,
  ): Record<string, any> {
    return {
      task: `${taskId}/task`,
      plan: "plan",
      goal: "goal",
      dependencies: Array.from(task.prerequisites.keys()).map((d) => `${d}/task`),
      dependants: (task.dependants || []).map((d) => `${d}/task`),
      relatedTasks: (task.context as any)?.relatedTasks || [],
    };
  }

  /**
   * Initialize CRDT docs for a collaboration task (Fix #14 — encapsulated).
   * Creates discussion Y.Array, decisions Y.Map, cursors Y.Map, and config Y.Map with guard rails.
   */
  async initCollabDocs(taskId: string, collabConfig?: Record<string, any>): Promise<void> {
    const config = collabConfig || {};
    // Initialize discussion doc with Y.Array + guard rail config
    const discussionDoc = await this._space.openDoc(`${taskId}/discussion`);
    discussionDoc.getArray("discussion");
    const configMap = discussionDoc.getMap("config");
    configMap.set("maxRounds", config.maxRounds || 10);
    configMap.set("maxTokens", config.maxTokens || 50000);
    configMap.set("timeoutMinutes", config.timeoutMinutes || 15);
    configMap.set("totalTokensUsed", 0);
    configMap.set("roundsPerAgent", {});
    configMap.set("mode", config.mode || "auto");
    configMap.set("status", "active");
    configMap.set("lastActivity", new Date().toISOString());
    // Initialize cursors
    discussionDoc.getMap("cursors");
    // Initialize decisions doc
    const decisionsDoc = await this._space.openDoc(`${taskId}/decisions`);
    decisionsDoc.getMap("decisions");
  }
}
