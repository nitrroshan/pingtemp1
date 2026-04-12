/**
 * Orchestrator Types
 *
 * Type definitions for the Orchestrator module.
 */

import type { ITaskProvider } from "./ITaskProvider.js";
import type { MemoryManager } from "../memory/MemoryManager.js";
import type { WorkerPool } from "../services/WorkerPool.js";
import type { AgentPlanOutput } from "./schemas.js";

/**
 * Orchestrator state machine states
 */
export type OrchestratorState =
  | "idle" // No active session
  | "gathering" // Gathering requirements through conversation
  | "researching" // Pre-plan research tasks running (planner can't submit_plan yet)
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

  // Planner-as-Agent callbacks (used when PLANNER_MODE=agent)
  // NOTE: ask_user and tell_user are just tool calls — they flow through onStream
  // as tool-input-*/tool-output-* stream parts (rendered as ToolCards in frontend).
  // No separate events needed. User responses come via the existing message event.
  /** Plan was mutated mid-flight (add/remove/update tasks) — needs state refresh */
  onPlanMutation?: (data: { type: string; data: any }) => void;
  /**
   * Orchestrator needs the planner to make a decision (task failed, all done, etc.)
   * AgentManager wires this to start a new PlannerAgent turn.
   * OrchestratorService does NOT reference PlannerAgent directly — they are peers.
   */
  onPlannerInput?: (message: string) => Promise<void>;
}

/**
 * Context provided to all orchestrator tools
 * Uses closure pattern for dependency injection
 */
export interface OrchestratorContext {
  // Core dependencies
  memoryManager: ITaskProvider;
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
