/**
 * Orchestrator Schemas
 *
 * Re-exports existing plan schemas and adds Orchestrator-specific input schemas.
 */

import { z } from "zod";

// Re-export existing schemas from agent module
export {
  AgentPlanSchema,
  TaskItemSchema,
  type TaskItem,
  type AgentPlanOutput,
} from "../agent/internal/schemas/AgentPlanSchema.js";

/**
 * Input schema for create_plan tool
 * Captures what the Orchestrator gathered from conversation
 */
export const PlanRequirementsSchema = z.object({
  goal: z
    .string()
    .describe("User's high-level goal extracted from conversation"),

  context: z
    .string()
    .describe("Relevant context, clarifications, and details gathered"),

  constraints: z
    .array(z.string())
    .default([])
    .describe("Constraints: tech stack, timeline, budget, etc."),

  roles: z
    .array(z.string())
    .describe("Available team roles that can be assigned tasks"),
});

export type PlanRequirements = z.infer<typeof PlanRequirementsSchema>;

/**
 * Status response from get_status tool
 */
export const TaskStatusSummarySchema = z.object({
  total: z.number(),
  ready: z.number(),
  inProgress: z.number(),
  completed: z.number(),
  failed: z.number(),
  tasks: z.array(
    z.object({
      id: z.string(),
      title: z.string(),
      status: z.enum([
        "ready",
        "pending",
        "in_progress",
        "completed",
        "failed",
      ]),
      assignedRole: z.string(),
    }),
  ),
});

export type TaskStatusSummary = z.infer<typeof TaskStatusSummarySchema>;

/**
 * Result from create_plan tool
 */
export const CreatePlanResultSchema = z.object({
  status: z.enum(["awaiting_approval", "error"]),
  taskCount: z.number().optional(),
  error: z.string().optional(),
});

export type CreatePlanResult = z.infer<typeof CreatePlanResultSchema>;

/**
 * Result from approve_plan tool
 */
export const ApprovePlanResultSchema = z.object({
  status: z.enum(["execution_started", "no_pending_plan", "error"]),
  tasksQueued: z.number().optional(),
  error: z.string().optional(),
});

export type ApprovePlanResult = z.infer<typeof ApprovePlanResultSchema>;
