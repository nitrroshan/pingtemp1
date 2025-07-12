import { AgentCapability } from "./agent";

export interface Subtask {
  id: string;
  description: string;
  requiredCapabilities: AgentCapability[];
  dependencies: string[];
  agent_type: string;
  status: "pending" | "ready" | "in-progress" | "completed" | "failed";
  result?: any;
  created_at: Date;
  updated_at: Date;
}

export interface Task {
  id: string;
  description: string;
  subtasks: Subtask[];
  // Optional field to specify capabilities required for the task
  status: "pending" | "in-progress" | "completed" | "failed";
  created_at: Date;
  updated_at: Date;
}

export interface TaskQueueItem {
  subtask_id: string;
  task_id: string;
  enqueued_at: Date;
}
