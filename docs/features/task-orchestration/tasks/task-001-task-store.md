# Task 001: TaskStore (Single Writer)

**Status:** `not-started`
**Assignee:**
**Estimated:** 2 days
**Branch:** `feature/planner-as-agent`

## Description
Build the TaskStore — single-writer task CRUD with state machine enforcement. Replaces MemoryManager's flat prerequisite maps. Only the Orchestrator writes task state.

## Acceptance Criteria
- [ ] `orchestrator/TaskStore.ts` — `create()`, `get()`, `getAll()`, `updateStatus()`, `updateTask()`
- [ ] `orchestrator/types/taskTypes.ts` — `Task`, `TaskStatus`, `TaskDependency`, `DependencyType` (`blocks | informs`), `TaskOutput`
- [ ] State machine: `proposed → ready|pending → in_progress → completed|failed|cancelled|skipped`
- [ ] Invalid transitions throw (e.g., `completed → in_progress`)
- [ ] All writes go through `TaskStore.updateStatus()` — single writer enforced
- [ ] Storage: in-memory `Map<string, Task>` (backed by MongoDB/CRDT later)

## Implementation Notes
- Consumes types from A5 Task 001 (`plannerTypes.ts`), extends with `taskTypes.ts`
- State machine is strict — no shortcuts. Every transition validated.
- A5's DependencyResolver (Task 004) operates on TaskStore data

## Dependencies
- A5 Task 001 (types)

## Testing
- Unit: state machine transitions (all valid + all invalid), CRUD operations, concurrent write rejection
