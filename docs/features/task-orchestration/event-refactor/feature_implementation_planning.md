# Event Architecture Refactor — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 2 (post-streaming, pre-Phase 3)  
**Branch:** `feature/event-refactor`  
**Depends on:** Agentic Streaming (done), Task Orchestration (A6)

---

## Scope

Replace 3 EventEmitter layers with typed alternatives. Incremental — each step is independently shippable.

## Package Dependencies

None — all patterns use built-in language features (AsyncGenerator, callbacks). No new dependencies.

Socket.IO is the only event system and it already exists. Future services (cost tracking, audit, webhooks) hook into Socket.IO or direct callbacks — zero new infrastructure.

---

## Implementation Steps

### Step 1: WorkerPool → AsyncGenerator Pass-Through
**Files:** `WorkerPool.ts`, `SocketServerV2.ts`, `AgentManagerV2.ts`  
**Effort:** Medium  

Change `WorkerPool.runTask()` from `Promise<void>` to `AsyncGenerator<AgentEvent>`:
- Remove `this.events.emit("worker:stream", ...)` and `this.events.emit("worker:event", ...)`
- `yield` events instead — the consumer iterates
- Move side effects (task status, logging) into the generator body before yield
- SocketServerV2 `handleWorkerMessage()` iterates `runTask()` directly instead of subscribing to events
- Remove `WorkerPool.events` EventEmitter entirely

**Exit:** `worker:stream` and `worker:event` events replaced by generator iteration. No EventEmitter on WorkerPool. Streaming still works.

### Step 2: OrchestratorService → AsyncGenerator
**Files:** `OrchestratorService.ts`, `SocketServerV2.ts`  
**Effort:** Low  

`executeAgent()` already iterates the agent generator. Change it to `yield*` instead of `this.events.emit()`:
- Remove `this.events.emit("worker:stream", ...)` from executeAgent
- Return `AsyncGenerator<AgentEvent>` from `handleMessage()`
- SocketServerV2 `handleOrchestratorMessage()` iterates directly

**Exit:** OrchestratorService no longer emits on WorkerPool.events. Orchestrator streaming works via generator chain.

### Step 3: RoleTaskQueue → Direct Callbacks (no events)
**Files:** `RoleTaskQueue.ts`, `MemoryManager.ts`, `OrchestratorService.ts`, `AgentManagerV2.ts`  
**Effort:** Medium  

**Why not events:** Only OrchestratorService listens to task lifecycle events. Events solve one-to-many (one producer, N consumers) — but we have one-to-one. Direct calls are simpler, debuggable (full stack trace), and have zero listener management overhead.

Replace `RoleTaskQueue.events = new EventEmitter()` with direct callbacks:

```ts
// RoleTaskQueue constructor accepts callbacks
interface TaskCallbacks {
  onTaskReady?: (role: string, taskId: string) => void;
  onTaskComplete?: (taskId: string, output: any) => void;
  onTaskFailed?: (taskId: string, error: string) => void;
}

class RoleTaskQueue {
  constructor(private callbacks: TaskCallbacks = {}) {}
  
  // Instead of: this.events.emit('task:available', { role, taskId })
  // Direct:     this.callbacks.onTaskReady?.(role, taskId)
}
```

- `MemoryManager` passes callbacks from OrchestratorService into RoleTaskQueue
- OrchestratorService provides `{ onTaskReady: this.wakeWorker, onTaskComplete: this.handleTaskComplete }`
- Remove all `events.on(...)` subscriptions and `.removeListener()` calls
- Remove `RoleTaskQueue.events` EventEmitter entirely

**When to revisit:** Almost never — future services (cost tracking, audit, webhooks) use Socket.IO server-side listeners or direct callbacks in SocketServerV2. Only add internal EventEmitters if a service needs events that never reach Socket.IO (unlikely).

**Exit:** Task lifecycle uses direct callbacks. Zero EventEmitters. Zero `.bind(this)`. Full stack traces on every task state change.

### Step 4: OrchestratorService Wiring
**Files:** `OrchestratorService.ts`, `AgentManagerV2.ts`  
**Effort:** Low  

Wire OrchestratorService methods directly as RoleTaskQueue callbacks:
- `wakeWorker` → `onTaskReady`
- `handleTaskComplete` → `onTaskComplete`  
- `handleTaskFailed` → `onTaskFailed`
- Use arrow functions or bound methods in AgentManagerV2 constructor — no runtime `.bind(this)`
- Remove all `memoryManager.on(...)` listener registrations

**Exit:** OrchestratorService receives task lifecycle events via direct injection. Zero `.bind(this)` calls.

### Step 5: Cleanup Dead Code
**Files:** Multiple  
**Effort:** Low  

- Remove `AgentManager.events` alias (was `= this.workerPool.events`)
- Remove `ensureTeamEventsBroadcast()` listener attachment (replaced by direct iteration)
- Remove `attachedTeams` Set tracking
- Remove `WORKER_EVENT_ROUTES` map (no more event-based routing)
- Delete `toStreamPart()` method
- Remove `AiSdkAgent._emitter` — fold `task:complete` into generator yield

**Exit:** Clean codebase. Event count: 7 emitters → 0 EventEmitters + Socket.IO (network boundary only). All internal communication is direct calls or generator iteration. Future services (cost tracker, audit, webhooks) hook into SocketServerV2 via direct callbacks or Socket.IO client connections — no new event infrastructure ever needed.

---

## Migration Strategy

Each step is independently shippable:
- Step 1+2 can ship together (streaming layer)
- Step 3 can ship independently (task lifecycle)
- Step 4+5 can ship together (cleanup)

Rollback: git revert the step branch. Each step only touches its own layer.

## Testing

- Golden path: submit goal → plan → approve → tasks execute → complete
- Streaming: text tokens arrive in frontend, tool cards render
- Task dependencies: T2 starts after T1 completes
- Error handling: failed task reports to orchestrator, doesn't crash
- Multi-team: 2 teams running simultaneously, events don't cross
