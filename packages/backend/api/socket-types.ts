/**
 * socket-types — Shared types, schemas, and utilities for SocketServerV2 modules.
 *
 * Extracted from SocketServerV2.ts (v5.0 communication layer refactor).
 * All sub-modules (EventBroadcaster, MessageHandler, ActionHandler) import from here.
 */

import { z } from "zod";
import type { StreamPayload } from "./types/streamTypes.js";

// ============================================================================
// Input Validation Schemas
// ============================================================================

export const MessagePayloadSchema = z.object({
  teamId: z.string().min(1).max(200),
  agentId: z.string().min(1).max(200),
  taskId: z.string().max(200).optional(),
  sessionId: z.string().max(200).optional(),
  goalId: z.string().max(200).nullish(),
  nonce: z.string().max(200).optional(),
  content: z.string().min(1).max(100000), // 100KB max message
  repoUrl: z.string().url().max(500).optional(),
  repoBranch: z.string().max(200).optional(),
});

export const ActionPayloadSchema = z.object({
  teamId: z.string().min(1).max(200),
  type: z.enum(["approve-plan", "reject-plan", "start-task", "complete-task", "cancel-task", "modify-task", "auto-execute", "get-state"]),
  sessionId: z.string().max(200).optional(),
  taskId: z.string().max(200).optional(),
  goalId: z.string().max(200).optional(),
  output: z.any().optional(),
  changes: z.record(z.any()).optional(),
  enabled: z.boolean().optional(),
  feedback: z.string().max(2000).optional(),
});

// ============================================================================
// Payload Types
// ============================================================================

/** Client → Server: message payload */
export interface MessagePayload {
  teamId: string;
  agentId: string;
  taskId?: string;
  sessionId?: string;
  content: string;
  goalId?: string | null;
  nonce?: string;
  repoUrl?: string;
  repoBranch?: string;
}

/** Client → Server: action payload */
export interface ActionPayload {
  teamId: string;
  type:
    | "approve-plan"
    | "reject-plan"
    | "start-task"
    | "complete-task"
    | "cancel-task"
    | "modify-task"
    | "auto-execute"
    | "get-state";
  sessionId?: string;
  taskId?: string;
  goalId?: string;
  output?: any;
  changes?: Record<string, any>;
  feedback?: string;
  enabled?: boolean;
}

/** Server → Client: message payload */
export interface MessageResponse {
  sessionId: string;
  agentId: string;
  taskId?: string;
  content: string;
  isStreaming?: boolean;
  timestamp: number;
}

/** Server → Client: state payload */
export interface StateResponse {
  sessionId: string;
  sessionState?:
    | "planning"
    | "ready"
    | "executing"
    | "completed"
    | "awaiting_approval";
  plan?: PlanTask[];
  tasks?: any[];
  autoExecute?: boolean;
  goalId?: string;
  timestamp: number;
}

/** Task in a plan, sent to frontend */
export interface PlanTask {
  id: string;
  title: string;
  description: string;
  assignedRole: string;
  status: string;
  priority: number;
  dependencies: string[];
  goalId?: string;
}

/** Server → Client: output payload */
export interface OutputResponse {
  sessionId: string;
  taskId: string;
  agentId: string;
  output: {
    content: string;
    contentType?: string;
    filePath?: string;
    links?: string[];
  };
  timestamp: number;
}

/** Server → Client: progress payload */
export interface ProgressResponse {
  sessionId: string;
  taskId: string;
  agentId: string;
  type: WorkerEventType;
  content: string;
  tool?: string;
  timestamp: number;
}

/** Server → Client: error payload */
export interface ErrorResponse {
  sessionId?: string | undefined;
  taskId?: string | undefined;
  error: string;
  timestamp: number;
}

// ============================================================================
// Worker Event Routing
// ============================================================================

export type WorkerEventType =
  | "thinking"
  | "planning"
  | "tool_start"
  | "tool_result"
  | "message"
  | "message_delta"
  | "artifact"
  | "frame"
  | "hotspots"
  | "error"
  | "done";

export type SocketChannel = "progress" | "stream";

export const WORKER_EVENT_ROUTES: Record<WorkerEventType, SocketChannel[]> = {
  thinking:      ["progress"],
  planning:      ["progress"],
  tool_start:    ["progress"],
  tool_result:   ["progress"],
  message:       [],
  message_delta: [],
  error:         [],
  done:          [],
  artifact:      ["stream"],
  frame:         ["stream"],
  hotspots:      ["stream"],
};

// ============================================================================
// Token Bucket Rate Limiter
// ============================================================================

export class TokenBucketLimiter {
  private buckets = new Map<string, { tokens: number; lastRefill: number }>();

  constructor(
    private capacity: number = 5,
    private refillRate: number = 1,
  ) {}

  allow(userId: string): boolean {
    const now = Date.now();
    let bucket = this.buckets.get(userId);

    if (!bucket) {
      this.buckets.set(userId, { tokens: this.capacity - 1, lastRefill: now });
      return true;
    }

    const elapsed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(this.capacity, bucket.tokens + elapsed * this.refillRate);
    bucket.lastRefill = now;

    if (bucket.tokens < 1) {
      return false;
    }

    bucket.tokens -= 1;
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    const idleThreshold = this.capacity / this.refillRate * 1000 * 2;
    for (const [userId, bucket] of this.buckets) {
      if (now - bucket.lastRefill > idleThreshold) {
        this.buckets.delete(userId);
      }
    }
  }
}

// ============================================================================
// Shared Helpers
// ============================================================================

/**
 * Convert raw accumulator parts into RenderedPart[] format for persistence.
 */
export function toRenderedParts(
  accText: string,
  accParts: Array<{ type: string; [key: string]: any }>,
): any[] {
  const rendered: any[] = [];

  if (accText.trim()) {
    rendered.push({ type: "text", id: "text-0", text: accText, done: true });
  }

  const toolCards = new Map<string, {
    toolCallId: string; toolName: string; status: string;
    argsText: string; args?: unknown; result?: unknown;
  }>();
  const toolOrder: string[] = [];

  for (const p of accParts) {
    if (p.type === "tool-call" || p.type === "tool-input") {
      const id = p.toolCallId;
      if (!toolCards.has(id)) toolOrder.push(id);
      const card = toolCards.get(id) || { toolCallId: id, toolName: p.toolName || "unknown", status: "complete", argsText: "", args: undefined as unknown, result: undefined as unknown };
      card.toolName = p.toolName || card.toolName;
      card.args = (p as any).args ?? (p as any).input;
      try { card.argsText = JSON.stringify(card.args, null, 2); } catch { card.argsText = ""; }
      toolCards.set(id, card);
    } else if (p.type === "tool-result" || p.type === "tool-output") {
      const id = p.toolCallId;
      if (!toolCards.has(id)) toolOrder.push(id);
      const card = toolCards.get(id) || { toolCallId: id, toolName: "unknown", status: "complete", argsText: "", args: undefined as unknown, result: undefined as unknown };
      card.result = (p as any).result ?? (p as any).output;
      card.status = "complete";
      toolCards.set(id, card);
    }
  }
  for (const id of toolOrder) {
    rendered.push({ type: "tool-card", card: toolCards.get(id) });
  }

  for (const p of accParts) {
    if (p.type === "reasoning") {
      rendered.push({ type: "reasoning", id: p.id || "reasoning-0", text: p.text || "", done: true });
    }
  }

  return rendered;
}

/**
 * Convert any task format to PlanTask for frontend.
 */
export function toPlanTask(task: any): PlanTask {
  let dependencies: string[] = [];
  if (task.prerequisites instanceof Map) {
    dependencies = Array.from(task.prerequisites.keys());
  } else if (Array.isArray(task.dependencies)) {
    dependencies = task.dependencies;
  }

  return {
    id: task.id,
    title: task.title || task.description,
    description: task.description,
    assignedRole: task.assignedRole || task.assigned_role,
    status: task.status || "pending",
    priority: task.priority || 0,
    dependencies,
    goalId: task.goalId || undefined,
  };
}

/**
 * Derive session state from tasks.
 */
export function deriveSessionState(plan: PlanTask[]): NonNullable<StateResponse["sessionState"]> {
  if (plan.length === 0) return "ready";
  const hasInProgress = plan.some((t) => t.status === "in_progress");
  const allCompleted = plan.every((t) => t.status === "completed");
  return allCompleted ? "completed" : hasInProgress ? "executing" : "ready";
}

/**
 * Build plan array from manager's TaskStore, optionally scoped to a goal.
 */
export function buildPlan(manager: any, goalId?: string): PlanTask[] {
  const taskStore = manager.getTaskStore();
  if (goalId) {
    const goalTasks = taskStore?.getByGoal(goalId) || [];
    return goalTasks.map((t: any) => toPlanTask(t));
  }
  const allTasks = taskStore?.getAllTasks() || [];
  return allTasks.map((t: any) => toPlanTask(t));
}

/**
 * Build plan array from a pending plan.
 */
export function buildPlanFromPending(pendingPlan: any): PlanTask[] {
  return pendingPlan.tasks?.map((t: any) => toPlanTask(t)) || [];
}

/**
 * Build a complete StateResponse from current manager state.
 */
export function buildStateResponse(
  manager: any,
  sessionId?: string,
  goalId?: string,
): StateResponse {
  const plan = buildPlan(manager, goalId);
  const sessionState = deriveSessionState(plan);

  const response: StateResponse = {
    sessionId: sessionId || "default",
    sessionState,
    timestamp: Date.now(),
    ...(goalId ? { goalId } : {}),
  };

  if (plan.length > 0) {
    response.plan = plan;
  }

  return response;
}

/**
 * Format progress event for display.
 */
export function formatProgressContent(event: any): string {
  switch (event.type) {
    case "thinking":
      return event.content || "Thinking...";
    case "tool_start":
      return `Using tool: ${event.tool || "unknown"}`;
    case "tool_result":
      return typeof event.result === "string"
        ? event.result.substring(0, 200)
        : "completed";
    default:
      return event.content || event.message || JSON.stringify(event);
  }
}

/**
 * Convert a worker event to an AI SDK stream part.
 */
export function toStreamPart(eventType: WorkerEventType, event: any, taskId: string): StreamPayload["part"] | null {
  switch (eventType) {
    case "message_delta":
      return { type: "text-delta", id: `${taskId}-txt`, delta: event.delta ?? "" };
    case "thinking":
      return { type: "reasoning-delta", id: `${taskId}-reason`, delta: event.content ?? "" };
    case "tool_start":
      return { type: "tool-input-start", toolCallId: `${taskId}-${event.tool}`, toolName: event.tool ?? "unknown" };
    case "tool_result":
      return { type: "tool-output-available", toolCallId: `${taskId}-${event.tool}`, toolName: event.tool ?? "unknown", output: event.result ?? "" };
    case "artifact":
      return { type: "artifact-state", artifactId: event.artifactId ?? taskId, state: event.state ?? "ready" };
    default:
      return null;
  }
}

/**
 * Create an ErrorResponse and emit it on a socket.
 */
export function emitError(socket: any, data: Partial<ErrorResponse>): void {
  const response: ErrorResponse = {
    ...data,
    error: data.error || "Unknown error",
    timestamp: Date.now(),
  };
  socket.emit("error", response);
}
