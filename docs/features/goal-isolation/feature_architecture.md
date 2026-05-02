# Goal Isolation — Feature Architecture

## Problem

Goals share mutable state. Goal A's planner sees Goal B's failures, creates recovery tasks for the wrong goal. Goals execute serially — Goal B waits until Goal A finishes.

## What We Want

Users submit multiple goals and switch between them freely. Each goal runs independently — like separate group chats. No cross-contamination, no waiting.

## Root Cause

31 violations across 10 files. Two categories:

**Contamination (18 violations):** Tools, notifications, and state queries return data from ALL goals instead of the current goal.

| Leak | Impact |
|---|---|
| `notifyPlanner` routes to `activeGoalId` | Task failures go to wrong planner |
| `get_status` calls `getAllTasks()` | Planner sees other goals' tasks |
| `DependencyResolver` has all goals' tasks | `getBlocked()` returns cross-goal blockers |
| `NotificationQueue` has no goalId | Batched messages go to active goal |
| `WorkerPool.currentGoalId` is a scalar | Last `approvePlan` overwrites for all workers |
| `GoalManager` lifecycle callbacks fall back to `activeGoalId` | Wrong goal gets completion events |

**Serialization (11 violations):** Only one goal can execute at a time.

| Barrier | Impact |
|---|---|
| GoalManager execution mutex | Goal B queued until Goal A finishes |
| Global `MAX_CONCURRENT_DISPATCHES = 2` | Two workers total, not per goal |
| `RoleTaskQueue` keyed by role only | Goals share dispatch queues |
| `DispatchManager` global active/deferred sets | No per-goal concurrency |

## Solution

**Phase 1: Fix contamination.** Every operation carries explicit `goalId`. No `activeGoalId` fallbacks. Tools see only their goal's data.

**Before broader multi-goal execution:** Resolve task ID collisions. The planner generates `task-1` for every goal, while `TaskStore` is keyed globally by `task.id`; this can fail even before full parallelism because approving a queued goal still inserts its tasks into the shared store.

**Phase 2: Enable parallelism.** Remove execution mutex. Per-goal dispatch chains. Multiple goals run workers simultaneously.

No new infrastructure. No database changes. Just fix the existing code.

## Design Rules

1. Every function that touches goal state takes `goalId` explicitly — no `activeGoalId` lookups
2. Tools receive goal-scoped data through `currentGoalId` on `OrchestratorContext`
3. Side effects (notifications, stream events) carry `goalId` from the source task
4. `GoalExecutionContext` is serializable (plain data, no class instances) — future-proofs for extracting to separate processes

## Files Changed

| File | Phase | Violations |
|---|---|---|
| `ITaskProvider.ts` | 1 | V30 — add `getByGoal()` |
| `NotificationQueue.ts` | 1 | V31 — partition by goalId |
| `OrchestratorService.ts` | 1 | V1-V4 — notifyPlanner, dispatchReadyTasks, shared messages |
| `GoalManager.ts` | 1+2 | V5-V9 — lifecycle fallbacks, mutex, chat agent search |
| `AgentManagerV2.ts` | 1+2 | V10-V14 — NotificationQueue flush, planner context closures |
| `getStatus.ts` | 1 | V15 — filter by goalId |
| `executionTools.ts` | 1+2 | V17-V20 — get_blocked, cancel_task |
| `DependencyResolver.ts` | 1 | V22 — goal-scoped rebuild |
| `submitResearch.ts` | 1 | V19 — add goalId to research tasks |
| `WorkerPool.ts` | 1 | V25-V27 — remove scalar currentGoalId |
| `types.ts` | 1 | V29 — goal-scoped getState/setState |
| `DispatchManager.ts` | 2 | V23-V24 — per-goal dispatch chains |
| `RoleTaskQueue.ts` | 2 | V28 — goal-aware queue keys |

## Frontend Changes

Frontend identity migration (goalId-only URLs, `activeGoalId`, `getState(goalId)` replay) handled in `communication-layer-refactor/v2.5`. Goal isolation itself is backend-only — the frontend already scopes display by goalId.

## Future Scaling (not now)

When single-process limits hit, the `GoalExecutionContext` serializable boundary enables:
- Redis-backed state (survive restarts)
- BullMQ task dispatch (horizontal scale)
- Worker threads (crash isolation)
- MongoDB persistence (long-lived goals)

These are additive — no rewrite of Phase 1+2 code. Build when needed.
