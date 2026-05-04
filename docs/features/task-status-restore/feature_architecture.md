# Task Status Restore on Restart — Feature Architecture

> **Status:** Design review  
> **Severity:** High — completed tasks show as pending after restart  
> **Discovered:** Phase 4.5 testing

## Problem

After backend restart, all tasks show as "pending" in the frontend sidebar even though some were completed. Users see completed tasks with "Start" buttons again.

## Current Architecture

Task status is persisted in **3 stores** during execution but only restored from 1 (CRDT), which fails silently:

```
SAVE PATH (all 3 written):
  Task status change
    → CrdtTaskSync.syncStatus()     [Hocuspocus Y.js — primary]
    → FileTaskStore.updateStatus()  [JSON on disk — backup]
    → Socket.IO "state" event       [frontend live update]

RESTORE PATH (only CRDT read):
  Backend restart
    → FileTaskStore.load()          [loaded but NEVER queried ❌]
    → GoalManager.loadActivePlan()
      → PlanStore.getLatestActivePlan()   [plan structure — NO status]
      → CrdtTaskSync.loadAllTasks()       [task status — FAILS SILENTLY ❌]
      → status = crdtTask?.status ?? "pending"  [ALL tasks become "pending"]
```

### Why CRDT Fails on Restart

`loadActivePlan()` runs during `OrchestratorService.initialize()`. At that point:
1. `crdtTaskSyncProxy` is a lazy resolver — may not be resolved yet
2. `resolveForGoal(goalId)` depends on CollaborationPlugin being fully initialized
3. Hocuspocus Y.js documents load asynchronously — may not be ready

The catch block silently logs a warning and continues with all tasks as "pending".

### What FileTaskStore Has

`data/tasks/{teamId}/tasks.json` — written on every status change (debounced 2s):

```json
[
  { "id": "task-1", "status": "completed", "output": { "summary": "..." }, ... },
  { "id": "task-2", "status": "in_progress", "assigned_role": "qa", ... },
  { "id": "task-3", "status": "pending", ... }
]
```

FileTaskStore is **loaded at startup** (`filePersistence.load()` at AgentManagerV2 line 132) — the data is available. It's just never queried by `loadActivePlan()`.

## Architecture Options

### Option A: FileTaskStore as Fallback in loadActivePlan

**Implementation:** After CRDT read (success or failure), check FileTaskStore for any tasks whose status is more advanced than CRDT's.

```typescript
for (const t of stored.plan.tasks) {
  const crdtTask = crdtTasks?.get(t.id);
  const fileTask = this.fileTaskStore?.getTask(t.id);
  
  // Use the most advanced status: CRDT > FileTaskStore > "pending"
  let status = crdtTask?.status ?? fileTask?.status ?? "pending";
  let output = crdtTask?.output ?? fileTask?.output;
}
```

**Pros:**
- Simple — 3 files changed, ~20 lines
- FileTaskStore already has the data and is already loaded
- No new infrastructure
- Works even when CRDT is completely unavailable

**Cons:**
- FileTaskStore is debounced (2s delay) — could lose last 2s of status changes on crash
- Two sources of truth — potential drift (CRDT says "pending", file says "completed")

**Effort:** 0.5 day

### Option B: Make CRDT Restore Reliable

**Implementation:** Ensure CRDT infrastructure is fully initialized before `loadActivePlan()` runs. Add retry logic with timeout.

```typescript
async loadActivePlan(): Promise<void> {
  // Wait for CRDT to be ready (max 5s)
  const crdtReady = await this.waitForCrdt(5000);
  if (!crdtReady) log.warn("CRDT not ready after 5s, falling back");
  // ... existing logic
}
```

**Pros:**
- Uses the intended primary source
- No second source of truth
- CRDT data is the most accurate (immediate writes, no debounce)

**Cons:**
- Adds startup delay (up to 5s waiting for Hocuspocus)
- Complex — need to understand Hocuspocus lifecycle
- Still fails if Hocuspocus is permanently down

**Effort:** 1.5 days

### Option C: Store Task Status in PlanStore

**Implementation:** When task status changes, update the PlanStore JSON with per-task status. On restore, read directly from the plan file.

```typescript
// On task complete:
planStore.updateTaskStatus(planId, goalId, taskId, "completed", output);

// On restore:
const stored = await planStore.getLatestActivePlan(); 
// stored.plan.tasks[i].status = "completed" (if updated)
```

**Pros:**
- Single file has everything — plan + status
- No CRDT dependency for restore
- Already reliable (PlanStore writes are synchronous)

**Cons:**
- Frequent writes to plan JSON (every status change)
- Plan file grows with output data
- PlanStore wasn't designed for mutable task state

**Effort:** 1 day

## Recommendation: Option B — Make CRDT Restore Reliable

CRDT is the team memory — it's the source of truth. FileTaskStore is a projection for backup, not for reads. The fix should make CRDT work correctly, not bypass it.

### Root Cause: Race Condition

```
T=0: AgentManagerV2.initializeOrchestrator()
  ├─ Create L2CollaborationPlugin (SYNC)
  └─ l2Plugin.initialize()  ← NOT AWAITED — starts Hocuspocus async
  
T=1: OrchestratorService.initialize() (IMMEDIATE — doesn't wait for L2)
  └─ await goalManager.loadActivePlan()  ← TOO EARLY!
     └─ CrdtTaskSync.loadAllTasks()
        └─ space.listDocs() → Hocuspocus NOT READY → THROWS
        └─ catch: log.warn(...) → ALL TASKS BECOME "pending"
```

### The Fix

Ensure `l2Plugin.initialize()` completes (Hocuspocus is ready) BEFORE `loadActivePlan()` runs. This is a **plugin initialization order fix** in AgentManagerV2 — not a change to GoalManager or CRDT.

### Files to Change

| File | Change |
|------|--------|
| `AgentManagerV2.ts` | Await L2CollaborationPlugin initialization before OrchestratorService init |
| `GoalManager.ts` | Remove FileTaskStore fallback code (keep CRDT as sole source) |

### Why Not Option A (FileTaskStore Fallback)

FileTaskStore is a **projection** — it's a denormalized copy for backup/search. Reading from projections during restore violates the CRDT-as-source-of-truth architecture. If CRDT fails, the correct response is to fix CRDT, not to create a read path from a projection.

### Hocuspocus Persistence

Hocuspocus DOES persist to disk:
- Binary: `data/collab/yjs/{docName}.bin` (FsBlobStorage)  
- Readable: `.ping/collaboration/` (filesystem projection)

The data survives restarts. The only issue is timing — Hocuspocus needs to load these files before `loadAllTasks()` can read them.

## Data Flow After Fix

```
RESTORE PATH (with FileTaskStore fallback):
  Backend restart
    → FileTaskStore.load()                    [loaded ✅]
    → GoalManager.loadActivePlan()
      → PlanStore.getLatestActivePlan()       [plan structure]
      → CrdtTaskSync.loadAllTasks()           [try CRDT first]
        → Success: use CRDT status ✅
        → Failure: fall through to FileTaskStore
      → FileTaskStore.getTask(taskId)         [fallback ✅]
      → status = crdtStatus ?? fileStatus ?? "pending"
```

## Files to Change

| File | Change |
|------|--------|
| `AgentManagerV2.ts` | Ensure plugin initialization (L2/Collab) completes before `orchestrator.initialize()` |
| Possibly `AgentManagerRegistry.ts` | If plugin init happens there, ensure await order |

## Impact

- No API changes
- No frontend changes
- No database schema changes
- No new files
- Startup may be slightly slower (~1-2s) while Hocuspocus loads persisted docs
- Backward compatible — just fixes the initialization order
