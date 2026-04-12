# Markdown Tasks v1.0/v1.1 — Implementation Review & Issues

**Date:** April 13, 2026  
**Scope:** CrdtTaskSync, CrdtGoalStore, OrchestratorService wiring, WorkerPool tool injection, collab tool extensions, projectToFilesystem  
**Status:** 20 issues found — 19 fixed, 1 deferred (v2.0 scope)

---

## Fixed Issues

| # | Severity | Issue | Fix |
|---|----------|-------|-----|
| 1 | CRITICAL | Proxy variable capture bug — multi-goal returns wrong CRDT stores | ✅ Used `this`-scoped properties on resolver object instead of captured `let` variables |
| 2 | CRITICAL | Guard rail counts lost on restart — agents exceed task limit | ✅ Derive count from `TaskStore.getAll()` filtered by `createdBy` tag |
| 3 | CRITICAL | Proxy not guaranteed resolved before use — silent null | ✅ Added explicit null guards with `log.debug()` warnings in all 3 call sites |
| 4 | HIGH | WorkerPool Maps grow without cleanup — memory leak | ✅ `disposeAll()` now clears `workerBaseTools`, `taskStore`, `dagResolver`, `crdtTaskSync` |
| 5 | HIGH | Read-only protection incomplete — discussion docs writable | ✅ Regex pattern `/\/(task\|discussion\|decisions\|config)$/` + system doc list |
| 6 | HIGH | projectToFilesystem path detection fragile | ✅ Regex `^[^/]+\/task$` instead of `endsWith("/task")` |
| 7 | HIGH | Dependency state lost on crash recovery — all prereqs show unmet | ✅ Two-pass loading: collect completed IDs first, then set correct prerequisite state |
| 8 | HIGH | setTaskServices() called after orchestrator init — race condition | ✅ Moved to fire right after `orchestrator.initialize()` with null crdtTaskSync (resolves lazily) |
| 9 | MEDIUM | BounceTask doesn't validate task status — state machine violation | ✅ Added status checks: reject completed/failed, warn if not in_progress |
| 10 | MEDIUM | RequestTask doesn't update new task's dependants list | ✅ Set `dependants: [ctx.taskId]` for blocks-me relationships |
| 12 | MEDIUM | Discuss action doesn't validate doc is a discussion doc | ✅ Check `docName.endsWith("/discussion")` before processing |
| 13 | MEDIUM | CrdtGoalStore.saveGoal() overwrites createdAt | ✅ Guard: only set `createdAt` if not already present in Y.Map |
| 14 | MEDIUM | CollabTaskDispatcher accesses private `space` field | ✅ Added `initCollabDocs(taskId, config)` method to CrdtTaskSync |
| 15 | MEDIUM | crdtRefs not in agent prompt — agents don't know about collab read | ✅ Added "Context Sources" section to enrichedDescription in dispatchTask |
| 16 | MEDIUM | disposeAll() doesn't clear task service references | ✅ Clear taskStore/dagResolver/crdtTaskSync in disposeAll() |
| 11 | MEDIUM | Heavy use of `any` types | ✅ Added `CrdtProxy<T>` interface, typed WorkerPool fields with structural types, exported types |
| 17 | LOW | xmlFragmentToMarkdown missing table/image/checklist handlers | ✅ Added image, table, checkListItem cases |
| 18 | LOW | CrdtGoalStore has no loadAllGoals() for multi-goal discovery | ✅ Added `loadAllGoals(allSpaces)` method |
| 19 | LOW | No exports of tool types from @ping/agent-manager | ✅ Exported RequestTaskContext, BounceTaskContext, CrdtProxy, GoalData, TaskLike |

---

## Critical Issues

### Issue #1: CRDT Lazy Proxy Variable Capture Bug
**File:** `packages/agent-manager/src/AgentManagerV2.ts` lines 335-350  
**Category:** WIRING  
**Impact:** Multi-goal execution returns WRONG goal's CRDT stores

The lazy resolver captures `crdtTaskSync` and `crdtGoalStore` as `let` variables re-assigned inside `resolveForGoal()`. All closures share the same variable reference — when a second goal is processed, the first goal's CRDT stores are silently overwritten.

```typescript
// ❌ CURRENT — shared mutable reference
let crdtTaskSync: any = null;
let crdtGoalStore: any = null;
const crdtResolver = {
  get taskSync() { return crdtTaskSync; },       // captures reference, not value
  resolveForGoal(goalId: string) {
    crdtTaskSync = l2Plugin.getCrdtTaskSync(goalId);  // overwrites for ALL consumers
  },
};
```

**Fix:** Use `this`-scoped properties on the resolver object:
```typescript
// ✅ FIX — self-contained state
const crdtResolver = {
  taskSync: null as any,
  goalStore: null as any,
  resolveForGoal(goalId: string) {
    if (l2Plugin?.getCrdtTaskSync) {
      this.taskSync = l2Plugin.getCrdtTaskSync(goalId);
      this.goalStore = l2Plugin.getCrdtGoalStore(goalId);
    }
  },
};

// Pass bound references
crdtTaskSync: { get: () => crdtResolver.taskSync, resolveForGoal: crdtResolver.resolveForGoal.bind(crdtResolver) },
crdtGoalStore: { get: () => crdtResolver.goalStore, resolveForGoal: crdtResolver.resolveForGoal.bind(crdtResolver) },
```

---

### Issue #2: Guard Rail Counts Not Durable Across Restarts
**File:** `packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts` line 76  
**Category:** WIRING / MISSING  
**Impact:** Agent can exceed max task limit after process restart

`agentTaskCounts` is a module-scoped `Map` — lost on restart. An agent that already created 5 tasks can create 5 more after a restart. The guard rail is bypassed.

```typescript
// ❌ CURRENT — module scope, not durable
const agentTaskCounts = new Map<string, number>();
```

**Fix:** Inject counts from OrchestratorService (scoped to plan lifecycle), or derive from TaskStore at tool creation time:
```typescript
// ✅ FIX — derive from existing tasks
const currentCount = ctx.taskStore.getAll()
  .filter(t => (t.context as any)?.createdBy === `agent:${ctx.role}`)
  .length;
if (currentCount >= MAX_AGENT_TASKS_PER_PLAN) {
  return `Error: Max ${MAX_AGENT_TASKS_PER_PLAN} agent-created tasks reached.`;
}
```

---

### Issue #3: OrchestratorService Proxy Not Guaranteed Resolved Before Use
**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` lines 257-275  
**Category:** WIRING  
**Impact:** CRDT operations silently skip if proxy not resolved

`resolveForGoal()` is called once in `approvePlan()`, but the `get()` calls in `onWorkerDone()`, `onTaskFailed()`, and `dispatchTask()` don't verify the proxy was resolved. If these run before a plan is approved (e.g., crash recovery), they get `null`.

**Fix:** Add explicit null guards with warning logs:
```typescript
const crdtSync = this.crdtTaskSyncProxy?.get?.();
if (!crdtSync) {
  log.warn(`CRDT not resolved for ${taskId} — skipping sync`);
  return;
}
```

---

## High Issues

### Issue #4: WorkerPool Maps Grow Without Cleanup
**File:** `packages/agent-manager/src/services/WorkerPool.ts` line 89  
**Category:** LLD / Memory Leak  
**Impact:** Memory grows over many plans

`workerRoles`, `lastResponses`, `workerBaseTools` grow per task and only clean up in `dispose(taskId)`. Orphaned tasks (crashes, timeouts) leak memory.

**Fix:** Add cleanup in `disposeAll()`:
```typescript
async disposeAll(): Promise<void> {
  await Promise.all(Array.from(this.workers.keys()).map(id => this.dispose(id)));
  this.workerRoles.clear();
  this.lastResponses.clear();
  this.workerBaseTools.clear();
}
```

---

### Issue #5: Read-Only Protection in Collab Tool Incomplete
**File:** `packages/collaboration/src/L2/tools/index.ts` lines 451-453  
**Category:** WIRING / Security  
**Impact:** Agents could modify task discussion docs directly via `write` action

The write protection checks specific `docName` values but doesn't catch `{taskId}/discussion` or `{taskId}/decisions`. Agents should only modify these via the `discuss` action, not via raw `write`.

**Fix:** Use pattern matching:
```typescript
// Read-only: anything under a task's namespace except custom agent docs
const isTaskDoc = /^task-[^/]+\/(task|discussion|decisions|config)$/.test(docName);
const isSystemDoc = ["plan", "plans", "outputs", "tasks", "goal", "_index"].includes(docName);
if (isTaskDoc || isSystemDoc) {
  return `"${docName}" is read-only. Use 'discuss' for discussions, or write to custom CRDT docs.`;
}
```

---

### Issue #6: projectToFilesystem Task Doc Path Detection Fragile
**File:** `packages/collaboration/src/L2/collaboration/HocuspocusServer.ts` lines 111-125  
**Category:** LLD  
**Impact:** Multi-level doc paths may not project correctly

`docType = rest.join("/")` works, but `isTaskDoc = docType.endsWith("/task")` matches `task-003/task` correctly. However, `isPlanDoc = docType === "plan"` and `isGoalDoc = docType === "goal"` depend on exact string match. If the doc naming convention ever changes, projections silently break.

**Fix:** Add explicit doc type detection comments and validation:
```typescript
// Explicit patterns for .md projection:
//   goal         → goal.md
//   plan         → plan.md
//   {taskId}/task → {taskId}/task.md
const isTaskDoc = /^[^/]+\/task$/.test(docType);  // regex is more robust
```

---

### Issue #7: CrdtTaskSync.loadAllTasks() Dependency State Lost on Reload
**File:** `packages/collaboration/src/L2/collaboration/CrdtTaskSync.ts` lines 264-284  
**Category:** LLD  
**Impact:** After crash recovery, all prerequisites show as unmet even if dependencies are completed

`toTask()` creates `prerequisites: new Map(deps.map(d => [d, false]))` — all dependencies are marked not-ready. But if the dependent tasks are already completed in CRDT, the prerequisites should be `true`.

**Fix:** Two-pass loading:
```typescript
async loadAllTasks(): Promise<TaskLike[]> {
  // First pass: load all tasks
  const rawTasks = [];
  for (const docName of taskDocNames) { /* ... load raw data ... */ }
  
  // Collect completed task IDs
  const completedIds = new Set(
    rawTasks.filter(t => t.status === "completed").map(t => t.id)
  );
  
  // Second pass: set prerequisite state correctly
  return rawTasks.map(data => ({
    ...this.toTask(data),
    prerequisites: new Map(
      (data.dependencies || []).map(d => [d, completedIds.has(d)] as [string, boolean])
    ),
  }));
}
```

---

### Issue #8: setTaskServices() Called After Orchestrator Init — Race Condition
**File:** `packages/agent-manager/src/AgentManagerV2.ts` lines 416-421  
**Category:** WIRING  
**Impact:** First dispatched task may not have request_task/bounce_task tools

`workerPool.setTaskServices()` is called AFTER `orchestrator.initialize()`. If the orchestrator auto-dispatches during initialization (crash recovery), tools won't be available.

**Fix:** Move `setTaskServices()` before `orchestrator.initialize()`:
```typescript
this.workerPool.setTaskServices({ taskStore, dagResolver, teamRoles });
await this.orchestrator.initialize();  // safe — tools already injected
```

---

## Medium Issues

### Issue #9: BounceTaskTool Doesn't Validate Task Status
**File:** `packages/agent-manager/src/agent/internal/tools/bounceTaskTool.ts` lines 53-64  
**Category:** LLD  
**Impact:** Bouncing a completed task violates state machine

No status check before setting to `"failed"`. Bouncing a `"completed"` task would throw in TaskStore's state machine (`VALID_TRANSITIONS: completed → []`).

**Fix:** Check status before bouncing:
```typescript
if (task.status === "completed") return "Error: Cannot bounce a completed task.";
if (task.status === "failed") return "Error: Task is already failed.";
if (task.status !== "in_progress") return `Warning: Task is "${task.status}", not in_progress.`;
```

---

### Issue #10: RequestTaskTool Doesn't Update New Task's Dependants
**File:** `packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts` lines 125-135  
**Category:** LLD  
**Impact:** DAG partially inconsistent for blocks-me relationships

For `blocks-me`, the current task gets a new prerequisite, but the new task's `dependants[]` list doesn't include the current task. DependencyResolver rebuilds the DAG, but the task object itself is inconsistent.

**Fix:**
```typescript
if (input.relationship === "blocks-me") {
  currentTask.prerequisites.set(newTaskId, false);
  newTask.dependants = [ctx.taskId];  // Add reverse link
}
```

---

### Issue #11: Heavy Use of `any` Types
**Files:** `OrchestratorService.ts`, `WorkerPool.ts`, `AgentManagerV2.ts`  
**Category:** LLD / Type Safety  
**Impact:** Misconfigurations undetectable at compile time

`crdtTaskSync: any`, `crdtGoalStore: any`, `taskStore: any` throughout. Should use imported concrete types or at minimum interface types.

**Fix:** Import and use `CrdtTaskSync`, `CrdtGoalStore` types from `@ping/collaboration`:
```typescript
import type { CrdtTaskSync } from "@ping/collaboration";
private crdtTaskSync: CrdtTaskSync | null = null;
```

---

### Issue #12: Discuss Action Doesn't Validate Doc is a Discussion Doc
**File:** `packages/collaboration/src/L2/tools/index.ts` (discuss handler)  
**Category:** LLD  
**Impact:** Agent could call `discuss` on a non-discussion doc (e.g., a task doc)

No validation that `docName` ends with `/discussion`. An agent calling `collab({ action: "discuss", docName: "task-003/task" })` would try to read a Y.Array("discussion") from a Y.Map-only doc, returning empty results silently.

**Fix:** Validate doc pattern:
```typescript
if (action === "discuss") {
  if (!docName?.includes("/discussion")) {
    return `discuss action requires a discussion doc (e.g., "task-003/discussion"). Got: "${docName}".`;
  }
  // ... rest
}
```

---

### Issue #13: CrdtGoalStore.saveGoal() Overwrites createdAt on Every Save
**File:** `packages/collaboration/src/L2/collaboration/CrdtGoalStore.ts` line 48  
**Category:** LLD  
**Impact:** Goal creation timestamp changes if saveGoal() is called twice

`createdAt` is set to `new Date()` unconditionally. If the goal is saved again (e.g., status update calls saveGoal), the timestamp changes.

**Fix:** Guard with existence check:
```typescript
if (!map.has("createdAt") || !map.get("createdAt")) {
  map.set("createdAt", new Date().toISOString());
}
```

---

### Issue #14: CollabTaskDispatcher Accesses Private `space` Field
**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` line 549  
**Category:** LLD / Encapsulation  
**Impact:** Tight coupling to CrdtTaskSync internals

`const space = (crdtSync as any).space` casts to `any` and accesses a property that should be internal. Although we added a getter, the access pattern is fragile.

**Fix:** Add a dedicated method to CrdtTaskSync:
```typescript
// CrdtTaskSync.ts
async initCollabDocs(taskId: string, config?: Record<string, any>): Promise<void> {
  const discussionDoc = await this._space.openDoc(`${taskId}/discussion`);
  // ... initialize Y.Array, Y.Map, etc.
}
```

---

### Issue #15: No `crdtRefs` in Agent Prompt Template
**Category:** MISSING  
**Impact:** Agents get crdtRefs in context but aren't told how to use them

`context.crdtRefs` is injected into the task context, but the agent's system prompt doesn't include a "Context Sources" section telling the agent about `collab read`. The context enrichment is in the data but not in the prompt.

**Fix:** Add crdtRefs to the enriched description in `dispatchTask()`:
```typescript
if (crdtRefs) {
  enrichedDescription += `\n\n## Context Sources (use collab read to access)`;
  enrichedDescription += `\n- Your task: collab read ${crdtRefs.task}`;
  enrichedDescription += `\n- Plan: collab read ${crdtRefs.plan}`;
  enrichedDescription += `\n- Goal: collab read ${crdtRefs.goal}`;
  if (crdtRefs.dependencies?.length) {
    enrichedDescription += `\n- Dependencies: ${crdtRefs.dependencies.join(", ")}`;
  }
}
```

---

### Issue #16: `disposeAll()` in WorkerPool May Not Clear New Fields
**File:** `packages/agent-manager/src/services/WorkerPool.ts`  
**Category:** LLD  
**Impact:** Stale task services after plan reset

When `disposeAll()` is called (plan reset), the old `taskStore`/`dagResolver` references linger. If a new plan is started, the old references may be used until `setTaskServices()` is called again.

**Fix:** Clear task services in `disposeAll()`:
```typescript
async disposeAll(): Promise<void> {
  // ... existing cleanup
  this.taskStore = null;
  this.dagResolver = null;
  this.crdtTaskSync = null;
}
```

---

## Low Issues

### Issue #17: xmlFragmentToMarkdown Missing Table/Image Handlers
**File:** `packages/collaboration/src/L2/collaboration/HocuspocusServer.ts` lines 233-268  
**Category:** LLD / Completeness  
**Impact:** Tables and images in CRDT docs silently dropped in projections

### Issue #18: CrdtGoalStore Has No loadAllGoals() for Multi-Goal Discovery
**File:** `packages/collaboration/src/L2/collaboration/CrdtGoalStore.ts`  
**Category:** MISSING  
**Impact:** No way to list all goals across a team (needed for future multi-goal support)

### Issue #19: No Exports of CrdtTaskSync Types from @ping/agent-manager
**File:** `packages/agent-manager/src/index.ts`  
**Category:** MISSING  
**Impact:** Backend package can't import RequestTaskContext, BounceTaskContext types

### Issue #20: Discuss Action Doesn't Emit Socket.IO Notifications
**File:** `packages/collaboration/src/L2/tools/index.ts`  
**Category:** MISSING (v2.0 scope)  
**Impact:** Frontend won't get `discussion:activity` events. This is expected — Socket.IO integration is v2.0 scope. Noted for awareness.

---

## Summary

| Severity | Total | Fixed | Deferred |
|----------|-------|-------|----------|
| **CRITICAL** | 3 | 3 ✅ | 0 |
| **HIGH** | 5 | 5 ✅ | 0 |
| **MEDIUM** | 8 | 8 ✅ | 0 |
| **LOW** | 4 | 3 ✅ | 1 (#20 — v2.0 scope) |
| **TOTAL** | **20** | **19** | **1** |

### Deferred Issues (v2.0 scope)

| # | Issue | Why Deferred |
|---|-------|-------------|
| 20 | Discuss action doesn't emit Socket.IO notifications | Requires Hocuspocus onChange → SocketServerV2 wiring. This is genuinely v2.0 frontend scope — needs the frontend discussion UI to consume the events. |
