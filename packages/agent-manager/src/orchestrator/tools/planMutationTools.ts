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
    dependencies: z.array(z.string()).default([]).describe("Task IDs this depends on"),
    expectedOutput: z.string().describe("What this task should produce"),
    context: TaskContextSchema,
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
    dependencies: z.array(z.string()).default([]),
    expectedOutput: z.string(),
    context: TaskContextSchema,
  })).min(1).describe("New tasks to replace remaining pending tasks"),
});

// ─── Tool Context ─────────────────────────────────────────────────────────────

export interface PlanMutationContext {
  tasks: ITaskProvider;
  dagResolver: DependencyResolver;
  availableRoles: string[];
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

      // Apply patch to task in MemoryManager
      const task = ctx.tasks.getTask(input.taskId)!;
      if (input.patch.title) (task as any).title = input.patch.title;
      if (input.patch.description) task.description = input.patch.description;
      if (input.patch.assignedRole) task.assigned_role = input.patch.assignedRole.toLowerCase();
      if (input.patch.priority) (task as any).priority = input.patch.priority;
      if (input.patch.expectedOutput) (task as any).expectedOutput = input.patch.expectedOutput;
      if (input.patch.dependencies) {
        task.prerequisites = new Map(input.patch.dependencies.map((d) => [d, false]));
        ctx.dagResolver.rebuild(ctx.tasks);
      }

      ctx.onMutation?.({ type: "plan:task_updated", data: { taskId: input.taskId, patch: input.patch } });
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
      const existingIds = new Set(ctx.tasks.getAllTasks().map((t) => t.id));
      for (const task of input.tasks) {
        if (existingIds.has(task.id)) return `Error: Task ID '${task.id}' already exists`;
      }

      // Validate DAG after adding all tasks
      const dagErr = ctx.dagResolver.validateNewTasks(input.tasks, ctx.tasks);
      if (dagErr) return `Error: ${dagErr}`;

      // Add tasks to MemoryManager
      for (const task of input.tasks) {
        ctx.tasks.addTask({
          id: task.id,
          description: `${task.title}: ${task.description}`,
          assigned_role: task.assignedRole.toLowerCase(),
          status: "pending",
          prerequisites: new Map(task.dependencies.map((d) => [d, false])),
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

      ctx.dagResolver.rebuild(ctx.tasks);
      ctx.onMutation?.({ type: "plan:tasks_added", data: { tasks: input.tasks.map((t) => t.id) } });
      return `Added ${input.tasks.length} task(s): ${input.tasks.map((t) => t.id).join(", ")}`;
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
        const allTasks = ctx.tasks.getAllTasks();
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

      ctx.dagResolver.rebuild(ctx.tasks);
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
      (task as any).priority = input.priority;

      ctx.onMutation?.({ type: "plan:task_reprioritized", data: { taskId: input.taskId, priority: input.priority } });
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
        task.status = "ready";
        statusReset = true;
      }

      ctx.onMutation?.({ type: "plan:task_reassigned", data: { taskId: input.taskId, oldRole, newRole: input.newRole, reason: input.reason, statusReset } });
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

      // Cancel all pending/ready tasks
      const allTasks = ctx.tasks.getAllTasks();
      const cancelled: string[] = [];
      for (const task of allTasks) {
        if (task.status === "pending" || task.status === "ready") {
          ctx.tasks.removeTask(task.id);
          cancelled.push(task.id);
        }
      }

      // Add new tasks
      for (const task of input.newTasks) {
        ctx.tasks.addTask({
          id: task.id,
          description: `${task.title}: ${task.description}`,
          assigned_role: task.assignedRole.toLowerCase(),
          status: "pending",
          prerequisites: new Map(task.dependencies.map((d) => [d, false])),
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

      ctx.dagResolver.rebuild(ctx.tasks);
      ctx.onMutation?.({ type: "plan:replanned", data: { reason: input.reason, cancelled, newTasks: input.newTasks.map((t) => t.id) } });
      return `Replan complete. Cancelled ${cancelled.length} task(s), added ${input.newTasks.length} new task(s). Reason: ${input.reason}`;
    },
    {
      name: "replan",
      description: PromptLoader.loadTemplate("tools", "replan"),
      schema: ReplanSchema,
    },
  );
}
