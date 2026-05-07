# Goal Sessions & Horizontal Scaling — System Design Research

**Date:** May 6, 2026
**Status:** Research
**Purpose:** First-principles system design for scaling AI agent orchestration. Goals are collaborative sessions — not jobs. How do you host N concurrent interactive sessions with isolation?

---

## 0. The Mental Model: Goals are Sessions, Not Jobs

A goal is **not** a batch job you dispatch and wait for. It's a **collaborative session** — like a Google Doc.

```
Google Docs                          Ping Goals
─────────────                        ──────────
Create a doc                         Create a goal
  → opens a workspace                 → opens a planning session
  → you and collaborators edit         → you and agents collaborate
  → doc stays open, you come back      → session stays alive, you come back
  → multiple docs open as tabs         → multiple goals open as tabs
  → each doc is independent            → each goal is independent
  → doc persists forever               → goal persists with all artifacts
```

**Key properties of a session (not a job):**

| Property | Job (Temporal/BullMQ) | Session (Google Docs / Ping Goal) |
|----------|----------------------|-----------------------------------|
| Lifecycle | Submit → process → done | Create → active → idle → resume → done |
| Duration | Seconds to hours | Hours to days to weeks |
| Interaction | Fire-and-forget (maybe callbacks) | Continuous bidirectional (chat, edits, approvals) |
| State | Intermediate checkpoints | Living workspace (CRDT docs, agent conversations) |
| User presence | Not needed | User is a participant — can be active or away |
| Concurrency | Queue depth | Open tabs (user mentally context-switches) |
| Failure | Retry the job | Reconnect to the session (state survives) |

**What happens in a goal session:**
1. User creates goal → session starts in `gathering` state
2. Planner joins as a collaborator — researches, asks questions, creates documents
3. User and planner co-edit plan documents in real-time (CRDT)
4. Plan approved → workers join as collaborators, execute tasks
5. User can chat with any agent at any time (ChatAgents)
6. User can open another goal (new tab) while this one runs
7. User closes browser → comes back → session restores exactly where they left off
8. All tasks complete → session enters `done` state (artifacts persist)

**This is not "run a pipeline." This is "open a workspace and work with AI teammates."**

---

## 1. Requirements Analysis

### Functional Requirements

1. A user/team can have multiple goal sessions open simultaneously (like browser tabs)
2. Each session is isolated — one session crashing/stalling doesn't affect others
3. Sessions are long-lived — hours to days, survive disconnects and server restarts
4. Each agent in a session streams tokens to the user in real-time (<100ms latency)
5. User can leave a session and come back — full state restored (conversation, documents, task progress)
6. Sessions can be distributed across machines (horizontal scaling)
7. User can interact with any agent in any session at any time (not just the "active" one)

### Session Lifecycle

```
create → gathering → ready → executing → done
  │         │          │         │          │
  │         │          │         │          └── artifacts persist, session closeable
  │         │          │         └── workers active, user monitors + chats
  │         │          └── plan reviewed, user approves/tweaks
  │         └── planner + user co-creating plan docs (CRDT)
  └── empty session, waiting for first message
  
At ANY point:
  - User can disconnect → session stays alive (agents keep working)
  - User can reconnect → full state restored from PG + MongoDB + CRDT
  - User can open another session → both run concurrently
  - User can chat with any agent → ChatAgent handles in parallel
```

### Non-Functional Requirements

| Requirement | Target | Current |
|-------------|--------|---------|
| Stream latency (agent → user) | <100ms p99 | ~5ms (in-process) |
| Concurrent sessions per team | 10+ | 1 (mutex) |
| Session crash isolation | Full (process-level) | None (shared process) |
| Reconnect time | <2s (state from DB) | N/A |
| Session idle lifespan | Days (persist to DB, reload on demand) | Dies with process |
| Max workers per session | Configurable (default 3) | Global limit of 2 |

### Scale Tiers

| Tier | Users | Concurrent Sessions | Workers | Infrastructure |
|------|-------|---------------------|---------|----------------|
| **Dev** | 1 | 1-3 | 3-6 | Single process, no Redis |
| **Alpha** | 5-20 | 5-15 | 15-30 | Single server, Redis |
| **Beta** | 50-200 | 20-100 | 60-200 | Multi-server |
| **Production** | 1000+ | 100-500 | 300-1000 | Auto-scaling fleet |

---

## 2. Industry Precedents

### Google Docs / Hocuspocus — Collaborative Sessions

**Model:** Each document is a session. Users connect/disconnect freely. State lives in CRDT, persisted to storage. Server manages operational transforms / CRDT merges.

```
Browser Client ──WebSocket──► Session Server ──► Blob Storage (persistence)
Browser Client ──WebSocket──►     │
                                  ├── CRDT state (in-memory while active)
                                  ├── Presence (who's connected)
                                  └── Awareness (cursors, selections)
```

**Key insights for us:**
- **Sessions are lazy-loaded.** When no one is connected, the session unloads from memory. When someone reconnects, it reloads from storage. This is how you handle thousands of sessions on finite servers.
- **State is the document, not the process.** The session doesn't "run" — it exists as persistent state that gets loaded into memory when needed. Agents working = state mutations. No agents working = idle state on disk.
- **Multiple participants connect/disconnect independently.** The user and 5 agents are all "collaborators" in the session. Any of them can join/leave.
- **This is exactly what Hocuspocus already does for our CRDT docs.** Each goal's plan/task docs are already collaborative sessions. The missing piece is that the orchestration layer (planner, workers) isn't modeled as a session participant.

**What we borrow:** Lazy session loading/unloading. Presence model. Session = persistent state, not running process.

### Figma — Multiplayer Design Sessions

**Model:** Each file is a session with real-time collaboration. Server processes operations, clients get updates via WebSocket.

**Key insights:**
- **Per-file servers.** Figma routes each file to a specific server. The server holds the file's state in memory while anyone is connected. When everyone disconnects, state is flushed to storage and the server slot is freed.
- **Server affinity** — all operations for a file go to the same server (consistent hashing). This is goal pinning.
- **Multiplexed connections** — one WebSocket from the browser carries multiple file sessions (user can have multiple tabs).

**What we borrow:** Server affinity for sessions. Multiplex multiple sessions over one connection.

### Replit — Collaborative Coding with AI

**Model:** Each Repl is a workspace (container) with an embedded AI agent. User and AI collaborate in the same environment.

**Key insights:**
- **Workspace = container.** Full process isolation by design. Each workspace has its own filesystem, processes, network.
- **AI agent is a session participant**, not a separate service. It reads/writes the same files, sees the same terminal, responds to the same chat.
- **Workspaces can idle.** When no one is connected, the container sleeps (but persists). Wakes on reconnect.

**What we borrow:** Agent as session participant. Workspace can idle/wake.

### Temporal.io — Workflow Orchestration (CONTRAST)

**Model:** Coordinator (Temporal Server) + Worker Processes + Task Queues + Event History. Workers are stateless — workflow state is reconstructed from event history.

**What we borrow:** Task queue model for worker dispatch. Event history for crash recovery.
**What doesn't fit:** No real-time streaming. Planner is stateful and conversational — can't replay from history like Temporal workflows.

### Figma — Per-Document Server with Rust Child Processes (DEEP DIVE)

**Architecture (from Figma engineering blog):**

```
Load Balancer
  │
  ├── Multiplayer Server A (Node.js/Rust)
  │     ├── Rust child process: Document X  ← one process per doc
  │     ├── Rust child process: Document Y
  │     └── WebSocket connections for docs X, Y
  │
  ├── Multiplayer Server B (Node.js/Rust)
  │     ├── Rust child process: Document Z
  │     └── WebSocket connections for doc Z
  │
  └── Each document lives on exactly ONE server
      (consistent hashing routes all connections for a doc to the same server)
```

**Key insights (direct quotes from engineering blog):**

1. **"Our servers currently spin up a separate process for each multiplayer document."** — One process per active document. This is process-per-session, not session-pool.

2. **"We couldn't just create a separate node.js process for every document because the memory overhead of the JavaScript VM would have been too high."** — So they used Rust child processes (30MB → ~5MB per doc). The Node.js parent handles WebSocket networking; the Rust child handles document operations.

3. **"A single slow operation would lock up the entire worker for all files associated with that worker."** — This is exactly our problem. One goal's slow LLM call blocks other goals.

4. **"When a document is opened, the client starts by downloading a copy of the file. From that point on, updates are synced over WebSocket."** — Session = download state → real-time sync. Same as our cold → hot model.

5. **"Figma lets you go offline for an arbitrary amount of time and continue editing. When you come back online, the client downloads a fresh copy."** — Reconnect = re-download + replay edits. Our equivalent: restore from PG + MongoDB + CRDT.

**What we borrow:**
- One process/isolate per active session (but in our case, Node.js worker_threads or child_process, not Rust)
- Parent process handles networking (WebSocket/Socket.IO), child handles session logic
- Consistent hash routing to pin sessions to servers
- **Critical insight: Figma had the same problem we have (JS VM overhead per process) and solved it with lower-overhead child processes**

### Discord — Data Services with Request Coalescing (DEEP DIVE)

**Architecture (from Discord engineering blog):**

```
API Monolith
  │
  ├── Data Service (Rust, per-database)
  │     ├── gRPC endpoints (one per query type)
  │     ├── Request coalescing: N identical requests → 1 DB query
  │     └── Consistent hash routing: channel_id → same service instance
  │
  └── ScyllaDB (Cassandra-compatible, C++)
```

**Key insights:**

1. **"If multiple users are requesting the same row at the same time, we'll only query the database once."** — Request coalescing. The first request spawns a worker task; subsequent requests subscribe to its result.

2. **"We implemented consistent hash-based routing to our data services. For messages, this is a channel ID."** — Channel affinity. All requests for the same channel go to the same service instance. Enables coalescing.

3. **"Hot partitions" were their #1 scaling problem.** A popular Discord server's channel would overwhelm a single DB node. Solved by data services as a buffer layer.

**What we borrow:**
- Consistent hash routing by goalId (all requests for a goal → same server)
- Request coalescing could help if multiple users watch the same goal
- Data service pattern: thin stateless buffer between API and database

### Microsoft Orleans — Virtual Actors / Grains (DEEP DIVE)

**Model:** Virtual actors ("grains") that are automatically activated on first use and deactivated after idle timeout. The runtime manages placement, lifecycle, and messaging.

```
Silo Cluster (N servers)
  │
  ├── Silo A
  │     ├── Grain: PlayerGrain("alice")    ← activated in memory
  │     ├── Grain: GameGrain("game-1")     ← activated in memory
  │     └── Grain: PlayerGrain("bob")      ← deactivated (idle timeout)
  │
  ├── Silo B
  │     ├── Grain: GameGrain("game-2")
  │     └── Grain: PlayerGrain("charlie")
  │
  └── Grain Directory (distributed hash table)
        Maps grain identity → silo location
```

**Key insights:**

1. **"Grains are virtual."** They always exist conceptually (you can always get a reference to `GoalGrain("goal-001")`), but they're only **activated** (loaded into memory) when someone calls them. This is exactly our cold/hot model.

2. **`OnActivateAsync()` / `OnDeactivateAsync()`** — lifecycle hooks for load/unload. Our equivalent: `loadSession()` (restore from PG/MongoDB) and `unloadSession()` (flush + dispose).

3. **"Grain placement"** — the runtime decides which silo hosts which grain. Strategies: random, prefer-local, hash-based. Our equivalent: session router with consistent hashing.

4. **"Exceptions don't cause grain deactivation."** A grain can fail and still stay active. Only storage inconsistency triggers deactivation. Good model — one failed agent response shouldn't kill the session.

5. **`IAsyncEnumerable<T>` return values** — Orleans supports streaming results from grains. "Returning large collections progressively, streaming real-time updates." This is exactly our token streaming need.

6. **"Grain references are independent of physical location."** You call `GetGrain<IGoalGrain>(goalId)` and the runtime routes to the correct silo. The caller never knows which machine hosts it. Our equivalent: `SessionRouter.route(goalId)`.

**What we borrow:**
- **Virtual actor model is the best fit for goal sessions.** Goals are virtual actors. They activate on first use, deactivate after idle timeout, and can be placed on any server.
- Lifecycle hooks (OnActivate = loadSession, OnDeactivate = unloadSession)
- Grain placement = session routing
- `IAsyncEnumerable` streaming = token streaming through Redis Streams

---

## 3. Design Patterns Comparison

| Pattern | System | How It Routes | How It Streams | Session State | Idle Handling |
|---------|--------|---------------|----------------|---------------|---------------|
| **Process-per-doc** | Figma | Consistent hash → server, then fork child per doc | Direct IPC (stdin/stdout) between parent+child | In-memory (Rust process) + blob storage | Child killed on last disconnect |
| **Data service + coalescing** | Discord | Consistent hash by channel_id → service instance | gRPC response streaming | Stateless (DB is source of truth) | N/A (stateless) |
| **Virtual actor** | Orleans | Grain directory (DHT) → silo | `IAsyncEnumerable` over RPC | Grain state + persistence provider | Auto-deactivation after idle timeout |
| **Session pool** | Our current proposal | Consistent hash by goalId → session host server | Redis Streams per agent | GoalSession in-memory + PG/MongoDB/CRDT | Idle timeout → unload → cold storage |

### Our System is Closest to Orleans

| Orleans Concept | Ping Equivalent |
|-----------------|-----------------|
| Grain | GoalSession |
| Grain Identity | goalId |
| Silo | Session Host Server |
| Grain Activation | loadSession() — restore from PG + MongoDB |
| Grain Deactivation | unloadSession() — flush + dispose |
| Grain Directory | Session Router (Redis hash: goalId → serverId) |
| Grain Placement Strategy | Consistent hash or least-loaded |
| `IAsyncEnumerable` stream | Redis Streams per agent |
| `OnActivateAsync` | GoalSession.initialize() |
| `OnDeactivateAsync` | GoalSession.flush() + dispose() |

**We don't need Orleans itself** (it's .NET, and the overhead of adopting a framework outweighs the benefit at our scale). But the **virtual actor pattern** is the right mental model. We implement it ourselves in Node.js/TypeScript.

---

## 4. Three Possible Designs for Our System

### Design A: Session Pool (Current Proposal)

Multiple sessions share one Node.js process. Sessions are objects in a Map. No process isolation between sessions.

```
Server Process
├── SessionHost (manages Map<goalId, GoalSession>)
│   ├── GoalSession("goal-001") — hot
│   ├── GoalSession("goal-002") — hot
│   └── GoalSession("goal-003") — warm (idle)
├── Express + Socket.IO
├── StreamMux (Redis Streams subscriber)
└── Shared: PG pool, MongoDB pool, Redis
```

**Pros:** Simplest. No IPC overhead. Shared DB connections. Easiest to debug.
**Cons:** No crash isolation. One session's unhandled error kills all sessions on that server. One slow LLM response blocks the event loop for all sessions.

**Best for:** Dev + Alpha (1-15 sessions).

### Design B: Process-Per-Session (Figma Model)

Each session runs in a child process. Parent handles networking.

```
Parent Process (Gateway)
├── Express + Socket.IO
├── SessionRouter (goalId → child process)
├── StreamMux (reads Redis Streams → Socket.IO)
│
├── fork() → child: GoalSession("goal-001")
│   └── Agents, TaskStore, DispatchManager
│   └── Publishes tokens to Redis Streams
│
├── fork() → child: GoalSession("goal-002")
│   └── (same, fully independent)
│
└── Redis + PG + MongoDB (each child has own connections)
```

**Pros:** Full crash isolation. Each session has its own event loop (no blocking). Memory limits per child.
**Cons:** 30MB overhead per Node.js process. DB connection proliferation (N sessions × M connections). IPC overhead for commands.

**Best for:** Beta (20-100 sessions) where crash isolation matters.

### Design C: Hybrid — Session Pool + Worker Threads for Heavy Sessions

Most sessions run in the main process (pool). Sessions that become "heavy" (many active workers, high LLM concurrency) are promoted to worker_threads.

```
Main Process
├── Express + Socket.IO
├── SessionHost (lightweight sessions in-process)
│   ├── GoalSession("goal-001") — in-process (light, 1 agent)
│   ├── GoalSession("goal-002") — in-process (light, planning only)
│   └── GoalSession("goal-003") — PROMOTED to worker thread
│
├── WorkerThread → GoalSession("goal-003")  ← 3 workers, heavy LLM load
│   └── Isolated V8 heap, own event loop
│   └── Communicates via postMessage()
│
└── Redis + PG + MongoDB
```

**Promotion criteria:** Session is promoted to a worker thread when:
- It has 3+ active workers running concurrently
- OR its LLM response processing is measurably slow (event loop lag > 50ms)
- OR it exceeds a memory threshold

**Pros:** Best of both worlds. Light sessions (planning, chatting) stay in-process with zero overhead. Heavy sessions (execution with many workers) get isolation.
**Cons:** Most complex. Two code paths (in-process vs thread). Promotion/demotion logic adds edge cases.

**Best for:** Production (100+ sessions) with mixed workloads.

---

## 5. Recommendation: Virtual Actor Runtime (Orleans-Inspired)

Don't graduate between designs. **Build one abstraction that works at all scales.** Orleans proved this — virtual actors handle single-process dev and multi-server production with the same programming model. The caller never knows where the actor lives.

### Why Not "Start A, Graduate to B"

| Problem | Impact |
|---------|--------|
| Two code paths to maintain | SessionPool vs ProcessPerSession have different IPC, error handling, resource management |
| Migration day | Switching from A to B is a risky deployment, not a config change |
| Testing gap | Tests pass on A, but B has different timing/concurrency characteristics |
| Mental model shift | Developers think in one model, then must unlearn it |

### Why Virtual Actors

Orleans's key insight: **the caller doesn't care about deployment topology.** You call `getSession(goalId).handleMessage(content)`. The runtime decides where it runs.

```typescript
// This code works identically whether the session is:
// - in-memory on this process (dev)
// - in a child process on this machine (single server)
// - on a different server across the network (production)

const session = runtime.getSession(goalId);
await session.handleMessage(content);
```

### The Virtual Actor Contract

```typescript
interface IGoalSession {
  handleMessage(content: string, agentId?: string): Promise<void>;
  approvePlan(): Promise<void>;
  rejectPlan(feedback: string): Promise<void>;
  cancel(): Promise<void>;
  getState(): Promise<GoalState>;
}
```

**That's it.** No `loadSession`, no `unloadSession`, no routing, no affinity, no stream setup. The runtime handles all of that.

### GoalSessionRuntime — Our Orleans

```typescript
class GoalSessionRuntime {
  private directory = new Map<string, SessionLocation>();  // goalId → where
  private local = new Map<string, GoalSession>();          // goalId → instance (if local)

  /** Get or create a session reference. Transparent location. */
  getSession(goalId: string): IGoalSession {
    const location = this.directory.get(goalId);

    if (!location) {
      // First access — activate locally
      return this.activate(goalId);
    }

    if (location.serverId === this.serverId) {
      // Local — return direct reference (zero overhead)
      return this.local.get(goalId)!;
    }

    // Remote — return proxy that forwards via Redis/BullMQ
    return new RemoteSessionProxy(goalId, location.serverId);
  }

  /** Activate a session (Orleans: OnActivateAsync) */
  private async activate(goalId: string): Promise<IGoalSession> {
    const session = new GoalSession(goalId);
    
    // Load state from cold storage
    await session.onActivate();  // PG + MongoDB + CRDT restore
    
    this.local.set(goalId, session);
    this.directory.set(goalId, { serverId: this.serverId });
    this.startIdleTimer(goalId);
    
    return session;
  }

  /** Deactivate after idle timeout (Orleans: OnDeactivateAsync) */
  private async deactivate(goalId: string) {
    const session = this.local.get(goalId);
    if (!session) return;

    await session.onDeactivate();  // flush state + dispose agents
    
    this.local.delete(goalId);
    this.directory.delete(goalId);
  }
}
```

### How It Scales (Same Code, Different Runtime Config)

| Scale | Runtime Behavior | Config |
|-------|-----------------|--------|
| **Dev** | All sessions in-process. `getSession()` returns direct reference. No Redis. | `RUNTIME=local` |
| **Single server + Redis** | All sessions in-process. Tokens via Redis Streams. Message persistence in StreamMux. | `RUNTIME=redis` |
| **Multi-process** | Sessions distributed across `child_process.fork()` children. `getSession()` returns IPC proxy for remote sessions. | `RUNTIME=fork` |
| **Multi-server** | Sessions distributed across machines. `getSession()` returns Redis proxy. Directory in Redis. | `RUNTIME=distributed` |

**The GoalSession code never changes.** Only the runtime changes how `getSession()` resolves.

### Implementation Phases (One Design, Progressive Runtime)

| Phase | Runtime | What Changes | Effort |
|-------|---------|-------------|--------|
| **0** | `LocalRuntime` | Extract `IGoalSession` + `GoalSessionRuntime`. Wrap current GoalManager. `getSession()` returns direct in-memory reference. **Zero behavior change.** Fix ChatAgent broadcast. | 1 week |
| **1** | `LocalRuntime` + idle | Add `onActivate`/`onDeactivate` lifecycle. Sessions load from PG/MongoDB. Idle timeout → deactivate. Per-session DispatchManager. | 2 weeks |
| **2** | `RedisRuntime` | Add Redis Streams for token delivery. StreamMux subscriber. Message persistence moves to mux. Same `IGoalSession` interface. | 2 weeks |
| **3** | `ForkRuntime` | Sessions in child processes. `getSession()` returns IPC proxy for remote. Parent forwards via `process.send()`. | 2-3 weeks |
| **4** | `DistributedRuntime` | Directory in Redis. `getSession()` returns Redis proxy for cross-server. BullMQ for reliable command delivery. | 2-3 weeks |

**Each phase is additive.** Phase 0 → 1 adds lifecycle. 1 → 2 adds Redis. 2 → 3 adds process isolation. 3 → 4 adds multi-server. No migration, no rewrite — just a new runtime implementation behind the same interface.

### Why This Is Better Than Designs A/B/C

| Concern | A→B Graduation | Virtual Actor |
|---------|---------------|---------------|
| Code changes per scale tier | Rewrite routing + IPC + error handling | Swap `RUNTIME` env var |
| Testing | Must test both A and B | Test once against `IGoalSession`, runtime is infrastructure |
| Developer mental model | "Session pool" → "child processes" → "BullMQ workers" | Always "virtual actors" — where they run is invisible |
| Rollback | Complex (different architecture) | Change one env var |
| Incremental adoption | Must commit to A or B | Can run A and B simultaneously (some sessions local, some forked) |

**Model:** Coordinator (Temporal Server) + Worker Processes + Task Queues + Event History

---

## Appendix A: Detailed Technical Designs

The sections below contain detailed implementation sketches for the chosen architecture. They complement the high-level design in sections 3-5.

### A.1 Per-Agent Stream Keys

```
stream:{teamId}:{goalId}:{agentType}:{agentId}

Planner:    stream:alpha:goal-001:planner:planner
Worker:     stream:alpha:goal-001:worker:backend-dev
ChatAgent:  stream:alpha:goal-001:chat:researcher

Why agentType in the key?
  - Coordinator can subscribe by pattern: stream:alpha:goal-001:*
  - Filtering by type: stream:alpha:goal-001:worker:*
  - Cleanup by type: DEL stream:alpha:goal-001:worker:*
```

### Stream Entry Protocol

```
XADD stream:alpha:goal-001:worker:backend-dev * \
  t sp \                          # type: stream_part (abbreviated)
  tid task-3 \                    # taskId (workers only)
  p '{"type":"text-delta","textDelta":"Hello"}' \  # part payload
  s 42                            # sequence number
```

Finish sentinel:
```
XADD stream:alpha:goal-001:worker:backend-dev * \
  t fin \
  tid task-3 \
  txt "Full response text" \
  pts '[...rendered parts...]'
```

---

## 5. Coordinator Design (StreamMux)

The coordinator subscribes to ALL active streams using a single `XREAD BLOCK` call. Redis handles the multiplexing.

```typescript
class StreamMux {
  private cursors = new Map<string, string>();  // streamKey → lastEntryId
  private running = true;

  // Subscribe to a goal's agents
  addGoal(teamId: string, goalId: string, agents: string[]) {
    for (const agent of agents) {
      this.cursors.set(`stream:${teamId}:${goalId}:${agent}`, "$");
    }
  }

  // Main loop — single async loop watches all streams
  async run(io: SocketIOServer) {
    while (this.running) {
      if (this.cursors.size === 0) { await sleep(100); continue; }

      const keys = [...this.cursors.keys()];
      const ids = [...this.cursors.values()];

      // Single XREAD BLOCK on ALL active streams
      // Redis returns entries from ANY stream that has new data
      const results = await redis.xread(
        "BLOCK", 50,    // 50ms block — natural batching
        "COUNT", 100,   // up to 100 entries per stream
        "STREAMS", ...keys, ...ids
      );

      if (!results) continue;

      for (const [streamKey, entries] of results) {
        // Parse key: stream:{teamId}:{goalId}:{agentType}:{agentId}
        const [, teamId, goalId] = streamKey.split(":");
        const room = `team:${teamId}:goal:${goalId}`;

        for (const [entryId, fields] of entries) {
          const data = parseEntry(fields);
          
          if (data.type === "stream_part") {
            io.to(room).emit("stream", buildPayload(streamKey, data));
          } else if (data.type === "finish") {
            await persistMessage(teamId, goalId, data);
            this.cursors.delete(streamKey);  // agent done
            await redis.del(streamKey);       // cleanup
          }

          // Advance cursor for this stream
          this.cursors.set(streamKey, entryId);
        }
      }
    }
  }
}
```

**Why one loop, not one subscriber per stream?**
- `XREAD BLOCK` on N keys is a single Redis command — O(1) network round-trip regardless of N
- Adding/removing streams is just adding/removing keys from the cursor map
- No thread management, no race conditions, no subscriber lifecycle

---

## 6. Session Host Design

Each session host server manages N goal sessions in-process. Sessions share the server's event loop, DB connections, and Redis connection, but have isolated state.

```typescript
// session-host.ts — manages multiple goal sessions on one server

class SessionHost {
  private sessions = new Map<string, GoalSession>();
  private idleTimers = new Map<string, NodeJS.Timeout>();

  // Load session from cold storage into memory
  async loadSession(goalId: string): Promise<GoalSession> {
    if (this.sessions.has(goalId)) return this.sessions.get(goalId)!;

    // Restore from persistent state
    const goalContext = await pg.getGoal(goalId);
    const tasks = await pg.getTasksByGoal(goalId);
    const conversation = await mongo.getConversation(goalId, "planner");

    const session = new GoalSession({
      goalId,
      goalContext,
      tasks,
      streams: new RedisStreamPublisher(redis),
      lifecycle: new RedisLifecyclePublisher(redis),
      maxWorkers: parseInt(process.env.MAX_WORKERS_PER_SESSION || "3"),
    });

    // Restore planner conversation (v1.2 persistence)
    if (conversation) {
      session.restorePlannerConversation(conversation);
    }

    this.sessions.set(goalId, session);
    this.resetIdleTimer(goalId);
    return session;
  }

  // Unload idle session to free memory
  async unloadSession(goalId: string) {
    const session = this.sessions.get(goalId);
    if (!session) return;

    // Flush any pending state to storage
    await session.flush();
    // Dispose agents (free LLM context memory)
    session.dispose();
    this.sessions.delete(goalId);
  }

  private resetIdleTimer(goalId: string) {
    const existing = this.idleTimers.get(goalId);
    if (existing) clearTimeout(existing);

    this.idleTimers.set(goalId, setTimeout(() => {
      this.unloadSession(goalId);
    }, 30 * 60 * 1000)); // 30 min idle timeout
  }

  // Handle incoming command (from gateway via Redis)
  async handleCommand(goalId: string, cmd: GoalCommand) {
    const session = await this.loadSession(goalId); // lazy load
    this.resetIdleTimer(goalId); // activity resets idle
    await session.handleCommand(cmd);
  }
}
```

### GoalSession — The Session Object

```typescript
class GoalSession {
  private planner: PlannerAgent;
  private chatAgents = new Map<string, ChatAgent>();
  private workerPool: WorkerPool;
  private dispatch: DispatchManager;
  private streams: IStreamPublisher;
  private lifecycle: ILifecyclePublisher;

  constructor(private config: GoalConfig) {
    this.streams = new RedisStreamPublisher(config.redis);
    this.lifecycle = new RedisLifecyclePublisher(config.redis);
    
    // Per-goal concurrency — NOT a global limit
    this.dispatch = new DispatchManager({
      maxConcurrent: config.maxWorkersPerGoal ?? 3,
    });
  }

  async handleCommand(cmd: GoalCommand) {
    switch (cmd.type) {
      case "message":
        await this.handleMessage(cmd.content, cmd.agentId);
        break;
      case "approve":
        await this.approvePlan();
        break;
      case "cancel":
        await this.shutdown();
        break;
    }
  }

  private async handleMessage(content: string, agentId?: string) {
    if (!agentId || agentId === "planner") {
      // Planner turn — stateful, stays in this process
      for await (const event of this.planner.execute({ message: content })) {
        if (event.type === "stream_part") {
          await this.streams.publish(
            this.config.teamId,
            this.config.goalId,
            "planner:planner",
            event.part
          );
        }
      }
    } else if (agentId.startsWith("chat-")) {
      // Chat agent — stateful, stays in this process
      const role = agentId.replace("chat-", "");
      const agent = this.chatAgents.get(role);
      for await (const event of agent.execute({ message: content })) {
        if (event.type === "stream_part") {
          await this.streams.publish(
            this.config.teamId,
            this.config.goalId,
            `chat:${role}`,
            event.part
          );
        }
      }
    }
  }

  private async executeTask(task: Task) {
    // Worker — ephemeral, runs in this process but could be remote
    const agent = this.workerPool.createAgent(task.assignedRole);
    for await (const event of agent.execute()) {
      if (event.type === "stream_part") {
        await this.streams.publish(
          this.config.teamId,
          this.config.goalId,
          `worker:${task.assignedRole}`,
          { ...event.part, taskId: task.taskId }
        );
      }
    }
    this.lifecycle.taskUpdate(this.config.goalId, task.taskId, "completed");
  }
}
```

---

## 7. Dev Mode (No Redis)

For local development, the same interfaces work with in-process implementations:

```typescript
// In-process — zero infrastructure
class InProcessStreamPublisher implements IStreamPublisher {
  constructor(private mux: InProcessStreamMux) {}
  
  async publish(teamId, goalId, agentKey, part) {
    // Direct callback — no Redis, no serialization
    this.mux.deliver(teamId, goalId, agentKey, part);
  }
}

class InProcessStreamMux {
  deliver(teamId, goalId, agentKey, part) {
    const room = `team:${teamId}:goal:${goalId}`;
    this.io.to(room).emit("stream", buildPayload(agentKey, part));
  }
}
```

**Feature flag:** `GOAL_ISOLATION=in-process|fork|bullmq`
- `in-process` (default): Current behavior, all goals in one process, direct callbacks
- `fork`: Goal processes via `child_process.fork()`, Redis Streams for tokens
- `bullmq`: Goal processes as BullMQ workers on separate machines

---

## 8. Failure Modes & Recovery

| Failure | Impact | Detection | Recovery |
|---------|--------|-----------|----------|
| **Session host crash** | N sessions on that host go down | Health check / heartbeat | Router reassigns sessions. Each reloads from cold storage (PG + MongoDB + CRDT). 1-3 seconds per session. |
| **Gateway crash** | All WebSocket connections drop | Frontend reconnect (Socket.IO auto) | New gateway. StreamMux resumes from last Redis cursor. Frontend re-subscribes. |
| **Redis crash** | Token streams lost, commands queued | Connection error | Redis Sentinel failover. In-flight tokens lost (acceptable). PG/Mongo state intact. |
| **Single session crash** | One session's agents die (bug in LLM response, OOM) | try/catch in SessionHost | Session marked as error. User notified. Can be reloaded from cold storage. Other sessions unaffected. |
| **Worker within session hangs** | One task stalled | Task timeout | Session kills worker, marks task failed, dispatches retry. Session itself stays alive. |
| **User disconnects** | Agents keep working (no user present) | Socket.IO disconnect event | Session stays hot. Agents continue autonomously. User reconnects later — full state available. |

### Session Recovery Data Flow (Cold → Hot)

```
Session host crashes (or session unloaded due to idle timeout)
  │
  ├── User sends new message (or agent needs to act)
  │
  ├── Gateway routes to (any) session host
  │
  ├── Session host calls loadSession(goalId):
  │   ├── PG: goal status, task statuses, plan metadata → GoalContext
  │   ├── MongoDB: planner conversation history → restore PlannerAgent
  │   ├── MongoDB: chatAgent conversations → restore ChatAgents
  │   ├── CRDT: plan documents, task specs → Hocuspocus reconnect
  │   └── Redis Streams: un-delivered tokens (XRANGE from 0) → catch up
  │
  ├── Session is now hot — ready to process commands
  │
  └── User's next message goes to the newly loaded session
```

**Key insight: recovery is just loading.** There's no special "recovery" mode. Loading a cold session and loading after a crash are the same operation. This is the Google Docs model — opening a doc is always the same, whether it's the first time or after a server restart.

---

## 9. Connection Pool Sizing

Each goal process needs database connections. This constrains max concurrent goals.

| Database | Per-process pool | 10 goals | 50 goals | Limit |
|----------|-----------------|----------|----------|-------|
| PostgreSQL | 2 connections | 20 | 100 | Neon free: 100 connections |
| MongoDB | 2 connections | 20 | 100 | Atlas M0: 500 connections |
| Redis | 1 connection (multiplexed) | 10 | 50 | Unlimited |

**Mitigation for PG connection pressure:**
- Use PgBouncer (connection pooler) in production
- Neon's built-in connection pooler supports 10K+ connections
- Goal processes use `pool.min = 1, pool.max = 3`

---

## 10. Cost Analysis

| Scale | Goals | Redis | PG (Neon) | MongoDB | Total |
|-------|-------|-------|-----------|---------|-------|
| Dev | 1-3 | Free (Docker) | Free | Free | $0 |
| Alpha | 5-15 | Upstash free (10K cmds/day) | Neon free | Atlas M0 | $0 |
| Beta | 20-100 | Upstash Pro ($10/mo) | Neon Launch ($19/mo) | Atlas M10 ($57/mo) | ~$86/mo |
| Production | 100-500 | Redis Cloud ($30/mo) | Neon Scale ($69/mo) | Atlas M20 ($140/mo) | ~$239/mo |

Redis Streams are very cheap — each token entry is ~100 bytes, entries are deleted after delivery. At 100 goals × 100 tokens/sec × 100 bytes = 1MB/sec throughput. Well within free tiers.

---

## 11. Implementation Phases (Revised)

| Phase | What | When | Effort |
|-------|------|------|--------|
| **0** | Extract `IStreamPublisher`/`IStreamSubscriber` interfaces. `InProcessStreamPublisher` wraps current callbacks. Fix ChatAgent to broadcast. Feature flag. **Zero behavior change.** | Now | 1 week |
| **1** | `GoalSession` class. Wrap current GoalContext + agents into a session object with load/unload/flush. Per-session `DispatchManager`. `SessionHost` manages N sessions in-process. Idle timeout → unload. | After Phase 4 (parallel goals) | 2 weeks |
| **2** | Add Redis. `RedisStreamPublisher` + `StreamMux`. Per-agent stream keys. Message persistence in mux subscriber. Batching. Gateway ↔ SessionHost communication via Redis. | After Phase 1 | 2 weeks |
| **3** | Multi-server. Session router (consistent hash). Session migration (host A → host B). Health checks. BullMQ for reliable command delivery across servers. | When single-server isn't enough | 2-3 weeks |

**Phase 0 is the critical first step.** It introduces the streaming abstraction without any infrastructure change. All subsequent phases swap implementations behind the same interface.

**Phase 1 is the session model.** It restructures the in-memory code from "GoalManager manages goals" to "SessionHost manages sessions." No Redis needed yet — sessions load/unload within the same process. The benefit is idle session cleanup (memory recovery) and the mental model shift.

---

## 12. Open Questions

1. **How many sessions per server?** Depends on LLM concurrency. Each hot session with 3 active workers = 3 concurrent LLM calls. At 10 sessions × 3 workers = 30 LLM calls. The bottleneck is LLM API rate limits, not server resources.

2. **Session affinity vs stateless routing?** With the session model, any server can host any session (load from cold storage). Affinity avoids the 1-3s cold load penalty. But if affinity fails (server dies), any server can pick up. **Prefer soft affinity** — route to the last-known host, fall back to any.

3. **CRDT access from sessions** — Each session connects to Hocuspocus as a client (same as frontend). Goal's CRDT docs are rooms that agents join/leave. This is already implemented — agents use `collab read/write` tools that go through the collab service.

4. **Rate limiting across sessions** — LLM API keys are per-team, not per-session. Use Redis `INCR + EXPIRE` for a sliding window. Each session checks the shared counter before making LLM calls.

5. **Should idle sessions keep CRDT connections?** No. When a session goes warm/cold, it disconnects from Hocuspocus. CRDT state persists in blob storage. When the session reloads, it reconnects. Hocuspocus handles this — it's designed for connect/disconnect patterns.

6. **Frontend UX for session switching** — User has 3 goals open. They click goal-002 in the sidebar. Frontend subscribes to Socket.IO room `team:{teamId}:goal:goal-002`. If the session is cold, the first message triggers a load. The 1-3s cold start could show a "Loading session..." indicator.
