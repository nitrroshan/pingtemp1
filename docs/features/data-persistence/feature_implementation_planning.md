# Data Persistence — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 4 (Agent Workspace & Persistence)  
**Approach:** Option B — CRDT docs primary, MongoDB as derived index

---

## Branch
- `feature/data-persistence`

## Scope
Migrate task/plan/output state from in-memory Maps to CRDT docs (source of truth) with MongoDB projections for aggregate queries. Agents access data via existing `collab` + `read_file` tools.

## Implementation Steps

### Step 1: Design CRDT Document Schemas
**Files to create:**
- `packages/backend/memory/L2/schemas/tasksDoc.ts` — Y.Map schema for `{teamId}/{goalId}/tasks`
- `packages/backend/memory/L2/schemas/planDoc.ts` — Y.Map schema for `{teamId}/{goalId}/plan`
- `packages/backend/memory/L2/schemas/outputsDoc.ts` — Per-task output manifests
- `packages/backend/memory/L2/schemas/goalsDoc.ts` — Y.Map schema for `{teamId}/goals`

**Exit criteria:** Schemas define all fields from architecture doc, TypeScript types exported

### Step 2: Create CRDT-to-MongoDB Sync
**Files to create:**
- `packages/backend/memory/L2/sync/CrdtMongoSync.ts` — Hocuspocus `onChange` hook that projects CRDT doc fields to MongoDB collections. Debounced (500ms). Collections: `tasks_index`, `plans_index`, `output_manifests_index`, `goals_index`.

**MongoDB schemas are indexes, not sources of truth.** If MongoDB is lost, rebuild from CRDT docs.  
**Exit criteria:** CRDT changes propagate to MongoDB within 500ms

### Step 3: Create MongoDB Index Models
**Files to create:**
- `packages/backend/db/models/TaskIndex.ts` — Mongoose model for task index (status, role, goalId, teamId)
- `packages/backend/db/models/PlanIndex.ts` — Mongoose model for plan index
- `packages/backend/db/models/GoalIndex.ts` — Mongoose model for goal index

**Exit criteria:** MongoDB models support aggregate queries (group by status, role, team)

### Step 4: Migrate TaskStore to CRDT Backend
**Files to modify:**
- `packages/backend/orchestrator/TaskStore.ts` — Replace in-memory Map with CRDT doc reads/writes. `setTaskStatus()` → mutate Y.Map. `getTask()` → read Y.Map. Single-writer enforced at this layer.

**Exit criteria:** TaskStore reads/writes through CRDT docs, not Maps

### Step 5: Create FilesystemProjection
**Files to create:**
- `packages/backend/memory/L2/sync/FilesystemProjection.ts` — Mirror CRDT doc state to `.ping/collaboration/` directory as JSON/markdown files. Agents read via `read_file`.

**Exit criteria:** `.ping/collaboration/tasks.json`, `.ping/collaboration/plan.json` auto-generated from CRDT state

### Step 6: Create Execution Events Collection
**Files to create:**
- `packages/backend/db/models/ExecutionEvent.ts` — Append-only MongoDB collection for planner episodic memory. Events: task_started, task_completed, task_failed, plan_created, plan_approved, goal_completed.

**Not a source of truth** — supplementary history for analytics and planner learning.  
**Exit criteria:** Key events logged, queryable for analytics

### Step 7: Migrate OrchestratorService
**Files to modify:**
- `packages/backend/orchestrator/OrchestratorService.ts` — Update to read plan/task state from CRDT docs. Dashboard/admin queries go through MongoDB indexes.

**Exit criteria:** Orchestrator fully backed by CRDT persistence

## Testing Strategy
- Unit test: CRDT ↔ MongoDB sync correctness
- Integration test: create task via CRDT → verify in MongoDB index → verify in `.ping/collaboration/`
- Test: restart backend → CRDT state persists (Hocuspocus DB extension)
- Test: delete MongoDB → rebuild indexes from CRDT docs

## Rollback Plan
- In-memory MemoryManager preserved behind `PERSISTENCE=crdt|memory` flag

## Complexity
High — overlaps with Phase 4 work (2-3 weeks).
