export interface ChatMessage {
  id: string;
  teamId: string;
  agentId: string;
  userId: string;
  goalId?: string;
  taskId?: string;
  role: "user" | "assistant" | "system";
  content: string;
  /** Stream parts (tool calls, reasoning, etc.) stored as JSON */
  streamParts?: string;
  /** Agent layer: planner, chat-agent, or worker. Used to scope session restore. */
  agentLayer?: "planner" | "chat-agent" | "worker";
  /** Full AI SDK ModelMessage[] serialized as JSON — for LLM context restoration with tool calls/results */
  contextMessages?: string;
  timestamp: string;
}
