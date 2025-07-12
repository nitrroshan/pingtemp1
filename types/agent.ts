// Extend existing types
export interface AgentCapability {
  name: string;
  description: string;
  level: "basic" | "intermediate" | "advanced";
  parameters?: Record<string, any>;
}

export interface Agent {
  id: string;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  status: "available" | "busy" | "offline" | "initializing";
  created_at: Date;
  last_heartbeat: Date;
  metadata?: Record<string, any>;
}

export interface AgentTemplate {
  id: string;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  creation_config: {
    container_image: string;
    environment_variables: Record<string, string>;
    required_resources: {
      cpu: number;
      memory: string;
    };
  };
}

// Supporting Types
export interface AgentAssignment {
  id: string;
  taskId: string;
  subtaskId: string;
  agentId: string;
  assignedAt: Date;
  completedAt?: Date;
  status: "assigned" | "completed" | "failed";
  result?: any;
}

export interface AgentSuggestion {
  id: string;
  name: string;
  description: string;
  capabilities: AgentCapability[];
  creationComplexity: "low" | "medium" | "high";
  estimatedSetupTime: number; // in seconds
}
