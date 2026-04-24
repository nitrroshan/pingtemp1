/**
 * TaskUpdate — Channel B event type.
 *
 * Coarse-grained task-level events synthesized from worker execution.
 * ChatAgent receives these (not raw stream_part tokens).
 * Same shape published to Socket.IO `task_update` channel and MCP SSE.
 *
 * See: docs/features/chat-agent-layer/feature_architecture.md — "Two distinct event channels"
 */

export type TaskUpdate =
  | { type: "started";        taskId: string; role: string; ts: number }
  | { type: "progress";       taskId: string; role: string; note: string; pct?: number; stepIdx?: number; tokensSoFar?: number; ts: number }
  | { type: "tool_milestone"; taskId: string; role: string; tool: string; summary: string; durationMs?: number; ts: number }
  | { type: "ask_user";       taskId: string; role: string; questionId: string; question: string; ts: number }
  | { type: "blocked";        taskId: string; role: string; reason: string; suggestedRole?: string; ts: number }
  | { type: "completed";      taskId: string; role: string; summary: string; deliverables?: string[]; nextSteps?: string[]; ts: number }
  | { type: "failed";         taskId: string; role: string; error: string; lastStep?: string; ts: number };

/** Tools that produce milestone events (not every tool call is a milestone) */
export const MILESTONE_TOOLS = new Set([
  "complete_task",
  "bounce_task",
  "report_status",
  "workspace_commit",
  "workspace_publish",
  "collab",
]);
