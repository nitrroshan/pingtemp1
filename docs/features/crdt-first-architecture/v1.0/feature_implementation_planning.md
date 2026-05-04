# Phase 1: CRDT-First + Document-Based Planning — Implementation Plan

**Branch strategy:** 4 PRs, merged sequentially. Each PR is independently testable and deployable.
**Architecture:** [crdt-first-architecture](../feature_architecture.md) | [plan-session](../../plan-session/feature_architecture.md)
**Vision:** [task-context-and-crdt](../../task-context-and-crdt/feature_architecture.md) *(vision doc — not a separate implementation track)*
**Roadmap:** [PLATFORM-ROADMAP Phase 1](../../../PLATFORM-ROADMAP.md#phase-1-crdt-first--document-based-planning)
**Build check:** Each PR must pass `bun run build:backend` + `bun run --filter @ping/agent-manager typecheck`

---

## Why 4 PRs, Not 1 Branch

The review found:
1. DB safety fixes are prerequisites — land them first, don't risk them in a mega-branch
2. CRDT restore can use existing CrdtTaskSync (standardize map names, don't rewrite the class yet)
3. DocumentRef is additive and independently testable
4. Document-first planning is the biggest change — it needs the first 3 stable before starting

Each PR builds on the previous. No deferral — everything ships in Phase 1. Just sequenced to be safe.

---

## PR 1: DB Safety + Dispatch Fixes (2 days)

**Branch:** `fix/db-safety`
**Merge target:** `dev`
**Risk:** Low — bug fixes only, no new features

### PR1.1. Fix MongoDB unique index

**Files:** `TaskSchema.ts` L40, `MongoTaskService.ts` L23

```typescript
// TaskSchema.ts — CHANGE:
TaskSchema.index({ teamId: 1, goalId: 1, taskId: 1 }, { unique: true });

// MongoTaskService.ts bulkWrite filter — CHANGE:
filter: { teamId: doc.teamId, goalId: doc.goalId, taskId: doc.taskId }
```

### PR1.2. Make persistence methods async + awaited

**File:** `GoalManager.ts` L107-126 — change 3 fire-and-forget methods to async:
```typescript
private async persistTasks(...): Promise<void> { await this.taskPersistence.saveTasks(...); }
private async persistTaskStatus(...): Promise<void> { await this.taskPersistence.updateTaskStatus(...); }
private async persistClearGoalTasks(...): Promise<void> { await this.taskPersistence.clearTasksByGoal(...); }
```
Update all call sites to `await`.

### PR1.3. Persist goal status + GoalConfig

**Files:** `GoalSchema.ts` — add `repoUrl`, `repoBranch` fields
**Files:** `MongoGoalService.ts` — include in `addGoal()`, add `updateGoalStatus(goalId, status)`
**Files:** `AgentManagerV2.ts` or wiring — wire `onGoalStatusChange` → `mongoGoalService.updateGoalStatus()`
**Files:** `GoalManager.ts` L213 — wire `setGoalRepo()` → persist to MongoDB

### PR1.4. Fix OrchestratorService dispatch signature errors

**File:** `OrchestratorService.ts` — fix the 4 compile errors in dispatch path identified in editor diagnostics. These must be clean before PR 2-4 touch the same file.

**Exit criteria:** Build passes. DB writes awaited. Goal status + config persists. No compile errors.

---

## PR 2: CRDT Standardize + Restore (3 days)

**Branch:** `fix/crdt-restore` (from `dev` after PR 1 merged)
**Risk:** Medium — changes Y.Map names and restores deleted writes

### PR2.1. Standardize CrdtTaskSync map names

**File:** `CrdtTaskSync.ts`

Change map names only — **don't rewrite the class**:
```typescript
// persistTask(): "task" → "meta", keep all 18 fields, keep body as string (for now)
const map = doc.getMap("meta");  // was: doc.getMap("task")
map.set("type", "task");         // NEW: identify page type

// persistPlan(): "plan" → "meta"
const map = doc.getMap("meta");  // was: doc.getMap("plan")
map.set("type", "plan");

// syncStatus(): "task" → "meta"
// syncPlanStatus(): "plan" → "meta"
// updateIndex(): "_index" → "meta", set type = "index"
```

**Why not CrdtPageManager yet:** CrdtTaskSync works. It's called from 6 files. Rewriting the class while also restoring 7 blank-line gaps is too much risk in one PR. Standardize names now, refactor to CrdtPageManager in PR 3 or later.

### PR2.2. Standardize CrdtGoalStore map names

**File:** `CrdtGoalStore.ts` — `"goal"` → `"meta"`, set `type: "goal"`

### PR2.3. Update collab tool to read from "meta"

**File:** `collab tool index.ts`
1. Delete `KNOWN_MAP_NAMES`
2. Delete `resolveDataMap()`
3. `read` action: always `doc.getMap("meta")`
4. Keep existing `write-block` / `read-block` as-is (raw XML construction works, BlockNote rewrite in PR 3)

### PR2.4. CRDT projection via Domain Events (replaces direct GoalManager writes)

**Status:** DONE — implemented differently than originally planned.

**Original plan:** Fill 7 blank-line gaps in GoalManager with direct `crdtSync.*` calls.

**Actual implementation:** Domain Events + GoalEventBus architecture.

| Component | File | What |
|-----------|------|------|
| GoalEventBus | `events/GoalEventBus.ts` | 2-tier event dispatch (projection + notification) |
| GoalEvents | `events/GoalEvents.ts` | 6 event types: TasksCreated, TaskStatusChanged, TaskCompleted, PlanStatusChanged, GoalStatusChanged, TasksCleared |
| CrdtProjectionHandler | `handlers/CrdtProjectionHandler.ts` | Subscribes to bus, projects state → CRDT (best-effort) |
| SocketNotificationHandler | `handlers/SocketNotificationHandler.ts` | Subscribes to bus, emits Socket.IO events (fire-and-forget) |
| AgentManagerV2 | `AgentManagerV2.ts` L331-386 | Creates bus, registers handlers, passes to GoalManager |
| GoalManager | `GoalManager.ts` | 7 `publishEvents()` calls replace 14 direct MongoDB+CRDT calls |

**Why the change:** Design review identified dual-write problem (MongoDB + CRDT with no coordination). Event-driven architecture ensures CRDT projection only happens after MongoDB write succeeds. Persist methods now throw on failure (not catch-and-continue), preventing stale projections.

**What GoalManager publishes (not direct CRDT calls):**
1. `approvePlan()` → `{ type: "tasks_created", tasks, plan }`
2. `onTaskReady()` → `{ type: "task_status_changed", newStatus: "ready" }`
3. `onTaskComplete()` → `{ type: "plan_status_changed" }` + `{ type: "goal_status_changed" }`
4. `onTaskFailed()` → `{ type: "task_status_changed", newStatus: "failed" }`
5. `onWorkerDone()` → `{ type: "task_completed", output }`
6. `resetPlan()` → `{ type: "plan_status_changed", status: "archived" }`
7. `interruptPlan()` → `{ type: "plan_status_changed", status: "interrupted" }`

### PR2.5. Add updateAgentStatus to CrdtTaskSync (FIX-1)

**File:** `CrdtTaskSync.ts` — add method:
```typescript
async updateAgentStatus(role: string, status: 'busy' | 'idle', taskId?: string): Promise<void> {
  const doc = await this._space.openDoc('agent-statuses');
  doc.getMap('agent-statuses').set(role, { status, task: taskId || null, since: Date.now() });
}
```
**File:** `WorkerPool.ts` — call before/after execution

### PR2.6. Add ICrdtTaskSync interface (FIX-2)

**New file:** `packages/collaboration/src/L2/collaboration/types/ICrdtTaskSync.ts`
Replace `any` in 6 files with typed interface.

**Exit criteria:** `collab read {taskId}/task` returns data from `Y.Map("meta")`. CRDT status syncs. Agent-statuses populated. Zero `any` for crdtTaskSync.

---

## PR 3: DocumentRef + complete_task + BlockNote (1 week)

**Branch:** `feature/document-ref` (from `dev` after PR 2 merged)
**Risk:** Low-medium — additive types + tool schema upgrade + BlockNote install

### PR3.1. Install BlockNote server-side

`cd packages/collaboration && bun add @blocknote/server-util @blocknote/core`

### PR3.2. Rewrite write-block / read-block with ServerBlockNoteEditor

**File:** `collab tool index.ts`
- Delete helper functions: `insertParagraph()`, `insertHeading()`, `markdownToBlocks()`, `xmlFragmentToText()`
- `write-block`: `tryParseMarkdownToBlocks()` → `blocksToYXmlFragment()`
- `read-block`: `yXmlFragmentToBlocks()` → `blocksToMarkdownLossy()`

### PR3.3. Update CrdtTaskSync.persistTask to write XmlFragment

**File:** `CrdtTaskSync.ts` `persistTask()` — move `body` from meta string to XmlFragment:
```typescript
// Remove: map.set("body", task.description);
// Add: write description to Y.XmlFragment("content") via ServerBlockNoteEditor
const blocks = await this.editor.tryParseMarkdownToBlocks(task.description);
blocksToYXmlFragment(this.editor, blocks, doc.getXmlFragment("content"));
```

Create a shared `ServerBlockNoteEditor` instance on CrdtTaskSync (constructed once, reused).

### PR3.4. DocumentRef types

**New file:** `packages/agent-manager/src/memory/types/DocumentRef.ts`
**File:** `Task.types.ts` — add optional `inputDocs`, `outputDocs`, `expectedOutputDocs`, `risks`, `acceptanceCriteria`

### PR3.5. Upgrade complete_task schema

**File:** `completeTaskTool.ts` — add `producedDocs`, `decisions`, `risksEncountered` (all optional, backward compat)

### PR3.6. Capture producedDocs + fix enrichDependantContext

**New file:** `toDocumentRefs.ts` — backward-compat conversion utility
**File:** `OrchestratorService.ts` onWorkerDone() — `task.outputDocs = toDocumentRefs(...)`
**File:** `TaskStore.ts` enrichDependantContext() — push `upstream.outputDocs` → `dependant.inputDocs`
**File:** `TaskStore.ts` enrichDependantContext() — push `upstream.output.decisions` → `ctx.upstreamDecisions`

### PR3.7. Include inputDocs in agent dispatch prompt

**File:** `OrchestratorService.ts` dispatchTask() — append `## Input Documents` + `## Expected Output Documents` sections

### PR3.8. Fix double-context in buildMessageWithContext

**File:** `WorkerPool.ts` — skip V1 context append when structured docs already injected

### PR3.9. record-decision / get-decisions (CRDT-F2)

**File:** `collab tool index.ts` — add 2 actions

**Exit criteria:** BlockNote conversion works. complete_task accepts producedDocs. DocumentRef flows downstream. No double context. Decisions recordable.

---

## PR 4: Document-First Plan Session (2 weeks)

**Branch:** `user/nitrroshan/fixplans` (from `dev`)
**Risk:** High — changes planner tool, approval flow, adds frontend component

### Backend (DONE)

#### PR4.1. Plan doc written to CRDT at proposal time ✅

**Status:** Implemented via domain events instead of direct `submitPlan.ts` call.

**How it works:**
1. `GoalManager.setPendingPlan()` emits `plan_proposed` domain event
2. `CrdtProjectionHandler.onPlanProposed()` calls `resolveForGoal()` + `createPlanDoc()`
3. `CrdtTaskSync.persistPlan()` writes `Y.Map("meta")` with `status: "pending"` + `Y.XmlFragment("content")` via ServerBlockNoteEditor
4. Plan doc is in CRDT BEFORE user reviews — available at `{goalId}/plan`

**Files changed:**
- `GoalEvents.ts` — added `PlanProposed` event type
- `GoalManager.ts` — `setPendingPlan()` publishes `plan_proposed` event
- `CrdtProjectionHandler.ts` — subscribes to `plan_proposed`, calls `createPlanDoc()`
- `CrdtTaskSync.ts` — `persistPlan()` writes `status: "pending"` (was `"executing"`)

**Design decision:** Plan lives in BOTH `pendingPlan` JSON (for approval logic) AND CRDT (for user review). `PlanStore` kept as backup. Full CRDT-only flow deferred — requires `GoalManager.deriveTasks()` to read from CRDT on approve, which is a bigger change.

#### PR4.2. Remove auto-approve + awaiting_approval state ✅

**Files changed:**
- `submitPlan.ts` — `octx.setState("awaiting_approval")` (was `"executing"`)
- `AgentManagerV2.ts` — `onPlanProposed` callback no longer calls `approvePlan()`, comment: "No auto-approve"
- Auto-approve APIs kept as opt-in (`setAutoApproveForRole`, `setAutoApproveAllRoles`)

#### PR4.3. Planner prompt: write rationale before submit_plan ✅

**File:** `planner/system.xml` — Planning Protocol instructs: (1) analyze, (2) `collab write-block "plan"`, (3) THEN `submit_plan`

#### PR4.4. Agent completion protocol: write CRDT report first ✅

**Files changed:**
- `generic-worker/system.xml` — `<finish-properly>` requires 4-step completion protocol
- `skills/task-lifecycle/SKILL.md` — full completion protocol: commit → write-block to `{taskId}/report` → record-decision → complete_task
- `CrdtTaskSync.ts` — `syncStatus()` no longer generates system report; agent's report IS the report
- `completeTaskTool.ts` — schema accepts `producedDocs` + `decisions`

#### PR4.5. Task description to Y.XmlFragment on creation ✅

**File:** `CrdtTaskSync.ts` `persistTask()` — writes task description as BlockNote content to `Y.XmlFragment("content")`

#### PR4.6. DocumentRef context pipeline ✅

**Files changed:**
- `Task.types.ts` — first-class `inputDocs`, `producedDocs`, `decisions` fields
- `DocumentRef.ts` — `DocumentRef` + `ExpectedDoc` types
- `TaskStore.ts` `enrichDependantContext()` — auto-generates `crdt:{taskId}/report` refs
- `TaskContextBuilder.ts` — "Input Documents" section with `collab read` URIs

#### PR4.7. Write-through persistence fixes ✅

- `DispatchManager.ts` — `updateTaskStatus` async-aware, error logging (not swallowed)
- `OrchestratorService.ts` — passes TaskStore async call directly (no `.catch(() => {})`)
- `requestTaskTool.ts` — cycle rollback via `taskStore.updateStatus("discarded")` (single writer)

### Frontend (PARTIAL)

#### PR4.8. Plan approval UI ✅

**File:** `PlanApproval.tsx` — dialog with task list, reorder, "Approve & Execute" button
**File:** `App.tsx` — renders when `sessionState === "awaiting_approval"`
**File:** `goalSessionStore.ts` — `approvePlan()` calls `agentServiceV2.approvePlan(goalId)`

#### PR4.9. Replan / reject button ✅ DONE

**What was done:**
- `PlanApproval.tsx` — added "Request Changes" button with feedback textarea + "Send & Replan" submit
- `AgentServiceV2.ts` — added `rejectPlan(goalId, feedback)`, `"reject-plan"` action type
- `goalSessionStore.ts` — added `rejectPlan(feedback)` action
- `socket-types.ts` — added `"reject-plan"` to action enum + `feedback` field
- `SocketActionHandler.ts` — `handleRejectPlan()`: clears pendingPlan, sets state to gathering, routes feedback to planner
- `AgentManagerV2.ts` — `rejectPlan(goalId)`: clears pendingPlan, sets goal state to `"gathering"`

**Flow:** User clicks "Request Changes" → enters feedback → "Send & Replan" → dialog closes → state to `gathering` → feedback routed to planner → planner revises → new `awaiting_approval`

#### PR4.10. Document Pane ❌ NOT IMPLEMENTED — DEFERRED

**Gap:** No DocumentPane component. PlanApproval is a task-list modal, not a CRDT doc viewer. Users can't see the plan document the planner wrote.

**Infrastructure already present:**
- `CollaborativeEditor.tsx` — full BlockNote + Hocuspocus component (used by DevCollabButton)
- All dependencies installed: `@blocknote/core`, `@blocknote/react`, `@blocknote/mantine`, `@hocuspocus/provider`, `yjs`
- Hocuspocus connection pattern works in `useDiscussion.ts`

**What's needed (separate feature — ~1 week):**

1. **DocumentPane container** — resizable right panel with document list + viewer
2. **Document list** — HTTP endpoint to list CRDT docs for a goal (from MongoDB goal/task records, not CRDT introspection — Liveblocks pattern)
3. **CrdtDocViewer** — wraps `CollaborativeEditor` with goal-scoped `docId` construction (`{teamId}/{goalId}/{docName}`)
4. **Layout integration** — split-pane in `App.tsx`, toggle state in `uiStore`
5. **Auto-open** — on `sessionState === "awaiting_approval"`, open DocumentPane with plan doc
6. **Approve/Replan buttons** — in DocumentPane footer when viewing plan doc during approval

**See:** `docs/features/document-pane/feature_implementation_planning.md` for full plan.

### Verification Checklist

| # | Check | Status |
|---|-------|--------|
| 1 | Planner writes plan rationale to CRDT before calling submit_plan | ✅ Prompt instructs it |
| 2 | Plan doc written to CRDT at proposal time (not just approval) | ✅ `plan_proposed` event |
| 3 | `sessionState === "awaiting_approval"` after plan proposed | ✅ `submitPlan.ts` |
| 4 | Auto-approve removed from AgentManagerV2.onPlanProposed | ✅ Comment in code |
| 5 | "Approve Plan" button in frontend triggers approvePlan() | ✅ PlanApproval.tsx |
| 6 | "Request Changes" button sends feedback to planner | ✅ PlanApproval + SocketActionHandler |
| 7 | Task CRDT docs have description in Y.XmlFragment("content") | ✅ persistTask() |
| 8 | Agent writes completion report to CRDT BEFORE calling complete_task | ✅ Prompt + SKILL.md |
| 9 | System report doesn't overwrite agent's writing | ✅ Removed from syncStatus |
| 10 | Downstream agent reads `collab read-block {id}/report` | ✅ enrichDependantContext |

### What Was NOT Done From Original PR4 Plan

| Original item | Status | Reason |
|---|---|---|
| GoalManager reads from CRDT on approve (`deriveTasks`) | Skipped | Would require CRDT→MongoDB derivation; `pendingPlan` JSON + event bus approach is simpler and works |
| Delete PlanStore | Skipped | Kept as JSON backup until CRDT plan docs proven stable in production |
| DocumentPane component | Deferred | Separate feature with its own implementation plan |
| Feature flag `FF_DOCUMENT_FIRST_PLANNING` | Skipped | Behavior is always-on; auto-approve kept as opt-in API for testing |

---

## Scope Ownership

**This implementation plan is the single source of truth for Phase 1.** The [task-context-and-crdt](../../task-context-and-crdt/feature_architecture.md) doc is the **vision** — it documents the full DocumentRef design, 13 context flows, and SOLID analysis. It is NOT a separate implementation track. All implementable items from that vision are pulled into PR 3 above.

Items from the vision deferred to later phases:
- DocumentResolverRegistry — agents use existing tools (YAGNI until proven needed)
- DocumentRegistry CRDT doc — not needed until cross-task discovery required
- Review-before-publish — Phase 2+
- L2 Search — Phase 6

---

## Verification Checklist

| PR | # | Check |
|----|---|-------|
| 1 | 1 | MongoDB index `{ teamId, goalId, taskId }` |
| 1 | 2 | DB writes awaited (error → visible in logs) |
| 1 | 3 | Goal status + repoUrl in `goals` collection |
| 1 | 4 | OrchestratorService dispatch — zero compile errors |
| 2 | 5 | `collab read {taskId}/task` → reads from `Y.Map("meta")` |
| 2 | 6 | CRDT task status syncs on complete/fail |
| 2 | 7 | `collab read agent-statuses` shows busy/idle |
| 2 | 8 | Zero `any` casts for crdtTaskSync |
| 3 | 9 | `write-block` uses ServerBlockNoteEditor (not raw XML) |
| 3 | 10 | Task pages have `Y.XmlFragment("content")` with blocks |
| 3 | 11 | complete_task with `producedDocs` → dependant gets `inputDocs` |
| 3 | 12 | Agent prompt shows `## Input Documents` with URIs |
| 3 | 13 | No double context in agent prompt |
| 3 | 14 | `collab record-decision` / `get-decisions` works |
| 4 | 15 | Planner writes plan-doc to CRDT (not JSON) |
| 4 | 16 | No auto-approve — `sessionState: "awaiting_approval"` |
| 4 | 17 | Document Pane renders file list + BlockNote editor |
| 4 | 18 | Approve from Document Pane → tasks in MongoDB |
| 4 | 19 | PlanStore gone — no JSON files in `data/plans/` |

---

## CrdtPageManager — When?

The CrdtPageManager refactor (replacing CrdtTaskSync) is a good idea but **not a prerequisite for Phase 1**. CrdtTaskSync with standardized map names (`"meta"`) + XmlFragment support (added in PR 3) is sufficient.

Refactor to CrdtPageManager when:
- Phase 1 is merged and stable
- The class is touched for Phase 2 (agent memory) or Phase 6 (search)
- We need `createReportPage()` or other new page types

Don't rewrite the foundation while building on it.

---

## Rollback

- **PR 1:** Revert index + persistence (DB-only, low risk)
- **PR 2:** Revert map names back to old. Remove blank-line fills. System falls back to empty CRDT (workers lose context but don't crash)
- **PR 3:** DocumentRef fields are optional — system works without them. Revert BlockNote to raw XML.
- **PR 4:** Restore `submit_plan` auto-approve + `pendingPlan` JSON. Re-enable PlanStore. Remove DocumentPane.
