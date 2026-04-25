export interface Agent {
  id: string;
  name: string;
  role: string;
  description: string;
  icon: string; // Using lucide-react icon names conceptually or emojis for simplicity in this demo
  systemInstruction?: string; // Optional system prompt for the agent
  parentId?: string;
  subAgents?: Agent[]; // For hierarchy
  collapsed?: boolean; // UI state for sidebar
  hasAppInterface?: boolean; // If true, shows an "App" tab in the UI
  skills?: string[]; // Assigned skill IDs from agent .md defaultSkills
}

export interface Skill {
  id: string;
  name: string;
  description: string;
}

export interface Message {
  id: string;
  role: "user" | "model";
  content: string;
  timestamp: number;
  isError?: boolean;
  /** If true, this message is still streaming */
  isStreaming?: boolean;
  /** Rendered stream parts (replaces flat content during streaming) */
  streamParts?: RenderedPart[];
}

export type TaskStatus = 'ready' | 'pending' | 'in_progress' | 'completed' | 'failed';

/** Plan summary from backend GoalManager (Phase 4 — Parallel Plans) */
export interface PlanSummary {
  goalId: string;
  title: string;
  state: 'idle' | 'gathering' | 'researching' | 'awaiting_approval' | 'executing' | 'queued' | 'done';
  taskCount: number;
  completedCount: number;
  planId?: string;
  createdAt: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  status: TaskStatus;
  assignedRole?: string;
  priority?: number;
  dependencies?: string[];
  completed: boolean; // Computed from status for backward compatibility
  createdAt?: number;
  goalId?: string; // Phase 4 v1.1 — links task to a specific goal/plan
}

export interface ChatSession {
  agentId: string;
  messages: Message[];
}

export type ThemeColor = "cyan" | "teal" | "purple" | "blue";

export interface ActiveAgentState {
  id: string;
  name: string;
  status: "idle" | "working" | "completed" | "failed";
  currentTask: string;
  reasoning: string;
  assignedAt: number;
}

export interface OrchestrationEvent {
  id: string;
  timestamp: number;
  type: "info" | "success" | "warning" | "error";
  message: string;
  source: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Streaming Types (Phase 2)
// ─────────────────────────────────────────────────────────────────────────────

/** A rendered part inside a streaming message */
export type RenderedPart =
  | { type: "text"; id: string; text: string; done: boolean }
  | { type: "reasoning"; id: string; text: string; done: boolean }
  | { type: "tool-card"; card: ToolCardState }
  | { type: "notification"; chip: NotificationChipState };

/** State of a single tool call card */
export interface ToolCardState {
  toolCallId: string;
  toolName: string;
  status: "calling" | "streaming-args" | "executing" | "complete" | "error";
  /** Partial or full JSON args as string */
  argsText: string;
  /** Parsed args object (available after tool-input-available) */
  args?: unknown;
  /** Tool result (available after tool-output-available) */
  result?: unknown;
  errorMessage?: string;
}

/** State for an inline notification chip */
export interface NotificationChipState {
  type: "task-started" | "task-completed" | "task-failed" | "plan-proposed" | "plan-approved";
  taskId?: string;
  role?: string;
  title?: string;
  error?: string;
}

/** Full stream state accumulated for one message */
export interface StreamState {
  messageId: string;
  /** Ordered parts that compose the message */
  parts: RenderedPart[];
  /** Map of active text parts by ID */
  textParts: Map<string, RenderedPart & { type: "text" }>;
  /** Map of active reasoning parts by ID */
  reasoningParts: Map<string, RenderedPart & { type: "reasoning" }>;
  /** Map of tool cards by toolCallId */
  toolCards: Map<string, ToolCardState>;
  isFinished: boolean;
  usage?: { promptTokens: number; completionTokens: number; totalTokens: number };
}

/** Outer Socket.IO stream payload */
export interface StreamPayload {
  sessionId: string;
  taskId?: string;
  agentId: string;
  part: StreamPart;
  goalId?: string;
  timestamp: number;
}

/** All stream part types from AI SDK Data Stream Protocol */
export type StreamPart =
  | { type: "start"; messageId: string }
  | { type: "finish"; finishReason: string; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } }
  | { type: "abort"; reason?: string }
  | { type: "text-start"; id: string }
  | { type: "text-delta"; id: string; delta: string }
  | { type: "text-end"; id: string }
  | { type: "reasoning-start"; id: string }
  | { type: "reasoning-delta"; id: string; delta: string }
  | { type: "reasoning-end"; id: string }
  | { type: "tool-input-start"; toolCallId: string; toolName: string }
  | { type: "tool-input-delta"; toolCallId: string; delta: string }
  | { type: "tool-input-available"; toolCallId: string; toolName: string; input: unknown }
  | { type: "tool-output-available"; toolCallId: string; toolName: string; output: unknown }
  | { type: "start-step"; stepIndex: number }
  | { type: "finish-step"; stepIndex: number; finishReason: string }
  | { type: "error"; error: string }
  | { type: "task-started"; taskId: string; role: string; title?: string }
  | { type: "task-completed"; taskId: string; role: string; title?: string }
  | { type: "task-failed"; taskId: string; role: string; error: string }
  | { type: "artifact-state"; artifactId: string; state: string }
  | { type: "plan-proposed"; planId: string; taskCount: number }
  | { type: "plan-approved"; planId: string };

export type SessionState =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'completed'
  | 'awaiting_approval'
  | null;

// Global declarations for Electron desktop
declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
    };
    ping?: {
      isDesktop: boolean;
      platform: string;
      versions: {
        electron: string;
        node: string;
        chrome: string;
      };
      minimize: () => void;
      maximize: () => void;
      close: () => void;
    };
  }
}

/** True when running inside Electron desktop shell */
export const isDesktop = Boolean(window.ping?.isDesktop);
