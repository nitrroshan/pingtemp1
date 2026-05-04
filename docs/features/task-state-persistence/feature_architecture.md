# Task State Persistence — Feature Architecture

**Status:** Planning  
**Date:** April 25, 2026  
**Priority:** HIGH — restart loses all plan progress  
**Related:** [conversation-persistence](../conversation-persistence/feature_architecture.md), [data-persistence](../data-persistence/feature_architecture.md)

---

## Problem

When the backend restarts, all task progress is lost. `loadActivePlan()` recreates every task as `"pending"` — even completed ones. User sees 0/8 instead of 5/8.

## Storage Architecture Decision

**CRDT is the correct source of truth for task state.** This was a deliberate architectural decision (see [data-persistence](../data-persistence/feature_architecture.md)):
- Agents read/write tasks via `collab` tool — no custom DB query tools needed
- Multiple agents write concurrently — CRDT handles merge conflict-free
- Real-time sync between agents + human is native to CRDT
- Task graph is small per goal (5-20 tasks) — not a DB scale problem

**DB is the correct store for queryable indexes** — chat messages, goals, team registry. CRDT data can be **derived/indexed** into MongoDB for dashboards/reporting later.

**The bug is NOT in the architecture. It's in `loadActivePlan()` which ignores CRDT.**

## What Survives Restart

| Component | Persists? | Has Task Status? |
|---|---|---|
| TaskStore (in-memory Map) | ❌ Lost | Was the runtime source |
| **CRDT task docs** (`data/collab/yjs/`) | ✅ Disk | **status, output, completedAt** ✅ |
| PlanStore JSON (`data/plans/`) | ✅ Disk | Plan-level only, no per-task status |
| OutputManifest (`.ping/outputs/`) | ✅ Disk/Git | Proves completion (if exists = done) |
| Chat messages (DB) | ✅ DB | — |

**Key finding:** CRDT task docs already contain everything needed. `loadActivePlan()` just doesn't read them.

## Root Cause

[OrchestratorService.loadActivePlan()](../../packages/agent-manager/src/orchestrator/OrchestratorService.ts) line ~1305:

```typescript
// Current: ignores CRDT, resets everything
for (const t of stored.plan.tasks) {
  this.taskStore.create({
    ...t,
    status: "pending",                              // ← ALWAYS pending
    prerequisites: new Map(t.dependencies.map(d => [d, false])),  // ← ALWAYS false
  });
}
```

## Fix: Read CRDT Task Status on Plan Recovery

```typescript
// After: read CRDT status for each task
for (const t of stored.plan.tasks) {
  const crdtStatus = await this.readTaskStatusFromCrdt(t.id);

  this.taskStore.create({
    ...t,
    status: crdtStatus?.status ?? "pending",
    output: crdtStatus?.output ?? undefined,
    prerequisites: new Map(t.dependencies.map(d => {
      // Mark prerequisite as met if the upstream task is completed in CRDT
      const depStatus = await this.readTaskStatusFromCrdt(d);
      return [d, depStatus?.status === "completed"];
    })),
  });
}
```

## Implementation Steps

- [x] **Step 1: Read CRDT task statuses** — used `loadAllTasks()` (batch, existing API)
- [x] **Step 2: Update `loadActivePlan()` with CRDT status** — correct status + prerequisites
- [x] **Step 3: Handle edge cases** — in_progress→ready, failed stays, missing→pending, completed→idle
- [x] **Step 4: Write goalId on messages** — `getCurrentGoalId()` on AgentManager, 3 save sites
- [ ] **Step 5: Filter restore messages by goalId** — deferred (new messages have goalId, filter later)
  Lines: ~5

## SOLID Analysis

| Principle | How Applied |
|---|---|
| **S** | `readTaskStatusFromCrdt()` — single responsibility: read status from CRDT. Doesn't modify. |
| **O** | `loadActivePlan()` enhanced, not replaced. CRDT reading is additive. |
| **L** | TaskStore interface unchanged — `create()` accepts the same shape, just with better initial values. |
| **I** | CollaborationPlugin accessed via existing `pluginRegistry.get("collaboration")` — no new interfaces. |
| **D** | OrchestratorService depends on plugin abstraction, not CRDT internals. |

## After Fix: Restart Behavior

```
Backend restarts → getForTeam() → OrchestratorService.initialize()
  → loadActivePlan() reads PlanStore (plan structure)
  → For each task: read CRDT doc (status, output)
  → TaskStore populated with CORRECT statuses:
    task-1: completed ✅ (from CRDT)
    task-2: completed ✅ (from CRDT)
    task-3: in_progress → ready (reset for re-dispatch)
    task-4: pending (prerequisites not met)
  → Ready tasks auto-dispatched
  → Frontend restore shows 2/4 completed
```

## Estimated Effort

~70 lines across 3 files. Medium risk (CRDT read path needs testing).

## Dependencies

- CRDT task sync must already be writing statuses on completion ✅ (verified: `syncStatus()` is called)
- CollaborationPlugin must be accessible from OrchestratorService ✅ (via `pluginRegistry`)
- PlanStore must have the active plan ✅ (verified: `getLatestActivePlan()` works)

## Future: DB as Derived Index (Not Source of Truth)

For dashboard views, cross-goal queries, and reporting, a derived `TaskIndex` MongoDB collection can be synced from CRDT via `onChange` hook. This is **not the source of truth** — just a queryable projection. Designed in [data-persistence feature](../data-persistence/feature_architecture.md) but not yet implemented.

| Layer | Source of Truth | Derived Index (future) |
|---|---|---|
| Task runtime state | CRDT (CrdtTaskSync) | MongoDB `TaskIndex` |
| Plan structure | PlanStore JSON + CRDT | MongoDB `PlanIndex` |
| Goals | DB (SQLite/MongoDB) | — |
| Chat | DB (SQLite/MongoDB) | — |
