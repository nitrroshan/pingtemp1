# Git-Based Task Context — Implementation Plan (Revised)

> **Parent:** [Feature Architecture](feature_architecture.md)  
> **Status:** Planning  
> **Branch:** `feature/git-task-context`  
> **Phase:** 3 in the [Parallel Plans roadmap](../parallel-plans/feature_architecture.md#cross-feature-dependency-map)  
> **Depends on:** Chat Agent Layer (Phase 1)  
> **FF Flag:** `FF_ENABLE_GIT_TASK_CONTEXT`  
> **ID:** A8

> **April 2026 revision:** Original plan had per-role git memory repo + 25 memory tools.  
> Simplified to: workspace branch-per-task + `goalId`/`planId` on Task type + scratchpad.  
> Team memory is CRDT (existing L2). Agent memory is conversation persistence (Phase 2).  
> No MemoryRepo, no memory-tools.ts, no LearningExtractor.

## Scope

- Add `goalId` and `planId` as top-level fields on Task type  
- Workspace branch-per-task (already partially exists via `AgentWorkspace`)  
- Scratchpad files (`.scratch/`) — ephemeral, gitignored  
- Post-task output capture via existing `OutputManifest`  
- ChatAgent background review of outputs → writes to Team Memory (CRDT)

**NOT in scope (handled by other features):**
- Team Memory CRDT — already exists as L2 collab  
- Conversation persistence — Phase 2  
- Per-task clone / worktree — Parallel Plans v2.0 (Phase 5)

## What Already Exists

| Component | Status | Location |
|---|---|---|
| `AgentWorkspace` with branch creation | ✅ | `packages/workspace/src/L1/workspace/AgentWorkspace.ts` (1405 lines) |
| `initializeFromRepo()` with git clone | ✅ | Same file, line ~267 |
| `GitBranchManager` with branch/commit/merge | ✅ | `packages/workspace/src/L1/workspace/GitBranchManager.ts` |
| 21 workspace tools | ✅ | Already separated from agent-personal tools |
| `.scratch/` directory setup | ✅ | Created by `AgentWorkspace.initialize()` |
| `OutputManifest` for task outputs | ✅ | `packages/workspace/src/L1/collaboration/OutputManifest.ts` |
| L2 collab tool for team knowledge | ✅ | Existing CRDT infrastructure |
| `goalId` on `WorkerPool` | ✅ | Set via `setTaskServices()` |
| `goalId` on `ChatMessage` | ✅ | Optional field in MongoDB schema |
| `IPlugin.onTaskComplete(taskId, goalId?)` | ✅ | Plugin lifecycle hook |

## What's Missing

| Component | Status | What's Needed |
|---|---|---|
| `goalId` on Task type | ❌ | Top-level field on `Task` interface |
| `planId` on Task type | ❌ | Top-level field on `Task` interface |
| Task-scoped branch naming with goalId | ❌ | `goal-{goalId}/task-{taskId}` branch pattern |
| Workspace merge on task approval | ❌ | Merge task branch → main flow |
| API for artifact review | ❌ | Endpoints to list/diff task branches |

## Implementation Steps

- [ ] **Step 1: Add `goalId` + `planId` to Task type**  
  Files: `packages/agent-manager/src/memory/types/Task.types.ts`  
  Add: `goalId?: string`, `planId?: string` as top-level optional fields  
  Update: `OrchestratorService.approvePlan()` — set `goalId` and `planId` when creating tasks  
  Update: `TaskStore.create()` — accept and store the new fields  
  Backward compat: fields are optional, no migration needed  
  Effort: 0.5 day

- [ ] **Step 2: Goal-scoped branch naming**  
  Files: `packages/workspace/src/L1/workspace/WorkspaceManager.ts`  
  Current: branch name is `task-{taskId}`  
  Target: when `goalId` exists, use `goal-{goalId}/task-{taskId}`  
  Update `createWorkspace()` to accept `goalId` in `initOptions`  
  Effort: 0.5 day

- [ ] **Step 3: Task branch merge flow**  
  Files: `WorkspacePlugin.onTaskComplete()`, `GitBranchManager`  
  On task completion: commit final state → mark branch as ready  
  On approval (new action): merge task branch → main, delete branch  
  On rejection: keep branch, agent continues or planner reassigns  
  If merge conflict: create resolution task  
  Effort: 2 days

- [ ] **Step 4: Artifact review API**  
  Files: `packages/backend/api/HttpServer.ts`  
  `GET /api/v2/teams/:teamId/workspace/files` — main branch file list  
  `GET /api/v2/teams/:teamId/workspace/branches/:branch/files` — task branch files  
  `GET /api/v2/teams/:teamId/workspace/branches/:branch/diff` — diff vs main  
  `POST /api/v2/teams/:teamId/workspace/branches/:branch/approve` — trigger merge  
  Effort: 1.5 days

- [ ] **Step 5: Wire goalId/planId through dispatch pipeline**  
  Files: `OrchestratorService.ts`, `WorkerPool.ts`, `WorkspacePlugin`  
  Thread `goalId` and `planId` from task context → `ToolContext` → `WorkspacePlugin.prepareForTask()`  
  Pass to `WorkspaceManager.createWorkspace()` for branch naming  
  Effort: 1 day

## Testing

- Unit: Task type with goalId/planId, branch naming with goal prefix
- Integration: task dispatch → branch created → agent works → merge to main
- Integration: merge conflict detection → resolution task created
- Regression: existing flows work with goalId=undefined (backward compat)

## Rollback

`FF_ENABLE_GIT_TASK_CONTEXT=false` → `goalId`/`planId` are ignored, branch naming stays `task-{taskId}`, no merge flow (current behavior). Fields exist on Task type but are unused.

## Estimated Total: 5.5 days
