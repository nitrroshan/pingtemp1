# Per-Goal Process Isolation — Feature Architecture

**Status:** Superseded by [multi-user](../multi-user/feature_architecture.md)  
**Note:** The production architecture in multi-user uses BullMQ worker processes (Option C below) as the primary approach, not a future add-on. Options A and B below remain valid for single-server development mode.

**Scope:** Run each goal in a separate OS process or worker thread for crash isolation and horizontal scaling  
**Depends on:** [parallel-goals](../parallel-goals/feature_architecture.md) Phase 5 (true parallel execution)  
**Related:** [parallel-plans/v3.0](../parallel-plans/v3.0/), [multi-user](../multi-user/feature_architecture.md), [redis-infrastructure](../redis-infrastructure/)

---

## Problem

After Phase 5 (parallel execution), all goals still share one Node.js process. This means:

1. **No crash isolation** — one goal's unhandled exception can crash all goals
2. **Single event loop** — 6 concurrent AI workers with tool calls contend for the same event loop
3. **Memory ceiling** — V8 heap limit (~4GB) shared across all goals, all LLM response buffers, all CRDT docs
4. **No horizontal scaling** — can't distribute goals across machines

## When This Matters

This feature is **NOT needed now**. Build it when:
- A single team regularly runs 5+ concurrent goals
- LLM response processing saturates the event loop (measured, not assumed)
- A goal crash has taken down other goals in production
- You need to distribute goals across multiple machines

---

## Architecture Options

### Option A: `child_process.fork()` — Separate Node.js Processes

**Implementation:** Each goal runs in a forked child process. The main process (coordinator) manages lifecycle, routes Socket.IO events, and forwards IPC messages.

```
Main Process (Coordinator)
 ├─ Express + Socket.IO server (stays here)
 ├─ AgentManagerRegistry (routes to correct child)
 ├─ GoalProcessManager (fork/kill/restart per goal)
 │
 ├─ fork() → Goal A process
 │   ├─ GoalContext + GoalManager (single goal)
 │   ├─ DispatchManager (per-goal dispatch chain)
 │   ├─ WorkerPool (creates AiSdkAgent instances)
 │   ├─ TaskStore (goal-scoped)
 │   └─ PlannerAgent + ChatAgents
 │
 ├─ fork() → Goal B process
 │   └─ (same structure, fully independent)
 │
 └─ Shared via Redis/MongoDB (not in-memory):
     ├─ Task state (CRDT docs persisted to disk)
     ├─ Conversations (MongoDB)
     ├─ Goal registry (which goals exist, their status)
     └─ LLM API rate limiter (Redis counter)
```

**IPC Protocol:** `child_process.fork()` provides built-in JSON IPC channel.

```typescript
// Coordinator → Goal process
type CoordinatorMessage =
  | { type: 'user-message'; goalId: string; content: string }
  | { type: 'approve-plan'; goalId: string }
  | { type: 'cancel'; goalId: string }
  | { type: 'get-state'; goalId: string }
  | { type: 'shutdown' }

// Goal process → Coordinator
type GoalMessage =
  | { type: 'stream-part'; goalId: string; part: StreamPart }
  | { type: 'state-change'; goalId: string; state: GoalState }
  | { type: 'task-update'; goalId: string; taskId: string; status: TaskStatus }
  | { type: 'error'; goalId: string; error: string }
  | { type: 'ready' }  // process initialized, accepting messages
```

**Coordinator forwards to Socket.IO:**
```typescript
goalProcess.on('message', (msg: GoalMessage) => {
  switch (msg.type) {
    case 'stream-part':
      io.to(`goal:${msg.goalId}`).emit('stream', msg.part);
      break;
    case 'state-change':
      io.emit('goal:stateChange', { goalId: msg.goalId, state: msg.state });
      break;
  }
});
```

**Pros:**
- Full crash isolation — child process dying doesn't affect coordinator or other goals
- Separate V8 heap per goal (~4GB each) — no shared memory pressure
- `child_process.fork()` IPC is built-in, reliable, and supports structured clone (Maps, Sets, Buffers)
- Can set `resourceLimits` (future: via worker_threads) or OS-level cgroup limits
- Simple to implement — GoalContext is already serializable plain data
- Each process has its own event loop — no contention from parallel tool calls
- Can be migrated to separate machines later (replace IPC with Redis pub/sub)

**Cons:**
- ~30MB memory overhead per process (V8 instance + Node.js runtime)
- IPC serialization cost — every stream_part event must be serialized/deserialized
- No shared memory — skill definitions, agent YAML loaded independently per process (or pre-loaded and passed via `workerData`)
- Socket.IO server must remain in coordinator — can't share socket handles across fork boundaries easily
- More complex deployment — process monitoring, restart logic, zombie cleanup

**Effort:** 2-3 weeks

---

### Option B: `worker_threads` — Same Process, Separate V8 Isolates

**Implementation:** Each goal runs in a worker thread. Shares process memory space but has its own V8 isolate and event loop.

```
Main Thread (Coordinator)
 ├─ Express + Socket.IO server
 ├─ GoalThreadManager (create/terminate workers)
 ├─ MessageChannel per goal (typed IPC)
 │
 ├─ Worker Thread → Goal A
 │   ├─ Receives workerData: { goalId, teamConfig, agentDefs }
 │   ├─ GoalContext + full execution stack
 │   └─ Communicates via parentPort.postMessage()
 │
 └─ Worker Thread → Goal B
     └─ (same, independent thread)
```

**IPC Protocol:** `MessagePort.postMessage()` with structured clone algorithm.

```typescript
// main thread
const worker = new Worker('./goal-worker.ts', {
  workerData: {
    goalId: 'goal-001',
    teamId: 'alpha',
    teamConfig: serializedTeamConfig,
    agentDefinitions: agentYamlMap,
  },
  resourceLimits: {
    maxOldGenerationSizeMb: 2048,  // 2GB heap cap per goal
    stackSizeMb: 8,
  },
});

worker.on('message', (msg: GoalMessage) => { /* forward to Socket.IO */ });
worker.on('error', (err) => { /* goal crashed, notify user, clean up */ });
worker.on('exit', (code) => { /* restart if unexpected */ });
```

**Shared resources via `SharedArrayBuffer`:**
```typescript
// Rate limiter shared across all goal threads
const rateLimitBuffer = new SharedArrayBuffer(4);
const rateLimitView = new Int32Array(rateLimitBuffer);
// Each thread atomically increments: Atomics.add(rateLimitView, 0, 1)
```

**Pros:**
- Lower overhead than fork (~5-10MB per thread vs ~30MB per process)
- Can share memory via `SharedArrayBuffer` (rate limiters, counters)
- `resourceLimits` built into Worker constructor — set max heap per goal
- Same TypeScript compilation — worker loads the same built code
- `worker.terminate()` cleanly kills a stuck goal
- Faster IPC than child_process — structured clone within same process, no pipe overhead
- `BroadcastChannel` for one-to-many notifications (goal state changes to all threads)
- `worker_threads.locks` (LockManager) for cross-thread coordination (experimental, Node.js 24+)

**Cons:**
- Partial crash isolation — uncaught exception kills the thread, not the process, BUT a native crash (segfault in a dependency) kills the entire process including all goals
- Worker threads can't use all Node.js APIs — `process.chdir()` unavailable, `process.env` is a copy
- Native addon compatibility — must be thread-safe (most LLM SDK deps are pure JS, should be fine)
- Debugging harder — thread-level breakpoints, interleaved logs
- `SharedArrayBuffer` requires careful atomic operations — easy to introduce subtle bugs

**Effort:** 2-3 weeks

---

### Option C: BullMQ + Separate Worker Processes (Job Queue Pattern)

**Implementation:** Goals dispatch tasks as BullMQ jobs. Separate worker processes pull from Redis queues. Fully decoupled.

```
Coordinator Process
 ├─ Express + Socket.IO
 ├─ GoalManager (tracks goal state)
 ├─ BullMQ Queue: "goal-tasks" (Redis-backed)
 │   ├─ Job: { goalId, taskId, role, context }
 │   └─ Job: { goalId, taskId, role, context }
 │
 ├─ BullMQ QueueEvents (listen for completed/failed)
 └─ Forwards events to Socket.IO

Worker Process 1 (any machine)
 ├─ BullMQ Worker("goal-tasks")
 ├─ AiSdkAgent execution
 ├─ Reports progress via job.updateProgress()
 └─ Returns result via job return value

Worker Process 2 (any machine)
 └─ (same, pulls next available job)
```

**Streaming challenge:** BullMQ progress events are polled via Redis pub/sub — not suitable for token-level streaming (stream_part). Would need a **parallel streaming channel** (Redis Streams or direct Socket.IO connection from worker to coordinator).

**Pros:**
- True horizontal scaling — workers on any machine
- Built-in retry, backoff, job priorities, rate limiting
- Dashboard (Bull Board) for monitoring
- Process isolation by design — workers are independent OS processes
- Language-agnostic workers possible (future: Python agents)

**Cons:**
- **Heaviest infrastructure** — requires Redis for job queue + separate worker deployment
- **Streaming latency** — BullMQ progress events add ~10-50ms latency vs direct IPC
- **Architecture rewrite** — current `WorkerPool.executeTask()` → `AiSdkAgent.execute()` flow is synchronous generator-based; must be refactored to job submission + async result collection
- Planner conversations don't fit the job queue model well — they're stateful, long-lived, interactive
- Two communication channels needed: BullMQ for task lifecycle + Redis Streams for real-time streaming
- Overkill until multi-machine deployment is needed

**Effort:** 4-6 weeks

---

## Recommendation

**Option B (worker_threads) for Phase 1. Option A (child_process.fork) for Phase 2. Option C (BullMQ) for Phase 3.**

The progression:

| Phase | Approach | When | Why |
|---|---|---|---|
| 1 | `worker_threads` | After Parallel Goals Phase 5 | Lowest overhead. V8 isolates give memory + crash isolation per goal. `resourceLimits` prevent runaway goals. Same codebase, no deployment changes. |
| 2 | `child_process.fork()` | When native crash isolation needed | If a dependency causes segfaults or V8 OOM kills, threads die together. Fork gives true OS-level isolation. IPC protocol already designed for serializable GoalContext. |
| 3 | BullMQ + separate workers | When multi-machine scaling needed | Only when single-server capacity is exceeded. Requires Redis infrastructure. The `IWorker` interface already supports remote execution. |

**Start with worker_threads because:**
- GoalContext is already serializable (Phase 5 design rule #4)
- IPC message types are already defined (stream_part, state-change, task-update)
- `resourceLimits` prevents a single goal from exhausting the heap
- Migration to child_process.fork is straightforward — same message protocol, just change the transport layer

---

## Design for All Three Options

### GoalProcessManager Interface

```typescript
interface IGoalProcessManager {
  /** Spawn a new isolated goal execution context */
  spawn(goalId: string, config: GoalSpawnConfig): Promise<void>;

  /** Send a user message to a running goal */
  sendMessage(goalId: string, content: string): Promise<void>;

  /** Approve a pending plan in a goal */
  approvePlan(goalId: string): Promise<void>;

  /** Get current state of a goal */
  getState(goalId: string): Promise<GoalState>;

  /** Terminate a goal (graceful shutdown) */
  terminate(goalId: string): Promise<void>;

  /** Kill a goal (immediate, for stuck goals) */
  kill(goalId: string): Promise<void>;

  /** Subscribe to goal events */
  on(event: 'stream-part', handler: (goalId: string, part: StreamPart) => void): void;
  on(event: 'state-change', handler: (goalId: string, state: GoalState) => void): void;
  on(event: 'error', handler: (goalId: string, error: Error) => void): void;
  on(event: 'exit', handler: (goalId: string, code: number) => void): void;
}

interface GoalSpawnConfig {
  goalId: string;
  teamId: string;
  teamConfig: SerializedTeamConfig;
  agentDefinitions: Map<string, AgentDefinition>;
  resourceLimits?: {
    maxHeapMb?: number;      // default: 2048
    maxWorkers?: number;     // default: 2
    timeoutMs?: number;      // default: 3600000 (1 hour)
  };
}
```

Three implementations:
- `WorkerThreadGoalManager implements IGoalProcessManager` — uses `worker_threads.Worker`
- `ForkGoalManager implements IGoalProcessManager` — uses `child_process.fork()`
- `BullMQGoalManager implements IGoalProcessManager` — uses BullMQ queues

### Goal Worker Entry Point

```typescript
// goal-worker.ts — loaded by worker_threads or fork()
import { parentPort, workerData } from 'worker_threads';

const { goalId, teamId, teamConfig, agentDefinitions } = workerData;

// Initialize isolated goal execution
const goalContext = new GoalContext(goalId, teamConfig);
const taskStore = new TaskStore();
const workerPool = new WorkerPool(agentDefinitions);
const dispatchManager = new DispatchManager(taskStore, workerPool);

// Wire event forwarding to parent
dispatchManager.onStreamPart((part) => {
  parentPort.postMessage({ type: 'stream-part', goalId, part });
});

dispatchManager.onStateChange((state) => {
  parentPort.postMessage({ type: 'state-change', goalId, state });
});

// Listen for commands from coordinator
parentPort.on('message', async (msg: CoordinatorMessage) => {
  switch (msg.type) {
    case 'user-message':
      await goalContext.handleMessage(msg.content);
      break;
    case 'approve-plan':
      await goalContext.approvePlan();
      break;
    case 'shutdown':
      await goalContext.gracefulShutdown();
      process.exit(0);
  }
});

parentPort.postMessage({ type: 'ready' });
```

### Streaming Through IPC

The key challenge: `AiSdkAgent.execute()` yields `stream_part` events at token-level granularity (~100+ events/second). IPC must handle this without backpressure issues.

**Worker threads:** `postMessage()` uses structured clone within the same process — fast, ~0.1ms per message. Handles 1000+ msgs/sec easily.

**Child process fork:** IPC over Unix domain socket (Linux/macOS) or named pipe (Windows). Slightly slower (~0.5ms per message) due to kernel context switch. Still handles 500+ msgs/sec.

**BullMQ:** Not suitable for token-level streaming. Use a parallel Redis Stream channel: worker publishes to `stream:{goalId}`, coordinator subscribes. ~2-5ms latency per message.

**Batching optimization (all options):**
```typescript
// Batch stream_parts to reduce IPC overhead
const batch: StreamPart[] = [];
let flushTimer: NodeJS.Timeout | null = null;

function emitStreamPart(part: StreamPart) {
  batch.push(part);
  if (!flushTimer) {
    flushTimer = setTimeout(() => {
      parentPort.postMessage({ type: 'stream-batch', goalId, parts: batch });
      batch.length = 0;
      flushTimer = null;
    }, 16); // ~60fps batching
  }
}
```

---

## Shared Resources Strategy

| Resource | In-Process (Phase 5) | Worker Threads | Child Processes | BullMQ Workers |
|---|---|---|---|---|
| Skill definitions | In-memory Map | Pass via `workerData` | Pass via IPC on init | Load from disk/Redis |
| Agent YAML | In-memory Map | Pass via `workerData` | Pass via IPC on init | Load from disk/Redis |
| LLM connections | Shared SDK instances | New instances per thread | New instances per process | New instances per process |
| Rate limiter | In-memory counter | `SharedArrayBuffer` + Atomics | Redis counter | Redis counter (BullMQ built-in) |
| Task state | CRDT docs (in-memory) | CRDT docs per thread | CRDT docs per process (persisted) | Redis/MongoDB |
| Conversations | MongoDB | MongoDB (same connection) | MongoDB (new connection per process) | MongoDB (new connection) |
| Socket.IO | Direct access | Coordinator forwards | Coordinator forwards | Coordinator forwards |
| Team config | AgentManagerRegistry | Passed at spawn time | Passed at spawn time | Stored in Redis |

**Key insight:** Worker threads can share the MongoDB connection pool (same process). Child processes each need their own connection. BullMQ workers need their own connections. This affects connection pool sizing.

---

## Implementation Phases

### Phase 1: IGoalProcessManager Interface (1 week)
- Define the interface
- Implement `InProcessGoalManager` (wraps current GoalManager — zero behavior change)
- Wire into OrchestratorService as the execution backend
- Feature flag: `GOAL_ISOLATION_MODE=in-process|thread|fork`

### Phase 2: WorkerThreadGoalManager (2 weeks)
- Create `goal-worker.ts` entry point
- Implement IPC message protocol
- Stream batching for high-throughput token streaming
- `resourceLimits` configuration (per-goal heap cap)
- Error handling: thread crash → notify user, clean up goal state
- Thread pool: max N threads (configurable, default: CPU count - 2)

### Phase 3: ForkGoalManager (1-2 weeks, if needed)
- Same IPC protocol, `child_process.fork()` transport
- Process monitoring: heartbeat check, zombie cleanup
- Graceful shutdown: SIGTERM → drain active tasks → exit
- Resource monitoring: memory usage per child, auto-kill on threshold

### Phase 4: BullMQ Integration (future, only if multi-machine needed)
- Redis infrastructure setup
- BullMQ queue + worker topology
- Parallel Redis Streams for real-time streaming
- Dashboard integration (Bull Board)

---

## Risks

| Risk | Impact | Mitigation |
|---|---|---|
| IPC overhead for streaming | Latency on token-level events | Batch stream_parts at 16ms intervals (~60fps) |
| Memory overhead per thread/process | 5-30MB per goal × 10 goals = 50-300MB | Set `maxOldGenerationSizeMb`, limit concurrent goals |
| MongoDB connection exhaustion | fork() creates new connections per process | Connection pooling, limit max processes |
| Complex debugging | Interleaved logs, thread-level breakpoints | Per-goal log files, goalId in all log entries |
| Native addon thread-safety | Crash if dependency isn't thread-safe | Audit AI SDK + LLM provider dependencies, use fork() as fallback |
| GoalContext serialization | Some state may not serialize cleanly | Design rule #4 already enforces serializable GoalContext |

---

## Decision Required

**Which approach should we start with: Option A (child_process.fork), Option B (worker_threads), or Option C (BullMQ)?**

Recommended: **Option B (worker_threads)** — lowest overhead, same codebase, `resourceLimits` built-in, easy migration path to fork() if native crash isolation is needed later.
