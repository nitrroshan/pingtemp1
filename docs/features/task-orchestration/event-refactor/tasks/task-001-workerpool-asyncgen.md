# Task 001: WorkerPool → AsyncGenerator

**Status:** `not-started`  
**Estimated:** 4-6 hours  
**Branch:** `feature/event-refactor`

## Description
Change `WorkerPool.runTask()` from `Promise<void>` to `AsyncGenerator<AgentEvent>`. Remove `this.events.emit("worker:stream", ...)` and `this.events.emit("worker:event", ...)`. Instead, `yield` events. SocketServerV2 iterates the generator directly instead of subscribing to events. Remove `WorkerPool.events` EventEmitter entirely.

## Acceptance Criteria
- [ ] `runTask()` returns `AsyncGenerator<AgentEvent>`
- [ ] All `this.events.emit("worker:stream", ...)` replaced with `yield`
- [ ] All `this.events.emit("worker:event", ...)` replaced with `yield`
- [ ] `WorkerPool.events` EventEmitter removed
- [ ] SocketServerV2 iterates `runTask()` directly
- [ ] Side effects (task status updates, logging) happen before `yield` in generator body
- [ ] Streaming still works end-to-end (frontend receives stream_part events)
- [ ] Golden path passes

## Implementation Notes
- File: `packages/backend/services/WorkerPool.ts`
- File: `packages/backend/api/SocketServerV2.ts` (consumer changes)
- File: `packages/backend/agentManager/AgentManagerV2.ts` (if it accesses WorkerPool.events)

**Pattern:**
```typescript
// Before:
async runTask(taskId: string, ...): Promise<void> {
  for await (const event of agent.execute(...)) {
    this.events.emit("worker:stream", { ...event });
  }
}

// After:
async *runTask(taskId: string, ...): AsyncGenerator<AgentEvent> {
  for await (const event of agent.execute(...)) {
    // Side effects first
    this.updateTaskStatus(event);
    // Then yield to consumer
    yield event;
  }
}
```

## Code TODOs
- `packages/backend/services/WorkerPool.ts` — TODO(task-001): Convert runTask to AsyncGenerator
- `packages/backend/api/SocketServerV2.ts` — TODO(task-001): Iterate runTask generator directly

## Testing
- Stream a task execution → verify frontend receives all stream_part events
- Verify task status updates still happen (in_progress → completed/failed)
- Golden path: goal → plan → approve → execute → done
