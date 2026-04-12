/**
 * Orchestrator Tools Factory
 *
 * Creates the planner toolkit (14 tools for planner-as-agent).
 */

import type { OrchestratorContext } from "../types.js";
import type { AgentFactory } from "../../agent/AgentFactory.js";
import type { DependencyResolver } from "../DependencyResolver.js";

// Planner tools (no user interaction tools — planner talks naturally via text)
import { createResearchDomainTool, createAnalyzeRequirementsTool, createGetTeamCapabilitiesTool, type KnowledgeToolContext } from "./knowledgeTools.js";
import { createSubmitPlanTool } from "./submitPlan.js";
import { createSubmitResearchTool } from "./submitResearch.js";
import { createGetStatusTool } from "./getStatus.js";
import { createGetContextTool } from "./getContext.js";
import { createCancelTaskTool, createGetBlockedTool, createGetCriticalPathTool, createSearchAgentsTool, type ExecutionToolContext } from "./executionTools.js";
import { createUpdateTaskTool, createAddTasksTool, createRemoveTaskTool, createReprioritizeTool, createReassignTaskTool, createReplanTool, type PlanMutationContext } from "./planMutationTools.js";

/**
 * Extended context required for planner-mode tools.
 */
export interface PlannerToolsContext {
  orchestratorContext: OrchestratorContext;
  agentFactory: AgentFactory;
  dagResolver: DependencyResolver;
  // User interaction is natural chat — no tools needed.
  // Planner generates text for questions, user answers in next message.
  /** Callback to emit Socket.IO mutation events */
  onMutation?: (event: { type: string; data: any }) => void;
  /** Callback to cancel a running worker */
  onCancelTask?: (taskId: string, reason: string) => Promise<boolean>;
}

/**
 * Creates the planner tool set (for PLANNER_MODE=agent)
 * 15 tools: knowledge (3) + execution (7) + plan mutation (5)
 * User interaction is natural text — no ask_user/tell_user tools.
 */
export function createPlannerTools(ctx: PlannerToolsContext) {
  const { orchestratorContext: octx } = ctx;

  const knowledgeCtx: KnowledgeToolContext = {
    agentFactory: ctx.agentFactory,
  };

  const execCtx: ExecutionToolContext = {
    tasks: octx.memoryManager,
    dagResolver: ctx.dagResolver,
    agentFactory: ctx.agentFactory,
    onCancelTask: ctx.onCancelTask,
  };

  const mutCtx: PlanMutationContext = {
    tasks: octx.memoryManager,
    dagResolver: ctx.dagResolver,
    availableRoles: octx.teamRoles,
    onMutation: ctx.onMutation,
  };

  return [
    // Knowledge (3)
    createResearchDomainTool(knowledgeCtx),
    createAnalyzeRequirementsTool(knowledgeCtx),
    createGetTeamCapabilitiesTool(knowledgeCtx),

    // Execution (7)
    createSubmitPlanTool({ orchestratorContext: octx, dagResolver: ctx.dagResolver }),
    createSubmitResearchTool({ orchestratorContext: octx, dagResolver: ctx.dagResolver }),
    createGetStatusTool(octx),
    createGetContextTool(octx),
    createCancelTaskTool(execCtx),
    createGetBlockedTool(execCtx),
    createGetCriticalPathTool(execCtx),
    createSearchAgentsTool(execCtx),

    // Plan Mutation (5)
    createUpdateTaskTool(mutCtx),
    createAddTasksTool(mutCtx),
    createRemoveTaskTool(mutCtx),
    createReprioritizeTool(mutCtx),
    createReplanTool(mutCtx),
  ];
}

// Re-export individual tool creators for testing
// Re-export individual tool creators for testing
export { createGetStatusTool } from "./getStatus.js";
export { createGetContextTool } from "./getContext.js";
export { createSubmitPlanTool } from "./submitPlan.js";
export { createSubmitResearchTool } from "./submitResearch.js";
export { createResearchDomainTool, createAnalyzeRequirementsTool, createGetTeamCapabilitiesTool } from "./knowledgeTools.js";
export { createCancelTaskTool, createGetBlockedTool, createGetCriticalPathTool, createSearchAgentsTool } from "./executionTools.js";
export { createUpdateTaskTool, createAddTasksTool, createRemoveTaskTool, createReprioritizeTool, createReassignTaskTool, createReplanTool } from "./planMutationTools.js";
