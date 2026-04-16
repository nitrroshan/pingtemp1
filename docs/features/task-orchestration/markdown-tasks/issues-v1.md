# Markdown Tasks v1.0/v1.1/v2.0 — Implementation Review & Issues

**Date:** April 14, 2026 (Round 9 — task flow & plan issues from live testing)  
**Scope:** Full v1.0 + v1.1 + v2.0 implementation, 9 review rounds, 40+ files reviewed  
**Status:** R1-R4: 29 fixed. R5+R6: 12 fixed. R7+R8: 5 fixed. R9: 6 fixed (live testing issues).

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
| 20 | LOW | Discuss action doesn't emit Socket.IO notifications | ✅ Added `onDiscussionChange` callback to CollabServer + `wireDiscussionEvents` in SocketServerV2 |
| R4-5 | MEDIUM | Discussions view was placeholder — no thread rendering | ✅ Added ActiveDiscussionView with useDiscussion hook, DiscussionThread + DecisionPanel rendering |
| R4-7 | MEDIUM | DetailPanel not wired with discussion props | ✅ Passed discussionThreads + onOpenDiscussion to DetailPanel, activity tracking via Socket.IO |
| R5-1 | CRITICAL | CollaborationPlugin goalId never set → wrong CRDT space | ✅ Added `collabPlugin.setGoalId(goalId)` in OrchestratorService.approvePlan() after resolveForGoal |
| R5-2 | CRITICAL | Collab read uses docName as Y.Map key → wrong lookup | ✅ Added `resolveDataMap()` + `extractDocData()` helpers that introspect doc shared types |
| R5-3 | HIGH | Partial CRDT task persistence | ✅ Root cause was R5-1 (wrong space). Also added try/catch per-task in R6-4 |
| R5-4 | HIGH | Agents hallucinate instead of escalating | ✅ Added "When Context Is Missing" protocol to worker prompt (R6-3) |
| R5-5 | MEDIUM | Discover output confuses doc names | ✅ Added auto-redirect: bare `task-N` → `task-N/task` in both read and list actions |
| R6-1 | CRITICAL | Collab list has same Y.Map bug as read | ✅ Same fix as R5-2 — resolveDataMap applied to list action |
| R6-2 | HIGH | Worker prompt missing request_task/bounce_task | ✅ Added to Core Workflow table + Task Management section with full guidelines |
| R6-3 | HIGH | No missing context escalation protocol | ✅ Added "When Context Is Missing" section to worker prompt |
| R6-4 | HIGH | CRDT persistence loop no error handling | ✅ Wrapped in try/catch per-task with logging + count reporting |
| R6-5 | MEDIUM | Agent-created tasks get timestamp IDs | ✅ Now uses `task-{max+1}` sequential IDs matching planner pattern |
| R6-6 | MEDIUM | Agent-created tasks not dispatched | ✅ `onTaskCreated` now calls `dispatchReadyTasks()` when autoExecute is on |
| R6-7 | LOW | write action Y.Map naming inconsistency | ✅ Covered by R5-2 fix (resolveDataMap handles both patterns) |

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
| **LOW** | 4 | 4 ✅ | 0 |
| **TOTAL** | **22** | **22** | **0** |

### Deferred Issues (v2.0 scope)

All deferred issues from v2.0 scope have been resolved in Round 4.

---

## Round 2 Review — Post v1.1 Completion

### R2 Critical

| # | File | Issue | Status |
|---|------|-------|--------|
| R2-1 | `OrchestratorService.ts` approvePlan | WorkerPool CRDT stays null after goal resolution | ✅ Fixed — approvePlan now calls `workerPool.setTaskServices()` with resolved CRDT instance after `resolveForGoal()` |
| R2-2 | `OrchestratorService.ts` onTaskFailed | Failed research task → state stuck in `researching` forever | ✅ Fixed — onTaskFailed checks if all tasks are done (completed/failed), transitions to idle with planner notification |
| R2-3 | `submitResearch.ts` line 80 | Uses `.addTask()` but TaskStore has `.create()` | ✅ Fixed — uses `taskStore.create \|\| taskStore.addTask` + CRDT persistence + DAG rebuild (R3 fix) |

### R2 High

| # | File | Issue | Status |
|---|------|-------|--------|
| R2-4 | `OrchestratorService.ts` initialize | `onTaskCreated`/`onBounce` callbacks never wired | ✅ Fixed — wired in `workerPool.setCallbacks()` with planner notification via `notifyPlanner()` |
| R2-5 | `OrchestratorService.ts` dispatchTask | Cross-plan ref failures use debug-only logging | ✅ Fixed — track `unresolvedRefs[]`, add warning to agent prompt, log at warn level |
| R2-6 | `tools/index.ts` line 46 | Comment says "14 tools" but it's now 15 | ✅ Fixed — updated to "15 tools: knowledge (3) + execution (7) + plan mutation (5)" |

### R2 Medium (deferred — needs deeper research)

| # | Issue | Why Deferred |
|---|-------|-------------|
| R2-7 | CRDT sync errors silently swallowed (debug logs only) | Needs retry strategy design — exponential backoff + dead letter queue. Risk: retry delays could slow task dispatch pipeline. Research needed on Y.js error semantics. |
| R2-8 | Discuss token limit sharp cutoff at 100% vs warn at 80% | UX design question — should there be a "soft limit" at 95%? Need product input on agent behavior when approaching limit. |
| R2-9 | CrdtResolver uses mutable `this` properties | Works correctly after Fix #1. Pattern is non-standard but functional. Refactor to factory pattern requires touching 3 files for cosmetic improvement. |
| R2-10 | CRDT null-guard logging scattered across 5+ sites | Needs helper method `getCrdtTaskSync()` that centralizes null check + single-log pattern. Low risk — all guard sites already work. |

### R2 Low (deferred — acceptable as-is)

| # | Issue | Why Acceptable |
|---|-------|---------------|
| R2-11 | blocks-me relationship logic underdocumented | Code is correct, just needs better comments. Not a bug. |
| R2-12 | Auto-complete task edge case | Defensive behavior is correct. "auto-completed" message surfaces to frontend. |
| R2-13 | SOLID: tool context objects duplicated | Architectural preference, not a bug. Each tool gets focused context. |
| R2-14 | XML→MD lossy for unknown block types | Already mitigated by Fix #17. Unknown types render as text. |
| R2-15 | No transaction semantics for approvePlan |

---

## Round 3 Review — Final Comprehensive (v1.0+v1.1+v2.0)

**Reviewer checked:** 27 files, 3 diagrams, SOLID principles, wiring completeness, type safety

### Verdict: Issues #1 and #2 were **false positives** — code already handles them:
- #1 (Discussion CRDT init): `initCollabDocs()` is called in `dispatchTask()` CollabTaskDispatcher (line 627)
- #2 (Blocks-me dependency): `currentTask.prerequisites.set(newTaskId, false)` exists at line 155

### Issue #3 — VALID and FIXED:
Research tasks were created in TaskStore but NOT persisted to CRDT or DAG-rebuilt.
**Fix:** Added CRDT persistence + DAG rebuild after task creation in `submitResearch.ts`.

### Frontend issues — NOW FIXED (Round 4):
| # | Issue | Status |
|---|-------|--------|
| #5 | Discussions view was placeholder | ✅ FIXED — ActiveDiscussionView renders DiscussionThread + DecisionPanel via useDiscussion hook |
| #6 | discussionThreads prop not populated | ✅ FIXED — Socket.IO `discussion:activity` events build thread list in App.tsx state |
| #7 | Socket.IO events untested end-to-end | ✅ FIXED — CollabServer.onDiscussionChange → SocketServerV2.wireDiscussionEvents → team room broadcast |

### SOLID Assessment:
| Principle | Grade | Notes |
|-----------|-------|-------|
| S — Single Responsibility | ⚠️ | OrchestratorService is 700+ lines. Acceptable for v1 but extract `CrdtSyncManager` in v2. |
| O — Open/Closed | ⚠️ | Task types hardcoded. Use strategy pattern in v2. |
| L — Liskov Substitution | ✅ | ITaskProvider consistent across implementations. |
| I — Interface Segregation | ⚠️ | DiscussionBlock has optional fields. Split into union types in v2. |
| D — Dependency Injection | ✅ | CrdtProxy, plugin storage, callbacks all properly injected. |

### Diagram Alignment:
| Diagram | Status |
|---------|--------|
| 01-task-lifecycle | ✅ Fully aligned |
| 05-discussion-event-flow | ✅ All 5 phases implemented (init is in dispatchTask, not onTaskReady) |
| 06-discussion-channels | ✅ CRDT + Socket.IO + projection all wired |

### Final Score: **22/22 issues fixed, v2.0 frontend complete, all Socket.IO wiring done.**

---

## Cumulative Stats

| Round | Found | Fixed | False Positive | Deferred | Acceptable |
|-------|-------|-------|----------------|----------|------------|
| R1 | 20 | 19 | 0 | 1 | 0 |
| R2 | 6 | 6 | 0 | 0 | 0 |
| R3 | 15 | 1 | 2 | 9 | 3 |
| R4 | 3 | 3 | 0 | 0 | 0 |
| R5 | 5 | 5 | 0 | 0 | 0 |
| R6 | 7 | 7 | 0 | 0 | 0 |
| R7+R8 | 5 | 5 | 0 | 0 | 0 |
| R9 | 6 | 6 | 0 | 0 | 0 |
| **Total** | **67** | **52** | **2** | **10** | **0** |

**R4 fixes:** #20 (Socket.IO emission), #5 (discussions view), #7 (end-to-end wiring). Frontend v2.0 now complete.

**R5+R6 fixes:** All 12 issues fixed. CRDT context retrieval working, worker prompt complete, task dispatch wired, sequential IDs, error handling added.

---

## Round 5 Review — Production Runtime Bugs (Live Testing)

**Source:** User observed live agent runs where collab tool reads return empty data, agents can't read task/plan/goal context, and agents complete tasks without needed info.

### R5-1: CRITICAL — CollaborationPlugin goalId never set → agents read wrong CRDT space

**File:** `packages/backend/agentManager/plugins/CollaborationPlugin.ts` line 48  
**File:** `packages/agent-manager/src/AgentManagerV2.ts` line 373  
**Category:** WIRING  
**Impact:** ALL collab tool reads return empty data. Total system failure for context retrieval.

The `CollabMcpServer.goalId` defaults to `"default"`. When `approvePlan()` runs, it resolves goal-scoped CRDT stores via `crdtResolver.resolveForGoal(goalId)`, but **never calls `CollaborationPlugin.setGoalId(goalId)`**. The collab tool creates its `CollaborationSpace` using `this.l2.getOrCreateSpace("default")` while the actual task data was persisted to `this.l2.getOrCreateSpace(actualGoalId)`.

**Result:** Agent calls `collab({ action: "discover" })` → lists docs from `"default"` space (empty or stale). Agent calls `collab({ action: "read", docName: "plan" })` → opens `plan` doc in `"default"` space → `{}` (empty).

**Evidence from screenshots:**
- `collab({ action: "read", docName: "plan" })` → `{"default": {}}`
- `collab({ action: "read", docName: "goal" })` → `{}`  
- `collab({ action: "read", docName: "task-6", key: "task" })` → `Key "task" not found`

**Fix needed:** In `AgentManagerV2.initializeOrchestrator()`, the `crdtResolver.resolveForGoal(goalId)` must also call `collabPlugin.setGoalId(goalId)`. Alternatively, wire it in `OrchestratorService.approvePlan()` via pluginRegistry.

```typescript
// In resolveForGoal:
resolveForGoal(goalId: string) {
  // ...existing CRDT resolution...
  // Also update the collab plugin so worker tools read from the right space
  const collabPlugin = pluginRegistry.get("collaboration");
  if (collabPlugin?.setGoalId) collabPlugin.setGoalId(goalId);
}
```

---

### R5-2: CRITICAL — Collab tool read uses docName as Y.Map key → wrong Y.Map lookup

**File:** `packages/collaboration/src/L2/tools/index.ts` lines 477-488  
**Category:** LLD  
**Impact:** Even when goalId is correct, task reads still fail because of Y.Map name mismatch.

The `read` action does `doc.getMap(docName).get(key)` where `docName` is the full doc path (e.g., `"task-5/task"`). But CrdtTaskSync stores data in `doc.getMap("task")` — the Y.Map name is the **type** (`"task"`, `"plan"`, `"goal"`), not the full doc path.

When agent calls `collab({ action: "read", docName: "task-5/task" })`:
- Opens correct doc ✅
- `doc.getMap("task-5/task")` → new empty Y.Map (wrong name) ❌
- Should be `doc.getMap("task")` ✅

For full-doc reads (no key): `doc.toJSON()` returns `{ "task": { id: "...", ... }, "default": {} }`. Then `json["task-5/task"]` → `undefined`. Falls through to return the whole object including the misleading `"default": {}` key.

**Fix needed:** Resolve the correct Y.Map name from the doc's shared types instead of using docName. The doc's named Y.Maps ARE the data — just use the first non-`"default"` map, or use a KNOWN_MAP_NAMES mapping:

```typescript
// For keyed reads:
const mapName = guessMapName(doc, docName);  // "task" for task docs, "plan", "goal", etc.
const val = doc.getMap(mapName).get(key);

// For full reads:
const json = doc.toJSON();
const { default: _default, ...rest } = json;  // strip "default" map
// Return the data map (usually only one non-default)
const dataKeys = Object.keys(rest);
const data = dataKeys.length === 1 ? rest[dataKeys[0]] : rest;
```

---

### R5-3: HIGH — Partial CRDT task persistence → some tasks have no `/task` doc

**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` line 318-324  
**Category:** WIRING  
**Impact:** Not all tasks get CRDT docs. Agents for unpersisted tasks cannot read their own task context.

**Evidence:** Discover shows `task-3/task, task-5/task, task-8/task` exist but `task-1/task, task-2/task, task-4/task, task-7/task, task-9/task` do NOT. The bare `task-1, task-2, ...` docs visible in CRDT are created by `initCollabDocs()` (discussion docs) but their `/task` data docs were never created.

**Possible causes:**
1. `crdtTaskSyncProxy?.get?.()` returns null during `approvePlan()` → persistence block skipped silently
2. Error in `persistTask()` for some tasks swallowed by try/catch
3. Tasks added after plan approval (via request_task) may not trigger CRDT persistence

**Investigate:** Add error logging around the persistence loop. Check if `crdtTaskSync` was null at the time of `approvePlan()`.

---

### R5-4: HIGH — Agents complete tasks without context instead of escalating

**Category:** BEHAVIOR / PROMPT  
**Impact:** When collab tool returns empty data, agents don't report the failure — they hallucinate work and call `complete_task`.

From screenshots: After getting "Key 'task' not found" and empty plan/goal, the agent says "The task-specific context was not found... the collaboration context might be incomplete or not set up yet." But then proceeds to write code based on generic assumptions and completes the task.

**Root cause:** The worker prompt has no instruction to:
1. Use `request_task` tool when blocking info is missing
2. Report a blocker via `report_status` and wait
3. Fail the task instead of completing with fabricated output

**Fix needed:** Add to worker prompt:
```
## When Context Is Missing
If collab reads return empty or your task dependencies show no data:
1. Call report_status({ progress: 0, blockers: "Cannot read task context — plan/goal data not available" })
2. Do NOT fabricate work. Do NOT call complete_task with made-up output.
3. If you need input from another agent, use request_task to create a blocking dependency.
```

---

### R5-5: MEDIUM — Discover output confuses doc names → agents use wrong docName patterns

**File:** `packages/collaboration/src/L2/tools/index.ts` line 280-286  
**Category:** UX / PROMPT  
**Impact:** Top-level discover lists raw CRDT doc names (e.g., `task-1, task-3/task, plan, ...`). Agents see `task-1` and assume `collab({ action: "read", docName: "task-1", key: "task" })` is correct. They don't realize the actual task data is at `task-1/task`.

**Evidence:** Screenshots show agents consistently calling `docName: "task-1"` (without `/task`) and `docName: "task-6"` (without `/task`).

**Fix needed:** 
1. In top-level discover, group/label docs better: separate task parent docs from task data docs
2. Better: Auto-redirect reads — if `docName` matches `{taskId}` and no data found, try `{taskId}/task` automatically
3. Show explicit usage examples per doc type in discover output

```
// Auto-redirect for task reads:
if (action === "read" && !key && !docName.includes("/")) {
  // Try {docName}/task for task-like names
  const taskDocName = `${docName}/task`;
  const taskDocs = await space.listDocs();
  if (taskDocs.includes(taskDocName)) {
    docName = taskDocName;
  }
}
```

---

### Impact Analysis

| Issue | Severity | User-visible Effect |
|-------|----------|-------------------|
| R5-1 | **CRITICAL** | ALL collab reads return empty — agents are blind |
| R5-2 | **CRITICAL** | Even with correct space, Y.Map name mismatch → task reads fail |
| R5-3 | **HIGH** | Some tasks missing CRDT data entirely |
| R5-4 | **HIGH** | Agents hallucinate work instead of reporting missing context |
| R5-5 | **MEDIUM** | Discover output misleads agents into wrong docName patterns |

### Fix Priority

1. **R5-1 + R5-2** — Fix together. These two bugs make ALL context retrieval fail. Without these, the entire CRDT collaboration layer is broken at runtime.
2. **R5-4** — Worker prompt update to prevent hallucinated completion. Quick fix.
3. **R5-5** — Auto-redirect in read action. Both a safety net and UX improvement.
4. **R5-3** — May resolve itself once R5-1 is fixed (if the issue was that crdtTaskSync was null because of wrong goalId). If not, add explicit error handling around persistTask loop.

---

## Round 6 Review — Full Tool & Wiring Audit

**Source:** Deep audit of ALL L1/L2 tools, WorkerPool tool assembly, initialization chain, and agent prompt coverage.  
**Files reviewed:** WorkerPool.ts, AgentManagerV2.ts, OrchestratorService.ts, CollaborationPlugin.ts, workspace-tools.ts, requestTaskTool.ts, bounceTaskTool.ts, collab tools/index.ts, worker prompt

### R6-1: CRITICAL — Collab `list` action has same Y.Map name bug as `read`

**File:** `packages/collaboration/src/L2/tools/index.ts` line 433  
**Category:** LLD (same root cause as R5-2)  
**Impact:** `list` action returns empty for ALL system docs (task, plan, goal)

The `list` action at line 433 does `doc.getMap(docName)` — same bug as `read`. For a task doc opened with `docName: "task-5/task"`, it creates `doc.getMap("task-5/task")` (new empty map) instead of `doc.getMap("task")` (actual data).

**Fix:** Same as R5-2 — resolve Y.Map name from shared types, not from docName.

---

### R6-2: HIGH — Worker prompt doesn't mention `request_task` or `bounce_task`

**File:** `packages/agent-manager/src/AgentManagerV2.ts` lines 68-148  
**Category:** PROMPT / BEHAVIOR  
**Impact:** Agents have `request_task` and `bounce_task` tools injected but don't know they exist. They never create tasks for other roles or bounce misassigned work.

The generic worker prompt (`getGenericWorkerPrompt()`) documents:
- ✅ `report_status`, `complete_task` — documented in "Core Workflow" table
- ✅ Workspace tools — documented in full section  
- ✅ Scratchpad tools — documented in full section
- ✅ Collab tools — documented in full section
- ✅ Identity tools — documented in full section
- ❌ `request_task` — **not mentioned anywhere**
- ❌ `bounce_task` — **not mentioned anywhere**

**Fix:** Add to worker prompt:
```
### Task Management — Create & Reassign

| Tool | Purpose |
|------|---------|
| **request_task** | Create a new task for another role. Use when you need work done by a different specialist. |
| **bounce_task** | Return your current task if it's misassigned or you lack the skills. Provide a reason. |

**Guidelines for request_task:**
- Target a specific role (e.g., "frontend-dev", "qa")
- Set relationship: "blocks-me" if you need the result, "independent" if not
- Priority 2-5 (1 is reserved for planner)
- Maximum 5 agent-created tasks per plan
```

---

### R6-3: HIGH — Worker prompt has no "missing context" escalation protocol

**File:** `packages/agent-manager/src/AgentManagerV2.ts` lines 68-148  
**Category:** PROMPT / BEHAVIOR (same root as R5-4 but distinct fix)  
**Impact:** Direct cause of agents hallucinating work and completing tasks blindly

The prompt says "Execute tasks assigned to your role with expertise and precision" but has zero guidance for when tools return empty data, dependencies fail, or context is unavailable.

**Fix:** Add to worker prompt after the Guidelines section:
```
## When Context Is Missing or Tools Fail

If `collab read` returns empty data, or `my_context` shows no dependency outputs:
1. Call `report_status` with status "blocked" and describe what's missing
2. Use `request_task` to create a blocking dependency on the role that should provide the data
3. Do NOT fabricate work. Do NOT call `complete_task` with made-up output.
4. If you can do partial work, report what you completed and what's still blocked.
```

---

### R6-4: HIGH — CRDT persistence loop has no error handling

**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` lines 318-327  
**Category:** WIRING  
**Impact:** If `persistTask()` throws for one task, remaining tasks may not be persisted and no error is logged

```typescript
// Current (no error handling):
for (const task of this.taskStore.getAll()) {
  await crdtTaskSync.persistTask(task);   // throws → loop aborts, zero logging
}
```

**Fix:**
```typescript
for (const task of this.taskStore.getAll()) {
  try {
    await crdtTaskSync.persistTask(task);
  } catch (err) {
    logger.error(`[Orchestrator] Failed to persist task ${task.id} to CRDT: ${err}`);
    // Continue — task is in TaskStore, just not in CRDT
  }
}
```

---

### R6-5: MEDIUM — `request_task` creates tasks with non-standard IDs

**File:** `packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts`  
**Category:** LLD  
**Impact:** Agent-created tasks get IDs like `task-1713024000000-a1b2` instead of sequential `task-N`. This inconsistency means CRDT doc paths are unpredictable and may collide with the timestamp-based ID format.

Planner creates: `task-1`, `task-2`, ..., `task-9` (from plan)  
Agent creates: `task-1713024000000-a1b2c3` (timestamp + random)

The collab tool discover shows both formats mixed, confusing agents and making doc paths harder to guess.

**Fix:** Use a counter based on current max task number:
```typescript
const existingIds = taskStore.getAll().map(t => t.id);
const maxNum = Math.max(0, ...existingIds.map(id => {
  const m = id.match(/^task-(\d+)$/);
  return m ? parseInt(m[1]) : 0;
}));
const newTaskId = `task-${maxNum + 1}`;
```

---

### R6-6: MEDIUM — `request_task` callback `onTaskCreated` may not dispatch

**File:** `packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts`  
**Category:** WIRING  
**Impact:** When an agent creates a task via `request_task`, the callback notifies the planner but doesn't directly trigger task dispatch. The new task sits in `"pending"` status in TaskStore. It needs the orchestrator to discover it's ready and dispatch it.

**Current flow:**
1. Agent calls `request_task` → task created in TaskStore with `status: "pending"`  
2. DAG rebuilt 
3. `onTaskCreated()` callback fires → planner gets notification
4. ??? Who dispatches the new task?

The orchestrator's `checkAndDispatchTasks()` only runs after task completion events. If the new task has no prerequisites (independent), it enters "ready" state but nobody dispatches it until another task completes.

**Fix:** After `onTaskCreated()`, also trigger `orchestrator.checkAndDispatchTasks()` so independent agent-created tasks get dispatched immediately.

---

### R6-7: LOW — Collab tool `write` action uses `docName` as Y.Map name

**File:** `packages/collaboration/src/L2/tools/index.ts` line 504  
**Category:** LLD (same class as R5-2, R6-1)  
**Impact:** Custom CRDT docs created by agents via `write` store data in Y.Map named after the full docName. Consistent for custom docs (they always use `doc.getMap(docName)`), but inconsistent with system docs (which use type-based names like `"task"`, `"plan"`, `"goal"`).

Not a blocker — custom docs work fine. But the inconsistency means any future reads of system docs via `list`/`read` fail (R5-2/R6-1).

**Fix:** Already covered by R5-2 fix. Just noting the pattern inconsistency.

---

### Impact Summary — All Open Issues

| Issue | Severity | Category | Fix Complexity |
|-------|----------|----------|---------------|
| R5-1 | **CRITICAL** | WIRING | Simple — 1 line (setGoalId call) |
| R5-2 | **CRITICAL** | LLD | Medium — refactor Y.Map resolution in read/list |
| R6-1 | **CRITICAL** | LLD | Same fix as R5-2 (list action) |
| R6-2 | **HIGH** | PROMPT | Simple — add prompt section |
| R6-3 | **HIGH** | PROMPT | Simple — add prompt section |
| R5-3 | **HIGH** | WIRING | Medium — verify after R5-1 fix + add error handling |
| R5-4 | **HIGH** | PROMPT | Same fix as R6-3 |
| R6-4 | **HIGH** | WIRING | Simple — wrap in try/catch |
| R6-6 | **MEDIUM** | WIRING | Medium — trigger dispatch after onTaskCreated |
| R5-5 | **MEDIUM** | UX | Medium — auto-redirect + better discover output |
| R6-5 | **MEDIUM** | LLD | Simple — use sequential IDs |
| R6-7 | **LOW** | LLD | No action — covered by R5-2 |

### Consolidated Fix Plan (Priority Order)

**Phase 1 — CRDT Context Retrieval (blocking everything):**
1. R5-1: Wire `collabPlugin.setGoalId(goalId)` in approvePlan
2. R5-2 + R6-1: Fix Y.Map name resolution in collab `read` and `list` actions
3. R6-4: Add try/catch + logging around CRDT persistence loop
4. R5-3: Verify task persistence works after R5-1 fix

**Phase 2 — Agent Behavior (agents hallucinate without these):**
5. R6-2: Add `request_task` / `bounce_task` to worker prompt
6. R6-3 + R5-4: Add "missing context" escalation protocol to worker prompt

**Phase 3 — Task Flow Improvements:**
7. R6-6: Trigger dispatch after agent-created tasks
8. R5-5: Auto-redirect for task docName patterns
9. R6-5: Sequential task IDs for agent-created tasks

---

## Round 9 Review — Task Flow & Plan Issues (Live Testing)

**Source:** Full team execution. Task-1 completed (schema), task-2 (API) bounced because it couldn't find task-1's output. Agent tried request_task but hit self-assign guard. Bounced task blocked all downstream tasks forever. New agent-created task completed but didn't unblock the flow.

### R9-1: HIGH — Self-assign guard too strict

**File:** `requestTaskTool.ts` line 88  
**Impact:** Backend agent needed schema detail from task-1 (also backend), but `request_task` rejected with "Cannot assign to own role."

A developer CAN create a follow-up ticket for the same team. The guard should be removed — the max-5-tasks limit already prevents abuse.

**Fix:** Remove the self-assign check entirely.

### R9-2: CRITICAL — Failed/bounced task blocks ALL downstream tasks forever

**File:** `TaskStore.ts` — no `handleDependencyFailure()`  
**Impact:** When task-2 bounced (status: "failed"), tasks 3, 4, 5 stayed "pending" forever. No cascade.

`completeTask()` handles success (marks prereqs met, dispatches ready tasks). But there's NO equivalent for failure. The `onDependencyFail` field exists in the schema but is never checked by TaskStore.

**Analysis:** The old `TaskList.ts` has `handleDependencyFailure()` with auto-cascade (fail/skip/replan modes), but auto-cascading removes agency from the planner in this planner-first architecture. The planner should decide what happens when a task fails.

**Fix (applied — planner notification):** ✅ Enhanced `onTaskFailed` to tell the planner WHICH downstream tasks are blocked by a failure (`task.dependants`). Also updated options to include `reassign_task` (which now resets status — R9-3 fix). The planner now has the info and tools to unblock downstream tasks without auto-cascade.

**Future consideration:** If patterns emerge where planner consistently takes the same action (e.g., always reassigns), consider adding `onDependencyFail` enum (fail/skip/replan) as TaskStore metadata that the planner sets at plan creation time. OrchestratorService would check this before notifying.

### R9-3: HIGH — `reassign_task` doesn't reset failed status

**File:** `planMutationTools.ts` line 268  
**Impact:** Planner reassigns bounced task but status stays "failed" — task never re-dispatches.

**Fix:** After reassigning, reset `task.status` from "failed" to "ready".

### R9-4: HIGH — Agent-created task completion doesn't unblock original

**Impact:** Task-6 "Revisit schema" completed but task-2 stayed "failed". No dependency link.

Root cause chain: request_task rejected (R9-1) → bounce without dependency → planner created task-6 without linking → task-6 completed → nothing unblocked.

**Fix:** ✅ Resolved by R9-1 (agent can self-assign → `blocks-me` link created) + R9-3 (reassign resets status → re-dispatch works).

### R9-5: MEDIUM — Agent uses "plans" (plural) instead of "plan" (singular) for CRDT read

**Impact:** `collab read plans` falls through to generic CRDT read and returns `{}`. But the CRDT doc is stored as `"plan"` (singular) via `CrdtTaskSync.persistPlan()`. The `"plans"` category only works for `discover` and `list` (reads from PlanStore). The actual plan data IS in CRDT at docName `"plan"`.

**Not a code bug — it's a naming confusion.** Agent should call `collab({ action: "read", docName: "plan" })` not `"plans"`. The discover output and crdtRefs already tell agents to use `"plan"`.

**Fix:** ✅ Added auto-redirect `"plans"` → `"plan"` in the read action (when no key specified), matching the R5-5 redirect pattern for task docs.

### R9-6: LOW — Agent didn't use workspace tools to read upstream deliverables

**Impact:** Task-1 created schema files in workspace but task-2 apparently couldn't read them.

**Root cause analysis (CORRECTED):** The full output propagation chain IS wired and works end-to-end:

1. **Output propagation:** `enrichDependantContext()` passes `summary`, `deliverables` (file paths), and `nextSteps` from completed tasks to downstream tasks ✅
2. **Artifact injection:** `WorkerPool.buildMessageWithContext()` injects `## Available artifacts:` with file paths into the agent's prompt ✅
3. **Branch merge:** `WorkspacePlugin.onTaskComplete()` → `mergeAndCleanup()` → merges task-1's branch to main via `GitBranchManager.mergeBranch()` ✅
4. **Downstream branch creation:** Task-2's workspace branches from main (post-merge), so task-1's files exist on task-2's branch ✅
5. **Workspace tools:** Agent has `workspace_read_file`, `workspace_list_files` etc. injected via PluginRegistry ✅

**This is a behavior issue, not a code bug.** The agent saw "Available artifacts: src/schema.ts" in its prompt but didn't call `workspace_read_file("src/schema.ts")` to read the content. The files were accessible.

**Possible contributing factors:**
- Agent relied on summary text instead of using workspace tools to read files
- Merge may have failed silently (conflict) — check `mergeWarning` in `onWorkerDone()`
- Race condition: task-2 dispatch could start before merge completes (unlikely — `onWorkerDone` awaits merge before calling `completeTask`)

**Fix B (prompt clarity — applied):** ✅ Enhanced `buildMessageWithContext()` to show a source-agnostic "Deliverables from Upstream Tasks" section with explicit instructions for each access method:
- File paths → `workspace_read_file` (files are merged into workspace after upstream branch merges to main)
- CRDT docs → `collab read` (for structured data stored by upstream agents)
- Directories → `workspace_list_files` (to discover related files)
- Includes note: "Always read deliverables before starting work — don't rely solely on summaries."

This keeps the agent in control — it reads on demand, choosing what to access based on its needs.

**Fix C (auto-include — rejected):** Would pre-load file content into `upstreamOutputs`, but this takes control away from the agent and lets the planner dictate which files matter. Better to let agents read files on demand.

---

## Systemic Issue: No Inter-Agent Negotiation Before Task Creation

**Discovered during R9 analysis.** The R9 failure chain (bad task → bounce → blocked downstream → stuck) reveals a deeper architectural gap: agents create tasks for other roles without any negotiation.

**Root cause:** `request_task` immediately creates and dispatches work. There's no "propose → discuss → agree → create" flow. Discussion primitives exist (`discuss`, `write-block`, mentions) but aren't connected to the task creation workflow.

**Full analysis and 4 architecture options documented in:**
→ `docs/features/inter-agent-collaboration/feature_architecture.md`

**Options under consideration:**
- **A: Prompt-driven discuss-before-task** (agents negotiate via existing discuss tool before creating tasks)
- **B: Collab-only** (agents can't create cross-role tasks; planner creates from discussions)
- **C: Smart routing** (high-confidence → direct, uncertain → discuss first)
- **D: Notify-and-proceed** (task creation auto-posts context to discussion thread)

**Awaiting architecture decision before implementation.**
