/**
 * Orchestrator Types
 *
 * Type definitions for the Orchestrator module.
 */

import type { ITaskProvider } from "./ITaskProvider.js";
import type { WorkerPool } from "../services/WorkerPool.js";
import type { AgentPlanOutput } from "./schemas.js";
import type { PlannerAgent } from "./PlannerAgent.js";
import type { ChatAgent } from "../chatAgent/ChatAgent.js";

/**
 * Orchestrator state machine states
 */
export type OrchestratorState =
  | "idle" // No active session
  | "gathering" // Gathering requirements through conversation
  | "researching" // Pre-plan research tasks running (planner can't submit_plan yet)
  | "awaiting_approval" // Plan created, waiting for user approval
  | "executing" // Plan approved, tasks being executed
  | "queued" // Goal approved but another goal is executing (Phase 4)
  | "done"; // All tasks completed (Phase 4)

/**
 * Per-goal state container (Phase 4 — Parallel Plans v1.0)
 * GoalManager holds Map<goalId, GoalContext>.
 */
export interface GoalContext {
  goalId: string;
  state: OrchestratorState;
  pendingPlan: any | null;
  currentPlanId: string | null;
  title: string;
  createdAt: number;
  // Per-goal agents (Phase 4.5 — moved from AgentManagerV2)
  planner: PlannerAgent | null;
  chatAgents: Map<string, ChatAgent>;
}

/**
 * Summary of a goal for frontend display
 */
export interface GoalSummary {
  goalId: string;
  title: string;
  state: OrchestratorState;
  taskCount: number;
  completedCount: number;
  planId?: string;
  createdAt: number;
}

export interface OrchestratorCallbacks {
  onStream?: (data: { taskId: string; agentId: string; part: any; goalId?: string }) => void;
  onEvent?: (data: { taskId: string; event: any }) => void;
  onDone?: (data: { taskId: string; role: string; output: any }) => void;
  onError?: (data: { taskId: string; error: string }) => void;
  onPlanProposed?: (data: { plan: any; teamId: string; timestamp: string }) => void;
  onPlanApproved?: (data: { planId: string; teamId: string; tasksQueued: number; timestamp: string }) => void;
  onTaskUpdate?: (data: { taskId: string; status: string; role?: string; output?: any; timestamp?: number }) => void;
  /** Channel B — coarse-grained task lifecycle events for ChatAgent + Frontend sidebar */
  onWorkerTaskUpdate?: (update: import("../types/TaskUpdate.js").TaskUpdate) => void;
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
  /** Goal status changed — all tasks completed or all failed */
  onGoalStatusChange?: (data: { teamId: string; status: "completed" | "failed" }) => void;
}

/**
 * Context provided to all orchestrator tools
 * Uses closure pattern for dependency injection
 */
export interface OrchestratorContext {
  // Core dependencies
  taskProvider: ITaskProvider;
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
  taskProvider: ITaskProvider;
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

// ═══════════════════════════════════════════════════════════════════
// GOAL MANAGER (Phase 3.5 — SRP extraction from OrchestratorService)
// ═══════════════════════════════════════════════════════════════════

/**
 * Callbacks GoalManager uses to communicate with OrchestratorService.
 * GoalManager NEVER depends on OrchestratorService directly — only through callbacks.
 */
export interface GoalManagerCallbacks {
  /** A task became ready — dispatch it (GoalManager → OrchestratorService) */
  onDispatchTask: (taskId: string, role: string) => void;
  /** Send message to planner (GoalManager → planner via OrchestratorService) */
  onNotifyPlanner: (message: string) => void;
  /** Forward task status to frontend */
  onTaskUpdate?: OrchestratorCallbacks["onTaskUpdate"];
  /** Forward progress to frontend */
  onProgress?: OrchestratorCallbacks["onProgress"];
  /** Goal status changed (all complete / all failed) */
  onGoalStatusChange?: OrchestratorCallbacks["onGoalStatusChange"];
  /** Plan approved notification */
  onPlanApproved?: OrchestratorCallbacks["onPlanApproved"];
  /** Channel B task updates for ChatAgent + frontend */
  onWorkerTaskUpdate?: OrchestratorCallbacks["onWorkerTaskUpdate"];
}

/**
 * GoalManager interface — owns goal lifecycle, delegates dispatch to OrchestratorService.
 * Single-goal for now. Phase 4 adds Map<goalId, GoalContext>.
 */
export interface IGoalManager {
  // State
  getState(): OrchestratorState;
  setState(state: OrchestratorState): void;
  getGoalId(): string | null;
  getPendingPlan(): any | null;
  setPendingPlan(plan: any | null): void;

  // Lifecycle (wired from TaskStore/WorkerPool callbacks)
  approvePlan(): Promise<{ success: boolean; tasksQueued?: number; error?: string }>;
  onTaskReady(data: { taskId: string; role: string }): void;
  onTaskComplete(data: { taskId: string; output: any }): void;
  onTaskFailed(data: { taskId: string; error: string }): void;
  onWorkerDone(data: {
    taskId: string; role: string; summary: string;
    deliverables?: string[]; nextSteps?: string[]; timestamp: number;
  }): Promise<void>;

  // State management
  reset(): void;
  resetPlan(): Promise<{ deleted: boolean; planId?: string }>;
  interruptPlan(): Promise<void>;
  loadActivePlan(): Promise<void>;
  dispose(): void;
}
