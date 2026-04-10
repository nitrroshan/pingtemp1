export interface ChatMessage {
  id: string;
  teamId: string;
  sessionId: string;
  role: "user" | "assistant";
  agentId: string;
  taskId?: string;
  content: string;
  timestamp: string;
}
