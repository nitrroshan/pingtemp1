# v3.0 — Backend Persistence

## Branch
`feature/v3-persistence`

## Scope
Task and goal state survives server restart via MongoDB write-through. CRDT stays for collaborative docs only. File stores eliminated.

## Prerequisites (Complete)
- [x] v2.5 goalId explicit everywhere (done — zero getCurrentGoalId in action handlers)
- [x] Frontend sends goalId with every action (done — emitAction includes goalId)
- [x] Workspace isolation uses goalId, not planId (done — per-task lookup, goalId-keyed directories)

## Current State

**Persisted to database:** Goals (MongoGoalService), Chat messages (MongoChatService). Both have SQLite fallback.

**NOT persisted (lost on restart):** Tasks (in-memory Map), GoalContext state, dependency DAG, worker agents, dispatch queue.

**File-based (stale):** FileTaskStore (debounced, never updated during execution), FilePlanStore (structure only), CrdtTaskSync (async, errors swallowed), CrdtGoalStore.

**Key gaps:** No ITaskPersistence interface in agent-manager. No MongoTaskService or TaskSchema. GoalManager constructor has no database injection point. AgentManagerV2 has zero-arg constructor.

## Steps

- [ ] **Step 1: Define ITaskPersistence in agent-manager**
  - New: `agent-manager/src/orchestrator/contracts/ITaskPersistence.ts`
  - Methods: `saveTasks`, `updateTaskStatus`, `getTasksByGoal`, `getTasksByTeam`, `clearTasksByGoal`

- [ ] **Step 2: Create MongoTaskService + TaskSchema**
  - New: `backend/services/mongo/MongoTaskService.ts`, `schemas/TaskSchema.ts`
  - Schema: `{ taskId, goalId, teamId, title, description, status, assignedRole, priority, output, planId, createdAt, updatedAt }`
  - New: `backend/services/sqlite/SqliteTaskService.ts`
  - Register in ServiceRegistry as `tasks`

- [ ] **Step 3: Enhance GoalSchema**
  - Add: `repoUrl`, `repoBranch`, `planId`, `taskCount`, `completedCount`, `state`
  - MongoGoalService: add goalId-based lookup (current uses _id)

- [ ] **Step 4: Inject into GoalManager**
  - GoalManagerConfig: add `taskPersistence?: ITaskPersistence`
  - AgentManagerV2: resolve from ServiceRegistry, pass to GoalManager
  - Wire: SocketServerV2 → AgentManagerV2 → GoalManager

- [ ] **Step 5: Wire write-through on ALL mutation paths**
  - approvePlan → saveTasks
  - onTaskComplete/Failed/Ready → updateTaskStatus
  - planMutationTools (add_tasks, remove_task, replan) → saveTasks/clearTasksByGoal
  - requestTaskTool → saveTasks
  - handleCompleteTask/CancelTask → updateTaskStatus
  - All fire-and-forget with error logging

- [ ] **Step 6: Startup recovery**
  - GoalManager.loadFromDatabase() — hydrate GoalContext + TaskStore from DB
  - in_progress tasks → reset to ready (workers unrecoverable)
  - Fallback to loadActivePlan() during transition

- [ ] **Step 7: Restore endpoint from database**
  - HttpServer restore: tasks from ITaskPersistence.getTasksByGoal instead of in-memory TaskStore

## Rollback
Each step independently deployable. Step 5 is dual-write. Revert by removing taskPersistence injection.
