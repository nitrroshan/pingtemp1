/**
 * Plan Mutation Tools
 *
 * Tools for modifying plans mid-flight:
 * - update_task: Modify task description, priority, role, deps
 * - add_tasks: Inject new tasks into active plan
 * - remove_task: Remove pending task + cascade dep updates
 * - reprioritize: Change task priority (affects dispatch order)
 * - reassign_task: Move task to different worker role
 * - replan: Replace remaining plan (cancel pending, submit new)
 *
 * Guard rails:
 * - Cannot mutate in_progress/completed tasks
 * - Cannot create dependency cycles
 * - Cannot assign to nonexistent roles
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { DependencyResolver } from "../DependencyResolver.js";
import type { ITaskProvider } from "../ITaskProvider.js";
import { PromptLoader } from "../PromptLoader.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

const TaskContextSchema = z.object({
  notes: z.string().optional(),
  files: z.array(z.string()).optional(),
  artifacts: z.array(z.string()).optional(),
  relatedTasks: z.array(z.string()).optional(),
}).optional();

export const UpdateTaskSchema = z.object({
  taskId: z.string().describe("ID of the task to update"),
  patch: z.object({
    title: z.string().optional().describe("New title"),
    description: z.string().optional().describe("New description"),
    assignedRole: z.string().optional().describe("New role assignment"),
    priority: z.number().min(1).max(5).optional().describe("New priority (1=highest)"),
    dependencies: z.array(z.string()).optional().describe("New dependency list"),
    expectedOutput: z.string().optional().describe("New expected output description"),
    context: TaskContextSchema,
  }).describe("Fields to update — only provided fields are changed"),
});

export const AddTasksSchema = z.object({
  tasks: z.array(z.object({
    id: z.string().describe("Unique task ID"),
    title: z.string().describe("Task title"),
    description: z.string().describe("Detailed description"),
    assignedRole: z.string().describe("Role to execute this task"),
    priority: z.number().min(1).max(5).default(3).describe("Priority (1=highest)"),
    complexity: z.enum(["low", "medium", "high"]).default("medium"),
    type: z.enum(["work", "discussion", "review", "research"]).default("work").describe("Task type"),
    dependencies: z.array(z.string()).default([]).describe("Task IDs this depends on"),
    expectedOutput: z.string().describe("What this task should produce"),
    context: TaskContextSchema,
    onDependencyFail: z.enum(["skip", "replan", "fail"]).optional().describe("Strategy when a dependency fails"),
  })).min(1).describe("Tasks to add to the active plan"),
});

export const RemoveTaskSchema = z.object({
  taskId: z.string().describe("ID of the task to remove"),
  cascadeOrphans: z.boolean().default(true).describe("Also remove tasks that depend solely on this one"),
});

export const ReprioritizeSchema = z.object({
  taskId: z.string().describe("ID of the task to reprioritize"),
  priority: z.number().min(1).max(5).describe("New priority (1=highest, 5=lowest)"),
});

export const ReassignTaskSchema = z.object({
  taskId: z.string().describe("ID of the task to reassign"),
  newRole: z.string().describe("New role to assign the task to"),
  reason: z.string().optional().describe("Why the reassignment is needed"),
});

export const ReplanSchema = z.object({
  reason: z.string().describe("Why a replan is needed"),
  newTasks: z.array(z.object({
    id: z.string(),
    title: z.string(),
    description: z.string(),
    assignedRole: z.string(),
    priority: z.number().min(1).max(5).default(3),
    complexity: z.enum(["low", "medium", "high"]).default("medium"),
    type: z.string().optional().describe("Task type hint (e.g. 'feature', 'bugfix')"),
    dependencies: z.array(z.string()).default([]),
    expectedOutput: z.string(),
    context: TaskContextSchema,
    onDependencyFail: z.enum(["skip", "replan", "fail"]).optional().describe("Strategy when a dependency fails"),
  })).min(1).describe("New tasks to replace remaining pending tasks"),
});

// ─── Tool Context ─────────────────────────────────────────────────────────────

export interface PlanMutationContext {
  tasks: ITaskProvider;
  dagResolver: DependencyResolver;
  availableRoles: string[];
  /** Goal ID — all tasks created by mutation tools inherit this */
  currentGoalId: string;
  /** Team ID — for persistence scoping */
  teamId?: string;
  /** v3.0: Database persistence (optional) */
  taskPersistence?: { saveTasks(goalId: string, teamId: string, tasks: any[]): Promise<void>; updateTaskStatus(taskId: string, goalId: string, status: string, output?: unknown): Promise<void>; clearTasksByGoal(goalId: string): Promise<void> } | null;
  /** Callback to emit Socket.IO mutation events */
  onMutation?: (event: { type: string; data: any }) => void;
}

// ─── Guard Rail Helpers ───────────────────────────────────────────────────────

function validateTaskMutable(tasks: ITaskProvider, taskId: string): string | null {
  const task = tasks.getTask(taskId);
  if (!task) return `Task '${taskId}' not found`;
  if (task.status === "in_progress") return `Task '${taskId}' is in_progress — cancel it first`;
  if (task.status === "completed") return `Task '${taskId}' is already completed — cannot modify`;
  return null;
}

function validateRole(availableRoles: string[], role: string): string | null {
  const lowerRole = role.toLowerCase();
  if (!availableRoles.some((r) => r.toLowerCase() === lowerRole)) {
    return `Role '${role}' not found. Available roles: ${availableRoles.join(", ")}`;
  }
  return null;
}

// ─── Shared: Normalize + Add Tasks ────────────────────────────────────────────

interface RawTaskInput {
  id: string;
  title: string;
  description: string;
  assignedRole: string;
  priority: number;
  complexity: string;
  type?: string;
  dependencies: string[];
  expectedOutput: string;
  context?: Record<string, any>;
}

/**
 * Normalize task IDs to sequential `task-N` format and add to TaskStore.
 *
 * Shared by `add_tasks` and `replan` — single implementation (DRY).
 * Returns the list of normalized task IDs.
 */
function normalizeAndAddTasks(
  ctx: PlanMutationContext,
  rawTasks: RawTaskInput[],
): string[] {
  const allExisting = ctx.currentGoalId ? ctx.tasks.getByGoal(ctx.currentGoalId) : ctx.tasks.getAllTasks();
  const goalPrefix = ctx.currentGoalId ? ctx.currentGoalId.slice(0, 8) : '';
  const scopeId = (id: string) => goalPrefix && !id.startsWith(goalPrefix) ? `${goalPrefix}-${id}` : id;
  const assignedIds = new Set(allExisting.map(t => t.id));

  let maxId = Math.max(0, ...allExisting.map(t => {
    const m = (t.id || "").match(/^task-(\d+)/);
    return m ? parseInt(m[1]!, 10) : 0;
  }));

  // Build ID normalization map (LLM ID → normalized task-N)
  // Track ALL assigned IDs to prevent collisions between kept and generated IDs
  const idMap = new Map<string, string>();
  for (const task of rawTasks) {
    if (/^task-\d+$/.test(task.id) && !assignedIds.has(scopeId(task.id))) {
      idMap.set(task.id, scopeId(task.id));
      assignedIds.add(scopeId(task.id));
      // Keep maxId ahead of any kept ID
      const num = parseInt(task.id.match(/^task-(\d+)/)![1]!, 10);
      if (num > maxId) maxId = num;
    } else {
      maxId++;
      while (assignedIds.has(scopeId(`task-${maxId}`))) maxId++; // skip collisions
      idMap.set(task.id, scopeId(`task-${maxId}`));
      assignedIds.add(scopeId(`task-${maxId}`));
    }
  }

  // Add each task to TaskStore
  for (const task of rawTasks) {
    const normalizedId = idMap.get(task.id) || task.id;
    const normalizedDeps = task.dependencies.map(d => idMap.get(d) || d);

    ctx.tasks.addTask({
      id: normalizedId,
      title: task.title,
      description: `${task.title}: ${task.description}`,
      assigned_role: task.assignedRole.toLowerCase(),
      goalId: ctx.currentGoalId,
      status: "pending",
      priority: task.priority,
      type: (task.type as any) || "work",
      expectedOutput: task.expectedOutput,
      prerequisites: new Map(normalizedDeps.map(d => {
        const depTask = ctx.tasks.getTask(d);
        return [d, depTask?.status === "completed"] as [string, boolean];
      })),
      dependants: [],
      context: {
        title: task.title,
        priority: task.priority,
        complexity: task.complexity,
        expectedOutput: task.expectedOutput,
        ...task.context,
      },
    });
  }

  ctx.currentGoalId ? ctx.dagResolver.rebuildForGoal(ctx.tasks, ctx.currentGoalId) : ctx.dagResolver.rebuild(ctx.tasks);

  // v3.0: Persist added tasks to database
  if (ctx.taskPersistence && ctx.teamId) {
    ctx.taskPersistence.saveTasks(ctx.currentGoalId, ctx.teamId, rawTasks.map((t: any) => ({
      taskId: idMap.get(t.id) || t.id,
      goalId: ctx.currentGoalId, teamId: ctx.teamId,
      title: t.title, description: `${t.title}: ${t.description}`,
      status: "pending", assignedRole: t.assignedRole.toLowerCase(),
      priority: t.priority, dependencies: (t.dependencies || []).map((d: string) => idMap.get(d) || d),
    }))).catch(() => {});
  }

  return rawTasks.map(t => idMap.get(t.id) || t.id);
}

// ─── Tool Factories ───────────────────────────────────────────────────────────

export function createUpdateTaskTool(ctx: PlanMutationContext) {
  return tool(
    async (input) => {
      const err = validateTaskMutable(ctx.tasks, input.taskId);
      if (err) return `Error: ${err}`;

      if (input.patch.assignedRole) {
        const roleErr = validateRole(ctx.availableRoles, input.patch.assignedRole);
        if (roleErr) return `Error: ${roleErr}`;
      }

      if (input.patch.dependencies) {
        const cycleErr = ctx.dagResolver.validateDependencies(input.taskId, input.patch.dependencies);
        if (cycleErr) return `Error: ${cycleErr}`;
      }

      // Apply patch to task
      const task = ctx.tasks.getTask(input.taskId)!;
      if (input.patch.title) task.title = input.patch.title;
      if (input.patch.description) task.description = input.patch.description;
      if (input.patch.assignedRole) task.assigned_role = input.patch.assignedRole.toLowerCase();
      if (input.patch.priority) task.priority = input.patch.priority;
      if (input.patch.expectedOutput) task.expectedOutput = input.patch.expectedOutput;
      if (input.patch.dependencies) {
        // Set prerequisites, marking already-completed deps as met
        task.prerequisites = new Map(input.patch.dependencies.map((d) => {
          const depTask = ctx.tasks.getTask(d);
          const met = depTask?.status === "completed";
          return [d, met] as [string, boolean];
        }));
        ctx.currentGoalId ? ctx.dagResolver.rebuildForGoal(ctx.tasks, ctx.currentGoalId) : ctx.dagResolver.rebuild(ctx.tasks);

        // Re-evaluate readiness: if all deps met, mark task ready via ITaskProvider
        const allMet = !task.prerequisites.size || Array.from(task.prerequisites.values()).every(v => v);
        if (allMet && (task.status === "pending" || task.status === "failed")) {
          ctx.tasks.markReady(input.taskId);
        }
      }

      ctx.onMutation?.({ type: "plan:task_updated", data: { taskId: input.taskId, patch: input.patch } });

      // v3.0: Persist updated task fields to database
      if (ctx.taskPersistence && ctx.teamId) {
        ctx.taskPersistence.saveTasks(ctx.currentGoalId, ctx.teamId, [{
          taskId: input.taskId, goalId: ctx.currentGoalId, teamId: ctx.teamId,
          title: task.title || "", description: task.description,
          status: task.status, assignedRole: task.assigned_role,
          priority: task.priority,
          dependencies: task.prerequisites ? Array.from(task.prerequisites.keys()) : [],
        }]).catch(() => {});
      }

      return `Task '${input.taskId}' updated successfully`;
    },
    {
      name: "update_task",
      description: PromptLoader.loadTemplate("tools", "update_task"),
      schema: UpdateTaskSchema,
    },
  );
}

export function createAddTasksTool(ctx: PlanMutationContext) {
  return tool(
    async (input) => {
      // Validate all roles
      for (const task of input.tasks) {
        const roleErr = validateRole(ctx.availableRoles, task.assignedRole);
        if (roleErr) return `Error: ${roleErr}`;
      }

      // Validate no duplicate IDs
      const existingIds = new Set((ctx.currentGoalId ? ctx.tasks.getByGoal(ctx.currentGoalId) : ctx.tasks.getAllTasks()).map((t) => t.id));
      for (const task of input.tasks) {
        if (existingIds.has(task.id)) return `Error: Task ID '${task.id}' already exists`;
      }

      // Validate DAG after adding all tasks
      const dagErr = ctx.dagResolver.validateNewTasks(input.tasks, ctx.tasks);
      if (dagErr) return `Error: ${dagErr}`;

      const normalizedIds = normalizeAndAddTasks(ctx, input.tasks);
      ctx.onMutation?.({ type: "plan:tasks_added", data: { tasks: normalizedIds } });
      return `Added ${input.tasks.length} task(s): ${normalizedIds.join(", ")}`;
    },
    {
      name: "add_tasks",
      description: PromptLoader.loadTemplate("tools", "add_tasks"),
      schema: AddTasksSchema,
    },
  );
}

export function createRemoveTaskTool(ctx: PlanMutationContext) {
  return tool(
    async (input) => {
      const err = validateTaskMutable(ctx.tasks, input.taskId);
      if (err) return `Error: ${err}`;

      const removed = [input.taskId];

      if (input.cascadeOrphans) {
        // Find tasks that depend ONLY on this task
        const allTasks = ctx.currentGoalId ? ctx.tasks.getByGoal(ctx.currentGoalId) : ctx.tasks.getAllTasks();
        for (const task of allTasks) {
          if (task.prerequisites && task.id !== input.taskId) {
            const deps = Array.from(task.prerequisites.keys());
            if (deps.length === 1 && deps[0] === input.taskId) {
              const orphanErr = validateTaskMutable(ctx.tasks, task.id);
              if (!orphanErr) removed.push(task.id);
            }
          }
        }
      }

      // Remove tasks
      for (const id of removed) {
        ctx.tasks.removeTask(id);
      }

      ctx.currentGoalId ? ctx.dagResolver.rebuildForGoal(ctx.tasks, ctx.currentGoalId) : ctx.dagResolver.rebuild(ctx.tasks);

      // v3.0: Mark removed tasks in database
      if (ctx.taskPersistence) {
        for (const id of removed) {
          ctx.taskPersistence.updateTaskStatus(id, ctx.currentGoalId, "removed").catch(() => {});
        }
      }

      ctx.onMutation?.({ type: "plan:task_removed", data: { taskIds: removed } });
      return `Removed ${removed.length} task(s): ${removed.join(", ")}`;
    },
    {
      name: "remove_task",
      description: PromptLoader.loadTemplate("tools", "remove_task"),
      schema: RemoveTaskSchema,
    },
  );
}

export function createReprioritizeTool(ctx: PlanMutationContext) {
  return tool(
    async (input) => {
      const err = validateTaskMutable(ctx.tasks, input.taskId);
      if (err) return `Error: ${err}`;

      const task = ctx.tasks.getTask(input.taskId)!;
      task.priority = input.priority;

      ctx.onMutation?.({ type: "plan:task_reprioritized", data: { taskId: input.taskId, priority: input.priority } });

      // v3.0: Persist priority change
      if (ctx.taskPersistence && ctx.teamId) {
        ctx.taskPersistence.saveTasks(ctx.currentGoalId, ctx.teamId, [{
          taskId: input.taskId, goalId: ctx.currentGoalId, teamId: ctx.teamId,
          title: task.title || "", description: task.description,
          status: task.status, assignedRole: task.assigned_role,
          priority: input.priority,
        }]).catch(() => {});
      }

      return `Task '${input.taskId}' priority set to ${input.priority}`;
    },
    {
      name: "reprioritize",
      description: PromptLoader.loadTemplate("tools", "reprioritize"),
      schema: ReprioritizeSchema,
    },
  );
}

export function createReassignTaskTool(ctx: PlanMutationContext) {
  return tool(
    async (input) => {
      const err = validateTaskMutable(ctx.tasks, input.taskId);
      if (err) return `Error: ${err}`;

      const roleErr = validateRole(ctx.availableRoles, input.newRole);
      if (roleErr) return `Error: ${roleErr}`;

      const task = ctx.tasks.getTask(input.taskId)!;
      const oldRole = task.assigned_role;
      task.assigned_role = input.newRole.toLowerCase();

      // R9-3 FIX: Reset failed status so task can be re-dispatched
      let statusReset = false;
      if (task.status === "failed") {
        ctx.tasks.updateTaskStatus(task.id, "ready");
        statusReset = true;
      }

      ctx.onMutation?.({ type: "plan:task_reassigned", data: { taskId: input.taskId, oldRole, newRole: input.newRole, reason: input.reason, statusReset } });

      // v3.0: Persist reassignment + status reset
      if (ctx.taskPersistence && ctx.teamId) {
        ctx.taskPersistence.saveTasks(ctx.currentGoalId, ctx.teamId, [{
          taskId: input.taskId, goalId: ctx.currentGoalId, teamId: ctx.teamId,
          title: task.title || "", description: task.description,
          status: statusReset ? "ready" : task.status, assignedRole: input.newRole.toLowerCase(),
          priority: task.priority,
        }]).catch(() => {});
      }

      return statusReset
        ? `Task '${input.taskId}' reassigned from '${oldRole}' to '${input.newRole}' and status reset to ready for re-dispatch.`
        : `Task '${input.taskId}' reassigned from '${oldRole}' to '${input.newRole}'`;
    },
    {
      name: "reassign_task",
      description: PromptLoader.loadTemplate("tools", "reassign_task"),
      schema: ReassignTaskSchema,
    },
  );
}

export function createReplanTool(ctx: PlanMutationContext) {
  return tool(
    async (input) => {
      // Validate all new task roles
      for (const task of input.newTasks) {
        const roleErr = validateRole(ctx.availableRoles, task.assignedRole);
        if (roleErr) return `Error: ${roleErr}`;
      }

      // Discard pending/ready tasks (mark as discarded, don't delete — audit trail)
      const allTasks = ctx.currentGoalId ? ctx.tasks.getByGoal(ctx.currentGoalId) : ctx.tasks.getAllTasks();
      const discarded: string[] = [];
      for (const task of allTasks) {
        if (task.status === "pending" || task.status === "ready") {
          ctx.tasks.updateTaskStatus(task.id, "discarded");
          discarded.push(task.id);
        }
      }

      const normalizedNewIds = normalizeAndAddTasks(ctx, input.newTasks);

      // v3.0: Persist discarded statuses to database
      if (ctx.taskPersistence) {
        for (const id of discarded) {
          ctx.taskPersistence.updateTaskStatus(id, ctx.currentGoalId, "discarded").catch(() => {});
        }
      }

      ctx.onMutation?.({ type: "plan:replanned", data: { reason: input.reason, discarded, newTasks: normalizedNewIds } });
      return `Replan complete. Discarded ${discarded.length} task(s), added ${input.newTasks.length} new task(s). Reason: ${input.reason}`;
    },
    {
      name: "replan",
      description: PromptLoader.loadTemplate("tools", "replan"),
      schema: ReplanSchema,
    },
  );
}
