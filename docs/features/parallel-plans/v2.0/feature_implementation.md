# Parallel Plans v2.0 — Implementation Log

## Branch
- `user/nitrroshan/fixplans`

## Status: Complete (April 27, 2026)

## Key Changes

### Step 1: SubmitPlanSchema
- Added `repoUrl` (required) and `repoBranch` (default "main") to [submitPlan.ts](../../../../packages/agent-manager/src/orchestrator/tools/submitPlan.ts) schema

### Step 2: Thread repoUrl through approvePlan
- [GoalManager.ts](../../../../packages/agent-manager/src/orchestrator/GoalManager.ts) `approvePlan()` now stores `repoUrl`/`repoBranch` from plan into each task's context
- [WorkerPool.ts](../../../../packages/agent-manager/src/services/WorkerPool.ts) extracts `repoUrl`/`repoBranch` from task context (both chat and queue mode) and populates `ToolContext`

### Step 3: ToolContext fields
- Done during GitHub Connect — `repoUrl`, `repoBranch`, `authToken` added to [plugin/types.ts](../../../../packages/agent-manager/src/plugin/types.ts)

### Step 4: WorkspaceManager per-task clone
- [WorkspaceManager.ts](../../../../packages/workspace/src/L1/workspace/WorkspaceManager.ts) `createWorkspace()` now supports **isolated mode**: creates `plan-{planId}/task-{taskId}/` with its own `GitBranchManager` when `repoUrl` + `planId` provided
- Falls back to shared branch mode when no `repoUrl` — backward compatible
- Feature flag: `FF_WORKSPACE_ISOLATION` (defaults to enabled)
- Added `cleanupPlan(planId)` method for post-completion directory removal

### Step 5: Worktree optimization
- **Deferred** — per-task clone works correctly. Worktree (1 clone + N worktrees) is a disk-saving optimization for later.

### Step 6: WorkspacePlugin wiring
- [WorkspacePlugin.ts](../../../../packages/backend/agentManager/plugins/WorkspacePlugin.ts) `prepareForTask()` now passes `planId`, `repoUrl`, `repoBranch`, `authToken` from ToolContext to `createWorkspace()`
- [L1WorkspacePlugin.ts](../../../../packages/workspace/src/L1/L1WorkspacePlugin.ts) updated to forward full `initOptions` (was only forwarding `goalId`)

### Step 7: pushToRemote + cleanup
- Added `pushToRemote()` method to [AgentWorkspace.ts](../../../../packages/workspace/src/L1/workspace/AgentWorkspace.ts) — commits pending changes, pushes branch to remote
- `WorkspacePlugin.onTaskComplete()` auto-pushes for isolated workspaces (non-fatal — local work preserved on push failure)

### Step 8: Frontend integration
- [GoalScreen.tsx](../../../../packages/frontend/components/GoalScreen/GoalScreen.tsx) redesigned as chat-box style: textarea + team selector + submit inside one rounded container, RepoPicker outside below
- `onSubmitGoal` now accepts `repoUrl` and `repoBranch` parameters
- Team dropdown opens downward (fixed overlap issue)

## Deviations from Plan
- Step 5 (worktree) deferred — per-task clone is simpler and works correctly for initial release
- Step 8 went through 3 layout iterations before settling on chat-box style with repo picker outside the box

## Files Changed (12 total)
- `packages/agent-manager/src/orchestrator/tools/submitPlan.ts` — repoUrl on schema
- `packages/agent-manager/src/orchestrator/GoalManager.ts` — thread repoUrl in approvePlan
- `packages/agent-manager/src/services/WorkerPool.ts` — extract repoUrl from task context
- `packages/agent-manager/src/plugin/types.ts` — ToolContext fields (done in GitHub Connect)
- `packages/workspace/src/types/index.ts` — authToken on WorkspaceInitOptions
- `packages/workspace/src/L1/workspace/WorkspaceManager.ts` — isolated mode + cleanupPlan
- `packages/workspace/src/L1/workspace/AgentWorkspace.ts` — pushToRemote + auth token inject
- `packages/workspace/src/L1/L1WorkspacePlugin.ts` — forward full initOptions
- `packages/backend/agentManager/plugins/WorkspacePlugin.ts` — wire isolation + push on complete
- `packages/frontend/components/GoalScreen/GoalScreen.tsx` — chat-box layout + RepoPicker
- `packages/frontend/components/GoalScreen/RepoPicker.tsx` — new component (GitHub Connect)
- `packages/frontend/hooks/useGitHubProfile.ts` — new hook (GitHub Connect)

## Known Issues
- No worktree optimization yet — each task in a plan gets a full clone (disk-heavy for large repos)
- `repoUrl` is required on `SubmitPlanSchema` but planner doesn't receive it in system prompt context yet (needs wiring from GoalManager → planner prompt)
