# Task 003: Orchestrator Agent Implementation

**Status:** `not-started`
**Assignee:** 
**Estimated:** 2-3 days
**Priority:** 🟡 Medium-High
**Branch:** `feature/orchestrator-agent`

## Description

Implement the Orchestrator as an InternalAgent with tools. The Orchestrator is AgentManager's "brain" - it uses LLM reasoning to decide workflow, calling tools that invoke other agents (PlanBuilder, workers). This replaces the hardcoded orchestration logic in AgentManager.

## Context

The documented architecture (see `docs/developer-guide/modules/orchestrator.md`) specifies:
- Orchestrator is an `InternalAgent` with tools
- Tools invoke other agents (not just functions)
- LLM decides when to call `create_plan`, `queue_task`, `replan`
- Dynamic workflow vs. hardcoded pipeline

Currently:
- ❌ No Orchestrator agent exists
- `AgentManager.createTask()` has hardcoded logic
- No tool-based delegation to builder agents

## Acceptance Criteria

- [ ] Create `src/worker/agent/agents/orchestrator.yaml` agent definition
- [ ] Implement Orchestrator tools in `src/worker/agentManager/tools/`

**Orchestrator-facing tools:**
- [ ] Tool: `create_plan` - Calls PlanBuilder agent, stores tasks in MemoryManager
- [ ] Tool: `queue_task` - Gathers context, creates branch, adds task to TaskQueue
- [ ] Tool: `sync_artifacts` - Stores agent outputs (pending approval)
- [ ] Tool: `get_context` - Retrieves outputs from completed dependencies
- [ ] Tool: `replan` - Calls PlanBuilder with failure context
- [ ] Tool: `get_status` - Checks TaskQueue and agent status
- [ ] Tool: `classify_intent` - Determine if message needs instant response or approval

**Branch management tools:**
- [ ] Tool: `create_branch` - Create git branch for task
- [ ] Tool: `merge_branch` - Merge completed task branch
- [ ] Tool: `delete_branch` - Delete branch (cancelled/rejected)

**Worker-facing tools:**
- [ ] Tool: `request_task` - Worker asks for task for another worker (→ proposed)
- [ ] Tool: `request_collaboration` - Worker requests group chat with another worker
- [ ] Tool: `report_progress` - Worker sends status update
- [ ] Tool: `report_blocker` - Worker reports issue needing attention
- [ ] Tool: `ask_user` - Forward question to user for clarification
- [ ] Tool: `submit_artifact` - Submit output for user approval
- [ ] Tool: `request_merge` - Request branch merge on completion
- [ ] Tool: `close_session` - End conversation session

**Core behaviors:**
- [ ] Orchestrator uses LLM reasoning to choose tools
- [ ] Tiered routing: instant (questions/status) vs approval (tasks/artifacts)
- [ ] Event emission for tool calls (`toolCall` event)
- [ ] All worker-created tasks go to `proposed` status (await approval)
- [ ] All artifacts require approval before available to other workers
- [ ] Group chat sessions: time-boxed (15 min), max 2 workers
- [ ] Auto-approval checking before requesting user approval
- [ ] Status updates pushed to user automatically

## Implementation Notes

**Files to create/modify:**
- Create: `src/worker/agent/agents/orchestrator.yaml`
- Create: `src/worker/agentManager/tools/createPlanTool.ts`
- Create: `src/worker/agentManager/tools/queueTaskTool.ts`
- Create: `src/worker/agentManager/tools/syncArtifactsTool.ts`
- Create: `src/worker/agentManager/tools/getContextTool.ts`
- Create: `src/worker/agentManager/tools/replanTool.ts`
- Create: `src/worker/agentManager/tools/getStatusTool.ts`
- Create: `src/worker/agentManager/tools/index.ts`

**Orchestrator YAML definition:**
```yaml
id: orchestrator
name: "Orchestrator"
role: system/orchestrator
type: internal

goal: "Coordinate team agents to accomplish user goals"

systemPrompt: |
  You are an orchestration agent that coordinates a team of AI agents.
  
  The team already exists (created by RoleManager). Your job:
  1. Create a plan → Call create_plan tool (invokes PlanBuilder agent)
  2. Queue tasks → Call queue_task tool (adds to TaskQueue by role)
  3. Listen for completion events → Agents poll and execute themselves
  4. Sync artifacts → Call sync_artifacts tool (store outputs)
  5. Handle failures → Call replan tool
  
  IMPORTANT: You QUEUE tasks by role. Agents POLL and execute themselves.
  Think step-by-step. Tools invoke other agents to do the work.

config:
  model:
    provider: azure-openai
    deployment: gpt-4o-2
  tools:
    - create_plan
    - queue_task
    - sync_artifacts
    - get_context
    - replan
    - get_status
```

**Tool context pattern:**
```typescript
const createPlanTool = tool(
  async ({ goal }, { factory, memoryManager, teamAgents }) => {
    const planBuilder = factory.create('plan-builder');
    const result = await planBuilder.execute({ goal, roles });
    // Store tasks in MemoryManager
    return result.structuredResponse;
  },
  { name: 'create_plan', schema: z.object({ goal: z.string() }) }
);
```

**Dependencies:**
- Task-001: InternalAgent (Orchestrator is an InternalAgent)
- Task-002: TaskQueue (queue_task tool uses it)
- Existing: PlanBuilder, ConfigBuilder agents

## Code TODOs

_To be added when implementation begins_

## Testing

**Unit tests:**
- Each tool in isolation
- Tool invokes correct agent
- Context passed correctly
- Error handling per tool

**Integration tests:**
- Orchestrator creates plan and queues tasks
- Orchestrator replans on failure
- Full workflow execution

## Blockers

- Depends on Task-001 (InternalAgent)
- Depends on Task-002 (TaskQueue)

## Notes

This is the key architectural change - moving from procedural orchestration to LLM-driven orchestration. The Orchestrator agent decides the workflow dynamically rather than following a hardcoded sequence.

Key insight: Tools = Agent Calls. The `create_plan` tool doesn't just run logic, it invokes the PlanBuilder agent.

---

**Related Tasks:**
- Task-001: InternalAgent (prerequisite)
- Task-002: TaskQueue (prerequisite)
- Task-004: AgentManager Redesign (uses Orchestrator)
