/**
 * Stream Protocol Types — AI SDK Data Stream Protocol
 *
 * Defines the typed payload format for the `stream` Socket.IO event.
 * Mirrors the AI SDK's fullStream part types with Ping-specific extensions.
 *
 * Single `stream` event channel:
 *   socket.emit('stream', { sessionId, taskId, agentId, part })
 *
 * Consumers switch on `part.type` to handle each event.
 */

// ─────────────────────────────────────────────────────────────────────────────
// AI SDK Core Stream Part Types
// ─────────────────────────────────────────────────────────────────────────────

export type StreamPartType =
  // Session lifecycle
  | "start"
  | "finish"
  | "abort"
  // Text
  | "text-start"
  | "text-delta"
  | "text-end"
  // Reasoning / thinking
  | "reasoning-start"
  | "reasoning-delta"
  | "reasoning-end"
  // Tool calls
  | "tool-input-start"
  | "tool-input-delta"
  | "tool-input-available"
  | "tool-output-available"
  // Steps
  | "start-step"
  | "finish-step"
  // Error
  | "error"
  // ── Ping-specific notifications ──────────────────────────────────────────
  | "task-started"
  | "task-completed"
  | "task-failed"
  | "artifact-state"
  | "plan-proposed"
  | "plan-approved";

/** Session start */
export interface StreamStartPart {
  type: "start";
  messageId: string;
}

/** Session finish with usage */
export interface StreamFinishPart {
  type: "finish";
  finishReason: "stop" | "length" | "tool-calls" | "error" | "other";
  usage?: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  };
}

/** Session aborted */
export interface StreamAbortPart {
  type: "abort";
  reason?: string;
}

/** Text streaming */
export interface TextStartPart {
  type: "text-start";
  id: string;
}

export interface TextDeltaPart {
  type: "text-delta";
  id: string;
  delta: string;
}

export interface TextEndPart {
  type: "text-end";
  id: string;
}

/** Reasoning / chain-of-thought */
export interface ReasoningStartPart {
  type: "reasoning-start";
  id: string;
}

export interface ReasoningDeltaPart {
  type: "reasoning-delta";
  id: string;
  delta: string;
}

export interface ReasoningEndPart {
  type: "reasoning-end";
  id: string;
}

/** Tool call — arguments streaming in */
export interface ToolInputStartPart {
  type: "tool-input-start";
  toolCallId: string;
  toolName: string;
}

export interface ToolInputDeltaPart {
  type: "tool-input-delta";
  toolCallId: string;
  delta: string;
}

/** Tool call — full args available (ready to execute) */
export interface ToolInputAvailablePart {
  type: "tool-input-available";
  toolCallId: string;
  toolName: string;
  input: unknown;
}

/** Tool result available */
export interface ToolOutputAvailablePart {
  type: "tool-output-available";
  toolCallId: string;
  toolName: string;
  output: unknown;
}

/** Step boundaries */
export interface StartStepPart {
  type: "start-step";
  stepIndex: number;
}

export interface FinishStepPart {
  type: "finish-step";
  stepIndex: number;
  finishReason: string;
}

/** Error */
export interface StreamErrorPart {
  type: "error";
  error: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ping-Specific Notification Parts
// ─────────────────────────────────────────────────────────────────────────────

export interface TaskStartedPart {
  type: "task-started";
  taskId: string;
  role: string;
  title?: string;
}

export interface TaskCompletedPart {
  type: "task-completed";
  taskId: string;
  role: string;
  title?: string;
}

export interface TaskFailedPart {
  type: "task-failed";
  taskId: string;
  role: string;
  error: string;
}

export interface ArtifactStatePart {
  type: "artifact-state";
  artifactId: string;
  state: "pending" | "ready" | "approved" | "rejected";
  contentType?: string;
  url?: string;
}

export interface PlanProposedPart {
  type: "plan-proposed";
  planId: string;
  taskCount: number;
}

export interface PlanApprovedPart {
  type: "plan-approved";
  planId: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Union type
// ─────────────────────────────────────────────────────────────────────────────

export type StreamPart =
  | StreamStartPart
  | StreamFinishPart
  | StreamAbortPart
  | TextStartPart
  | TextDeltaPart
  | TextEndPart
  | ReasoningStartPart
  | ReasoningDeltaPart
  | ReasoningEndPart
  | ToolInputStartPart
  | ToolInputDeltaPart
  | ToolInputAvailablePart
  | ToolOutputAvailablePart
  | StartStepPart
  | FinishStepPart
  | StreamErrorPart
  | TaskStartedPart
  | TaskCompletedPart
  | TaskFailedPart
  | ArtifactStatePart
  | PlanProposedPart
  | PlanApprovedPart;

// ─────────────────────────────────────────────────────────────────────────────
// Socket.IO payload wrapper
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Outer wrapper emitted on the `stream` Socket.IO channel.
 */
export interface StreamPayload {
  sessionId: string;
  taskId?: string;
  agentId: string;
  part: StreamPart;
  goalId?: string;
  timestamp: number;
}
