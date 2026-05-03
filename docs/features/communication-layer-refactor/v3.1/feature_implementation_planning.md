# v3.1 — Persistence Cleanup + Scoping

## Branch
`feature/v3.1-persistence-cleanup`

## Scope
Remove redundant CRDT/File task persistence (v3.0 dual-write confirmed). Scope task updates by goalId. SQLite task persistence for local dev.

## Prerequisites
- [x] v3.0 MongoDB dual-write confirmed (14 mutation paths, verified in Compass)
- [x] v3.0 startup recovery from DB confirmed
- [x] v3.0 goal metadata recovery via goalLookup confirmed

## Steps

- [ ] **Step 1: Remove FileTaskStore (10 references)**
  - `AgentManagerV2.ts` L32: remove import
  - `AgentManagerV2.ts` L72: remove field declaration
  - `AgentManagerV2.ts` L134-135: remove creation + load
  - `AgentManagerV2.ts` L691, L743, L815, L816, L1030: remove 5 write calls
  - `AgentManagerV2.ts` L1196-1197: remove flush block

- [ ] **Step 2: Remove CRDT task write blocks (9 blocks in GoalManager.ts)**
  - Block 1 (L480-487): `approvePlan` persistTask + updateIndex → remove entire `if (crdtSync?.persistTask)` block
  - Block 2 (L521-528): `approvePlan` CrdtGoalStore saveGoal + updateStatus → remove entire `if (crdtGoalStore)` block
  - Block 3 (L754-759): `onTaskFailed` syncStatus + updateIndex → remove entire `if (crdtSync)` block
  - Block 4 (L840-851): `onWorkerDone` discussion auto-close → KEEP (this is collaboration, not task persistence)
  - Block 5 (L886-896): `onWorkerDone` completion sync → remove entire `if (crdtSyncDone)` block
  - Block 6 (L646-649): `onTaskComplete` plan status sync → remove entire `if (crdtSyncComplete?.syncPlanStatus)` block
  - Block 7 (L922): `resetPlan` plan status → remove CRDT call
  - Block 8 (L944): `interruptPlan` plan status → remove CRDT call
  - Block 9 (L1089-1105): `loadActivePlan` CRDT recovery → KEEP (fallback during transition)

- [ ] **Step 3: Remove loadActivePlan fallback**
  - `OrchestratorService.ts` L264: remove `await this.goalManager.loadActivePlan()` call
  - DB recovery via `loadFromDatabase()` is primary now
  - Keep `loadActivePlan()` method as dead code initially; delete after confirming production recovery

- [ ] **Step 4: Scope updateTaskStatus by goalId**
  - `ITaskPersistence.ts`: `updateTaskStatus(taskId, goalId, status, output?)`
  - `MongoTaskService.ts`: filter `{ taskId, goalId }` instead of `{ taskId }`
  - Update all 14+ call sites: `GoalManager.ts` (persistTaskStatus helper), `AgentManagerV2.ts` (completeTaskByUser), `planMutationTools.ts` (remove/update/reprioritize/reassign), `requestTaskTool.ts`

- [ ] **Step 5: SQLite task persistence**
  - New: `backend/services/sqlite/SqliteTaskService.ts` implements `ITaskPersistence`
  - Table: `tasks (taskId, goalId, teamId, title, description, status, assignedRole, priority, output, planId, dependencies, createdAt, updatedAt)`
  - Unique: `(teamId, taskId)`
  - Replace no-op stub in `ServiceRegistry.ts` L87-93

## Rollback
Steps 1-3 revert by restoring deleted blocks. Step 4 is interface change — revert all call sites. Step 5 is additive.
