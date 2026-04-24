# Plan Stall After Task Failure — Root Cause Analysis

**Date:** April 18, 2026  
**Symptom:** After a task fails, the plan stalls. Planner acknowledges failure and creates a fix task, but the original failed task never re-dispatches even after the fix task completes.

---

## What Happened (Live Test)

```
1. Task-1 (Design schema)     → ✅ Completed
2. Task-2 (Develop backend API) → ❌ Failed — "blocked, missing schema context"
3. Task-3,4,5 (downstream)    → Pending forever (blocked by Task-2)
4. Planner gets failure notification → creates Task-6 (provide schema)
5. Task-6 completes            → ✅ Done
6. Task-2 stays FAILED         → Never re-dispatches
7. Plan stalls                 → Planner says "monitoring progress" but nothing happens
```

---

## Root Cause: `completeTask()` Only Transitions `pending → ready`

**File:** `TaskStore.ts` line 237

When Task-6 completes, `completeTask()` iterates all dependants and marks prerequisites as met:

```typescript
for (const other of this.tasks.values()) {
  if (other.prerequisites?.has(taskId)) {
    other.prerequisites.set(taskId, true);  // ← Task-6 marked as met
    
    if (this.isReady(other) && other.status === "pending") {  // ← THE BUG
      other.status = "ready";
      this.queueTask(other);
    }
  }
}
```

The condition is `other.status === "pending"`. Task-2 is `"failed"`, not `"pending"`. So even though all prerequisites are now met, **Task-2 never transitions to ready**.

### Why `failed → ready` Exists in VALID_TRANSITIONS But Is Never Used

The state machine defines `failed: ["ready"]` — meaning `failed → ready` is a valid transition. But nothing triggers it automatically. It's only used by:
- `reassign_task` tool (planner manually reassigns — resets to ready)
- The transition exists for manual retry

**No automatic transition path:** `completeTask()` → prerequisite met → dependant is failed → nothing happens.

---

## The Full Stall Chain

```
Task-2 fails (status: "failed")
    │
    ▼
Planner notified: "Task-2 failed. Blocked: task-3, task-4, task-5"
    │
    ▼
Planner creates Task-6 (request_task or add_tasks) 
  with relationship that makes Task-2 depend on Task-6
    │
    ▼
Task-6 dispatches and completes ✅
    │
    ▼
completeTask(task-6):
  - task-2.prerequisites.set("task-6", true)  ← ✅ marked met
  - isReady(task-2) = true                    ← ✅ all prereqs met
  - task-2.status === "pending"?              ← ❌ NO, it's "failed"
  - SKIPPED — task-2 stays failed
    │
    ▼
Nothing else happens. Plan stalled.
Planner says "monitoring" but has no more notifications coming.
```

---

## Why The Planner Can't Fix It

The planner HAS the tools to fix this:
- `reassign_task` — resets failed → ready and triggers dispatch
- `replan` — creates new tasks replacing the failed one

But the planner **doesn't get notified when Task-6 completes**. After the initial failure notification, the planner gets a turn. It creates Task-6. Then... silence. The planner doesn't get another notification when Task-6 finishes because:

1. Task-6 completes → `onTaskComplete` fires
2. `isAllComplete()` → false (Task-2 is failed, 3/4/5 are pending)
3. No "all done" notification sent
4. Planner is NOT notified about Task-6 specifically (it's an individual task completion, not a plan-level event)
5. Planner sits idle. No more input → no more LLM turns.

---

## Fix Options

### Fix A: Auto-transition `failed → ready` when prerequisites become met

In `completeTask()`, change the condition:

```typescript
if (this.isReady(other) && (other.status === "pending" || other.status === "failed")) {
  other.status = "ready";
  this.queueTask(other);
  newlyReady.push(other);
}
```

**Pros:** Simple, handles the exact case. Failed task auto-retries when its new dependency completes.  
**Cons:** Auto-retry without planner review. The planner may not want to retry — maybe the failure was permanent.  
**Risk:** Low — the task gets re-dispatched with the new context. If it fails again, the same failure flow runs.

### Fix B: Notify planner when a failed task's prerequisites become met

In `completeTask()`, if a dependant is failed but now has all prerequisites met, notify the planner:

```typescript
if (this.isReady(other) && other.status === "failed") {
  // Don't auto-transition — notify planner to decide
  this.storeCallbacks.onFailedTaskUnblocked?.(other.id);
}
```

Then OrchestratorService notifies planner: "Task-2 was failed but its new dependency Task-6 completed. Use reassign_task to retry, or replan."

**Pros:** Planner stays in control. Explicit review before retry.  
**Cons:** Extra planner turn. Planner may just always retry anyway.

### Fix C: Fix A + notify planner

Auto-transition AND notify. Best of both worlds:

```typescript
if (this.isReady(other) && other.status === "failed") {
  other.status = "ready";
  this.queueTask(other);
  newlyReady.push(other);
  // Also notify planner
  this.storeCallbacks.onFailedTaskRetried?.(other.id);
}
```

**Recommended: Fix A** — simplest, solves the immediate problem. The planner created the fix task specifically to unblock the failed task. Auto-retrying is the expected behavior.
