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

/** Shape of task data stored in CRDT Y.Map("meta") */
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
      const map = doc.getMap("meta");

      const ctx = (task.context || {}) as Record<string, any>;

      map.set("type", "task");
      map.set("id", task.id);
      map.set("title", ctx.title || task.description.split(":")[0]?.trim() || task.id);
      map.set("assignedRole", task.assigned_role);
      map.set("status", task.status);
      map.set("priority", task.priority || 3);
      map.set("complexity", ctx.complexity || "medium");
      map.set("taskType", ctx.type || "work");
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

      // Write task as rich readable BlockNote content to Y.XmlFragment("content")
      try {
        const { ServerBlockNoteEditor } = await import("@blocknote/server-util");
        const editor = ServerBlockNoteEditor.create();
        const title = ctx.title || task.description.split(":")[0]?.trim() || task.id;
        const deps = Array.from(task.prerequisites.keys());
        const taskMd = [
          `## ${title}`,
          "",
          `**Role:** ${task.assigned_role} | **Priority:** P${task.priority || 3} | **Type:** ${ctx.type || "work"}`,
          "",
          "### Description",
          "",
          task.description,
          "",
          ctx.expectedOutput ? `### Expected Output\n\n${ctx.expectedOutput}\n` : "",
          deps.length ? `### Dependencies\n\n${deps.map(d => `- ${d}`).join("\n")}\n` : "",
          ctx.notes ? `### Context & Notes\n\n${ctx.notes}\n` : "",
          ctx.files?.length ? `### Related Files\n\n${ctx.files.map((f: string) => `- \`${f}\``).join("\n")}\n` : "",
          ctx.artifacts?.length ? `### Artifacts\n\n${ctx.artifacts.map((a: string) => `- ${a}`).join("\n")}\n` : "",
          "### Status",
          "",
          `Current: **${task.status}** | Created: ${new Date().toISOString().split("T")[0]}`,
        ].filter(Boolean).join("\n");

        const blocks = await editor.tryParseMarkdownToBlocks(taskMd);
        const fragment = doc.getXmlFragment("content");
        editor.blocksToYXmlFragment(blocks, fragment);
      } catch (err) {
        logger.debug(`Failed to write task description to XmlFragment: ${err}`);
      }

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
      const map = doc.getMap("meta");
      map.set("status", newStatus);
      if (newStatus === "completed") {
        map.set("completedAt", new Date().toISOString());
        if (output != null) {
          map.set("output", output);
        }
        // Note: The agent writes the real completion report to {taskId}/report
        // via collab write-block BEFORE calling complete_task.
        // We don't generate a system report here — the agent's report IS the report.
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
      const map = doc.getMap("meta");
      map.set("type", "plan");
      map.set("planId", plan.planId);
      map.set("goalId", goalId);
      map.set("goal", plan.goal);
      map.set("status", "pending");
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

      doc.setMeta({
        description: `Plan: ${plan.goal} (${plan.tasks?.length || 0} tasks)`,
        createdBy: "planner",
      });

      // Content is written by the planner LLM via collab write-block BEFORE submit_plan.
      // No system-generated fallback — if the planner didn't write content, the user
      // sees an empty doc and uses "Request Changes" to force a rewrite.
      const fragment = doc.getXmlFragment("content");
      if (fragment.length === 0) {
        logger.warn(`Plan ${plan.planId}: planner did not write plan document content — user will see empty doc`);
      }

      logger.debug(`Persisted plan ${plan.planId} to CRDT`);
    } catch (err) {
      logger.error(`Failed to persist plan: ${err}`);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PLAN DOC CHECK — Verify the planner wrote content before approval
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Check if the plan CRDT document has content written by the planner.
   * Returns true if the content XmlFragment has blocks, false if empty.
   */
  async isPlanDocWritten(): Promise<boolean> {
    try {
      const doc = await this._space.openDoc("plan");
      const fragment = doc.getXmlFragment("content");
      return fragment.length > 0;
    } catch (err) {
      logger.warn(`Failed to check plan doc content: ${err}`);
      return true; // On error, don't block approval
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // SYNC PLAN STATUS — Update plan status in CRDT (BUG-1 fix)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update plan status in CRDT. Called when plan is completed, interrupted, or archived.
   * Fixes dual-write drift where PlanStore has the truth but CRDT is stale.
   */
  async syncPlanStatus(status: string): Promise<void> {
    try {
      const doc = await this._space.openDoc("plan");
      const map = doc.getMap("meta");
      map.set("status", status);
      map.set("updatedAt", new Date().toISOString());
      logger.debug(`Synced plan status to "${status}" in CRDT`);
    } catch (err) {
      logger.warn(`Failed to sync plan status to CRDT: ${err}`);
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
      const map = doc.getMap("meta");
      map.set("type", "index");

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
  // AGENT STATUS — Track which agents are busy/idle
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Update agent status in CRDT. Called before/after task execution.
   * Readable via `collab read agent-statuses`.
   */
  async updateAgentStatus(role: string, status: 'busy' | 'idle', taskId?: string): Promise<void> {
    try {
      const doc = await this._space.openDoc('agent-statuses');
      const map = doc.getMap('meta');
      map.set('type', 'agent-statuses');
      map.set(role, { status, task: taskId || null, since: Date.now() });
    } catch (err) {
      logger.debug(`Agent status update failed (non-critical): ${err}`);
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
          const map = doc.getMap("meta");
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

    // Phase 4: Store participants list
    if (config.participants) {
      configMap.set("participants", config.participants);
    }

    // Phase 3: Store agenda items
    if (Array.isArray(config.agenda) && config.agenda.length > 0) {
      configMap.set("agenda", config.agenda.map((item: string, i: number) => ({
        id: `item-${i + 1}`,
        text: item,
        resolved: false,
      })));
    }

    // Initialize cursors
    discussionDoc.getMap("cursors");
    // Initialize decisions doc
    const decisionsDoc = await this._space.openDoc(`${taskId}/decisions`);
    decisionsDoc.getMap("decisions");
  }
}
