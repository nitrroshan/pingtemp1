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
}

export interface Message {
  id: string;
  role: "user" | "model";
  content: string;
  timestamp: number;
  isError?: boolean;
}

export type TaskStatus = 'ready' | 'pending' | 'in_progress' | 'completed' | 'failed';

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

export type SessionState =
  | 'idle'
  | 'planning'
  | 'executing'
  | 'completed'
  | 'awaiting_approval'
  | null;

// Global declarations for Electron
declare global {
  interface Window {
    electronAPI?: {
      isElectron: boolean;
    };
  }
}
