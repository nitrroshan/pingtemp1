# Task 003: RoleTaskQueue → Direct Callbacks

**Status:** `not-started`  
**Depends on:** task-001  
**Estimated:** 3-4 hours  
**Branch:** `feature/event-refactor`

## Description
Replace `RoleTaskQueue`'s EventEmitter with direct callbacks. Only OrchestratorService listens to task lifecycle events — events are overkill for one-to-one communication. Direct calls give full stack traces and zero listener management overhead.

## Acceptance Criteria
- [ ] `RoleTaskQueue.events` EventEmitter removed
- [ ] `TaskCallbacks` interface created: `onTaskReady`, `onTaskComplete`, `onTaskFailed`
- [ ] RoleTaskQueue constructor accepts `TaskCallbacks`
- [ ] All `this.events.emit("task:available", ...)` replaced with `this.callbacks.onTaskReady?.()`
- [ ] All `this.events.emit("task:complete", ...)` replaced with `this.callbacks.onTaskComplete?.()`
- [ ] MemoryManager passes callbacks from OrchestratorService into RoleTaskQueue
- [ ] All `events.on(...)` subscriptions removed
- [ ] All `.removeListener()` / `.removeAllListeners()` calls removed
- [ ] Task lifecycle works: DAG dependencies resolve, tasks become ready
- [ ] Golden path passes

## Implementation Notes
- File: `packages/backend/util/RoleTaskQueue.ts` — remove EventEmitter, add callbacks
- File: `packages/backend/memoryManager/MemoryManager.ts` — pass callbacks through
- File: `packages/backend/orchestrator/OrchestratorService.ts` — provide callbacks
- File: `packages/backend/agentManager/AgentManagerV2.ts` — wire callbacks at construction

**Pattern:**
```typescript
interface TaskCallbacks {
  onTaskReady?: (role: string, taskId: string) => void;
  onTaskComplete?: (taskId: string, output: any) => void;
  onTaskFailed?: (taskId: string, error: string) => void;
}

class RoleTaskQueue {
  constructor(private callbacks: TaskCallbacks = {}) {}
  
  markComplete(taskId: string, output: any) {
    // Update internal state...
    this.callbacks.onTaskComplete?.(taskId, output);
  }
}
```

## Code TODOs
- `packages/backend/util/RoleTaskQueue.ts` — TODO(task-003): Replace EventEmitter with callbacks
- `packages/backend/memoryManager/MemoryManager.ts` — TODO(task-003): Pass callbacks to RoleTaskQueue

## Testing
- Create plan with dependencies → verify tasks become ready in correct order
- Complete a task → verify dependent tasks become ready
- Fail a task → verify failure callback fires
- Golden path: goal → plan → approve → execute → done
