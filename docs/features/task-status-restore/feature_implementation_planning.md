# Task Status Restore — Implementation Plan

> **Parent:** [feature_architecture.md](./feature_architecture.md)  
> **Status:** Planning  
> **Branch:** `feature/task-status-restore`

## Scope

Fix task status restoration on backend restart. CRDT is the source of truth — make it work reliably.

## Investigation First

Before changing code, we need diagnostic data. The initialization order appears correct (`pluginRegistry.initializeAll()` awaits before `loadActivePlan()`), so the failure may be elsewhere.

### Step 0: Add Diagnostic Logging (0.25d)

Add logging to `loadActivePlan()` to identify the exact failure point:

```typescript
async loadActivePlan(): Promise<void> {
  log.info("[loadActivePlan] Starting...");
  
  const stored = await this.planStore.getLatestActivePlan();
  log.info(`[loadActivePlan] Plan found: ${!!stored}, status: ${stored?.metadata.status}`);
  
  // ... existing code ...
  
  log.info(`[loadActivePlan] crdtTaskSyncProxy exists: ${!!this.crdtTaskSyncProxy}`);
  log.info(`[loadActivePlan] l2Plugin exists: ${!!this.crdtTaskSyncProxy?.get?.()}`);
  
  const loaded = await crdtSync.loadAllTasks();
  log.info(`[loadActivePlan] CRDT returned ${loaded.length} tasks`);
  for (const t of loaded) {
    log.info(`  ${t.id}: status=${t.status}, output=${!!t.output}`);
  }
}
```

**Files:** `GoalManager.ts`

**Exit criteria:** Run backend, check logs, identify which step fails:
- A) Plan not found → PlanStore issue
- B) crdtTaskSyncProxy is null → Plugin wiring issue
- C) loadAllTasks returns 0 → CRDT not persisting
- D) loadAllTasks throws → Hocuspocus timing issue
- E) Tasks loaded with correct status → Frontend display issue

### Step 1: Fix Based on Diagnosis (0.5-1.5d)

**If A (Plan not found):** Check PlanStore file path, ensure plan JSON exists on disk after approval.

**If B (Proxy null):** Fix plugin storage wiring — ensure CollaborationPlugin stores CRDT reference during `initialize()`.

**If C (CRDT empty):** Check `persistTask()` and `syncStatus()` — verify tasks are written to CRDT during execution. Check Hocuspocus persistence (FsBlobStorage) — verify .bin files exist.

**If D (Hocuspocus timing):** Despite `initializeAll()` being awaited, Hocuspocus may have an internal async gap. Fix with retry + timeout in `loadActivePlan()`.

**If E (Frontend issue):** Verify `buildStateResponse()` includes correct status, verify `onState` handler in frontend uses it.

## Testing

1. Submit goal → plan approved → 2+ tasks complete
2. Restart backend
3. Check backend logs for `[loadActivePlan]` diagnostics
4. Verify frontend shows correct task statuses (completed tasks show as completed)
5. Verify sidebar task count matches (e.g., "2/6" not "0/6")
