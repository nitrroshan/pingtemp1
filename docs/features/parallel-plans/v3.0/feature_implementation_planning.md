# Parallel Plans v3.0 — Full Parallel Execution

> **Parent:** [feature_architecture.md](../feature_architecture.md) — Option A (Full Parallel)  
> **Status:** Planning  
> **Branch:** `feature/parallel-plans-v3.0`  
> **Phase:** 6 (final) in the [cross-feature roadmap](../feature_architecture.md#cross-feature-dependency-map)  
> **Depends on:** v1.0 (GoalContext), v2.0 (workspace isolation — eliminates file conflicts)  
> **Unlocks:** Multi-repo teams, external agent parallel dispatch, team stacking

## Why This Is Safe

v3.0 is a **small code change** with a **big behavioral change**. It's safe because:

1. **v2.0 eliminated workspace conflicts** — each task has its own clone/worktree
2. **GoalContext (v1.0) already isolates state** — per-goal dispatch chains, per-goal planner threads
3. **The execution mutex is the only thing serializing goals** — removing it is ~50 lines of code
4. **TaskStore is already goal-scoped** (v1.0) — no cross-goal data contamination
5. **Workers are already task-scoped** — WorkerPool doesn't care which goal spawned a task

## Scope

Remove the execution mutex. Multiple goals execute simultaneously with independent dispatch chains, per-goal concurrency limits, and shared worker pool. This is **Option A from the architecture doc**, enabled by v2.0's workspace isolation.

**Includes:**
- Remove execution mutex — multiple goals in `executing` state
- Per-goal `MAX_CONCURRENT_DISPATCHES` (default 2 per goal, configurable)
- Global concurrency budget (e.g., max 6 total active workers across all goals)
- Per-goal dispatch chain (independent `Promise` chains)
- Planner awareness of other active goals (cross-goal context in planner prompt)
- Worker pool shared across goals — workers accept tasks from any goal
- Per-goal error isolation — one goal failing doesn't crash others
- Frontend: parallel progress view, multi-goal task dashboard

**Excludes:**
- Container sandboxing (separate feature)
- External agent workers (separate feature, but `IWorker` interface supports it)
- Cross-goal task dependencies (future enhancement)

## Implementation Steps

- [ ] **Step 1: Remove execution mutex**  
  Files: `OrchestratorService.ts`  
  Entry: Only one GoalContext can be in `executing` state  
  Exit: Multiple GoalContexts can be `executing` simultaneously  
  Effort: 1 day

- [ ] **Step 2: Per-goal dispatch chain**  
  Files: `OrchestratorService.ts`  
  Entry: GoalContext has its own dispatch chain (from v1.0) but mutex prevents concurrent use  
  Exit: Each goal's dispatch chain runs independently. `dispatchReadyTasks()` scoped to goalId  
  Effort: 1.5 days

- [ ] **Step 3: Concurrency budget**  
  Files: `OrchestratorService.ts`, config  
  Entry: `MAX_CONCURRENT_DISPATCHES = 2` is global  
  Exit: Per-goal limit (default 2) + global cap (default 6). `canDispatch(goalId)` checks both  
  Effort: 1.5 days

- [ ] **Step 4: Worker pool — multi-goal routing**  
  Files: `WorkerPool.ts`, `RoleTaskQueue.ts`  
  Entry: Workers are created per-task but queue doesn't consider goal context  
  Exit: Workers tagged with goalId. Role queue serves tasks from any goal (round-robin across goals for fairness)  
  Effort: 2 days

- [ ] **Step 5: Per-goal error isolation**  
  Files: `OrchestratorService.ts` — error handlers, dependency failure  
  Entry: Task failure flows assume single goal context  
  Exit: `onTaskFailed` scoped to goal. One goal failing → only that goal's dependents affected. Other goals unaffected  
  Effort: 1.5 days

- [ ] **Step 6: Planner cross-goal awareness**  
  Files: Planner prompt, `OrchestratorService._buildPlannerContext()`  
  Entry: Planner has no knowledge of other active goals  
  Exit: Planner system prompt includes summary of other active goals (titles, status, roles in use). Prevents conflicting plans  
  Effort: 1 day

- [ ] **Step 7: Frontend — parallel progress dashboard**  
  Files: `packages/frontend/` — new components  
  Entry: Frontend shows one goal at a time (v1.0 sidebar switcher)  
  Exit: Split view or tabbed view showing multiple goals' progress simultaneously. Per-goal task progress bars. Global worker utilization indicator  
  Effort: 3 days

- [ ] **Step 8: Stress testing + tuning**  
  Entry: Feature works in happy path  
  Exit: Tested with 3+ concurrent goals, 10+ active workers. Concurrency budget prevents OOM. No race conditions in TaskStore/WorkerPool  
  Effort: 2 days

## Testing

- Unit: Concurrency budget logic, per-goal dispatch isolation, round-robin fairness
- Integration: 3 goals executing simultaneously → tasks dispatch correctly → complete independently
- Stress: 5 goals × 4 tasks each → verify memory, token usage, no deadlocks
- Chaos: Kill one goal mid-execution → verify others unaffected

## Rollback

`FF_PARALLEL_EXECUTION` flag. When off, falls back to v1.0 execution mutex (one goal at a time). GoalContext Map and workspace isolation (v2.0) remain active — only the mutex is re-enabled.

## Estimated Total: 13-14 days
