/**
 * Task status enumeration
 * Represents the lifecycle states of a task in the AgentManager
 */
export type Status = "ready" | "pending" | "in_progress" | "completed" | "failed";

/**
 * Task assignment structure
 * Maps roles to their assigned tasks
 */
export type TaskAssignments = Record<string, any[]>;

/**
 * Worker registry structure
 * Maps role names to their corresponding AgentWorker instances
 */
export type WorkerRegistry = Record<string, any>;
