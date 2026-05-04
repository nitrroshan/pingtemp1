# Task Status Restore on Restart

> **Status:** Research complete — ready for review  
> **Severity:** High — completed tasks show as pending after restart, confuses user  
> **Related:** Phase 4.5 goalId elimination

## Problem

After backend restart, all tasks show as "new/pending" in the frontend sidebar even though some were completed. The user sees completed tasks with "Start" buttons again.

## Root Cause Analysis

Task status is persisted in **3 places** but only restored from one (CRDT), which fails silently:

| Storage | Writes | Reads on Restart | Status |
|---------|--------|-----------------|--------|
| **PlanStore** (JSON files) | Plan + tasks at approval | Yes — `loadActivePlan()` reads plan definition | ✅ But no task **status** in plan JSON |
| **CRDT** (Hocuspocus/Y.js) | Task status on every update | Yes — `loadActivePlan()` tries `loadAllTasks()` | ⚠️ **Fails silently** if CRDT proxy not resolved |
| **FileTaskStore** (JSON) | Task state on every update | **NO** — never queried during restore | ❌ **Not used** |

### The failure chain:

```
Backend restarts → loadActivePlan() called
  → PlanStore.getLatestActivePlan() → gets plan with tasks (no status)
  → crdtTaskSyncProxy.resolveForGoal(goalId)
  → crdtSync.loadAllTasks()
    → FAILS (CRDT proxy not yet resolved, or Hocuspocus not connected)
    → catch: log.warn("Failed to read CRDT task state") ← SILENT
  → For each task: status = crdtTask?.status ?? "pending" ← ALL BECOME PENDING
  → TaskStore.create({ status: "pending" }) for every task
  → Frontend receives state event with all tasks "pending"
```

### Why CRDT fails on restart:

The CRDT proxy (`crdtTaskSyncProxy`) is a lazy resolver that depends on:
1. `CollaborationPlugin` being initialized
2. `resolveForGoal(goalId)` being called to get the goal-scoped CRDT store
3. Hocuspocus server being connected and the Y.js document being loaded

During `loadActivePlan()` (called in `OrchestratorService.initialize()`), the CRDT infrastructure may not be fully ready — the Hocuspocus server might still be connecting, or the lazy proxy hasn't resolved yet.

## Fix Options

### Option A: Use FileTaskStore as fallback (recommended)

FileTaskStore already persists task status to disk (`data/tasks/{teamId}/tasks.json`). It's loaded at startup (`filePersistence.load()` in AgentManagerV2). Use it as fallback when CRDT fails:

```typescript
// In loadActivePlan():
for (const t of stored.plan.tasks) {
  const crdtTask = crdtTasks?.get(t.id);
  const fileTask = this.fileTaskStore?.get(t.id);  // NEW: check FileTaskStore
  let status = crdtTask?.status ?? fileTask?.status ?? "pending";
  // ...
}
```

**Pros:** Simple, no new infrastructure. FileTaskStore already has the data.
**Cons:** Requires passing FileTaskStore reference to GoalManager.

### Option B: Store task status in PlanStore metadata

When tasks complete, update the PlanStore JSON with their status. On restore, read status from the plan JSON itself.

**Pros:** Single source of truth.
**Cons:** Frequent JSON file writes on every status change.

### Option C: Fix CRDT proxy timing

Ensure CRDT infrastructure is fully initialized before `loadActivePlan()` runs.

**Pros:** Uses existing CRDT path correctly.
**Cons:** Complex timing — Hocuspocus connection is async, may delay startup.

## Recommended: Option A

FileTaskStore is already persisting task status. We just need to read from it during `loadActivePlan()` as a fallback when CRDT fails.

### Implementation Steps

- [ ] Step 1: Pass FileTaskStore reference to GoalManager (via GoalManagerConfig)
- [ ] Step 2: In `loadActivePlan()`, read FileTaskStore as fallback after CRDT
- [ ] Step 3: Ensure FileTaskStore status updates are written for all status changes (complete, failed, in_progress)
- [ ] Step 4: Test: complete a task → restart backend → verify status restored

### Files to Change

| File | Change |
|------|--------|
| `GoalManager.ts` | Add `fileTaskStore` to config, use in `loadActivePlan()` |
| `OrchestratorService.ts` | Pass FileTaskStore through config |
| `AgentManagerV2.ts` | Pass `filePersistence` to OrchestratorService config |

## Testing

1. Submit goal → plan approved → 2 tasks complete → restart backend → verify 2 tasks show as "completed", others as "pending"
2. Submit goal → task fails → restart → verify task shows as "failed"
3. Submit goal → task in_progress → restart → verify task shows as "ready" (not in_progress — can't resume mid-execution)
