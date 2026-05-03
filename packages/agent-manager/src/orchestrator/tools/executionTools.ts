/**
 * Execution Tools
 *
 * Tools for the planner to monitor and control task execution:
 * - cancel_task: Abort a running task
 * - get_blocked: Query what tasks are stuck and why
 * - get_critical_path: Longest dependency chain
 * - search_agents: Find available agents/roles by capability
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import type { DependencyResolver } from "../DependencyResolver.js";
import type { ITaskProvider } from "../ITaskProvider.js";
import type { AgentFactory } from "../../agent/AgentFactory.js";
import { PromptLoader } from "../PromptLoader.js";

// ─── Schemas ──────────────────────────────────────────────────────────────────

export const CancelTaskSchema = z.object({
  taskId: z.string().describe("ID of the task to cancel"),
  reason: z
    .string()
    .describe("Why the task is being cancelled (e.g., 'upstream dependency failed', 'scope changed')"),
});

export const GetBlockedSchema = z.object({
  includeDetails: z.boolean().default(true).describe("Include details of what each task is blocked by"),
});

export const GetCriticalPathSchema = z.object({});

export const SearchAgentsSchema = z.object({
  capability: z
    .string()
    .describe("What capability you're looking for (e.g., 'database', 'testing', 'frontend')"),
});

// ─── Tool Context ─────────────────────────────────────────────────────────────

export interface ExecutionToolContext {
  tasks: ITaskProvider;
  dagResolver: DependencyResolver;
  agentFactory: AgentFactory;
  /** Current goal ID for scoping queries */
  currentGoalId?: string;
  /** Callback to cancel a running worker */
  onCancelTask?: (taskId: string, reason: string) => Promise<boolean>;
}

// ─── Tool Factories ───────────────────────────────────────────────────────────

export function createCancelTaskTool(ctx: ExecutionToolContext) {
  return tool(
    async (input) => {
      const task = ctx.tasks.getTask(input.taskId);
      if (!task) return `Error: Task '${input.taskId}' not found`;

      // Goal ownership check — planner can only cancel its own goal's tasks
      if (ctx.currentGoalId && task.goalId && task.goalId !== ctx.currentGoalId) {
        return `Error: Task '${input.taskId}' belongs to a different goal`;
      }

      if (task.status === "completed") return `Error: Task '${input.taskId}' is already completed`;
      if (task.status === "failed") return `Task '${input.taskId}' has already failed`;

      // If task is in_progress, cancel the worker
      if (task.status === "in_progress") {
        const cancelled = await ctx.onCancelTask?.(input.taskId, input.reason);
        if (!cancelled) {
          return `Warning: Could not cancel running worker for task '${input.taskId}' — it may still be running`;
        }
      }

      // Mark as failed in TaskStore
      await ctx.tasks.updateTaskStatus(input.taskId, "failed");

      return `Task '${input.taskId}' cancelled. Reason: ${input.reason}`;
    },
    {
      name: "cancel_task",
      description: PromptLoader.loadTemplate("tools", "cancel_task"),
      schema: CancelTaskSchema,
    },
  );
}

export function createGetBlockedTool(ctx: ExecutionToolContext) {
  return tool(
    async (input) => {
      // Rebuild DAG scoped to current goal before querying
      if (ctx.currentGoalId) {
        ctx.dagResolver.rebuildForGoal(ctx.tasks, ctx.currentGoalId);
      }
      const blocked = ctx.dagResolver.getBlocked();

      if (blocked.length === 0) {
        return "No tasks are currently blocked. All pending tasks have their dependencies satisfied.";
      }

      if (!input.includeDetails) {
        return `${blocked.length} task(s) blocked: ${blocked.map((b) => b.taskId).join(", ")}`;
      }

      return blocked.map((b) => {
        const task = ctx.tasks.getTask(b.taskId);
        const blockers = b.blockedBy.map((bid) => {
          const blocker = ctx.tasks.getTask(bid);
          return `  - ${bid} (${blocker?.status || "unknown"})`;
        });
        return `**${b.taskId}** (${task?.description || "no description"})\n  Blocked by:\n${blockers.join("\n")}`;
      }).join("\n\n");
    },
    {
      name: "get_blocked",
      description: PromptLoader.loadTemplate("tools", "get_blocked"),
      schema: GetBlockedSchema,
    },
  );
}

export function createGetCriticalPathTool(ctx: ExecutionToolContext) {
  return tool(
    async () => {
      // Rebuild DAG scoped to current goal before querying
      if (ctx.currentGoalId) {
        ctx.dagResolver.rebuildForGoal(ctx.tasks, ctx.currentGoalId);
      }
      const path = ctx.dagResolver.getCriticalPath();

      if (path.length === 0) {
        return "No critical path found (no tasks or no dependencies).";
      }

      const details = path.map((id, i) => {
        const task = ctx.tasks.getTask(id);
        return `${i + 1}. ${id} — ${task?.description || "(no description)"} [${task?.status || "unknown"}]`;
      });

      return `Critical path (${path.length} tasks, longest dependency chain):\n${details.join("\n")}`;
    },
    {
      name: "get_critical_path",
      description: PromptLoader.loadTemplate("tools", "get_critical_path"),
      schema: GetCriticalPathSchema,
    },
  );
}

export function createSearchAgentsTool(ctx: ExecutionToolContext) {
  return tool(
    async (input) => {
      const definitions = ctx.agentFactory.listDefinitions();
      const lowerCap = input.capability.toLowerCase();

      const matches = definitions.filter((d) => {
        if (d.role.startsWith("system/")) return false;
        return (
          d.id.toLowerCase().includes(lowerCap) ||
          d.name.toLowerCase().includes(lowerCap) ||
          d.role.toLowerCase().includes(lowerCap) ||
          (d.description || "").toLowerCase().includes(lowerCap) ||
          (d.goal || "").toLowerCase().includes(lowerCap)
        );
      });

      if (matches.length === 0) {
        return `No agents found matching "${input.capability}". Consider broadening your search.`;
      }

      return matches.map((d) => {
        return `- **${d.name}** (role: ${d.role}, id: ${d.id})\n  ${d.description || "(no description)"}`;
      }).join("\n");
    },
    {
      name: "search_agents",
      description: PromptLoader.loadTemplate("tools", "search_agents"),
      schema: SearchAgentsSchema,
    },
  );
}
