# Event Architecture Analysis

**Created:** January 30, 2026  
**Status:** Architectural Review

## Executive Summary

Current system has **7 distinct event emitters** creating a complex web of event propagation. This analysis identifies which events are appropriate and which should be refactored.

---

## Event Emitter Inventory

### 1. **RoleTaskQueue** (`util/RoleTaskQueue.ts`)
```typescript
private events: EventEmitter = new EventEmitter();

Emits:
- task:available → { role, taskId }
- task:complete → { taskId, output }
- task:failed → { taskId, error }
```

### 2. **MemoryManager** (`memoryManager/MemoryManager.ts`)
```typescript
// Forwards events from RoleTaskQueue
on('task:available', handler)
on('task:complete', handler)
on('task:failed', handler)
```

### 3. **OrchestratorService** (`orchestrator/OrchestratorService.ts`)
```typescript
private events: EventEmitter; // Injected

Subscribes to:
- task:available → wakeWorker()
- task:complete → handleTaskComplete()
- task:failed → handleTaskFailed()

Emits:
- plan:approved → { planId, teamId, tasksQueued }
- execution:complete → { teamId, timestamp }
- task:error → { taskId, role, error }
```

### 4. **AgentManagerV2** (`agentManager/AgentManagerV2.ts`)
```typescript
public readonly events: EventEmitter;

Subscribes to:
- plan:proposed (from orchestrator)
- plan:approved (from orchestrator)
- task:complete (from taskQueue)
- task:failed (from taskQueue)

Emits:
- worker:event → { taskId, event }
- worker:done → { taskId, output }
- worker:error → { taskId, error }
```

### 5. **WorkerPool** (`services/WorkerPool.ts`)
```typescript
public readonly events = new EventEmitter();

Emits:
- worker:event → { taskId, event }
- worker:done → { taskId, output }
- worker:error → { taskId, error }
```

### 6. **SocketServer** (`api/SocketServer.ts`)
```typescript
// Socket.IO events (network boundary)
Listens to:
- AgentManager.events (plan:proposed, plan:approved)

Emits to clients:
- orchestrator:message
- orchestrator:error
- plan:approval:success
- plan:approval:failed
```

### 7. **TaskList** (`agent/TaskList.ts`)
```typescript
private emitter: EventEmitter = new EventEmitter();

Emits:
- task:added
- task:started
- task:completed
- task:failed
- task:skipped
- task:circular-detected
- task:replan-needed
```

---

## Event Flow Map

```
┌─────────────────┐
│ RoleTaskQueue   │
│ (Low-level)     │
└────────┬────────┘
         │ task:available/complete/failed
         ▼
┌─────────────────┐
│ MemoryManager   │
│ (Forwarding)    │
└────────┬────────┘
         │ Forwards queue events
         ▼
┌──────────────────────┐
│ OrchestratorService  │───────► External EventEmitter
│ (Coordinator)        │         (plan:approved, execution:complete)
└──────────┬───────────┘
           │
           ▼
┌──────────────────┐
│ WorkerPool       │───────► events (worker:event/done/error)
└──────────────────┘
           │
           ▼
┌──────────────────┐
│ AgentManagerV2   │───────► events (forwarded to UI)
└──────────────────┘
           │
           ▼
┌──────────────────┐
│ SocketServer     │───────► Socket.IO → Frontend
└──────────────────┘
```

---

## ❌ INAPPROPRIATE Event Usage (Should Refactor)

### 1. **MemoryManager → OrchestratorService** (Internal Coordination)
**Current:**
```typescript
// MemoryManager emits → OrchestratorService subscribes
this.memoryManager.on('task:available', this.wakeWorker);
this.memoryManager.on('task:complete', this.handleTaskComplete);
```

**Problem:**
- Same process, tightly coupled services
- Events add indirection for no benefit
- Hard to debug: "Who called handleTaskComplete?"
- Memory leak risk with `.bind(this)`

**✅ Better: Direct Callback Injection**
```typescript
class OrchestratorService {
  constructor(config: {
    memoryManager: MemoryManager,
    onTaskAvailable: (taskId, role) => void,
    onTaskComplete: (taskId, output) => void,
  }) {
    // Direct, type-safe, traceable
  }
}
```

---

### 2. **RoleTaskQueue → MemoryManager** (Same Module)
**Current:**
```typescript
// Queue emits → MemoryManager forwards
this.taskQueue.on('task:available', handler);
```

**Problem:**
- Parent owns child, should use direct callbacks
- Forwarding events = unnecessary indirection

**✅ Better: Constructor Callbacks**
```typescript
class RoleTaskQueue {
  constructor(config: {
    onTaskAvailable: (role, taskId) => void,
    onTaskComplete: (taskId, output) => void,
  }) {
    // Direct callback when task available
    config.onTaskAvailable(role, taskId);
  }
}
```

---

### 3. **AgentManagerV2 → WorkerPool events** (Internal Streaming)
**Current:**
```typescript
// WorkerPool emits → AgentManager listens → Re-emits
this.workerPool.events.on('worker:event', ({ taskId, event }) => {
  this.events.emit('worker:event', { taskId, event });
});
```

**Problem:**
- Double event emission (WorkerPool → AgentManager → SocketServer)
- WorkerPool events should be consumed directly by SocketServer
- AgentManager is just a passthrough

**✅ Better: Direct WorkerPool → SocketServer**
```typescript
// SocketServer subscribes directly to WorkerPool
workerPool.events.on('worker:event', forwardToSocket);
```

---

### 4. **TaskList Internal Events** (Over-Engineering)
**Current:**
```typescript
private emitter: EventEmitter = new EventEmitter();
this.emitter.emit('task:added', newTask);
```

**Problem:**
- TaskList is a data structure, not an event source
- Nobody subscribes to these events (dead code?)
- Should use direct method return values

**✅ Better: Return Values**
```typescript
class TaskList {
  addTask(task: Task): TaskAddResult {
    // Return status instead of emitting
    return { success: true, task };
  }
}
```

---

## ✅ APPROPRIATE Event Usage (Keep As-Is)

### 1. **SocketServer → Frontend** (Network Boundary)
**✅ Good Use:**
```typescript
socket.emit('orchestrator:message', data);
socket.on('sendMessage', handler);
```
**Why:** Network I/O requires async event-driven model

---

### 2. **AgentManagerV2.events → SocketServer** (Cross-Service UI Updates)
**✅ Good Use:**
```typescript
agentManager.events.on('plan:proposed', forwardToClients);
```
**Why:**
- Decouples backend logic from WebSocket layer
- Multiple listeners possible (metrics, logging, UI)
- Clear boundary: business logic → presentation

---

### 3. **Process Signals** (OS Events)
**✅ Good Use:**
```typescript
process.on('SIGINT', gracefulShutdown);
```
**Why:** OS-level events, no alternative

---

## 📋 Refactoring Recommendations

### Priority 1: **Remove Internal Event Chains** 🔴

**Impact:** High complexity, low value

1. **OrchestratorService ← MemoryManager**
   - Change from: Event subscription
   - Change to: Constructor callbacks
   - Files: `OrchestratorService.ts`, `MemoryManager.ts`

2. **MemoryManager ← RoleTaskQueue**
   - Change from: Event forwarding
   - Change to: Direct callbacks
   - Files: `MemoryManager.ts`, `RoleTaskQueue.ts`

### Priority 2: **Eliminate Event Passthrough** 🟡

**Impact:** Medium complexity, clarity gain

3. **AgentManager event forwarding**
   - Change from: WorkerPool → AgentManager → SocketServer
   - Change to: WorkerPool → SocketServer (direct)
   - Files: `AgentManagerV2.ts`, `SocketServer.ts`

### Priority 3: **Remove Dead Events** 🟢

**Impact:** Low effort, cleanup

4. **TaskList events**
   - Change from: Event emission
   - Change to: Return values / exceptions
   - Files: `TaskList.ts`

---

## Event Usage Guidelines

### ✅ **Use Events When:**

1. **Crossing Process/Network Boundaries**
   - Socket.IO, HTTP responses, IPC
   - Example: `socket.emit('message')`

2. **Multiple Unknown Listeners**
   - Pub/sub pattern, plugins, extensibility
   - Example: Metrics, logging, monitoring

3. **Async Notification (Fire-and-Forget)**
   - UI updates, background jobs
   - Example: `events.emit('execution:complete')`

4. **Third-party Libraries Require It**
   - Socket.IO, Express, OS signals
   - Example: `process.on('SIGINT')`

### ❌ **Don't Use Events When:**

1. **Same Module/Service (Internal Coordination)**
   - Parent → Child relationship
   - Use: Direct method calls or callbacks

2. **Synchronous Request-Response**
   - Need return value immediately
   - Use: Direct function calls

3. **Single Known Listener**
   - Only one subscriber
   - Use: Dependency injection with callbacks

4. **Type Safety Matters**
   - Event names are strings (typo-prone)
   - Use: Typed callbacks or interfaces

5. **Debugging is Critical**
   - Hard to trace event chains
   - Use: Direct calls with stack traces

---

## Migration Strategy

### Phase 1: Document Current State ✅
- [x] Map all event emitters
- [x] Identify inappropriate usage
- [x] Create guidelines

### Phase 2: Refactor Internal Events (1-2 days)
- [ ] Replace MemoryManager events with callbacks
- [ ] Replace RoleTaskQueue events with callbacks
- [ ] Update OrchestratorService to use direct calls
- [ ] Update tests

### Phase 3: Simplify Event Passthrough (1 day)
- [ ] Remove AgentManager event forwarding
- [ ] Connect WorkerPool directly to SocketServer
- [ ] Update AgentManager to focus on orchestration

### Phase 4: Cleanup Dead Code (2 hours)
- [ ] Remove TaskList events
- [ ] Remove unused event listeners
- [ ] Update documentation

---

## Metrics

### Current State:
- **Event Emitters:** 7
- **Event Types:** ~20
- **Event Chains:** 4+ levels deep
- **Type Safety:** ❌ (string-based)
- **Debuggability:** 🟡 (requires tracing)

### Target State:
- **Event Emitters:** 3 (Socket, AgentManager, WorkerPool)
- **Event Types:** ~8 (UI-facing only)
- **Event Chains:** 2 levels max
- **Type Safety:** ✅ (typed callbacks internally)
- **Debuggability:** ✅ (direct stack traces)

---

## References

- [Node.js EventEmitter Best Practices](https://nodejs.org/api/events.html)
- Martin Fowler: [Event-Driven Architecture](https://martinfowler.com/articles/201701-event-driven.html)
- [TypeScript Callback Patterns](https://www.typescriptlang.org/docs/handbook/2/functions.html)

---

## Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-01-30 | Document current event architecture | Needed baseline for refactoring |
| 2026-01-30 | Mark internal events as inappropriate | Adds complexity without benefits |
| Pending | Refactor to callback-based internal coordination | Type safety, debuggability |
