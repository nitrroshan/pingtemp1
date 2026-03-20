/**
 * Orchestrator Types
 *
 * Type definitions for the Orchestrator module.
 */

import type { EventEmitter } from "events";
import type { MemoryManager } from "../memory/MemoryManager.js";
import type { WorkerPool } from "../services/WorkerPool.js";
import type { PlanStore } from "../memory/L2/collaboration/PlanStore.js";
import type { AgentPlanOutput } from "./schemas.js";

/**
 * Orchestrator state machine states
 */
export type OrchestratorState =
  | "idle" // No active session
  | "gathering" // Gathering requirements through conversation
  | "awaiting_approval" // Plan created, waiting for user approval
  | "executing"; // Plan approved, tasks being executed

/**
 * Context provided to all orchestrator tools
 * Uses closure pattern for dependency injection
 */
export interface OrchestratorContext {
  // Core dependencies
  memoryManager: MemoryManager;
  events: EventEmitter;
  planStore: PlanStore;

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
  events: EventEmitter;
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
