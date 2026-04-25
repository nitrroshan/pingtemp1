# Git-Based Task Context — Implementation Plan (Revised)

> **Parent:** [Feature Architecture](feature_architecture.md)  
> **Status:** Ready to implement  
> **Branch:** `feature/git-task-context`  
> **Phase:** 3 in the [Parallel Plans roadmap](../parallel-plans/feature_architecture.md#cross-feature-dependency-map)  
> **Depends on:** Chat Agent Layer (Phase 1 ✅), Conversation Persistence (Phase 2 ✅)  
> **FF Flag:** `FF_ENABLE_GIT_TASK_CONTEXT`  
> **ID:** A8

> **April 25, 2026 revision:** Audited against codebase. Original 5 steps → 4 steps.  
> Deferred: Artifact review API (needs GitBranchManager methods + HttpServer wiring — build when frontend Phase 15 is ready).  
> Deferred: Manual approval gating (A9 Approval System).  
> Simplified: Step 5 (wiring) is ~5 lines, merged into Step 1.

## Scope

- Add `goalId` and `planId` as top-level fields on Task type + query methods  
- Goal-scoped branch naming (`goal-{goalId}/task-{taskId}`)  
- Auto-merge task branch to main on completion + conflict → resolution task  
- Wire goalId/planId through dispatch pipeline (ToolContext → WorkspacePlugin)

**NOT in scope:**
- Artifact review API — deferred to frontend Phase 15 (needs `listFiles()`, `getDiff()` on GitBranchManager)  
- Manual approval gating — deferred to A9 Approval System  
- Per-task clone / worktree — Parallel Plans v2.0 (Phase 5)  
- Post-task learning extraction — C4 (⚠️ Needs Rethinking)

## What Already Exists

| Component | Status | Notes |
|---|---|---|
| `AgentWorkspace` with branch/commit/merge | ✅ | `publish()` and `merge()` methods exist |
| `GitBranchManager` with branch/commit/merge | ✅ | `mergeBranch()` returns success/failure |
| `WorkspacePlugin.onTaskComplete()` | ✅ | Calls `publish()`, then calls `mergeAndCleanup()` — **but that method doesn't exist yet** |
| `goalId` derived in `OrchestratorService.approvePlan()` | ✅ | `toGoalId()` + `currentGoalId` field |
| `planId` available in `approvePlan()` | ✅ | `planToApprove.planId` |
| `goalId` + `planId` in `WorkerPool.taskServices` | ✅ | Set via `setTaskServices({ ..., planId, goalId })` |
| `ToolContext` type + `prepareForTask()` flow | ✅ | WorkerPool builds it → PluginRegistry → plugins |
| `FilePlanStore` scoped by `{teamId}/{goalId}/{planId}` | ✅ | Already goal-scoped |
| `.scratch/` directory + scratchpad tools | ✅ | Gitignored, ephemeral |

## What's Missing

| Component | What's Needed |
|---|---|
| `goalId`/`planId` on Task type | Top-level optional fields (currently only in `task.context`) |
| `TaskStore.getByGoal()` | Query method for Phase 4 GoalContext |
| `FileTaskStore` persistence | Save/load `goalId`/`planId` |
| Goal-scoped branch naming | `goal-{goalId}/task-{taskId}` instead of `task-{taskId}` |
| `WorkspaceManager.mergeAndCleanup()` | Called by WorkspacePlugin but doesn't exist — **runtime error** |
| `goalId`/`planId` on `ToolContext` | 2 fields missing from type |
| ToolContext wiring | 2 lines in WorkerPool + 1 line in WorkspacePlugin |

## Implementation Steps

### Step 1: `goalId`/`planId` on Task type + pipeline wiring (0.5 day)

**Files:**
- `packages/agent-manager/src/memory/types/Task.types.ts` — add `goalId?: string`, `planId?: string`
- `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — in `approvePlan()`, set `goalId` and `planId` on each task (both values already derived, just not set)
- `packages/agent-manager/src/orchestrator/TaskStore.ts` — add `getByGoal(goalId)` and `getByPlan(planId)` query methods
- `packages/agent-manager/src/persistence/FileTaskStore.ts` — add `goalId`/`planId` to `StoredTask` interface and `addTask()`
- `packages/agent-manager/src/plugin/types.ts` — add `goalId?: string`, `planId?: string` to `ToolContext`
- `packages/agent-manager/src/services/WorkerPool.ts` — add `goalId`/`planId` to ToolContext construction (~line 285):
  ```typescript
  const toolContext: ToolContext = {
    consumer: "worker",
    role: roleKey,
    taskId,
    goalId: this.taskServices?.goalId,   // ← add
    planId: this.taskServices?.planId,   // ← add
  };
  ```

**What changes (exact):**
- Task.types.ts: +2 lines (fields)
- OrchestratorService.ts: +2 lines in `approvePlan()` task creation block
- TaskStore.ts: +8 lines (2 query methods: filter by goalId/planId)
- FileTaskStore.ts: +2 lines in `StoredTask` + 2 lines in `addTask()`
- ToolContext type: +2 lines
- WorkerPool.ts: +2 lines in ToolContext construction

**Backward compat:** All fields optional. Existing tasks with no goalId work unchanged.

### Step 2: Goal-scoped branch naming (0.5 day)

**Files:**
- `packages/workspace/src/L1/workspace/WorkspaceManager.ts` — update `createWorkspace()` to accept `goalId` and build branch name:
  ```typescript
  async createWorkspace(
    agentId: string,
    taskId: string,
    initOptions?: WorkspaceInitOptions & { goalId?: string },
  ): Promise<AgentWorkspace> {
    // ...existing early return for existing workspace...
    const branchName = initOptions?.goalId
      ? `goal-${initOptions.goalId}/task-${taskId}`
      : `task-${taskId}`;
    // ...rest unchanged, uses branchName...
  }
  ```
- `packages/backend/agentManager/plugins/WorkspacePlugin.ts` — update `prepareForTask()` to pass `context.goalId`:
  ```typescript
  await this.l1.createWorkspace(context.role, context.taskId, { goalId: context.goalId });
  ```

**What changes (exact):**
- WorkspaceManager.ts: +3 lines (param type + branch name conditional)
- WorkspacePlugin.ts: +1 line (pass goalId)

### Step 3: Task branch merge flow (1.5 days)

**Problem:** `WorkspacePlugin.onTaskComplete()` calls `this.l1.manager.mergeAndCleanup(taskId)` which **doesn't exist** — this is a runtime error in production today (caught by try/catch, logged as warning).

**Files:**

**3a. Add `mergeAndCleanup()` to WorkspaceManager (new method):**
- `packages/workspace/src/L1/workspace/WorkspaceManager.ts`
  ```typescript
  async mergeAndCleanup(taskId: string): Promise<{ success: boolean; error?: string; conflicts?: string[] }> {
    const workspace = this.workspaces.get(taskId);
    if (!workspace) return { success: true }; // no workspace = nothing to merge

    // Publish if not already
    if (workspace.status === "active") {
      await workspace.publish();
    }

    if (workspace.status !== "published") {
      return { success: false, error: `Cannot merge: status is ${workspace.status}` };
    }

    try {
      const result = await workspace.merge();
      if (!result.success) {
        return { success: false, error: "Merge conflicts", conflicts: result.conflicts };
      }

      // Delete branch after successful merge
      try {
        await this.gitManager.deleteBranch(workspace.branchName);
      } catch { /* branch delete is best-effort */ }

      // Remove from registry
      this.workspaces.delete(taskId);
      return { success: true };
    } catch (err: any) {
      return { success: false, error: err.message };
    }
  }
  ```

**3b. Handle merge conflicts → create resolution task in OrchestratorService:**
- `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — in the `onWorkerDone` / task completion handler, check merge result:
  ```typescript
  // After WorkspacePlugin.onTaskComplete() returns
  if (!mergeResult.success && mergeResult.conflicts?.length) {
    // Create a resolution task
    this.taskStore.create({
      id: `resolve-${taskId}`,
      title: `Resolve merge conflicts from ${task.title}`,
      description: `Merge conflicts in: ${mergeResult.conflicts.join(", ")}. Resolve and commit.`,
      assigned_role: task.assigned_role,
      goalId: task.goalId,
      planId: task.planId,
      status: "pending",
      prerequisites: new Map(),
      dependants: task.dependants || [],
    });
  }
  ```

**3c. Verify `GitBranchManager.deleteBranch()` exists:**
- Check if `deleteBranch(branchName)` exists. If not, add: `await this.git.deleteLocalBranch(branchName)` (~3 lines).

**What changes (exact):**
- WorkspaceManager.ts: +25 lines (new method)
- OrchestratorService.ts: +15 lines (conflict → resolution task)
- GitBranchManager.ts: +5 lines (deleteBranch if missing)
- WorkspacePlugin.ts: 0 lines (already calls mergeAndCleanup correctly)

### ~~Step 4: Artifact review API~~ — DEFERRED

Deferred until frontend Phase 15 is ready to consume it. Requires:
- `GitBranchManager.listFiles(branch)` — doesn't exist
- `GitBranchManager.getDiff(fromBranch, toBranch)` — doesn't exist
- `GitBranchManager.readFileOnBranch(branch, path)` — doesn't exist
- HttpServer → WorkspaceManager bridge — not wired

These are needed for `GET /api/v2/teams/:teamId/tasks/:taskId/changes` (Phase 15 API).
Build together with frontend to avoid speculative API design.

### ~~Step 5: Wire goalId/planId~~ — MERGED INTO STEP 1

Only 5 lines across 2 files. Merged into Step 1 since they touch the same pipeline.

## Testing

- Unit: Task type with goalId/planId fields, TaskStore.getByGoal() query
- Unit: Branch naming with/without goalId (conditional pattern)
- Integration: task dispatch → branch created with goal prefix → agent works → merge to main
- Integration: merge conflict → resolution task created with correct role/goal/plan
- Regression: existing flows work with goalId=undefined (backward compat, no branch prefix)

## Rollback

`FF_ENABLE_GIT_TASK_CONTEXT=false` → `goalId`/`planId` fields exist but ignored, branch naming stays `task-{taskId}`, `mergeAndCleanup()` still runs (it already should — fixing the runtime error). Fields are optional, no migration needed.

## Estimated Total: 2.5 days

| Step | What | Effort |
|------|------|--------|
| 1 | goalId/planId on Task type + queries + pipeline wiring | 0.5d |
| 2 | Goal-scoped branch naming | 0.5d |
| 3 | mergeAndCleanup() + conflict resolution task | 1.5d |
| **Total** | | **2.5 days** |
