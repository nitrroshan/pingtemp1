# GoalManager Extraction — Feature Architecture

> **Status:** Approved  
> **ID:** A12  
> **Depends on:** Chat Agent Layer (Phase 1 ✅), Git Task Context (Phase 3 ✅)  
> **Blocks:** A11 Parallel Plans v1.0 (Phase 4)  
> **Principle:** SRP — extract goal lifecycle from OrchestratorService before adding multi-goal support

## Problem

OrchestratorService is 1300 lines doing 4 jobs: goal lifecycle, task dispatch, planner communication, and state queries. Phase 4 (Parallel Plans) replaces 7 scalar fields with `Map<goalId, GoalContext>` which would push the file to 1800+ lines with interleaved concerns.

**Extracting GoalManager now** (single-goal, same behavior) makes the Phase 4 refactor surgical: GoalManager gains a Map, OrchestratorService doesn't change.

## Current State: OrchestratorService Method Audit

28 methods categorized:

| Category | Methods | Properties | What it does |
|----------|---------|------------|-------------|
| **GOAL_LIFECYCLE** | 8 | 2 | Goal state, plan approval, completion detection, failure cascade, restart |
| **TASK_DISPATCH** | 8 | 5 | Concurrency, worker spawn, ChatAgent routing, retry |
| **PLANNER_COMMS** | 5 | 3 | User messages, planner notifications, serialization |
| **STATE_QUERY** | 7 | 3 | Getters/setters for tools and AgentManager |

### What Moves to GoalManager

| Method | Category | Why it's goal lifecycle |
|--------|----------|----------------------|
| `approvePlan()` | GOAL | Plan approval = goal state transition |
| `onTaskComplete()` | GOAL | Detects goal completion |
| `onTaskFailed()` | GOAL | Failure handling within a goal |
| `onWorkerDone()` | GOAL | Worker completion → goal state check |
| `handleTaskFailure()` | GOAL | Dependency cascade within a goal |
| `onTaskReady()` | GOAL | Task ready → route to dispatcher |
| `reset()` / `resetPlan()` / `interruptPlan()` | GOAL | Goal state management |
| `loadActivePlan()` | GOAL | Restart recovery |
| `getPendingPlan()` / `setPendingPlan()` | GOAL | Plan state |
| `getCurrentGoalId()` | GOAL | Goal tracking |

**Properties that move:** `currentGoalId`, `pendingPlan`, `state` (per-goal in Phase 4)

### What Stays in OrchestratorService

| Method | Category | Why it stays |
|--------|----------|-------------|
| `dispatchTask()` | DISPATCH | Worker spawn + context enrichment |
| `directDispatchTask()` | DISPATCH | ChatAgent bypass |
| `manualDispatch()` | DISPATCH | User-triggered dispatch |
| `dispatchReadyTasks()` | DISPATCH | Bulk dispatch |
| `drainDeferredDispatches()` | DISPATCH | Deferred queue processing |
| `spawnCollabWorkers()` | DISPATCH | Discussion workers |
| `onPlanMutation()` | DISPATCH | Mutation → dispatch trigger |
| `setChatAgentDispatch()` | DISPATCH | ChatAgent routing setup |
| `handleMessage()` / `_handleMessage()` | COMMS | Routes to GoalManager's planner |
| `notifyPlanner()` / `notifyPlannerFromRole()` | COMMS | Delegates to GoalManager |
| All state getters | QUERY | Facade for tools/AgentManager |

**Properties that stay:** `activeDispatches`, `deferredDispatches`, `taskAttempts`, `messageChain`, `callbacks`

## Architecture

```
BEFORE:
  AgentManagerV2
    └── OrchestratorService (1300 lines, 4 concerns mixed)
        ├── Goal lifecycle
        ├── Task dispatch
        ├── Planner comms
        └── State queries

AFTER:
  AgentManagerV2
    └── OrchestratorService (~900 lines — dispatch + comms + queries)
        ├── Task dispatch
        ├── Planner comms (routes to GoalManager's planner)
        ├── State queries
        └── goalManager: IGoalManager ← injected dependency
    └── GoalManager (~400 lines — goal lifecycle)
        ├── GoalContext (single for now, Map in Phase 4)
        ├── Plan approval + task creation
        ├── Completion detection + failure cascade
        ├── State management (reset, interrupt)
        └── Restart recovery
```

### IGoalManager Interface

```typescript
interface IGoalManager {
  // Goal state
  getGoalId(): string | null;
  getState(): OrchestratorState;
  setState(state: OrchestratorState): void;

  // Plan lifecycle
  getPendingPlan(): AgentPlanOutput | null;
  setPendingPlan(plan: AgentPlanOutput | null): void;
  approvePlan(): Promise<{ success: boolean; tasksQueued?: number; error?: string }>;

  // Task lifecycle callbacks (wired from TaskStore/WorkerPool)
  onTaskReady(data: { taskId: string; role: string }): void;
  onTaskComplete(data: { taskId: string; output: any }): void;
  onTaskFailed(data: { taskId: string; error: string }): void;
  onWorkerDone(data: WorkerDonePayload): Promise<void>;
  handleTaskFailure(taskId: string, reason: string): void;

  // State management
  reset(): void;
  resetPlan(): Promise<void>;
  interruptPlan(): Promise<void>;
  loadActivePlan(): Promise<void>;

  // Dispatch hook — GoalManager tells OrchestratorService to dispatch
  setDispatchHook(hook: (taskId: string, role: string) => Promise<void>): void;
}
```

### Dependency Direction

```
OrchestratorService → IGoalManager (depends on interface)
GoalManager implements IGoalManager
GoalManager → TaskStore (injected)
GoalManager → DependencyResolver (injected)
GoalManager → PluginRegistry (injected)
GoalManager → dispatch hook callback (set by OrchestratorService)

OrchestratorService DOES NOT depend on GoalManager (concrete).
GoalManager DOES NOT depend on OrchestratorService.
Communication: GoalManager calls dispatch hook; OrchestratorService calls IGoalManager methods.
```

### How They Communicate

```
User message → OrchestratorService.handleMessage()
  → delegates to GoalManager for state checks
  → calls planner via callbacks

Planner calls submit_plan → GoalManager.setPendingPlan()

User approves → OrchestratorService calls GoalManager.approvePlan()
  → GoalManager creates tasks in TaskStore
  → GoalManager calls dispatchHook for ready tasks
  → OrchestratorService.dispatchTask() handles actual dispatch

Worker completes → OrchestratorService catches event
  → calls GoalManager.onWorkerDone()
  → GoalManager checks completion, cascades dependencies
  → GoalManager calls dispatchHook for newly ready tasks
  → GoalManager checks isAllComplete → fires onGoalComplete callback
```

## Why Now (Not During Phase 4)

1. **Single-goal extraction is a pure refactor** — same behavior, same tests, just different file organization. No new features, no new state.
2. **Phase 4 becomes additive** — GoalManager gains `Map<goalId, GoalContext>`, `getOrCreateGoal()`, execution mutex. OrchestratorService barely changes.
3. **Risk isolation** — if the extraction breaks something, we know it's the split, not multi-goal logic. If Phase 4 breaks something, we know it's multi-goal logic, not the split.
4. **Reviewable** — 400-line GoalManager is easier to review than a 1800-line OrchestratorService.

## Scope

**In scope:**
- Extract GoalManager class from OrchestratorService
- Move 8 lifecycle methods + 2 properties
- IGoalManager interface
- Dispatch hook pattern (GoalManager → OrchestratorService callback)
- Wire in AgentManagerV2

**Not in scope:**
- Multi-goal (`Map<goalId, GoalContext>`) — that's Phase 4
- Per-goal planners — that's Phase 4
- Per-goal ChatAgents — that's Phase 4
- New features or behavior changes

## Estimated Effort: 2-3 days

| Step | What | Effort |
|------|------|--------|
| 1 | Define `IGoalManager` interface in types.ts | 0.5d |
| 2 | Create GoalManager class, move lifecycle methods | 1.5d |
| 3 | Refactor OrchestratorService to delegate to GoalManager | 0.5d |
| 4 | Wire in AgentManagerV2, verify build + existing behavior | 0.5d |
