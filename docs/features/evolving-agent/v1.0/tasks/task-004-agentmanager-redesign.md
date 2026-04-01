# Task 004: AgentManager Redesign

**Status:** `completed`
**Assignee:** Copilot
**Estimated:** 1-2 days
**Priority:** 🟢 Medium
**Branch:** `feature/agentmanager-redesign`

## Description

Redesign AgentManager as a thin coordinator with a **single entry point**. All user messages flow through the Orchestrator (Project Manager Agent), which routes, plans, and waits for approval. Remove hardcoded orchestration logic.

**See:** [Unified Orchestrator Model](../../../ping/unified-orchestrator.md)

## Current State (2026-01-30)

**Already Implemented:**
- ✅ `AgentManagerV2` exists with OrchestratorService integration
- ✅ `handleMessage()` routes to orchestrator (when USE_ORCHESTRATOR=true)
- ✅ `OrchestratorService` handles planning, approval, execution
- ✅ `MemoryManager` integration with RoleTaskQueue
- ✅ `WorkerPool` for task execution
- ✅ Plan approval flow via `approvePlan()`
- ✅ Basic `approveTask()` for queue-based approval

**Gap Analysis:**
- ⚠️ Still has legacy `configureWorkflow()`, `createPlan()` methods
- ⚠️ Two-mode design (USE_ORCHESTRATOR flag) should be unified
- ❌ No `teamAgents` map for agent registry
- ❌ No `modifyTask()`, `discardTask()` methods
- ❌ No artifact approval (deferred to v1.2)
- ❌ No git branch management (deferred to v1.2)

## Acceptance Criteria

### Core Redesign (v1.0)
- [x] Integrate OrchestratorService for coordination
- [x] Implement `handleMessage()` routing to orchestrator
- [x] Keep `MemoryManager` reference
- [x] Keep `WorkerPool` reference
- [x] Basic `approveTask(taskId)` implemented
- [x] Remove legacy `configureWorkflow()` method or mark deprecated
- [x] Remove legacy `createPlan()` method or mark deprecated
- [x] Unify to single mode (USE_ORCHESTRATOR defaults true, opt-out deprecated)
- [x] Add agent registry via `definitions[]` + WorkerPool
- [x] Add `registerAgent(agent)` for dynamic agent registration
- [x] Add `getActiveAgents()` for UI listing

### Task Control (v1.0)
- [x] `approveTask(taskId)` - Approve and execute task
- [x] `modifyTask(taskId, changes)` - Modify task details before approval
- [x] `discardTask(taskId)` - Reject/cancel proposed task

### Status Methods (v1.0)
- [x] Status available via orchestrator `get_status` tool
- [x] `getStatus()` - Direct method for workflow status
- [x] `getTaskStatus(taskId)` - Individual task status

### Bonus Features (added beyond spec)
- [x] `discoverRoles(taskDescription)` - Pure role discovery without side effects
- [x] `unregisterAgent(agentId)` - Remove agents at runtime
- [x] `setAutoApproveForRole(role, enabled)` - Auto-approve tasks for specific roles
- [x] `setAutoApproveAllRoles(enabled)` - Auto-approve all tasks globally

### Deferred to v1.2+
- Artifact approval (`approveArtifact`, `requestArtifactChanges`, `rejectArtifact`)
- Git branch operations (`approveMerge`, `rejectMerge`, `cancelTask`)
- Auto-approval configuration (`setWorkerAutoApproval`)
- Group chat management (post-MVP)

## Implementation Plan

**See:** [Feature Architecture](../feature_architecture.md) for design rationale.

**Approach:** Parallel Operation (add new, validate, then deprecate)

### Step 1: Add New Types (~15 min)
- Add `TaskChanges` interface to types
- Add `WorkflowStatus` interface to types
- Add `TaskStatusResponse` interface to types

### Step 2: Add Team Agent Registry (~45 min)
- Add `private teamAgents: Map<string, IAgent>`
- Implement `registerAgent(agent: IAgent): void`
- Implement `getActiveAgents(): IAgent[]`
- Wire to RoleManager for dynamic registration

### Step 3: Add Task Control Methods (~1 hour)
- Implement `modifyTask(taskId, changes)` - Update task in MemoryManager
- Implement `discardTask(taskId)` - Remove task from queue/memory
- Implement `getStatus()` - Return workflow status
- Implement `getTaskStatus(taskId)` - Return individual task status

### Step 4: Tests (~1 hour)
- Unit tests for new methods
- Integration test for team agent registration
- Ensure ALL existing tests still pass

### Step 5: Remove USE_ORCHESTRATOR Flag (~30 min)
- Remove `USE_ORCHESTRATOR` environment variable check
- Always use OrchestratorService
- Remove non-orchestrator code paths
- Verify tests still pass

### Step 6: Deprecate Legacy Methods (~15 min) ⚠️ LAST
- Mark `configureWorkflow()` as `@deprecated`
- Mark `createPlan()` as `@deprecated`
- Add console.warn deprecation notices
- Document migration path to `handleMessage()`

## Files to Modify

| File | Changes |
|------|---------|
| `AgentManagerV2.ts` | Add methods, deprecate legacy, remove flag |
| `types/AgentManager.types.ts` | Add `TaskChanges`, `WorkflowStatus` types |

## Testing

**Unit tests:**
- `modifyTask` updates task in MemoryManager
- `discardTask` removes task from queue
- `getStatus` returns correct state
- `registerAgent` adds to team map
- `getActiveAgents` returns registered agents

**Integration tests:**
- Full flow with task modification
- Task discard before execution

## Notes

This task focuses on **cleanup and consolidation** rather than new features:
- v1.1 Orchestrator already does the heavy lifting
- AgentManagerV2 is mostly there, just needs polish
- Artifact approval and git branches are v1.2+ scope

---

**Related Tasks:**
- Task-001: InternalAgent ✅ (complete)
- Task-002: TaskQueue ✅ (complete via RoleTaskQueue)
- Task-003: Orchestrator ✅ (complete via OrchestratorService)
- Task-005: Chat Mode + UI (follows this)
- Task-006: Git Branch Manager (v1.2)
