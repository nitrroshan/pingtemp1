/**
 * @ping/shared — Message and stream types.
 *
 * Shared between backend (message persistence) and frontend (rendering).
 */

// ─────────────────────────────────────────────────────────────────────────────
// Stream parts (AI SDK Data Stream Protocol)
// ─────────────────────────────────────────────────────────────────────────────

/** All stream part types from AI SDK Data Stream Protocol */
export type StreamPart =
  | { type: 'start'; messageId: string }
  | { type: 'finish'; finishReason: string; usage?: StreamUsage }
  | { type: 'abort'; reason?: string }
  | { type: 'text-start'; id: string }
  | { type: 'text-delta'; id: string; delta: string }
  | { type: 'text-end'; id: string }
  | { type: 'reasoning-start'; id: string }
  | { type: 'reasoning-delta'; id: string; delta: string }
  | { type: 'reasoning-end'; id: string }
  | { type: 'tool-input-start'; toolCallId: string; toolName: string }
  | { type: 'tool-input-delta'; toolCallId: string; delta: string }
  | { type: 'tool-input-available'; toolCallId: string; toolName: string; input: unknown }
  | { type: 'tool-output-available'; toolCallId: string; toolName: string; output: unknown }
  | { type: 'start-step'; stepIndex: number }
  | { type: 'finish-step'; stepIndex: number; finishReason: string }
  | { type: 'error'; error: string }
  | { type: 'task-started'; taskId: string; role: string; title?: string }
  | { type: 'task-completed'; taskId: string; role: string; title?: string }
  | { type: 'task-failed'; taskId: string; role: string; error: string }
  | { type: 'artifact-state'; artifactId: string; state: string }
  | { type: 'plan-proposed'; planId: string; taskCount: number }
  | { type: 'plan-approved'; planId: string };

export interface StreamUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Stream payload (Socket.IO wrapper)
// ─────────────────────────────────────────────────────────────────────────────

/** Outer Socket.IO stream payload */
export interface StreamPayload {
  sessionId: string;
  taskId?: string;
  agentId: string;
  part: StreamPart;
  goalId?: string;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Chat messages
// ─────────────────────────────────────────────────────────────────────────────

/** Backend chat message (MongoDB schema shape) */
export interface ChatMessage {
  id: string;
  teamId: string;
  userId?: string;
  agentId?: string;
  taskId?: string;
  goalId?: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  streamParts?: string; // JSON-stringified RenderedPart[]
  timestamp: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Error response
// ─────────────────────────────────────────────────────────────────────────────

export interface ErrorResponse {
  sessionId?: string;
  taskId?: string;
  error: string;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// API error
// ─────────────────────────────────────────────────────────────────────────────

export interface ApiError {
  status: number;
  message: string;
  code?: string;
}
