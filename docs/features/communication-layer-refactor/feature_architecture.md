# Communication Layer Refactor — Architecture

> **Updated:** May 1, 2026 — Full rewrite after deep audit of actual codebase  
> **Status:** Approved — v1 (coordinator) → v2 (unified store) → v3 (backend persistence)

## Root Problem

Goal state is fragmented across **7 independent locations** with no single owner. Every "fix" to date has been patching one location without reconciling the others. The result is 5+ race conditions and a GoalCoordinator that papers over the cracks without fixing the structure.

### The 7 Sources of Truth

| # | What | Location | Persisted? | Scoped by goalId? |
|---|------|----------|------------|-------------------|
| 1 | activeGoalId | `uiStore` (localStorage) | Yes | — |
| 2 | activeGoalId | `orchestrationStore` (in-memory) | No | One-way sync from #1 |
| 3 | subscribedGoal | `AgentServiceV2` (in-memory) | No | Tracked independently |
| 4 | Chat messages | `chatStore` (sessionStorage + Zustand) | Partially | Via composite key |
| 5 | Tasks + sessionState | `orchestrationStore` (Zustand) | No | Via `goalSessionStates` dict |
| 6 | planId→goalId mapping | `sessionStorage` (`ping:plans:{teamId}`) | Session-scoped | Optional field |
| 7 | activePlanId | `uiStore` (NOT persisted) | **No** | — |

**When any two of these disagree, the UI breaks.** The GoalCoordinator (v1) writes to all 7 atomically, but the 3 side-effect `useEffect`s in App.tsx still write to #2 and #3 independently, and the URL init effect still reads from #6 independently.

### SOLID Violations

| Principle | Violation | Where |
|-----------|-----------|-------|
| **S — Single Responsibility** | `App.tsx` (1300 lines) manages: routing, socket wiring, goal switching, team loading, chat key derivation, toast display, discussion threads, theme | App.tsx |
| **S — Single Responsibility** | `chatStore` manages: message CRUD, stream processing, session restore, sessionStorage persistence, agent chat loading | chatStore.ts |
| **O — Open/Closed** | Adding a new goal-switching path requires modifying App.tsx inline callbacks + the GoalCoordinator | App.tsx, GoalCoordinator.ts |
| **L — Liskov** | `restoreTeam()` returns `RestoreResult` with optional `goals` field — callers must null-check and branch differently | GoalCoordinator.ts |
| **I — Interface Segregation** | `chatStore.restoreFromServer()` returns `{ goals, plan, tasks, orchestratorState, activeGoalId }` — data that belongs to orchestration, not chat | chatStore.ts |
| **D — Dependency Inversion** | GoalCoordinator directly imports and calls 3 concrete Zustand stores + AgentServiceV2 | GoalCoordinator.ts |

### Persistence Gaps (Backend)

| State | Persisted? | Recovery on restart |
|-------|-----------|-------------------|
| GoalContext (state, title, repo) | **No** — in-memory `GoalManager.goals` Map | Lost |
| Tasks (status, output, deps) | **No** — in-memory `TaskStore` Map | Lost |
| Planner conversation | **No** — flat `messages[]` in OrchestratorService | Lost |
| Chat messages | Yes — SQLite/MongoDB | Recoverable |
| Goal metadata | Yes — SQLite/MongoDB | Recoverable |
| autoExecute flag | **No** — in-memory | Lost |
| Plan structure | Yes — JSON files | Recoverable |

---

## Architecture: Three-Layer Fix

The fix has 3 layers, each independently valuable. Each layer is a clean deliverable that makes the next layer easier.

### Layer 1: GoalSessionStore (Frontend — eliminates sources #1-#5)

**Problem it solves:** 5 stores that must agree on goalId, synced by side-effect chains.

**Solution:** Single Zustand store owns ALL goal-scoped state. `chatStore` and `orchestrationStore` merge into `goalSessionStore`. `uiStore` keeps only layout/theme. `agentStore` keeps only team/agent data.

```
BEFORE:                                    AFTER:
┌──────────┐  useEffect   ┌────────────┐  ┌──────────────────────────┐
│ uiStore   │──────────────│ orchStore  │  │ goalSessionStore          │
│ goalId    │              │ goalId     │  │                          │
│ planId    │  useEffect   │ tasks      │  │  activeGoalId            │
│ taskId    │──────────────│ state      │  │  activePlanId            │
└──────────┘              └────────────┘  │  messages: Message[]     │
┌──────────┐                               │  tasks: Task[]           │
│ chatStore │ ← key: teamId:goal:goalId    │  sessionState            │
│ histories │                               │  plans: PlanSummary[]    │
│ streaming │                               │  _streaming (internal)   │
└──────────┘                               │                          │
┌──────────┐                               │  switchGoal(goalId)      │
│ AgentSvc  │ ← subscribedGoal             │  processStreamPart(part) │
│ .subscr.  │                               │  restoreFromServer()     │
└──────────┘                               └──────────────────────────┘
                                           ┌──────────────────────────┐
                                           │ uiStore (layout only)    │
                                           │  theme, sidebar, modal   │
                                           └──────────────────────────┘
                                           ┌──────────────────────────┐
                                           │ agentStore (unchanged)   │
                                           │  teams, agents, roles    │
                                           └──────────────────────────┘
```

**Key design decisions:**
- Messages stored as **flat array** with `{ goalId, agentId, taskId }` metadata — no composite chat keys
- Views (planner chat, worker chat) derived via selectors, not keying
- `switchGoal()` is **the only write path** for goal transitions — no useEffects, no side-channels
- Stream processing stays in the same store (it mutates messages at 60Hz — cross-store writes would thrash)
- `sessionStorage` for plans **eliminated** — `plans[]` array lives in the store, populated from server
- Socket room subscription happens **inside** `switchGoal()` — not in a separate useEffect

**Blast radius:** 3 files import chatStore/orchestrationStore (App.tsx, GoalCoordinator.ts, PlanList.tsx). GoalCoordinator.ts is deleted (absorbed into store).

### Layer 2: Backend Persistence (eliminates persistence gaps)

**Problem it solves:** GoalContext, tasks, planner conversation lost on backend restart.

**Solution:** Persist to MongoDB alongside existing chat messages.

| Schema | Fields | Replaces |
|--------|--------|----------|
| `GoalContext` | goalId, teamId, userId, state, title, repoUrl, repoBranch, planId, createdAt, updatedAt | In-memory `GoalManager.goals` Map |
| `Task` | id, goalId, teamId, title, description, status, assignedRole, priority, output, prerequisites | In-memory `TaskStore` Map |

**Key design decisions:**
- Write-through: in-memory Map stays for fast access, MongoDB for durability
- On startup: `GoalManager.loadFromDb()` hydrates the Map from MongoDB
- `TaskStore.updateStatus()` writes to both Map and MongoDB
- Planner conversation persisted per-goal as `PlannerConversation` collection
- `in_progress` tasks downgraded to `ready` on restart (workers can't be recovered)

### Layer 3: Server-Owned Sessions (frontend becomes stateless view)

**Problem it solves:** Frontend and backend can disagree on goal state.

**Solution:** Server is the single source of truth. Frontend fetches on load, receives updates via Socket.IO.

```
GET /api/v2/goals/{goalId}/session → complete snapshot
Socket.IO stream/state events → incremental updates
Frontend stores are read-only views + active stream buffer
```

This is the ChatGPT/Claude model: open any tab, any device, see the same state. Layer 3 depends on Layer 2 (backend must persist everything first).

---

## Delivery Plan

| Version | Layer | What | Effort | Files |
|---------|-------|------|--------|-------|
| **v1.0** | — | ~~GoalCoordinator~~ (done, but is a patch — will be replaced by v2.0) | Done | — |
| **v2.0** | 1 | GoalSessionStore — merge stores, eliminate coordinator | 3-5 days | 5 files (3 new, 2 delete) |
| **v3.0** | 2 | Backend persistence — MongoDB for GoalContext + Tasks | 3-4 days | 4 files (new schemas + services) |
| **v4.0** | 3 | Server-owned sessions — stateless frontend | 3-4 days | Endpoint + frontend simplification |

Each version is independently shippable and valuable. v2.0 is the priority — it fixes the recurring frontend bugs. v3.0 and v4.0 are infrastructure improvements.

---

## What v1.0 Was vs What's Actually Needed

| v1.0 (GoalCoordinator) | Problem |
|-------------------------|---------|
| `switchGoal()` writes to 5 stores atomically | Stores still have independent write paths (useEffects) |
| `restoreTeam()` returns goals for PlanList sync | Still reads planId→goalId from sessionStorage in 3 places |
| Shared types created in `@ping/shared` | Types applied to Socket generic but callbacks still use `any` |
| `authFetch` retries 5xx once | Doesn't handle offline → online reconnection |
| Dead `{ response }` unwrapping removed | Other dead code remains (useOrchestration.ts, empty WORKER_EVENT_ROUTES) |

**v1.0 was a collection of patches. v2.0 is the structural fix.**
- Can be done in any order (no dependencies between fixes)
- Backend-frontend can adopt incrementally

**Cons:**
- SocketServerV2 stays at 1438 lines (SRP violation not addressed)
- 5-layer callback chain remains
- App.tsx stays at 850+ lines
- Doesn't fix the 4 disconnected Zustand stores

**Effort:** Small — each fix is 1-2 hours.

---

### Option B: Communication Contracts + Service Layer

**Implementation:** Extract a typed communication contract, split SocketServerV2 into focused services.

1. **Shared contract package** (`packages/shared/`):
   ```
   packages/shared/
     events.ts        — ServerToClientEvents, ClientToServerEvents (Socket.IO typed)
     messages.ts      — Message, StreamPayload, ErrorResponse
     tasks.ts         — Task, TaskStatus, PlanSummary
     api.ts           — REST endpoint request/response types
   ```

2. **Split SocketServerV2** into:
   - `StreamBroadcaster` — handles `stream` channel (accumulation + emission)
   - `StateBroadcaster` — handles `state` + `task_update` channels
   - `MessageHandler` — handles incoming `message` + `action` events
   - `SocketServer` — thin orchestrator that wires the above

3. **Flatten callback chain** to 3 layers:
   ```
   AiSdkAgent → AgentManagerV2 → SocketServer (broadcasts)
   ```
   Remove WorkerPool as intermediary for events (it still manages worker lifecycle).

4. **Unified frontend service** — merge AgentServiceV2 callback pattern into Zustand middleware:
   ```
   Socket.IO events → Zustand middleware → stores update directly
   ```
   Eliminates App.tsx as manual wiring layer.

5. **Global error interceptor** — single `ErrorBoundaryService` for HTTP + Socket.IO errors.

**Pros:**
- Type-safe end-to-end (compile-time contract validation)
- SocketServerV2 drops from 1438 → ~200 lines (orchestrator only)
- Callback chain simplified (5 layers → 3)
- Frontend wiring moves from App.tsx to declarative Zustand middleware
- Each service testable in isolation

**Cons:**
- Larger diff — touches 8+ files
- Requires frontend and backend changes in lockstep (shared types)
- Zustand middleware pattern is less familiar than explicit wiring
- Need to update existing tests

**Effort:** Medium — 3-5 days for full migration.

---

### Option C: Event Bus with Schema Registry

**Implementation:** Introduce a typed event bus abstraction with schema validation at boundaries.

1. **Event bus** (`packages/shared/eventBus.ts`):
   - Zod schemas for every event type
   - Runtime validation at emission + consumption boundaries
   - Type inference from schemas (no manual types)

2. **Backend event bus** wraps Socket.IO:
   ```typescript
   const bus = createEventBus(io);
   bus.emit("stream", StreamSchema, payload);  // validates before emitting
   ```

3. **Frontend event bus** wraps Socket.IO client:
   ```typescript
   const bus = createClientBus(socket);
   bus.on("stream", StreamSchema, (payload) => { ... });  // validates on receive
   ```

4. **Schema registry** — all event shapes defined once with Zod, shared between backend & frontend.

**Pros:**
- Runtime validation catches type drift immediately
- Self-documenting — schemas ARE the documentation
- Schema evolution can be versioned (add optional fields without breaking)
- Zod schemas generate TypeScript types automatically
- Can generate API docs from schemas

**Cons:**
- Adds runtime validation overhead to every event (measurable in high-frequency stream)
- New abstraction layer over Socket.IO (more indirection)
- Zod is already used for input validation but not for events — new pattern
- Over-engineered for current scale (5 event types, 2 consumers)

**Effort:** Large — 5-7 days. New package, migration of all events.

---

## Recommendation: Option A → B (Incremental)

**Option B is the target architecture**, aligned with the product vision:

| Vision Principle | Option B Alignment |
|------------------|--------------------|
| "Backend becomes thin API" (Phase 3C) | SocketServerV2 splits from 1438 → ~200 lines |
| Package extraction (`@ping/*`) | `packages/shared/` fits existing monorepo pattern |
| "Protocol over adapters" | Typed Socket.IO contracts = protocol-first |
| "No EventEmitters" (Phase 3B) | Extends the same philosophy to Socket.IO boundary |
| Team stacking (recursive composition) | 3 typed channels prevent explosion when teams nest |
| "Maximum value, minimum effort" | Medium effort, addresses all 7 root problems |

**Skip Option C** — runtime Zod validation on every stream part contradicts "minimum effort" and adds latency to high-frequency events. Not needed at current scale (5 event types, 2 consumers).

**Delivery order:**
1. Option A steps 1-4 (quick wins — dead code, error handling, no structural changes)
2. Option B steps 5-7 (target — shared types, split SocketServerV2, Zustand middleware)

This matches the roadmap's "each phase delivers a working, evolved app" model.
