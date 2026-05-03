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

**Branch:** `feature/plan-session` (from `dev` after PR 3 merged)
**Risk:** High — changes planner tool, approval flow, adds frontend component

### Backend

#### PR4.1. Refactor submitPlan to write CRDT document

**File:** `submitPlan.ts`

Instead of storing JSON in `pendingPlan` and auto-approving:
1. Write `plan-doc` CRDT page: `Y.Map("meta")` with `{ goal, approach, status: "draft", taskSummaries }` + `Y.XmlFragment("content")` with plan prose via ServerBlockNoteEditor
2. Write per-task CRDT pages: each task gets `{taskId}/task` page
3. Set `sessionState: "awaiting_approval"` (NOT "executing")
4. Do NOT set `pendingPlan` — plan lives in CRDT

#### PR4.2. GoalManager reads from CRDT on approve

**File:** `GoalManager.ts`

New method: `deriveTasks(goalId)` — reads plan-doc from CRDT `meta.taskSummaries`, returns task array.

Change `approvePlan()`: read from CRDT (not `pendingPlan` JSON). Create MongoDB task records from CRDT data.

#### PR4.3. Delete PlanStore

Remove `planStore.savePlan()`, `planStore.updatePlanStatus()`, `planStore.archivePlan()` calls from GoalManager. CRDT plan-doc + MongoDB is sufficient.

### Frontend

#### PR4.4. DocumentPane component

**New file:** `packages/frontend/components/DocumentPane/DocumentPane.tsx`

Resizable right pane with:
- File list view (all CRDT pages for goal, with status badges)
- Document view (BlockNote editor bound to Hocuspocus Y.XmlFragment)

#### PR4.5. Hocuspocus connection

`HocuspocusProvider` → `Y.Doc` → `doc.getXmlFragment("content")` → `useCreateBlockNote({ collaboration: { fragment } })`

#### PR4.6. Wire into existing layout

- `DetailPanel.tsx` — add "📄 View Documents" button (plan + task modes)
- `PlanTaskList.tsx` — add `📋 Plan Document` entry
- `uiStore.ts` — `documentPaneOpen`, `documentPanePath` state
- `App.tsx` — auto-open DocumentPane on `sessionState: "awaiting_approval"`

#### PR4.7. Approve / Replan buttons

- Document Pane footer: "✓ Approve Plan" → `agentServiceV2.approvePlan(goalId)`
- "↻ Replan" → sends message to planner

**Exit criteria:** Planner writes document (not JSON). No auto-approve. User reviews in BlockNote. Approve creates MongoDB tasks from CRDT. PlanStore gone.

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
