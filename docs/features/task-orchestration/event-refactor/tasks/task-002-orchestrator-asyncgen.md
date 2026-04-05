# Task 002: OrchestratorService → AsyncGenerator

**Status:** `not-started`  
**Depends on:** task-001  
**Estimated:** 2-3 hours  
**Branch:** `feature/event-refactor`

## Description
Change `OrchestratorService.handleMessage()` to return `AsyncGenerator<AgentEvent>`. Replace `this.events.emit("worker:stream", ...)` with `yield*` from the agent generator. SocketServerV2 iterates the orchestrator generator directly instead of subscribing to events.

## Acceptance Criteria
- [ ] `handleMessage()` returns `AsyncGenerator<AgentEvent>`
- [ ] `executeAgent()` uses `yield*` instead of `events.emit()`
- [ ] OrchestratorService no longer emits on any EventEmitter
- [ ] SocketServerV2 `handleOrchestratorMessage()` iterates directly
- [ ] Orchestrator streaming works (planner output streams to frontend)
- [ ] Golden path passes

## Implementation Notes
- File: `packages/backend/orchestrator/OrchestratorService.ts`
- File: `packages/backend/api/SocketServerV2.ts` (consumer changes)

**Pattern:**
```typescript
// Before:
async handleMessage(message: string): Promise<string> {
  // ... calls executeAgent which emits events
}

// After:
async *handleMessage(message: string): AsyncGenerator<AgentEvent> {
  // ... yields from executeAgent
  yield* this.executeAgent(message);
}

async *executeAgent(message: string): AsyncGenerator<AgentEvent> {
  for await (const event of agent.execute(message)) {
    yield event;  // instead of this.events.emit(...)
  }
}
```

## Code TODOs
- `packages/backend/orchestrator/OrchestratorService.ts` — TODO(task-002): Convert to AsyncGenerator
- `packages/backend/api/SocketServerV2.ts` — TODO(task-002): Iterate orchestrator generator

## Testing
- Send a message → verify orchestrator streams plan creation to frontend
- Verify tool calls (create_plan, approve_plan) still work within the generator
- Golden path: goal → plan → approve → execute → done
