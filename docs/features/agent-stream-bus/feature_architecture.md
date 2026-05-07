# Agent Stream Bus — Feature Architecture

**Date:** May 6, 2026
**Status:** Architecture
**Priority:** P1 — Foundation for clean streaming, extensibility, and ChatAgent unicast fix
**Depends on:** None (can start immediately)
**Related:** [goal-sessions](../goal-sessions/) (multi-goal scalar fixes still needed separately)

---

## Problem

WorkerPool.runTask() is a 280-line god method mixing 5 concerns: agent configuration, generator iteration, streaming delivery, Channel B synthesis, and error handling. Streaming goes through a 4-hop callback chain with 2 pure pass-throughs. Adding new stream consumers (cost tracking, Redis Streams) requires editing existing code.

## What This Feature Does

Replace the callback-based streaming with an Observer pattern: agents emit events to a stream bus, independent observers react.

---

## Architecture Options

### Option A: IStreamPublisher Interface (Simple)

**Implementation:** Single interface injected into WorkerPool and GoalManager. One class handles all stream consumers.

```
WorkerPool/GoalManager
  → streamPublisher.publish(part)
    → io.emit() + accumulate + Channel B + CRDT status
```

**Pros:**
- Simplest — one new interface, one impl
- Minimal code change (swap callback for method call)
- Easy to understand

**Cons:**
- All consumers in one class — violates SRP
- Adding consumers means editing the publisher
- Violates Open/Closed principle
- Channel B synthesis still mixed in somewhere

**Effort:** 3-4 days

---

### Option B: AgentStreamBus with Observers

**Implementation:** Agents emit events to a lightweight bus. Independent observer classes react to the events they care about. Each observer is a focused, testable class.

```
Agent yields event
  → bus.emit(event, context)
    → StreamPublisherObserver   (tokens → Socket.IO + persist)
    → ChannelBObserver          (progress + milestones → ChatAgent + sidebar)
    → TaskLifecycleObserver     (done/error → DAG + dispatch next)
    → CrdtStatusObserver        (busy/idle)
    → (future: CostTracker, RedisStreamObserver, ...)
```

```typescript
interface AgentStreamObserver {
  onEvent(event: AgentEvent, ctx: StreamContext): void;
}

class AgentStreamBus {
  private observers: AgentStreamObserver[] = [];
  addObserver(o: AgentStreamObserver): void { this.observers.push(o); }
  emit(event: AgentEvent, ctx: StreamContext): void {
    for (const o of this.observers) o.onEvent(event, ctx);
  }
}

interface StreamContext {
  teamId: string;
  goalId: string;
  agentKey: string;  // "planner" | "worker:backend-dev" | "chat:researcher"
  taskId?: string;
}
```

**Pros:**
- Each observer is SRP — one concern per class
- Open/Closed — add consumers without editing existing code
- Each observer independently testable
- Clean separation: streaming vs progress vs lifecycle vs CRDT
- Maps to real-world vision: agents stream freely, services observe
- Natural extension point for Redis Streams (add observer, don't replace)
- Fixes ChatAgent unicast bug (same bus for all agents)

**Cons:**
- More files (bus + 4 observers)
- Slightly more indirection than a direct method call
- Must be careful about observer error isolation

**Effort:** 1 week

---

### Option C: Node.js EventEmitter

**Implementation:** Use built-in EventEmitter. Agents emit typed events. Listeners registered per event type.

```typescript
const bus = new EventEmitter();
bus.on("stream_part", (part, ctx) => io.emit(...));
bus.on("stream_part", (part, ctx) => channelB.observe(part));
bus.on("done", (data, ctx) => taskStore.complete(...));
```

**Pros:**
- Built-in Node.js, no new classes needed
- Familiar API
- Wildcard listeners possible (`bus.on("*", ...)`)

**Cons:**
- No type safety — event names are strings
- Error in one listener crashes all (unless wrapped)
- **Copilot instructions say "Do NOT add new EventEmitters"** — project convention
- Hard to trace event flow (string-based dispatch)
- No structured context (just positional args)

**Effort:** 3-4 days

---

## Recommendation: Option B — Tiered AgentStreamBus with Observers

Option B with sync/async tiers is the gold standard:

### Why This Pattern

1. **It's what the codebase already wants to be.** The current callbacks ARE observers — just implemented as a 4-hop chain instead of a proper pattern.
2. **Satisfies the team vision.** Agents stream freely (like team members communicating). Services observe (dashboard, project tracker, team lead). Adding a new observer = plugging in a new service.
3. **Open/Closed.** Redis Streams = add `RedisStreamObserver`. Cost tracking = add `CostTrackingObserver`. No existing code changes.
4. **Respects project convention.** No EventEmitter (Option C rejected per copilot-instructions.md).
5. **Reactive Manifesto aligned.** Message-driven (async bus), resilient (per-observer error isolation), elastic (no contention), responsive (sync tier for real-time).

### Research Findings

| Pattern | Verdict |
|---------|---------|
| **Node.js Streams** (Transform/Writable pipeline) | Too heavy for in-memory object routing — designed for byte streams, not event fan-out. Our agents yield typed objects, not buffers. |
| **RxJS / ReactiveX** | Powerful but adds 50KB dependency. Overkill — we need fan-out, not map/filter/merge operators. |
| **Reactive Manifesto** | Validates our design: message-driven, resilient (failure isolation), elastic (no contention), responsive (consistent latency). |
| **Node.js `Readable.from(asyncGenerator)`** | AiSdkAgent.execute() is already an async generator. Composable with our bus — the generator feeds the bus, not a Node.js stream. |
| **`stream.pipeline()`** | Useful for sequential transforms, not parallel fan-out to N consumers. |

### The Tiered Design

```typescript
interface AgentStreamObserver {
  /** Sync — MUST be fast (<1ms). For real-time delivery. */
  onEvent?(event: AgentEvent, ctx: StreamContext): void;
  
  /** Async — can be slow. For persistence, CRDT, etc. Fire-and-forget. */
  onEventAsync?(event: AgentEvent, ctx: StreamContext): Promise<void>;
}

class AgentStreamBus {
  private syncObservers: AgentStreamObserver[] = [];
  private asyncObservers: AgentStreamObserver[] = [];

  addObserver(observer: AgentStreamObserver, tier: "sync" | "async" = "sync") {
    if (tier === "sync") this.syncObservers.push(observer);
    else this.asyncObservers.push(observer);
  }

  emit(event: AgentEvent, ctx: StreamContext): void {
    // Tier 1: Sync — run immediately, error-isolated
    for (const o of this.syncObservers) {
      try { o.onEvent?.(event, ctx); }
      catch (err) { logger.error({ err, observer: o.constructor.name }, "Sync observer error"); }
    }

    // Tier 2: Async — fire-and-forget, never blocks sync
    for (const o of this.asyncObservers) {
      o.onEventAsync?.(event, ctx)?.catch((err) => {
        logger.error({ err, observer: o.constructor.name }, "Async observer error");
      });
    }
  }
}

interface StreamContext {
  teamId: string;
  goalId: string;
  agentKey: string;  // "planner" | "worker:backend-dev" | "chat:researcher"
  taskId?: string;
}
```

### Observer Tiers

| Tier | Observer | What It Does | Latency |
|------|----------|-------------|---------|
| **Sync** | `StreamPublisherObserver` | `io.to(room).emit()` + accumulate text | <1ms |
| **Sync** | `ChannelBObserver` | `finish-step` → progress, `tool-output` → milestone → ChatAgent + Socket.IO | <1ms |
| **Async** | `TaskLifecycleObserver` | `done` → PG update + DAG dispatch; `error` → retry/notify planner | 5-50ms |
| **Async** | `CrdtStatusObserver` | `start` → busy; `done`/`error` → idle | 2-10ms |
| **Async** | (future) `CostTrackingObserver` | Count tokens, update billing | 1-5ms |
| **Async** | (future) `RedisStreamObserver` | `XADD stream:key * part {json}` | 1-5ms |

**Sync tier never waits for async tier.** Token delivery to the user's browser is never blocked by a database write.

### Why Not Other Patterns

| Alternative | Why Rejected |
|-------------|-------------|
| Single `IStreamPublisher.publish()` that does everything | Violates SRP + Open/Closed. All consumers in one method. Adding new consumer = edit existing code. |
| Node.js `EventEmitter` | Project convention says no new EventEmitters. No type safety. Error in one listener crashes all. |
| Node.js Streams (Transform pipeline) | Designed for sequential byte transforms, not parallel object fan-out. |
| RxJS Observables | External dependency. Powerful operators we don't need. Same result with 50 lines of custom code. |

---

## What Changes

### Refactoring: WorkerPool Split + AgentFactory

#### Current Problem: Three Agent Creation Paths

```
PLANNER:  Inline closure in AgentManagerV2.initializeOrchestrator() (42 lines)
          Creates PlannerAgent + planner tools + collab tools
          Captures `self`, 10+ closed-over variables

WORKER:   Inline in WorkerPool.runTask() (140 lines) 
          Creates AiSdkAgent + lifecycle tools + plugin tools + skills + identity file
          WorkerPool has 8 setter methods for dependencies it doesn't own

CHAT:     Inline closure in AgentManagerV2.initializeOrchestrator() (20 lines)
          Creates ChatAgent with dispatch/notify callbacks
          Captures `self`

Three different creation paths. Three different tool assembly patterns.
Tool assembly duplicated. Untestable closures.
```

#### Fix: Unified AgentFactory

```typescript
class AgentFactory {
  constructor(
    private pluginRegistry: PluginRegistry,
    private definitions: Map<string, AgentDefinition>,
    private teamId: string,
    private teamRoles: string[],
  ) {}

  /** One entry point — give me what you need, I build it. */
  async create(config: AgentCreateConfig): Promise<ConfiguredAgent> {
    // 1. Get or create base agent
    // 2. Assemble tools: lifecycle + plugin + skills (unified path)
    // 3. Prepare workspace (if worker)
    // 4. Return configured agent ready to execute
  }
}

// Usage — callers just ask:
const planner = await factory.create({ goalId, consumer: "planner" });
const worker  = await factory.create({ goalId, taskId, role: "backend-dev", consumer: "worker" });
const chat    = await factory.create({ goalId, role: "researcher", consumer: "chat" });
```

**All agents get tools from the same PluginRegistry path.** Adding a new tool type (MCP, custom) = add to PluginRegistry once, all agent types get it. The `consumer` field drives which tools/skills are assembled.

#### What Each Component Becomes

```
BEFORE:                                    AFTER:

AgentManagerV2 (1310 lines)               AgentManagerV2 (~900 lines)
├── initializeOrchestrator (400 lines)    ├── initializeOrchestrator (~250 lines)
│   ├── planner closure (42 lines)        │   └── wiring only, no closures
│   ├── chatAgent closure (20 lines)      │
│   ├── callback wiring (60 lines)        ├── AgentFactory (new, ~150 lines)
│   └── event bus setup (80 lines)        │   └── create(type, config) — all agents
│                                         │
├── streamCallbacks (dead code)           └── removes: streamCallbacks,
├── registerStreamCallbacks()                  registerStreamCallbacks(),
└── 8+ methods for WorkerPool setup            closures, callback wiring

WorkerPool (686 lines)                    WorkerPool (~150 lines)
├── runTask (280 lines, god method)       ├── definitions: Map<role, AgentDefinition>
│   ├── tool assembly (140 lines)         ├── workers: Map<taskId, AiSdkAgent>
│   ├── iteration + callbacks (50 lines)  ├── executeAgent(agent, taskId): AsyncGenerator
│   ├── Channel B (30 lines)              ├── dispose(taskId)
│   └── done/error (20 lines)            └── disposeByGoal(goalId)
├── 8 setter methods
├── callbacks interface
└── definitions + workers Maps

SocketEventBroadcaster (374 lines)        DELETED — replaced by StreamPublisherObserver
```

#### New Files

| File | Lines | Purpose |
|------|-------|---------|
| `agent/AgentFactory.ts` | ~150 | Unified agent creation: planner, worker, chat. One tool assembly path. |
| `streaming/AgentStreamBus.ts` | ~45 | Tiered bus + observer interface |
| `streaming/StreamPublisherObserver.ts` | ~65 | Channel A → Socket.IO + persist on finish |
| `streaming/ChannelBObserver.ts` | ~50 | Coarse progress synthesis |
| `streaming/TaskLifecycleObserver.ts` | ~80 | done/error → GoalManager |
| `streaming/CrdtStatusObserver.ts` | ~20 | CRDT busy/idle |

#### Modified Files

| File | Change |
|------|--------|
| `WorkerPool.ts` | Strip from 686 → ~150 lines. Remove tool assembly, callbacks, setters. Keep definitions + executeAgent + dispose. |
| `OrchestratorService.ts` | `dispatchTask()`: use `agentFactory.create("worker", ...)` + iterate via `workerPool.executeAgent()` + emit to bus. Remove `workerPool.setCallbacks()` block (70 lines). |
| `GoalManager.ts` | `executePlannerTurn()`: use `agentFactory.create("planner", ...)` + emit to bus. Remove `onPlannerStream` callback. |
| `AgentManagerV2.ts` | Create `AgentFactory` instance. Remove planner/chatAgent closures. Remove `streamCallbacks`. Pass factory to OrchestratorService + GoalManager. |
| `SocketMessageHandler.ts` | ChatAgent: `agentFactory.create("chat", ...)` + emit to bus (fixes unicast). |
| `SocketServerV2.ts` | Create `StreamPublisherObserver` instead of `SocketEventBroadcaster`. |

#### Deleted Files

| File | Lines | Replaced By |
|------|-------|------------|
| `SocketEventBroadcaster.ts` | 374 | `StreamPublisherObserver` |

### What Stays Unchanged

| Component | Why |
|-----------|-----|
| **Orchestration flow** (GoalManager → OrchestratorService → dispatch) | Command/control, not observation |
| **Tool callbacks** (complete_task, report_status, bounce_task) | Synchronous, must return result to agent. `report_status(blocked)` mutates `task.lastReportedStatus` which `dispatchTask()` reads immediately — MUST stay in sync control path. |
| **Worker lifecycle callbacks** (onAgentComplete, onStatusUpdate, onBounce, onTaskCreated, onMentionedRoles) | Mutate task state or trigger orchestration. Stay as direct function calls, NOT on bus. |
| **TaskStore / RoleTaskQueue** | Task state machine transitions |
| **DispatchManager** | Concurrency management |
| **GoalEventBus** | Domain events for CRDT projection |
| **AiSdkAgent / PlannerAgent / ChatAgent** | Agent classes unchanged — factory creates them |

**Only streaming pass-throughs move to bus.** The 4 callbacks that are pure pass-throughs (onStream, onDone, onError, onEvent) become bus events. The 5 callbacks that mutate state (onAgentComplete, onStatusUpdate, onBounce, onTaskCreated, onMentionedRoles) stay as direct function calls.

---

## Callback Migration Map

### Current State: 4-Layer Callback Chain (BEFORE)

22 callbacks across 6 interfaces, 12 are pure pass-throughs.

```
┌─ AiSdkAgent (streamText generator) ──────────────────────────┐
│  yields: stream_part, done, error                             │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─ WorkerPool.runTask() ───────────────────────────────────────┐
│  WorkerCallbacks (10 callbacks)                               │
│  onStream, onEvent, onDone, onError, onTaskUpdate,            │
│  onAgentComplete, onStatusUpdate, onBounce,                   │
│  onTaskCreated, onMentionedRoles                              │
└──────────┬──────────────────────────┬────────────────────────┘
           │ (pass-throughs)          │ (orchestration)
           ▼                          ▼
┌─ OrchestratorService ──────────────────────────────────────┐
│  Forwards 4 streaming callbacks (onStream/Event/Done/Error) │
│  Handles 5 lifecycle callbacks (Complete/Status/Bounce/...)  │
│  OrchestratorCallbacks (11 callbacks, 7 pass-throughs)       │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─ AgentManagerV2 ───────────────────────────────────────────┐
│  ManagerStreamCallbacks (10 callbacks, all forwarded)        │
│  registerStreamCallbacks() wired by SocketEventBroadcaster   │
└──────────┬──────────────────────────────────────────────────┘
           │
           ▼
┌─ SocketEventBroadcaster ──────────────────────────────────┐
│  io.to(room).emit("stream" | "state" | "progress" | ...)   │
│  + message accumulation + persistence on "finish"           │
└─────────────────────────────────────────────────────────────┘

Separate path (ChatAgent) — bypasses entire chain:
  ChatAgent generator → SocketMessageHandler → socket.emit() (unicast bug)
```

### After Migration: Bus + Direct Callbacks (AFTER)

```
┌─ AiSdkAgent (streamText generator) ──────────────────────────┐
│  yields: stream_part, done, error                             │
└──────────┬────────────────────────────────────────────────────┘
           │
           ▼
┌─ AgentStreamBus.emit(event, ctx) ────────────────────────────┐
│  SYNC tier (<1ms):                                            │
│    StreamPublisherObserver  → io.to(room).emit("stream")      │
│    ChannelBObserver         → progress + milestone events     │
│                                                                │
│  ASYNC tier (fire-and-forget):                                │
│    TaskLifecycleObserver    → done/error → GoalManager        │
│    CrdtStatusObserver       → busy/idle                       │
└──────────────────────────────────────────────────────────────┘

Direct callbacks (unchanged, NOT on bus):
  report_status  → task.lastReportedStatus (sync mutation)
  complete_task  → GoalManager.onWorkerDone() (sync)
  bounce_task    → GoalManager.handleTaskFailure() (sync)
  request_task   → TaskStore.addTask() + DAG rebuild (sync)
```

### Callback Classification: What Stays vs What Moves

#### DELETED — Pure pass-throughs eliminated by bus (12 callbacks)

| Callback | Layer | Why Deleted |
|----------|-------|-------------|
| `WorkerCallbacks.onStream` | WorkerPool → Orch | Bus replaces: StreamPublisherObserver |
| `WorkerCallbacks.onEvent` | WorkerPool → Orch | Bus replaces: ChannelBObserver |
| `WorkerCallbacks.onDone` | WorkerPool → Orch | Bus replaces: TaskLifecycleObserver |
| `WorkerCallbacks.onError` | WorkerPool → Orch | Bus replaces: TaskLifecycleObserver |
| `WorkerCallbacks.onTaskUpdate` | WorkerPool → Orch | Bus replaces: ChannelBObserver |
| `OrchestratorCallbacks.onStream` | Orch → AgentMgr | Was just `this.streamCallbacks?.onStream?.(data)` |
| `OrchestratorCallbacks.onEvent` | Orch → AgentMgr | Was just `this.streamCallbacks?.onEvent?.(data)` |
| `OrchestratorCallbacks.onDone` | Orch → AgentMgr | Was just `this.streamCallbacks?.onDone?.(data)` |
| `OrchestratorCallbacks.onError` | Orch → AgentMgr | Was just `this.streamCallbacks?.onError?.(data)` |
| `ManagerStreamCallbacks.onStream` | AgentMgr → Broadcaster | Broadcaster replaced by StreamPublisherObserver |
| `ManagerStreamCallbacks.onEvent` | AgentMgr → Broadcaster | Broadcaster replaced by ChannelBObserver |
| `onPlannerStream` | GoalMgr → Orch → AgentMgr → Broadcaster | 3-hop pass-through. Bus replaces directly. |

#### STAYS — Direct callbacks (synchronous, state-mutating, or orchestration)

| Callback | Where | Why It Stays |
|----------|-------|-------------|
| `report_status` tool callback | assembleLifecycleTools → WorkerCallbacks.onStatusUpdate | **CRITICAL:** Writes `task.lastReportedStatus` synchronously. `dispatchTask()` reads it immediately after `runTask()` returns. Moving to async = race condition. |
| `complete_task` tool callback | assembleLifecycleTools → WorkerCallbacks.onAgentComplete → GoalManager.onWorkerDone() | Merges workspace, marks task complete, publishes domain events. Must complete before auto-complete guard. |
| `bounce_task` tool callback | assembleLifecycleTools → WorkerCallbacks.onBounce | Marks task failed, notifies planner. Reads/writes task state. |
| `request_task` tool callback | assembleLifecycleTools → WorkerCallbacks.onTaskCreated | Creates task in TaskStore, rebuilds DAG. Must complete atomically. |
| `onMentionedRoles` | WorkerPool → OrchestratorService.spawnCollabWorkers() | Spawns collab workers. Side-effect-heavy, no observation semantics. |
| `TaskCallbacks.onTaskReady` | RoleTaskQueue → GoalManager | Part of task DAG — triggers dispatch. |
| `TaskCallbacks.onTaskComplete` | RoleTaskQueue → GoalManager | Checks goal completion, cascades. |
| `TaskCallbacks.onTaskFailed` | RoleTaskQueue → GoalManager | Handles failure cascade. |
| `GoalManagerCallbacks.onDispatchTask` | GoalManager → OrchestratorService | Entry point to dispatch pipeline. |
| `GoalManagerCallbacks.onNotifyPlanner` | GoalManager → NotificationQueue → GoalManager | Circular roundtrip (debounced). |

#### MOVES TO BUS — Currently direct but becoming observers

| Callback | Current Location | New Observer |
|----------|-----------------|-------------|
| `onWorkerTaskUpdate` (Channel B) | Orch → AgentMgr → ChatAgent + Broadcaster | ChannelBObserver |
| `onGoalStatusChange` | GoalMgr → Orch → AgentMgr → Broadcaster | StreamPublisherObserver (state events) |
| `onPlanProposed` | GoalMgr → Orch → AgentMgr → Broadcaster | StreamPublisherObserver (state events) |
| `onPlanUpdate` | AgentMgr → Broadcaster | StreamPublisherObserver (state events) |
| `onTaskUpdate` (state) | GoalMgr → Orch → AgentMgr → Broadcaster | StreamPublisherObserver (state events) |

### Sequence Diagrams

#### Worker Task Execution (AFTER migration)

```
User               OrchestratorService    AgentFactory    WorkerPool     AiSdkAgent      Bus            Observers
 │                       │                    │              │              │              │                │
 │  goal/plan approved   │                    │              │              │              │                │
 │──────────────────────>│                    │              │              │              │                │
 │                       │                    │              │              │              │                │
 │                       │ create(worker,     │              │              │              │                │
 │                       │  { goalId, taskId, │              │              │              │                │
 │                       │    role, callbacks})│              │              │              │                │
 │                       │───────────────────>│              │              │              │                │
 │                       │                    │              │              │              │                │
 │                       │                    │ builds agent  │              │              │                │
 │                       │                    │ + lifecycle   │              │              │                │
 │                       │                    │   tools       │              │              │                │
 │                       │                    │ + plugin      │              │              │                │
 │                       │                    │   tools       │              │              │                │
 │                       │                    │ + skills      │              │              │                │
 │                       │   <configured agent>│              │              │              │                │
 │                       │<───────────────────│              │              │              │                │
 │                       │                    │              │              │              │                │
 │                       │ executeAgent(agent, taskId, input) │              │              │                │
 │                       │──────────────────────────────────>│              │              │                │
 │                       │                    │              │ execute()    │              │                │
 │                       │                    │              │─────────────>│              │                │
 │                       │                    │              │              │              │                │
 │                       │                    │              │   ┌─────────────────────────────────────┐   │
 │                       │                    │              │   │ for await (event of generator):     │   │
 │                       │                    │              │   │                                     │   │
 │                       │  <─── yield stream_part ─────────│<──│  stream_part {text-delta}           │   │
 │                       │                    │              │   │                                     │   │
 │                       │  bus.emit(event, ctx)             │   │                                     │   │
 │                       │───────────────────────────────────────────────>│                │            │
 │                       │                    │              │   │        │                │            │
 │                       │                    │              │   │        │ SYNC:          │            │
 │  <─ io.emit("stream") ─────────────────────────────────────────────── StreamPublisher  │            │
 │                       │                    │              │   │        │ ChannelB        │            │
 │                       │                    │              │   │        │                │            │
 │                       │                    │              │   │        │ ASYNC:         │            │
 │                       │                    │              │   │        │ CrdtStatus (busy)           │
 │                       │                    │              │   │                                     │
 │                       │                    │              │   │  ── agent calls report_status ──    │
 │                       │                    │              │   │  DIRECT CALLBACK (not bus):         │
 │                       │                    │              │   │  → task.lastReportedStatus = X      │
 │                       │                    │              │   │                                     │
 │                       │                    │              │   │  ── agent calls complete_task ──    │
 │                       │                    │              │   │  DIRECT CALLBACK (not bus):         │
 │                       │                    │              │   │  → GoalManager.onWorkerDone()       │
 │                       │                    │              │   │  → workspace merge + task complete  │
 │                       │                    │              │   │                                     │
 │                       │  <─── yield done ────────────────│<──│  done {summary, deliverables}       │
 │                       │                    │              │   └─────────────────────────────────────┘
 │                       │  bus.emit(done, ctx)              │              │              │                │
 │                       │───────────────────────────────────────────────>│                │                │
 │  <─ io.emit("stream", finish) ───────────────────────────────────────── StreamPublisher │                │
 │                       │                    │              │              │ CrdtStatus(idle)              │
 │                       │                    │              │              │              │                │
 │                       │  auto-complete check:             │              │              │                │
 │                       │  if (status==in_progress &&       │              │              │                │
 │                       │      lastReportedStatus!=blocked) │              │              │                │
 │                       │    → completeTask()               │              │              │                │
```

#### Planner Streaming (AFTER migration)

```
User        GoalManager     AgentFactory     PlannerAgent       Bus           StreamPublisher
 │              │                │                │               │                │
 │  message     │                │                │               │                │
 │─────────────>│                │                │               │                │
 │              │                │                │               │                │
 │              │ create(planner,│                │               │                │
 │              │  { goalId })   │                │               │                │
 │              │───────────────>│                │               │                │
 │              │                │ builds planner │               │                │
 │              │                │ + 15 plan tools│               │                │
 │              │                │ + collab tools │               │                │
 │              │ <─ planner ───│                │               │                │
 │              │                │                │               │                │
 │              │ executePlannerTurn()            │               │                │
 │              │───────────────────────────────>│               │                │
 │              │                │                │               │                │
 │              │   ┌────────────────────────────────────────┐   │                │
 │              │   │ for await (event of planner.execute()): │   │                │
 │              │   │                                         │   │                │
 │              │   │  stream_part {text-delta}               │   │                │
 │              │   │  bus.emit(event, {agentKey:"planner"})  │   │                │
 │              │───│─────────────────────────────────────────────>│                │
 │ <── io.emit("stream", {agentId:"planner"}) ───────────────────── StreamPublisher│
 │              │   │                                         │   │                │
 │              │   │  stream_part {tool-call: submit_plan}   │   │                │
 │              │───│─────────────────────────────────────────────>│                │
 │ <── io.emit("stream", {tool-call}) ───────────────────────────── StreamPublisher│
 │              │   │                                         │   │                │
 │              │   │  done                                   │   │                │
 │              │───│─────────────────────────────────────────────>│                │
 │ <── io.emit("stream", {finish}) + persist ────────────────────── StreamPublisher│
 │              │   └────────────────────────────────────────┘   │                │
```

#### ChatAgent Message (AFTER migration — unicast bug fixed)

```
User        SocketMessageHandler   AgentFactory    ChatAgent        Bus           StreamPublisher
 │              │                      │              │               │                │
 │ chat msg     │                      │              │               │                │
 │─────────────>│                      │              │               │                │
 │              │                      │              │               │                │
 │              │  create(chat,        │              │               │                │
 │              │   { goalId, role })  │              │               │                │
 │              │─────────────────────>│              │               │                │
 │              │                      │ builds chat  │               │                │
 │              │                      │ + read tools │               │                │
 │              │                      │ + plugin tools│              │                │
 │              │  <── chatAgent ─────│              │               │                │
 │              │                      │              │               │                │
 │              │  for await (event of chatAgent.execute()):         │                │
 │              │                      │              │               │                │
 │              │  bus.emit(event, {agentKey:"chat:researcher"})     │                │
 │              │──────────────────────────────────────────────────>│                │
 │              │                      │              │               │                │
 │ <── io.to(goalRoom).emit("stream") ────────────────────────────── StreamPublisher│
 │              │                      │              │               │                │
 │  ALL users in room see the response (not just requesting socket)  │                │
 │              │                      │              │               │                │
 │              │  finish → persist via StreamPublisher               │                │
 │              │──────────────────────────────────────────────────>│                │
 │              │                      │              │ persist       │ addMessage()   │
```

---

## Review Findings (May 7, 2026)

Code review against live runtime identified 4 risks and 1 open question. Classified as **fix first** (must resolve before or during this feature), **safe to defer** (separate feature/ticket), or **avoid** (do not change in this feature).

### Finding 1 — HIGH: Async lifecycle observer would regress blocked-task handling

**Classification: AVOID — keep report_status as direct callback**

The architecture doc already says `report_status(blocked)` must stay synchronous. But `TaskLifecycleObserver` in the implementation plan is scoped too broadly — it lists `onStatusUpdate` as something it handles. In reality:

- `report_status` tool → sets `task.lastReportedStatus = "blocked"` synchronously in WorkerPool callback
- `OrchestratorService.dispatchTask()` L630-635 reads `afterTask.lastReportedStatus === "blocked"` immediately after `runTask()` returns
- If this mutation lands in an async observer, a blocked worker can be auto-completed as success before the blocked status arrives

**Rule:** `onStatusUpdate` stays as a direct callback passed to `assembleLifecycleTools()`. It is NOT a bus event. The `TaskLifecycleObserver` only handles post-execution events (`done`, `error`) — never mid-execution state mutations.

### Finding 2 — HIGH: WorkerPool has 5 callers, not just dispatchTask

The plan treats `dispatchTask()` as the main (only) path. In reality, `WorkerPool.runTask()` has 5 distinct call sites:

| # | Caller | Overload | goalId? | Awaited? |
|---|--------|----------|---------|----------|
| 1 | `OrchestratorService.dispatchTask()` | TaskWithContext | Yes | Yes |
| 2 | `OrchestratorService.spawnCollabWorkers()` | (taskId, role, msg, goalId) | Yes (resolved) | No (fire-and-forget) |
| 3 | `AgentManagerV2.startTaskExecution()` | TaskWithContext | **No** — missing | Yes |
| 4 | `AgentManagerV2.startTask()` | (taskId, role, msg) | **No** | Yes |
| 5 | `AgentManagerV2.continueTask()` | (taskId, role, msg) | **No** | Yes |

**Classification: FIX FIRST — AgentFactory must handle all 5 paths**

Call sites 3-5 (AgentManagerV2) don't pass goalId and don't go through OrchestratorService. If AgentFactory only wires into the dispatchTask path, these callers silently lose plugin setup, skill injection, and workspace branching.

**Resolution:** AgentFactory.buildWorker() must handle both overloads. For legacy callers (3-5), factory resolves goalId from TaskStore (same as current WorkerPool fallback). Collab workers (2) must also route through factory — they currently skip plugin preflight and skill injection.

### Finding 3 — MEDIUM: ChatAgent persistence stamps wrong userId

**Classification: SAFE TO DEFER — separate bug fix**

The current ChatAgent path in `SocketMessageHandler.ts` L309 persists assistant messages with:
```typescript
userId: await this.services.teamRegistry?.getOwner(teamId) ?? "system"
```

This means assistant responses are attributed to the team owner, not the requesting user. Combined with Mongo's `getSessionMessages()` filter `{ $or: [{ userId }, { role: "assistant" }] }`, all users see all assistant messages regardless of who asked. SQLite's `getSessionMessages()` has no user filter at all.

This is a multi-user bug, not a stream-bus concern. The bus refactor preserves the existing (broken) behavior — `StreamPublisherObserver` will persist with the same userId logic. Fix separately in the multi-user feature.

### Finding 4 — HIGH: CRDT auth hole grows with more CRDT usage

**Classification: SAFE TO DEFER — but document the risk**

`HocuspocusServer.ts` L365-367:
```typescript
async onAuthenticate({ token }) {
  return { user: token || "anonymous" };
}
```

No team-level authorization. Any WebSocket client that reaches the Hocuspocus port can read/write any CRDT document. The stream-bus feature doesn't increase CRDT usage (observers don't create new CRDT docs), but the broader architecture trend of CRDT-as-planning-substrate amplifies this hole.

**Rule for this feature:** CrdtStatusObserver only calls `updateAgentStatus()` (existing path). Do NOT add new CRDT document creation or cross-goal CRDT access in this feature. CRDT auth is tracked in [crdt-auth](../crdt-auth/).

### Open Question: Multi-goal blockers are NOT fixed by this feature

The stream-bus improves structure but does not fix the scaling blockers:
- `messageChain` in OrchestratorService serializes all goals into one promise chain
- `activeGoalId` fallback in GoalManager collapses to last-active goal
- `MAX_CONCURRENT_DISPATCHES=2` is global, not per-goal

These are documented in [goal-sessions](../goal-sessions/feature_implementation_planning.md). The bus makes them easier to fix later (each observer is goal-scoped via `StreamContext.goalId`), but the fix is a separate feature.

---

### What This Does NOT Fix

The bus + factory is a streaming/creation cleanup. Multi-goal blockers need separate fixes:

| Blocker | Where | Fix |
|---------|-------|-----|
| `FF_PARALLEL_PLANS` gate | GoalManager | Remove if block |
| `activeGoalId` scalar | GoalManager | Require explicit goalId |
| `messageChain` serializes all goals | OrchestratorService | `Map<goalId, Promise>` |
| `MAX_CONCURRENT_DISPATCHES=2` global | DispatchManager | `Map<goalId, Budget>` |

See [goal-sessions implementation plan](../goal-sessions/feature_implementation_planning.md).

| File | Replaced By |
|------|------------|
| `SocketEventBroadcaster.ts` | `StreamPublisherObserver` |

---

## Execution Flow (After)

```
OrchestratorService.dispatchTask(taskId, role):
  │
  ├── 1. Configure agent
  │     definition = workerPool.getDefinition(role)
  │     agent = new AiSdkAgent(definition)
  │     tools = assembleLifecycleTools(...) + pluginRegistry.getTools(...)
  │     agent.setTools(tools)
  │
  ├── 2. Create bus with observers
  │     bus = new AgentStreamBus()
  │     bus.addObserver(streamPublisherObserver)  // Channel A
  │     bus.addObserver(channelBObserver)          // Channel B
  │     bus.addObserver(taskLifecycleObserver)     // done/error
  │     bus.addObserver(crdtStatusObserver)        // CRDT
  │
  └── 3. Iterate + emit
        for await (event of workerPool.executeAgent(agent, taskId)):
          bus.emit(event, { teamId, goalId, agentKey: role, taskId })
```

---

## Impact on Frontend

None. Socket.IO events are identical — same `stream` channel, same payload shape. `StreamPublisherObserver` emits the same data that `SocketEventBroadcaster` does now.

**One fix:** ChatAgent responses will now broadcast to the goal room (via observer) instead of unicasting to the requesting socket. This means other users watching the same goal will see ChatAgent responses — which is correct behavior.
