# Event Architecture Refactor — Feature Architecture

**Status:** Planned  
**Date:** April 5, 2026  
**Parent:** Task Orchestration (A6)  
**Depends on:** AI SDK Migration (done), Agentic Streaming (done)  
**Prior Art:** [EVENT_ARCHITECTURE_ANALYSIS.md](../../../architecture/EVENT_ARCHITECTURE_ANALYSIS.md)

---

## Overview

Replace the 3-layer EventEmitter chain (RoleTaskQueue → WorkerPool → SocketServerV2) with a cleaner architecture that preserves backpressure, eliminates magic strings, and removes fire-and-forget event delivery.

### Current State (7 EventEmitters, 3 Critical Paths)

```
RoleTaskQueue.events          ← task DAG lifecycle (available, complete, failed)
  ↓ forwarded by MemoryManager
OrchestratorService           ← subscribes via .bind(this), never cleaned up
  ↓ triggers
WorkerPool.events             ← worker streaming (stream, event, done, error)
  = AgentManager.events      ← alias (same object)
  ↓ listened by
SocketServerV2                ← broadcasts to Socket.IO
```

**Problems documented in [EVENT_ARCHITECTURE_ANALYSIS.md](../../../architecture/EVENT_ARCHITECTURE_ANALYSIS.md):**
1. 7 distinct emitters with overlapping event names (`task:complete` on 3 emitters)
2. MemoryManager → OrchestratorService uses events for same-process calls (unnecessary indirection)
3. WorkerPool → AgentManager → SocketServer is a passthrough (double emission)
4. `.bind(this)` listeners never cleaned up (memory leak risk)
5. No type safety — magic strings everywhere
6. No backpressure — 787+ stream events fire-and-forget
7. Errors in listeners silently swallowed

### Target State
- **Streaming:** AsyncGenerator pass-through (backpressure preserved)
- **Task lifecycle:** Direct callbacks (only one consumer — OrchestratorService)
- **Network boundary:** Socket.IO only (already exists, already broadcasts everything)
- **Future services** (cost tracking, audit, webhooks): Socket.IO server-side listeners or direct callbacks — zero new infrastructure
- **End result:** 7 EventEmitters → 0 + Socket.IO only
- **Internal coordination:** Direct callbacks (OrchestratorService ← MemoryManager)

### Key Insight: Socket.IO IS the Event Bus

Socket.IO already broadcasts every event to the frontend (stream parts, task status, progress). Any future service that needs to observe the same data has two clean options:

| Service Type | Pattern | Example |
|---|---|---|
| **Same process** (cost tracker) | Direct callback next to `io.emit()` in SocketServerV2 | `costTracker.record(usage)` |
| **Separate process** (webhook relay) | Connect as Socket.IO client to existing server | `io('http://localhost:3002').on('stream', ...)` |

No new event infrastructure is ever needed. Socket.IO handles one-to-many natively. Internal backend code stays direct calls.

---

## Architecture Options

### For Worker Streaming: Option A — AsyncGenerator Pass-Through (Recommended)

Replace `WorkerPool.events.emit("worker:stream", event)` with `yield event` — the generator chain stays intact from AiSdkAgent → WorkerPool → consumer.

```
// CURRENT (breaks backpressure)
for await (const event of agent.execute(input)) {
  this.events.emit("worker:stream", event);     // fire-and-forget
}

// TARGET (preserves backpressure)
async *runTask(taskId, role, input): AsyncGenerator<AgentEvent> {
  const agent = this.getOrCreateWorker(taskId, role);
  for await (const event of agent.execute(input)) {
    this.handleSideEffect(event, taskId, role);  // task status, logging
    yield event;                                  // consumer controls pace
  }
}

// SocketServerV2 iterates directly
const stream = manager.workerPool.runTask(taskId, role, input);
for await (const event of stream) {
  socket.emit("stream", toStreamPayload(event));
}
```

**Pros:** Backpressure, zero listener management, type-safe generator chain, no EventEmitter needed.
**Cons:** SocketServerV2 must own the iteration loop (needs restructure of handleMessage). One consumer only (can't have both Socket + logging iterate — use `tee()` or side effects inside the generator).

### For Task Lifecycle: Option B — Direct Callbacks (Recommended)

**Key insight:** Only OrchestratorService reacts to task events. Events solve one-to-many, but we have one-to-one. Direct calls are simpler, debuggable, and have zero listener management.

```ts
// RoleTaskQueue accepts callbacks at construction
interface TaskCallbacks {
  onTaskReady?: (role: string, taskId: string) => void;
  onTaskComplete?: (taskId: string, output: any) => void;
  onTaskFailed?: (taskId: string, error: string) => void;
}

class RoleTaskQueue {
  constructor(private callbacks: TaskCallbacks = {}) {}
  
  private notifyReady(role: string, taskId: string) {
    // Instead of: this.events.emit('task:available', { role, taskId })
    this.callbacks.onTaskReady?.(role, taskId);
  }
}

// Wired in AgentManagerV2
new RoleTaskQueue({
  onTaskReady: (role, taskId) => orchestrator.wakeWorker(role, taskId),
  onTaskComplete: (taskId, output) => orchestrator.handleTaskComplete(taskId, output),
  onTaskFailed: (taskId, error) => orchestrator.handleTaskFailed(taskId, error),
});
```

**Why direct calls over `emittery`/EventEmitter:**
| Aspect | EventEmitter/emittery | Direct Callbacks |
|---|---|---|
| Consumers | N (unknown at compile time) | 1 (OrchestratorService — known) |
| Type safety | emittery: ✅, EventEmitter: ❌ | ✅ TypeScript interface |
| Debugging | Lost call stack (async dispatch) | Full stack trace |
| Cleanup | Manual removal or AbortSignal | None needed — GC handles it |
| Overhead | Listener registry, event loop hop | Direct function call |
| Dependencies | emittery: external package | None — built-in language feature |

**When to add events back:** Almost never — future services (cost tracking, audit, webhooks) can use Socket.IO server-side listeners or direct callbacks in SocketServerV2. Only add internal EventEmitters if a service needs to observe events that never reach Socket.IO (unlikely — Socket.IO already broadcasts everything).

### For Internal Calls: Option C — Constructor Injection (same pattern as B)

Replace `memoryManager.on('task:available', this.wakeWorker.bind(this))` with constructor injection.

```ts
// CURRENT (event indirection)
this.memoryManager.on('task:available', this.wakeWorker.bind(this));
this.memoryManager.on('task:complete', this.handleTaskComplete.bind(this));

// TARGET (direct, type-safe, traceable)
class OrchestratorService {
  constructor(config: {
    onTaskAvailable: (role: string, taskId: string) => void;
    onTaskComplete: (taskId: string, output: any) => void;
  }) { ... }
}

// Caller provides callbacks
new OrchestratorService({
  onTaskAvailable: (role, taskId) => this.wakeWorker(role, taskId),
  onTaskComplete: (taskId, output) => this.handleComplete(taskId, output),
});
```

**Pros:** Zero overhead, fully type-safe, debuggable (call stack shows caller).
**Cons:** Rigid — can't add listeners dynamically. Fine for 1:1 internal coordination.

---

## Recommended Approach: Direct Calls Everywhere (No Events)

| Layer | Pattern | Why |
|---|---|---|
| **Agent → Consumer** (streaming) | AsyncGenerator pass-through | Backpressure, type-safe, no listeners |
| **Task DAG lifecycle** | Direct callbacks | Only 1 consumer (OrchestratorService), no indirection needed |
| **Internal coordination** | Constructor injection | Same-process, 1:1, fully traceable |
| **→ Socket.IO** (network) | `socket.emit()` | Appropriate — network boundary, many browser clients |

**End state:** 0 EventEmitters in backend code. Socket.IO is the only event system (appropriate for network I/O).

---

## Risks

- **AsyncGenerator single consumer** — if multiple consumers need the stream, use side-effect middleware inside the generator (not `tee()` which buffers unbounded)
- **Direct callbacks are rigid** — if a second task consumer appears, use Socket.IO server-side listeners (already exists) rather than adding internal EventEmitters
- **Migration is incremental** — can swap one layer at a time without breaking the others

## Future Services (Cost Tracking, Audit, Webhooks)

All planned services that need to observe task/agent events can use the existing Socket.IO infrastructure:

```
AiSdkAgent → WorkerPool → SocketServerV2
                              ├─ io.to(room).emit("stream", ...)     → Frontend browsers
                              ├─ costTracker.record(usage)            → Direct call (same process)
                              └─ Socket.IO server event               → Any connected service
```

| Service | Where it hooks in | Pattern |
|---|---|---|
| **Cost Tracker** | SocketServerV2 `worker:done` handler | Direct callback: `if (usage) costTracker.record(teamId, taskId, usage)` |
| **Audit Logger** | SocketServerV2 broadcast handlers | Direct callback: `auditLog.append(event)` before/after `io.emit()` |
| **Webhook Notifier** | Separate process, Socket.IO client | Connects to `ws://localhost:3002`, filters events, POSTs to external URLs |

**Rule:** Internal services = direct call. External/separate-process services = Socket.IO client. Never add internal EventEmitters.
