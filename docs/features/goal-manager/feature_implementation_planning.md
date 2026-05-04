# GoalManager Extraction — Implementation Plan

> **Parent:** [Feature Architecture](feature_architecture.md)  
> **Status:** Ready to implement  
> **Branch:** `feature/goal-manager`  
> **ID:** A12  
> **Depends on:** Chat Agent Layer (Phase 1 ✅), Git Task Context (Phase 3 ✅)  
> **Blocks:** A11 Parallel Plans v1.0 (Phase 4)

## Scope

Pure SRP refactor. Extract goal lifecycle methods from OrchestratorService into GoalManager. **Zero behavior change** — same callbacks, same state transitions, same task flow. Just two files instead of one.

**In scope:** Move 10 methods + 3 properties. Define IGoalManager interface. Wire dispatch hook.
**Not in scope:** Multi-goal Map (Phase 4), per-goal planners (Phase 4), per-goal ChatAgents (Phase 4).

## Code Audit Summary

**OrchestratorService.ts: 1450 lines, 28 methods**

What moves to GoalManager (~400 lines):
- `approvePlan()` (L270-430, ~160 lines) — creates tasks, resolves CRDT, sets state
- `onTaskComplete()` (L688-768, ~80 lines) — detects goal completion, notifies planner
- `onTaskFailed()` (L822-900, ~78 lines) — failure handling, CRDT sync, cascade
- `onWorkerDone()` (L905-1010, ~105 lines) — plugin notify, merge, mark complete
- `handleTaskFailure()` (L770-820, ~50 lines) — dependency cascade
- `onTaskReady()` (L587-625, ~38 lines) — ready → dispatch routing
- `reset()` (L1405, 1 line)
- `resetPlan()` (L1407-1420, ~13 lines)
- `interruptPlan()` (L1422-1435, ~13 lines)
- `loadActivePlan()` (L1323-1400, ~77 lines) — restart recovery

Properties that move: `state`, `currentGoalId`, `pendingPlan`

What stays in OrchestratorService (~1050 lines):
- `initialize()` — wires callbacks (delegates lifecycle to GoalManager)
- `handleMessage()` / `_handleMessage()` — planner comms
- `dispatchTask()` (~250 lines) — worker spawn + context enrichment
- `directDispatchTask()`, `manualDispatch()` — dispatch variants
- `dispatchReadyTasks()`, `drainDeferredDispatches()` — concurrency
- `spawnCollabWorkers()` — discussion workers
- `onPlanMutation()` — mutation dispatch trigger
- `notifyPlanner()` / `notifyPlannerFromRole()` — planner notification
- All getters/setters — facade for tools/AgentManager

## Implementation Steps

### Step 1: IGoalManager interface + GoalManagerCallbacks (0.5 day)

**File:** `packages/agent-manager/src/orchestrator/types.ts`

```typescript
/** Callbacks GoalManager uses to communicate with OrchestratorService */
export interface GoalManagerCallbacks {
  /** Dispatch a ready task (GoalManager → OrchestratorService) */
  onDispatchTask: (taskId: string, role: string) => void;
  /** Notify planner (GoalManager → planner via OrchestratorService) */
  onNotifyPlanner: (message: string) => void;
  /** Forward to frontend */
  onTaskUpdate: OrchestratorCallbacks['onTaskUpdate'];
  onProgress: OrchestratorCallbacks['onProgress'];
  onGoalStatusChange: OrchestratorCallbacks['onGoalStatusChange'];
  onPlanApproved: OrchestratorCallbacks['onPlanApproved'];
  onWorkerTaskUpdate: OrchestratorCallbacks['onWorkerTaskUpdate'];
}

export interface IGoalManager {
  // State
  getState(): OrchestratorState;
  setState(state: OrchestratorState): void;
  getGoalId(): string | null;
  getPendingPlan(): any | null;
  setPendingPlan(plan: any | null): void;

  // Lifecycle
  approvePlan(): Promise<{ success: boolean; tasksQueued?: number; error?: string }>;
  onTaskReady(data: { taskId: string; role: string }): void;
  onTaskComplete(data: { taskId: string; output: any }): void;
  onTaskFailed(data: { taskId: string; error: string }): void;
  onWorkerDone(data: { taskId: string; role: string; summary: string; deliverables?: string[]; nextSteps?: string[]; timestamp: number }): Promise<void>;

  // State management
  reset(): void;
  resetPlan(): Promise<{ deleted: boolean; planId?: string }>;
  interruptPlan(): Promise<void>;
  loadActivePlan(): Promise<void>;
  dispose(): void;
}
```

### Step 2: Create GoalManager class (1.5 days)

**File:** `packages/agent-manager/src/orchestrator/GoalManager.ts` (NEW)

**Constructor receives:**
```typescript
constructor(config: {
  teamId: string;
  teamRoles: string[];
  taskStore: TaskStore;
  dagResolver: DependencyResolver;
  workerPool: WorkerPool;
  pluginRegistry?: PluginRegistry;
  planStore?: any;
  crdtTaskSyncProxy?: CrdtProxy;
  crdtGoalStoreProxy?: CrdtProxy;
  autoExecute: boolean;
  callbacks: GoalManagerCallbacks;
})
```

**Methods to move (copy from OrchestratorService, adapt `this.` references):**

Each method's changes:
- `this.callbacks.onTaskUpdate` → `this.callbacks.onTaskUpdate`  (same — callbacks passed in)
- `this.notifyPlanner(msg)` → `this.callbacks.onNotifyPlanner(msg)` (delegate out)
- `this.dispatchTask(id, role)` → `this.callbacks.onDispatchTask(id, role)` (delegate out)
- `this.chatAgentDispatch` → `this.callbacks.onDispatchTask` (GoalManager doesn't know about ChatAgent routing — OrchestratorService handles that in its dispatch hook)
- `this.activeDispatches` — stays in OrchestratorService. GoalManager's `onTaskReady()` just calls `callbacks.onDispatchTask()`; concurrency is OrchestratorService's concern.

**Key design: GoalManager doesn't manage concurrency.** It says "this task is ready, dispatch it." OrchestratorService decides HOW (direct, deferred, ChatAgent-routed).

### Step 3: Refactor OrchestratorService to delegate (0.5 day)

**File:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts`

**Changes:**
1. Add `private goalManager: GoalManager` field
2. Create GoalManager in constructor with dispatch hook wired
3. Replace lifecycle method bodies with `this.goalManager.methodName()` delegation
4. Remove moved properties (`state`, `currentGoalId`, `pendingPlan`) — delegate to goalManager
5. Update `initialize()` to wire TaskStore/WorkerPool callbacks to GoalManager

```typescript
// In constructor:
this.goalManager = new GoalManager({
  teamId, teamRoles, taskStore, dagResolver, workerPool,
  pluginRegistry, planStore, crdtTaskSyncProxy, crdtGoalStoreProxy,
  autoExecute,
  callbacks: {
    onDispatchTask: (taskId, role) => this.handleReadyTask(taskId, role),
    onNotifyPlanner: (msg) => this.notifyPlanner(msg),
    onTaskUpdate: config.callbacks?.onTaskUpdate,
    onProgress: config.callbacks?.onProgress,
    onGoalStatusChange: config.callbacks?.onGoalStatusChange,
    onPlanApproved: config.callbacks?.onPlanApproved,
    onWorkerTaskUpdate: config.callbacks?.onWorkerTaskUpdate,
  },
});

// New method: routes ready task through ChatAgent or direct dispatch
private handleReadyTask(taskId: string, role: string): void {
  if (!this.autoExecute) return;
  if (this.chatAgentDispatch) {
    this.chatAgentDispatch(taskId, role).catch(err => log.error(`ChatAgent dispatch error: ${err}`));
    return;
  }
  if (this.activeDispatches.size >= MAX_CONCURRENT_DISPATCHES) {
    this.deferredDispatches.push({ taskId, role });
    return;
  }
  this.activeDispatches.add(taskId);
  this.dispatchTask(taskId, role)
    .catch(err => log.error(`Dispatch error: ${err}`))
    .finally(() => { this.activeDispatches.delete(taskId); this.drainDeferredDispatches(); });
}

// Delegate getters:
getState() { return this.goalManager.getState(); }
getCurrentGoalId() { return this.goalManager.getGoalId(); }
getPendingPlan() { return this.goalManager.getPendingPlan(); }
setPendingPlan(plan: any) { this.goalManager.setPendingPlan(plan); }
approvePlan() { return this.goalManager.approvePlan(); }
reset() { this.goalManager.reset(); }
resetPlan() { return this.goalManager.resetPlan(); }
interruptPlan() { return this.goalManager.interruptPlan(); }

// In initialize():
this.taskStore.setQueueCallbacks({
  onTaskReady: (data) => this.goalManager.onTaskReady(data),
  onTaskComplete: (data) => this.goalManager.onTaskComplete(data),
  onTaskFailed: (data) => this.goalManager.onTaskFailed(data),
});
this.workerPool.setCallbacks({
  // ... stream callbacks stay on OrchestratorService
  onAgentComplete: (data) => this.goalManager.onWorkerDone(data),
  // ... other callbacks stay
});
```

### Step 4: Wire in AgentManagerV2 + verify build (0.5 day)

**File:** `packages/agent-manager/src/AgentManagerV2.ts`

- No changes needed if OrchestratorService's public API stays the same (it does — delegation is internal)
- Verify: `approvePlan()`, `handleMessage()`, `getState()`, `getCurrentGoalId()` all still work through the delegated interface
- Export GoalManager from package index if needed for Phase 4

**Build verification:**
```bash
bun run build:backend
```

## File Changes Summary

| File | Action | Lines |
|------|--------|-------|
| `orchestrator/types.ts` | EDIT — add IGoalManager, GoalManagerCallbacks | +40 |
| `orchestrator/GoalManager.ts` | NEW — extracted lifecycle class | ~400 |
| `orchestrator/OrchestratorService.ts` | EDIT — delegate to GoalManager, remove moved methods | -400, +30 |
| `orchestrator/index.ts` | EDIT — export GoalManager | +1 |

**Net: +70 lines** (400 new GoalManager - 400 removed from OrchestratorService + 70 interface/wiring)

## Testing

- Build passes with zero errors
- Existing functionality unchanged — same callbacks fire, same state transitions
- Manual test: submit goal → plan → approve → tasks execute → complete
- GoalManager methods are pure delegates — if OrchestratorService tests pass, GoalManager is correct

## Rollback

Revert the 4 files. OrchestratorService goes back to monolithic. No data migration, no config change.

## Estimated Total: 3 days
