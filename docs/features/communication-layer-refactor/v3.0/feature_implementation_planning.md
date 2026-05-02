# v3.0 — Backend Persistence (Single Source of Truth)

> **Scope:** Database becomes the single source of truth for ALL workflow state. CRDT stays for collaborative document content only. File stores eliminated.  
> **Depends on:** v2.5 (multi-goal crossing fix — explicit goalId everywhere)  
> **Architecture:** [../feature_architecture.md](../feature_architecture.md) — Layer 2  
> **Prerequisite:** [bug-multi-goal-plan-crossing.md](../bugs/bug-multi-goal-plan-crossing.md) — must ship as v2.5 before persistence

## Problem: 5 Stores for the Same Data

Task status is currently written to **5 different locations**:

| Store | Write Timing | Read Timing | Status Accuracy |
|-------|-------------|-------------|:---------------:|
| TaskStore (Map) | Synchronous on every change | Every dispatch, every API | ✅ Always current |
| CrdtTaskSync | Fire-and-forget after TaskStore | On restart | ⚠️ May lag (async, errors swallowed) |
| FileTaskStore | Debounced 2s after creation | On restart (before CRDT) | ❌ Stale (never updated during execution) |
| FilePlanStore | On plan approval | On restart | ✅ Structure only (no status) |
| MongoDB (goals) | On plan approval only | On restore endpoint | ❌ Goal-level only, not task-level |

**Industry pattern:** CRDT is for collaborative document content. Workflow state belongs in a database. One source of truth, not five.

## Prerequisites

### v2.5: Multi-Goal Crossing Fix (Ship Separately)

This is a **code bug**, not a persistence feature. Must ship before v3 because v3's write-through needs goalId to be explicit everywhere.

- [ ] Remove `if (!getGoalId())` guard in OrchestratorService — always switch to incoming goalId
- [ ] `setPendingPlan(goalId, plan)` — explicit goalId parameter
- [ ] `approvePlan(goalId)` — explicit goalId parameter
- [ ] Add `goalId` to ActionPayloadSchema in SocketServerV2
- [ ] Frontend sends `activeGoalId` with every action (approvePlan, startTask, cancelTask)
- [ ] Wire goalId through all planner tool calls that create/modify plans

**Files:** OrchestratorService.ts, GoalManager.ts, SocketServerV2.ts, AgentServiceV2.ts, goalSessionStore.ts

### v2.5: Task Mutation Audit

Every path that creates or mutates a task must be identified. Not just the 4 obvious ones in GoalManager, but also:

- `GoalManager.approvePlan()` → creates tasks (main path)
- `GoalManager.onTaskComplete()` → status + output
- `GoalManager.onTaskFailed()` → status + error
- `GoalManager.onTaskReady()` → status change from dependency resolution
- `add_tasks` planner tool → dynamic task creation mid-execution
- `remove_task` planner tool → task deletion
- `replan` planner tool → clearByGoal + new task creation
- `bounceTask` → status change (failed → ready with retry count)
- `SocketServerV2.handleCompleteTask()` → manual complete by user
- `SocketServerV2.handleStartTask()` → manual start by user
- `SocketServerV2.handleCancelTask()` → cancel by user

**All of these must persist through the same `ITaskService` interface.**

## Architecture: Clean Separation

```
AFTER:
  TaskStore.updateStatus()
    → ITaskService.updateStatus()   (write-through, awaited)

  On restart:
    → ITaskService.getByTeam(teamId) → hydrate TaskStore
    → IGoalService.getGoals(teamId)  → hydrate GoalManager

  CRDT stays for:
    → Discussion documents (agent collaboration)
    → Shared docs (BlockNote editor)
    → Agent presence (cursors, awareness)
```

### Storage Abstraction (DIP — agent-manager must not depend on Mongo)

The `@ping/agent-manager` package defines **interfaces**. The `@ping/backend` package provides **implementations**.

```
@ping/agent-manager (interfaces):
  ITaskService { createTasks, updateStatus, getByGoal, getByTeam, clearByGoal }
  IGoalService { createGoal, updateStatus, getGoal, getGoals }

@ping/backend (implementations):
  MongoTaskService implements ITaskService
  MongoGoalService implements IGoalService
  SqliteTaskService implements ITaskService  (local dev mode)
  SqliteGoalService implements IGoalService  (local dev mode)

Injection:
  AgentManagerV2 constructor receives ITaskService + IGoalService
  → passes to GoalManager
  → GoalManager calls interface methods, never knows about Mongo
```

This preserves:
- `@ping/agent-manager` has zero dependency on `@ping/backend` or MongoDB
- Local SQLite mode continues to work
- Cloud MongoDB mode works with the same GoalManager code
- Tests can inject mock `ITaskService`

## Implementation Steps

### Step 1: Define Storage Interfaces

Create interfaces in `@ping/agent-manager`:

```typescript
// packages/agent-manager/src/orchestrator/contracts/ITaskService.ts
export interface ITaskService {
  createTasks(goalId: string, teamId: string, tasks: TaskData[]): Promise<void>;
  updateStatus(taskId: string, status: string, output?: unknown): Promise<void>;
  getByGoal(goalId: string): Promise<TaskData[]>;
  getByTeam(teamId: string): Promise<TaskData[]>;
  clearByGoal(goalId: string): Promise<void>;
}

// packages/agent-manager/src/orchestrator/contracts/IGoalService.ts
export interface IGoalPersistence {
  createGoal(goal: GoalData): Promise<void>;
  updateGoalStatus(goalId: string, status: string, patch?: Partial<GoalData>): Promise<void>;
  getGoal(goalId: string): Promise<GoalData | null>;
  getGoals(teamId: string): Promise<GoalData[]>;
}
```

**Files:** New `contracts/ITaskService.ts`, `contracts/IGoalService.ts` in agent-manager

### Step 2: Implement MongoDB Services

Create implementations in `@ping/backend`:

- [ ] `MongoTaskService implements ITaskService` — bulk insert, updateOne, find, deleteMany
- [ ] Enhance existing `MongoGoalService` to implement `IGoalPersistence`
- [ ] Task schema:
  ```
  { id, goalId, teamId, title, description, status, assignedRole,
    priority, output, prerequisites, branchName, branchStatus,
    createdAt, updatedAt }
  Indexes: { goalId }, { teamId, status }, { id: 1 } (unique)
  ```
- [ ] Enhance Goal schema: add `repoUrl`, `repoBranch`, `planId`, `taskCount`, `completedCount`
- [ ] Register in `ServiceRegistry` alongside existing chat/goals services

**Files:** New `MongoTaskService.ts`, new `TaskSchema.ts`, modify `GoalSchema.ts`, modify `ServiceRegistry.ts`

### Step 3: Inject Services into AgentManager

- [ ] `AgentManagerV2` constructor accepts `ITaskService` + `IGoalPersistence` (optional — graceful degradation)
- [ ] Passes to `GoalManager` constructor
- [ ] `SocketServerV2.loadTeam()` resolves services from `ServiceRegistry`, passes to `AgentManagerV2`

**Files:** AgentManagerV2.ts, GoalManager.ts constructors, SocketServerV2.ts team loading

### Step 4: Wire Write-Through (Dual-Write Phase)

Replace CRDT calls with interface calls. Keep existing CRDT+File writes temporarily for safety.

- [ ] On `approvePlan(goalId)`: `await taskService.createTasks(goalId, teamId, tasks)`
- [ ] On every task status change (ALL paths from audit): `await taskService.updateStatus(taskId, status, output?)`
- [ ] On goal state transitions: `await goalService.updateGoalStatus(goalId, status)`
- [ ] On goal creation (first message): `await goalService.createGoal({ goalId, teamId, ... })`
- [ ] On replan: `await taskService.clearByGoal(goalId)`

**Critical: cover ALL mutation paths, not just the obvious 4:**
```typescript
// Every TaskStore.create/updateStatus/completeTask call must also call:
if (taskService) await taskService.updateStatus(taskId, newStatus, output);
```

**Files:** GoalManager.ts (add interface calls alongside existing CRDT/File calls)

### Step 5: Startup Recovery from Database

- [ ] `GoalManager.loadFromDb()`:
  ```typescript
  const goals = await goalService.getGoals(teamId);
  for (const g of goals.filter(g => g.status === "executing" || g.status === "awaiting_approval")) {
    const tasks = await taskService.getByGoal(g.goalId);
    // in_progress → ready (workers can't be recovered)
    // Hydrate TaskStore + GoalContext
  }
  ```
- [ ] Call `loadFromDb()` in `AgentManagerV2.initializeOrchestrator()` before plugin init
- [ ] Falls back to old `loadActivePlan()` if database has no goals (transition period)

**Files:** GoalManager.ts (new method), AgentManagerV2.ts (call on init)

### Step 6: Restore Endpoint from Database

- [ ] Return goals from `IGoalService.getGoals(teamId)` (not `manager.getAllGoalSummaries()`)
- [ ] Return tasks from `ITaskService.getByGoal(goalId)` (not in-memory TaskStore)
- [ ] Active execution state (sessions, workers, streams) still from in-memory manager
- [ ] Merge: database provides list + history, in-memory provides real-time overlay

**Files:** HttpServer.ts (restore endpoint)

### Step 7: Eliminate Old Stores

Only after dual-write phase confirms database writes are correct:

- [ ] Remove `CrdtTaskSync.persistTask/syncStatus/syncPlanStatus/updateIndex/loadAllTasks` calls
- [ ] Remove `CrdtGoalStore.saveGoal/updateStatus` calls → delete `CrdtGoalStore.ts`
- [ ] Remove `FilePlanStore.savePlan/archivePlan/updatePlanStatus` calls
- [ ] Remove `FileTaskStore.addTask/updateStatus/setOutput/flush` calls
- [ ] Remove `loadActivePlan()` recovery path (replaced by `loadFromDb()`)
- [ ] Rename `CrdtTaskSync.ts` → `CrdtCollabDocs.ts` (keep `initCollabDocs`, `persistPlan`)

**Files:** GoalManager.ts (remove old calls), CrdtTaskSync.ts → CrdtCollabDocs.ts, delete CrdtGoalStore.ts

## Files Changed Summary

| File | Change |
|------|--------|
| `agent-manager/src/orchestrator/contracts/ITaskService.ts` | **New** — interface |
| `agent-manager/src/orchestrator/contracts/IGoalService.ts` | **New** — interface |
| `backend/services/mongo/MongoTaskService.ts` | **New** — MongoDB implementation |
| `backend/services/mongo/schemas/TaskSchema.ts` | **New** — task schema |
| `backend/services/mongo/MongoGoalService.ts` | Modify — implement IGoalPersistence |
| `backend/services/mongo/schemas/GoalSchema.ts` | Modify — add fields |
| `backend/services/ServiceRegistry.ts` | Modify — register task service |
| `agent-manager/src/orchestrator/GoalManager.ts` | Major — inject services, wire write-through, loadFromDb |
| `agent-manager/src/AgentManagerV2.ts` | Modify — accept + pass services |
| `backend/api/SocketServerV2.ts` | Modify — pass services to AgentManager |
| `backend/api/HttpServer.ts` | Modify — restore from database |
| `collaboration/src/L2/CrdtTaskSync.ts` | Reduce → CrdtCollabDocs |
| `collaboration/src/L2/CrdtGoalStore.ts` | **Delete** |
| `agent-manager/src/persistence/FilePlanStore.ts` | **Remove usage** |
| `agent-manager/src/persistence/FileTaskStore.ts` | **Remove usage** |
| `frontend/services/AgentServiceV2.ts` | Modify — goalId in actions (v2.5) |
| `frontend/stores/goalSessionStore.ts` | Modify — pass goalId (v2.5) |

## Migration Path

```
v2.5: Fix multi-goal bug (goalId explicit) — no persistence changes
  ↓
Step 1: Define interfaces — no runtime changes
  ↓
Step 2: Create implementations — additive, no existing data affected
  ↓
Step 3: Inject services — optional, graceful degradation if null
  ↓
Step 4: Dual-write — write to BOTH old stores AND database
  ↓
Step 5: Startup recovery — read from database, fallback to old path
  ↓
Step 6: Restore from database — read goals/tasks from DB
  ↓
Step 7: Remove old stores — only after confirming database works
```

Each step is independently deployable. No big bang.

## Testing

1. Submit goal → saved to database immediately (not just on approval)
2. Approve plan → tasks in database with correct goalId
3. Task completes → database status = "completed"
4. Server restart → goals + tasks restored from database
5. Replan → old tasks cleared, new tasks created
6. Multi-goal → Goal A and Goal B have separate tasks (requires v2.5 first)
7. Local mode (SQLite) → same behavior, different implementation
8. CRDT unavailable → workflows still work (CRDT only for discussions)
9. Dynamic task creation (add_tasks tool) → persisted through ITaskService
10. Manual task complete (user clicks) → persisted through ITaskService

## Rollback

Steps 2-4 are additive. To rollback: remove interface calls from GoalManager, system reverts to CRDT+File persistence. Old stores were still receiving writes during dual-write phase — no data loss.
