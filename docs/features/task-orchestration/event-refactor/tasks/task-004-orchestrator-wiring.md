# Task 004: OrchestratorService Callback Wiring

**Status:** `not-started`  
**Depends on:** task-003  
**Estimated:** 2-3 hours  
**Branch:** `feature/event-refactor`

## Description
Wire OrchestratorService's task lifecycle methods as direct callbacks injected via constructor. Replace all `memoryManager.on(...)` event subscriptions with constructor-injected arrow functions. Remove all `.bind(this)` patterns (memory leak risk).

## Acceptance Criteria
- [ ] OrchestratorService provides `{ onTaskReady, onTaskComplete, onTaskFailed }` callbacks
- [ ] Callbacks are arrow functions (no `.bind(this)` needed)
- [ ] All `memoryManager.on("task:available", ...)` subscriptions removed
- [ ] All `memoryManager.on("task:complete", ...)` subscriptions removed
- [ ] AgentManagerV2 wires callbacks at construction time
- [ ] No `.bind(this)` anywhere in the callback chain
- [ ] Full stack traces work on every task state change
- [ ] Golden path passes

## Implementation Notes
- File: `packages/backend/orchestrator/OrchestratorService.ts` — remove event subscriptions, expose callbacks
- File: `packages/backend/agentManager/AgentManagerV2.ts` — wire callbacks in constructor/init

**Pattern:**
```typescript
// In AgentManagerV2 setup:
const taskCallbacks: TaskCallbacks = {
  onTaskReady: (role, taskId) => this.orchestrator.wakeWorker(role, taskId),
  onTaskComplete: (taskId, output) => this.orchestrator.handleTaskComplete(taskId, output),
  onTaskFailed: (taskId, error) => this.orchestrator.handleTaskFailed(taskId, error),
};

// Passed into MemoryManager → RoleTaskQueue
this.memoryManager = new MemoryManager(taskCallbacks);
```

## Code TODOs
- `packages/backend/orchestrator/OrchestratorService.ts` — TODO(task-004): Remove event subscriptions
- `packages/backend/agentManager/AgentManagerV2.ts` — TODO(task-004): Wire callbacks at construction

## Testing
- Submit goal → plan created → approve → tasks dispatched via callback (not event)
- Task completes → dependent tasks wake up via callback chain
- Verify full stack trace is visible on task state changes (no swallowed errors)
- Golden path: goal → plan → approve → execute → done
