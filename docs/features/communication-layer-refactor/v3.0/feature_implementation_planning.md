# v3.0 — Backend Persistence

## Branch
`feature/v3-persistence`

## Scope
Tasks persist to MongoDB via dual-write. Goal metadata persists with goalId. On restart, tasks recover from DB; in_progress tasks reset to ready. Full GoalContext (planner, chat agents) is NOT serializable — only task data + minimal goal shell are recovered.

## Prerequisites (Complete)
- [x] v2.5 goalId explicit everywhere
- [x] Frontend sends goalId with every action
- [x] Workspace isolation uses goalId, not planId
- [x] Restore endpoint uses goal-scoped pending plan

## Implementation Status

**Done:**
- ITaskPersistence interface (agent-manager, DIP)
- MongoTaskService + TaskSchema (compound teamId+taskId unique index)
- GoalService goalId fix (persists goalId, updates by goalId field)
- Injection chain: ServiceRegistry → AgentManagerRegistry → AgentManagerV2 → OrchestratorService → GoalManager
- Dual-write on ALL 14 mutation paths (fire-and-forget with error logging)
- Startup recovery: `loadFromDatabase()` hydrates TaskStore + GoalContext, resets in_progress→ready
- Restore endpoint: DB fallback when in-memory TaskStore empty
- taskPersistence wired through OrchestratorContext → PlanMutationContext → tools

**Remaining:**
- [ ] SQLite task persistence (local dev — currently no-op stub)
- [ ] Remove CRDT/File task persistence after confirming DB path works

## Design Decisions

**Restore strategy:** During live execution, in-memory TaskStore is authoritative. The restore endpoint serves live state first, DB fallback second. After restart, `loadFromDatabase()` is the primary recovery source, with `loadActivePlan()` as legacy fallback. This is the intended two-mode design — not a gap.

**GoalContext recovery is minimal:** Planner agents, chat agents, and conversation history can't be serialized. On restart, only task data + basic goal metadata are restored. Planners are re-created when the user interacts.

**Fire-and-forget writes:** All DB writes are async with error logging. They don't block the task execution loop. If DB is down, execution continues and CRDT/File stores provide fallback.

## Rollback
Each step was independently deployable. Revert by removing taskPersistence injection from GoalManagerConfig.
