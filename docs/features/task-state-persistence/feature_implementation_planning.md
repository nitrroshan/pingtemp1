# Task State Persistence — Implementation Planning

> **Parent:** [feature_architecture.md](./feature_architecture.md)  
> **Status:** ✅ Steps 1-4 Implemented, Step 5 deferred  
> **Branch:** `user/nitrroshan/fixplans`

## Implementation Steps

- [x] **Step 1: Read CRDT task statuses in `loadActivePlan()`**  
  Used existing `CrdtTaskSync.loadAllTasks()` (batch read) instead of per-task `readTaskStatusFromCrdt()`.  
  - Calls `crdtTaskSyncProxy.resolveForGoal(goalId)` to unlock CRDT for the goal  
  - Calls `loadAllTasks()` → returns `TaskLike[]` with correct `status`, `output`, `prerequisites`  
  - Builds `Map<taskId, TaskLike>` for O(1) lookup  
  File: `OrchestratorService.ts` (`loadActivePlan`)

- [x] **Step 2: Use CRDT status instead of hardcoded "pending"**  
  For each plan task: `crdtTask?.status ?? "pending"`. Uses CRDT prerequisites (resolved against completed upstream tasks) or falls back to all-false.  
  Also restores `output`, `description`, `context` from CRDT when available.  
  File: `OrchestratorService.ts` (`loadActivePlan`)

- [x] **Step 3: Handle edge cases**  
  - `in_progress` at crash time → reset to `ready` (re-dispatch on next cycle)  
  - `failed` → kept as `failed` (planner decides retry)  
  - CRDT doc missing → graceful fallback to `"pending"` with log warning  
  - Plan `completed` → state set to `idle`, no re-dispatch  
  - `isAllComplete()` check after restore — detects plan finished before restart  
  File: `OrchestratorService.ts` (`loadActivePlan`)

- [x] **Step 4: Write goalId on messages**  
  - Added `getCurrentGoalId()` on `AgentManagerV2` (delegates to `OrchestratorService.getCurrentGoalId()`)  
  - Worker/planner `onStream(finish)` saves `goalId: manager.getCurrentGoalId()`  
  - ChatAgent finish handler saves `goalId: manager.getCurrentGoalId()`  
  - User message save includes `goalId` placeholder (set after team loads)  
  Files: `AgentManagerV2.ts`, `SocketServerV2.ts`

- [ ] **Step 5: Filter restore messages by goalId** (deferred)  
  Restore endpoint should filter session messages by the active goal's ID.  
  Currently returns ALL team messages regardless of goal — causes mixed conversations.  
  File: `HttpServer.ts` (restore endpoint)  
  Blocked by: needs goalId available at restore time (from PlanStore → stored.metadata.goalId)

## SOLID Verification

| Principle | Planned | Implemented | Verdict |
|---|---|---|---|
| **S** | `readTaskStatusFromCrdt()` single method | `loadAllTasks()` reuse — even cleaner | ✅ |
| **O** | `loadActivePlan()` enhanced | CRDT block added before task loop, structure preserved | ✅ |
| **L** | TaskStore.create() unchanged | Same interface, better initial values | ✅ |
| **I** | Access via pluginRegistry | Uses `CrdtProxy` injected interface, not direct CRDT | ✅ |
| **D** | Abstraction, not internals | `loadAllTasks()` API, no Y.js direct calls | ✅ |

## Deviation from Plan

| Planned | Actual | Why |
|---|---|---|
| `readTaskStatusFromCrdt()` per-task method | `loadAllTasks()` batch method | Already existed on CrdtTaskSync. One call loads all tasks with correct prerequisites. More efficient than N individual reads. |
| Step 5 (goalId filter on restore) | Deferred | Requires goalId on old messages first. New messages now have goalId — filter can be added later when enough data has goalId. |

## Files Changed

| File | Change |
|---|---|
| `OrchestratorService.ts` | `loadActivePlan()` reads CRDT, uses correct statuses |
| `AgentManagerV2.ts` | `getCurrentGoalId()` method exposed |
| `SocketServerV2.ts` | `goalId` added to 3 `addMessage()` calls |
