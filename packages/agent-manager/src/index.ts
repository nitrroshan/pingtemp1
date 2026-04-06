/**
 * @ping/agent-manager — Public API
 *
 * Orchestration layer for the Ping platform.
 *
 * Phase 3C Status:
 *   Step 1 (this PR)  — Package declared; public contract types exported here.
 *   Step 2 (next PR)  — Source code physically moved from @ping/backend to
 *                        packages/agent-manager/src/ and AgentManager class
 *                        exported from this package.
 *
 * See docs/features/ROADMAP.md — Phase 3C: Team Package & Multi-Team.
 *
 * Until Step 2 is complete, import the AgentManager implementation directly:
 *   import { AgentManager } from "@ping/backend/agentManager/AgentManagerV2.js"
 *   import { agentManagerRegistry } from "@ping/backend/agentManager/AgentManagerRegistry.js"
 */

export type {
  // Plan types
  TaskContext,
  TaskItem,
  PlanPhase,
  AgentPlanOutput,
  TaskPlan,
  // Event types
  OrchestratorState,
  PlanProposedEvent,
  PlanApprovedEvent,
  // Callback interfaces
  WorkerCallbacks,
  OrchestratorCallbacks,
  ManagerStreamCallbacks,
  // Registry types
  TeamData,
} from "./types.js";
