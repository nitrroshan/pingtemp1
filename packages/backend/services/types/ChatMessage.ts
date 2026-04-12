export interface ChatMessage {
  id: string;
  teamId: string;
  agentId: string;
  sessionId: string;
  goalId?: string;
  taskId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Stream parts (tool calls, reasoning, etc.) stored as JSON */
  streamParts?: string;
  timestamp: string;
}
