/**
 * Report Status Tool
 * 
 * Allows agents to signal their progress to the user.
 * Emits task:status events for UI updates.
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { PromptLoader } from "../../../orchestrator/PromptLoader.js";
import type { AgentContext, TaskLifecycleHooks } from "../../streaming/types.js";

/**
 * Status values that agents can report
 */
export const TaskStatusSchema = z.object({
  status: z.enum([
    "in_progress",
    "need_clarification", 
    "ready_for_review",
    "blocked",
  ]).describe("Current task status"),
  summary: z.string().describe("Brief summary of progress or what you need"),
  progress: z.number().min(0).max(100).optional().describe("Optional progress percentage"),
});

export type TaskStatusInput = z.infer<typeof TaskStatusSchema>;

/**
 * Create a report_status tool that invokes a callback
 *
 * Phase 1.6 of the agent-stream-bus refactor:
 *   When `lifecycleHooks` is provided, the tool ALSO calls
 *   `lifecycleHooks.onStatusChange(payload, lifecycleCtx)` after the typed
 *   callback. Both run; failures in either are awaited but isolated by the
 *   caller (assembleLifecycleTools wraps in try/catch as needed).
 *
 * @param taskId - The task ID this tool is bound to
 * @param role - The agent role
 * @param onStatus - Legacy typed callback invoked on status updates
 * @param lifecycleHooks - Optional TaskLifecycleHooks (Phase 1.6)
 * @param lifecycleCtx - AgentContext required when lifecycleHooks is set
 */
export function createReportStatusTool(
  taskId: string,
  role: string,
  onStatus?: (data: { taskId: string; role: string; status: string; summary: string; progress?: number; timestamp: number }) => void,
  lifecycleHooks?: TaskLifecycleHooks,
  lifecycleCtx?: AgentContext,
) {
  return tool(
    async (input: TaskStatusInput) => {
      const ts = Date.now();
      onStatus?.({
        taskId,
        role,
        status: input.status,
        summary: input.summary,
        progress: input.progress,
        timestamp: ts,
      });

      // Fan-out to TaskLifecycleHooks (Phase 1.6).
      if (lifecycleHooks?.onStatusChange && lifecycleCtx) {
        await lifecycleHooks.onStatusChange(
          { status: input.status, detail: input.summary },
          lifecycleCtx,
        );
      }

      // Return confirmation to the agent
      return `Status reported: ${input.status} - ${input.summary}`;
    },
    {
      name: "report_status",
      description: PromptLoader.loadTemplate("tools", "report_status"),
      schema: TaskStatusSchema,
    }
  );
}
