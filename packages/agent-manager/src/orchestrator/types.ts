/**
 * Orchestrator Types
 *
 * Type definitions for the Orchestrator module.
 */

import type { MemoryManager } from "../memory/MemoryManager.js";
import type { WorkerPool } from "../services/WorkerPool.js";
import type { AgentPlanOutput } from "./schemas.js";

/**
 * Orchestrator state machine states
 */
export type OrchestratorState =
  | "idle" // No active session
  | "gathering" // Gathering requirements through conversation
  | "awaiting_approval" // Plan created, waiting for user approval
  | "executing"; // Plan approved, tasks being executed

export interface OrchestratorCallbacks {
  onStream?: (data: { taskId: string; agentId: string; part: any }) => void;
  onEvent?: (data: { taskId: string; event: any }) => void;
  onDone?: (data: { taskId: string; role: string; output: any }) => void;
  onError?: (data: { taskId: string; error: string }) => void;
  onPlanProposed?: (data: { plan: any; teamId: string; timestamp: string }) => void;
  onPlanApproved?: (data: { planId: string; teamId: string; tasksQueued: number; timestamp: string }) => void;
  onTaskUpdate?: (data: { taskId: string; status: string; role?: string; output?: any; timestamp?: number }) => void;
  onProgress?: (data: { teamId: string; state: string; message: string; [key: string]: any }) => void;
}

/**
 * Context provided to all orchestrator tools
 * Uses closure pattern for dependency injection
 */
export interface OrchestratorContext {
  // Core dependencies
  memoryManager: MemoryManager;
  callbacks: OrchestratorCallbacks;
  planStore: any;

  // Team configuration
  teamId: string;
  currentGoalId: string | null;
  teamRoles: string[];

  // PlanBuilder agent for creating plans
  planBuilder: {
    invoke: (params: {
      messages: Array<{ role: string; content: string }>;
    }) => Promise<any>;
  };

  // State management
  getState: () => OrchestratorState;
  setState: (state: OrchestratorState) => void;

  // Pending plan management
  getPendingPlan: () => AgentPlanOutput | null;
  setPendingPlan: (plan: AgentPlanOutput | null) => void;
}

/**
 * Configuration for creating an OrchestratorService
 */
export interface OrchestratorConfig {
  teamId: string;
  teamRoles: string[];
  memoryManager: MemoryManager;
  workerPool: WorkerPool;
  callbacks?: OrchestratorCallbacks;
  /** Injected plan store (required in @ping/agent-manager). */
  planStore?: any;
  /**
   * When true (default), tasks execute automatically when ready.
   * When false, tasks wait in pending state for manual approval.
   */
  autoExecute?: boolean;
}

/**
 * Message format for orchestrator conversation
 */
export interface OrchestratorMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

/**
 * Plan proposal event payload
 */
export interface PlanProposedEvent {
  plan: AgentPlanOutput;
  teamId: string;
  timestamp: string;
}

/**
 * Plan approved event payload
 */
export interface PlanApprovedEvent {
  planId: string;
  teamId: string;
  tasksQueued: number;
  timestamp: string;
}

/**
 * Re-export AgentPlanOutput as TaskPlan for semantic clarity
 */
export type TaskPlan = AgentPlanOutput;
