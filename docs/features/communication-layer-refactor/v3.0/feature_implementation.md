# v3.0 — Implementation Tracking

> **Status:** In progress
> **Planning:** [feature_implementation_planning.md](./feature_implementation_planning.md)

## Progress

| Step | Description | Status | Notes |
|------|------------|--------|-------|
| 1 | ITaskPersistence interface | Done | `agent-manager/src/orchestrator/contracts/ITaskPersistence.ts` |
| 2 | MongoTaskService + TaskSchema | Done | `backend/services/mongo/MongoTaskService.ts`, `schemas/TaskSchema.ts`. Compound (teamId, taskId) unique index. SQLite stub for local mode. |
| 3 | GoalService goalId fix | Done | `MongoGoalService` persists goalId, updates by goalId field |
| 4 | Inject into GoalManager | Done | `GoalManagerConfig.taskPersistence` → `OrchestratorService` → `GoalManager`. Wired from `AgentManagerRegistry.setTaskPersistence()` |
| 5 | Dual-write ALL mutation paths | Done | 14 paths: approvePlan, clearByGoal, onTaskReady/Complete/Failed, dependency cascade (fail+skip), requestTaskTool, add_tasks, remove_task, update_task, reprioritize, reassign_task, replan (discard), completeTaskByUser |
| 6 | Startup recovery from DB | Done | `GoalManager.loadFromDatabase()` — hydrates TaskStore + GoalContext, resets in_progress→ready, falls back to loadActivePlan if DB empty |
| 7 | Restore endpoint DB fallback | Done | `HttpServer.ts` — falls back to `ITaskPersistence.getTasksByGoal()` when in-memory TaskStore empty |

## Remaining

- [ ] SQLite task persistence (local dev — currently no-op stub)
- [ ] Remove CRDT/File task persistence after confirming DB path works

## Out of Scope (v3.0)

- Full GoalContext persistence (planner agents, chat agents, conversation history are not serializable — they are re-created on demand)
- DB-primary restore (live execution uses in-memory TaskStore as authoritative; DB is the recovery source after restart)
