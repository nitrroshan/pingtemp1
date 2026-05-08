/**
 * Complete Task Tool
 * 
 * Allows agents to signal task completion.
 * This is the proper way for agents to mark their work as done.
 * 
 * In auto mode: Agent calls this when it has finished the task
 * In interactive mode: User manually completes via UI (this tool is optional)
 */

import { z } from "zod";
import { tool } from "@langchain/core/tools";
import { PromptLoader } from "../../../orchestrator/PromptLoader.js";
import type { AgentContext, TaskLifecycleHooks } from "../../streaming/types.js";

/**
 * Schema for task completion
 */
export const CompleteTaskSchema = z.object({
  summary: z.string().describe("Summary of what was accomplished"),
  deliverables: z.array(z.string()).optional().describe("List of deliverables or outputs produced (file paths, URLs)"),
  nextSteps: z.array(z.string()).optional().describe("Recommended next steps for the user"),
  producedDocs: z.array(z.object({
    uri: z.string().describe("URI of the document (workspace:path, crdt:docName, https://...)"),
    name: z.string().describe("Human-readable name for this document"),
    description: z.string().optional().describe("What the document contains"),
  })).optional().describe("Documents produced by this task — downstream tasks will receive these as inputDocs"),
  decisions: z.array(z.object({
    decision: z.string().describe("What was decided"),
    rationale: z.string().optional().describe("Why this decision was made"),
  })).optional().describe("Key decisions made during this task — downstream tasks should respect these"),
});

export type CompleteTaskInput = z.infer<typeof CompleteTaskSchema>;

/**
 * Create a complete_task tool that signals task completion
 *
 * Phase 1.6 of the agent-stream-bus refactor:
 *   When `lifecycleHooks` is provided, the tool ALSO calls
 *   `lifecycleHooks.onComplete(payload, lifecycleCtx)` after the typed
 *   callback. If the hook returns `{ accepted: false, reason }`, the tool
 *   surfaces the reason back to the LLM as an actionable error and the task
 *   is NOT marked complete from the agent's perspective.
 *
 * Phase 1.6 fix (May 8 2026): added `onTerminated` callback. Called ONLY
 * when completion is genuinely accepted (orchestration succeeded). The
 * agent runtime uses this to flip its `terminationState` so the streamText
 * `stopWhen` exits cleanly. When the protocol is rejected (e.g. missing
 * report doc) `onTerminated` is NOT called — the agent stays in the loop
 * and reads the error to self-correct.
 *
 * @param taskId - The task ID this tool is bound to
 * @param role - The agent role
 * @param onComplete - Legacy typed callback invoked on task completion
 * @param agentState - Shared state with report_status for blocked guard
 * @param lifecycleHooks - Optional TaskLifecycleHooks (Phase 1.6)
 * @param lifecycleCtx - AgentContext required when lifecycleHooks is set
 * @param onTerminated - Called when completion is accepted by orchestration
 */
export function createCompleteTaskTool(
  taskId: string,
  role: string,
  onComplete?: (data: { taskId: string; role: string; summary: string; deliverables: string[]; nextSteps: string[]; producedDocs?: Array<{ uri: string; name: string; description?: string }>; decisions?: Array<{ decision: string; rationale?: string }>; timestamp: number }) => void,
  agentState?: { lastStatus: string },
  lifecycleHooks?: TaskLifecycleHooks,
  lifecycleCtx?: AgentContext,
  onTerminated?: (kind: "complete" | "bounce") => void,
) {
  return tool(
    async (input: CompleteTaskInput) => {
      // Blocked guard: reject completion if agent reported "blocked"
      if (agentState?.lastStatus === "blocked") {
        return `ERROR: Cannot complete task — you reported status "blocked". You must either:
1. Use bounce_task() to return this task to the planner
2. Use request_task() to create a task for the role that can unblock you
3. Call report_status({ status: "in_progress" }) if you resolved the blocker

Do NOT fabricate output when blocked.`;
      }

      // Completion protocol enforcement: require a CRDT report doc for this task
      const expectedReportUri = `crdt:${taskId}/report`;
      const hasReportDoc = input.producedDocs?.some(
        doc => doc.uri === expectedReportUri
      );
      if (!hasReportDoc) {
        return `ERROR: Completion protocol not followed. Before calling complete_task, you MUST:

1. Write your completion report: collab({ action: "write-block", docName: "${taskId}/report", value: "## What Was Done\\n...\\n## Key Decisions\\n...\\n## Files Produced\\n..." })
2. Record key decisions: collab({ action: "record-decision", docName: "${taskId}/report", key: "decision-name", value: { decision: "...", rationale: "..." } })
3. THEN call complete_task with producedDocs: [{ uri: "${expectedReportUri}", name: "completion-report" }]

Your report doc is the full handoff to downstream agents. Write it now, then call complete_task again.`;
      }

      await onComplete?.({
        taskId,
        role,
        summary: input.summary,
        deliverables: input.deliverables || [],
        nextSteps: input.nextSteps || [],
        producedDocs: input.producedDocs,
        decisions: input.decisions,
        timestamp: Date.now(),
      });

      // Fan-out to TaskLifecycleHooks (Phase 1.6).
      if (lifecycleHooks?.onComplete && lifecycleCtx) {
        const ack = await lifecycleHooks.onComplete(
          {
            summary: input.summary,
            deliverables: input.deliverables,
            nextSteps: input.nextSteps,
            producedDocs: input.producedDocs,
            decisions: input.decisions,
            timestamp: Date.now(),
          },
          lifecycleCtx,
        );
        if (ack && ack.accepted === false) {
          // Rejected. Do NOT terminate — let the LLM read the reason and
          // call again with the missing pieces.
          return `ERROR: Orchestrator rejected complete_task: ${ack.reason ?? "no reason given"}`;
        }
      }

      // Accepted. Mark agent terminated so the streamText loop exits.
      onTerminated?.("complete");

      // Return confirmation to the agent
      return `Task marked complete. Summary: ${input.summary}`;
    },
    {
      name: "complete_task",
      description: PromptLoader.loadTemplate("tools", "complete_task"),
      schema: CompleteTaskSchema,
    }
  );
}
