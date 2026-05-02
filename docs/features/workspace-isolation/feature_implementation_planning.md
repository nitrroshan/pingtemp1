## Workspace Isolation — Implementation Plan (Option B)

## Branch
`feature/workspace-goal-isolation`

## Scope
Remove `WorkerPool.currentPlanId` scalar. Read planId per-task from TaskStore. WorkspaceManager keys directories and clone cache on `goalId` instead of `planId`.

---

## Steps

- [ ] **Step 1: WorkerPool — remove currentPlanId scalar, read per-task**
  - `packages/agent-manager/src/services/WorkerPool.ts`
  - Delete `private currentPlanId` field (line 85)
  - Delete `this.currentPlanId = services.planId` from `setTaskServices` (line 142)
  - Compute `taskPlanId` from `storedTask?.planId || storedTask?.context?.planId` (same pattern as `taskGoalId`)
  - Pass `taskPlanId` to `assembleLifecycleTools` TaskServices (line 296) — replaces `this.currentPlanId`
  - Pass `taskPlanId` to ToolContext (line 315) — replaces `this.currentPlanId`
  - Remove re-declaration of `taskGoalId` at line 285 — use the one already computed at line 234/245
  - Remove `planId` from `setTaskServices` interface (line 135)

- [ ] **Step 2: GoalManager — stop passing planId to setTaskServices**
  - `packages/agent-manager/src/orchestrator/GoalManager.ts`
  - In `approvePlan()` ~line 458: remove `planId` from `workerPool.setTaskServices({ ... })` call

- [ ] **Step 3: requestTaskTool — set top-level planId on agent-created tasks**
  - `packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts`
  - Add `planId: ctx.planId || undefined` at top level of the `newTask` object (currently only in `context.planId`)
  - This ensures WorkerPool per-task lookup finds planId for dynamically created tasks

- [ ] **Step 4: WorkspaceManager — key on goalId instead of planId**
  - `packages/workspace/src/L1/workspace/WorkspaceManager.ts`
  - Isolation gate: accept `goalId` OR `planId` (goalId sufficient for isolation)
  - Directory key: `const dirKey = initOptions.goalId || initOptions.planId!`
  - Directory name: `goal-${dirKey}/` instead of `plan-${planId}/`
  - `planRepos` map: `.get(dirKey)`, `.set(dirKey, ...)` — rename field to `goalRepos`
  - Merger lookup: use `dirKey`
  - `cleanupPlan(planId, goalId?)`: use `goalId || planId` as directory key

- [ ] **Step 5: assembleLifecycleTools — remove planId from TaskServices interface**
  - `packages/agent-manager/src/services/tools/assembleLifecycleTools.ts`
  - Remove `planId` from the `TaskServices` interface — it's now computed per-task in WorkerPool and passed directly
  - OR: keep `planId` on `TaskServices` but document it comes from per-task lookup, not the pool scalar

- [ ] **Step 6: Build and verify**
  - `bun run --filter @ping/agent-manager typecheck`
  - `bun run build:backend`

## Files Changed

| File | Change |
|------|--------|
| `packages/agent-manager/src/services/WorkerPool.ts` | Remove `currentPlanId` scalar, per-task lookup for both lifecycle tools and ToolContext |
| `packages/agent-manager/src/orchestrator/GoalManager.ts` | Remove `planId` from `setTaskServices` call |
| `packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts` | Add top-level `planId` on created tasks |
| `packages/workspace/src/L1/workspace/WorkspaceManager.ts` | Key on goalId, rename directory prefix, rename planRepos |
| `packages/agent-manager/src/services/tools/assembleLifecycleTools.ts` | TaskServices.planId now per-task |

## Rollback
Revert 3 files. No database or schema changes. Existing `plan-{planId}/` directories on disk remain (orphaned but harmless). New goals create `goal-{goalId}/` directories.

## Testing
- Two goals with same repo URL → separate `goal-{goalId}/` directories
- Workers for Goal A don't see Goal B's planId
- Workspace push/merge works with goalId-keyed directories
- Single goal still works (regression)
