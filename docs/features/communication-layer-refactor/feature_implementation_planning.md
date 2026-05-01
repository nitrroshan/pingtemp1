# Communication Layer Refactor — Implementation Planning

> **Status:** Architecture approved (E → D → F for data model, A → B for transport)
> **Architecture:** [feature_architecture.md](./feature_architecture.md)
> **Branch:** `user/nitrroshan/fixplans`

## Delivery Roadmap

Two parallel tracks, 5 versions:

```
DATA MODEL (fixes bugs 27-32)          TRANSPORT (fixes structural debt)
─────────────────────────────           ────────────────────────────────
v1.0  GoalCoordinator (Option E)       v1.1  Shared types + dead code (Option A)
  ↓                                       ↓
v2.0  GoalSessionStore (Option D)       v2.1  Type-safe Socket.IO + split SocketServer (Option B)
  ↓
v3.0  Backend-first sessions (Option F)
```

Each version is independently deployable and testable.

---

## v1.0 — GoalCoordinator (Option E)

### Scope

Centralize 11 scattered goal-switching paths into one `switchGoal()` function. Fixes Issues 27-32.

### Problem: 11 Paths, Only 2 Complete

| Path | Location | Ops done | Missing |
|------|----------|----------|---------|
| A: URL mount | App.tsx L196 | 2/6 | subscribe, restore, clearTask, resetAgent |
| D: Team load | App.tsx L455 | 4/6 | setPlanId, pushRoute |
| E: handleGoalSubmit | App.tsx L555 | 6/6 ✅ | — |
| F: handleGoalScreenSubmit | App.tsx L575 | 6/6 ✅ | — |
| G: Sidebar onSelectPlan | App.tsx L723 | 8 ops | (gold standard) |
| H: GoalScreen onSelectPlan | App.tsx L852 | 3/6 | restore, clearTask, resetAgent |
| I: PlanSwitcher | App.tsx L1065 | 3/6 | restore, clearTask, resetAgent |
| J: Sidebar onSelectGoal | App.tsx L808 | 2/6 | **no goalId!** |

### Implementation Steps

- [ ] **Step 1**: Create `packages/frontend/lib/GoalCoordinator.ts`
  - `switchGoal(teamId, goalId, planId)` — all 6 ops atomic
  - `switchGoalAndNavigate(teamId, goalId, planId, pushRoute)` — + URL update
  - `restoreTeam(teamId)` — initial team load
  - Calls `unsubscribeFromGoal()` before subscribing to new room

- [ ] **Step 2**: Replace Paths G, H, I, J with coordinator calls
  - 4 `onSelectPlan` / `onSelectGoal` handlers → `goalCoordinator.switchGoalAndNavigate()`

- [ ] **Step 3**: Replace Path D (team load) with `goalCoordinator.restoreTeam()`

- [ ] **Step 4**: Add `unsubscribeFromGoal()` to AgentServiceV2 + backend handler
  - Frontend: `AgentServiceV2.unsubscribeFromGoal()` — emits event, clears `subscribedGoal`
  - Backend: `SocketServerV2` handler for `unsubscribeFromGoal` — `socket.leave(room)`

- [ ] **Step 5**: Remove side-effect `useEffect`s (B + C) — coordinator handles subscription + store sync

### Files Changed

| File | Change | New? |
|------|--------|------|
| `frontend/lib/GoalCoordinator.ts` | GoalCoordinator class | **New** |
| `frontend/App.tsx` | Replace 6 switching paths with coordinator | Modify |
| `frontend/services/AgentServiceV2.ts` | Add `unsubscribeFromGoal()` | Modify |
| `backend/api/SocketServerV2.ts` | Add `unsubscribeFromGoal` handler | Modify |

### Testing

1. New goal from GoalScreen → chat + tasks load correctly
2. Switch plans via sidebar → old chat clears, new loads
3. Refresh mid-task → chat restores, stream resumes
4. Two identical prompts → separate goalIds, separate chats
5. Close browser, reopen → activeGoalId persisted, restore works

---

## v1.1 — Shared Types + Dead Code Cleanup (Option A)

### Scope

Create shared type definitions, remove dead code, add global error handling. No structural changes.

### Implementation Steps

- [ ] **Step 1**: Create `packages/shared/` package
  - `events.ts` — `ServerToClientEvents`, `ClientToServerEvents` (Socket.IO v4 typed interfaces)
  - `messages.ts` — `Message`, `StreamPayload`, `ChatMessage`
  - `tasks.ts` — `Task`, `TaskStatus`, `PlanSummary`, `GoalSession`
  - `errors.ts` — `ErrorResponse`, `ApiError`

  **Industry standard**: Socket.IO v4 supports typed events natively via `Server<C2S, S2C>` and `Socket<S2C, C2S>`. Both backend and frontend import from same package — compile-time type safety.

- [ ] **Step 2**: Remove dead code
  - Delete `{ response }` unwrapping in useOrchestration
  - Remove empty `WORKER_EVENT_ROUTES` entries
  - Remove `worker:stream` references in comments

- [ ] **Step 3**: Global HTTP error handler
  - `authFetch()` wrapper in AgentServiceV2: 401 → redirect to login, 5xx → single retry with 500ms delay
  - Replace silent `catch {}` blocks with `console.error` + toast callback

- [ ] **Step 4**: Replace silent error swallowing (10+ locations)
  - `chatStore.restoreFromServer()` — log + return typed error
  - `sessionStorage` operations — add `console.warn`
  - `App.tsx` JSON parse blocks — add context to warnings

### Files Changed

| File | Change | New? |
|------|--------|------|
| `packages/shared/` (4 files) | Type definitions | **New package** |
| `frontend/services/AgentServiceV2.ts` | Import shared types, authFetch wrapper | Modify |
| `frontend/stores/chatStore.ts` | Error logging | Modify |
| `frontend/App.tsx` | Remove dead code, error logging | Modify |
| `backend/api/SocketServerV2.ts` | Import shared event types | Modify |

---

## v2.0 — GoalSessionStore (Option D)

### Scope

Merge `chatStore` + `orchestrationStore` into a single goal-scoped `goalSessionStore`. Messages stored as flat array with goalId, not ad-hoc keyed Record.

### Key Design (industry-standard: Zustand best practices)

```typescript
// Single store per concern — messages + tasks + state for the active goal
const useGoalSessionStore = create<GoalSessionState>()(devtools((set, get) => ({
  // State
  activeGoalId: null as string | null,
  messages: [] as Message[],        // ALL messages, flat, each has goalId + agentId
  tasks: [] as Task[],
  sessionState: null as string | null,
  plans: [] as PlanSummary[],

  // Actions (modeled as events, not setters — per Redux style guide)
  goalLoaded: (session: GoalSession) => set({ ... }),
  messageSent: (msg: Message) => set(prev => ({ messages: [...prev.messages, msg] })),
  streamPartReceived: (chatKey: string, part: any) => { ... },
  taskUpdated: (taskId: string, patch: Partial<Task>) => { ... },
  goalSwitched: (goalId: string) => set({ messages: [], tasks: [], ... }),
})));

// Atomic selectors (per TkDodo best practice)
export const usePlannerMessages = () => useGoalSessionStore(s =>
  s.messages.filter(m => m.agentLayer === 'planner' && m.goalId === s.activeGoalId)
);
export const useWorkerMessages = (taskId: string) => useGoalSessionStore(s =>
  s.messages.filter(m => m.taskId === taskId)
);
export const useGoalTasks = () => useGoalSessionStore(s =>
  s.tasks.filter(t => t.goalId === s.activeGoalId)
);
```

**Industry patterns applied:**
- Actions as events, not setters (Redux style guide)
- Atomic selectors (Zustand best practice — per TkDodo)
- Actions separated from state (single `useActions()` hook)
- Small store scope (goal-scoped, not global)

### Blast Radius

LOW — only 2 files import these stores:
- `App.tsx` (primary consumer)
- `PlanList.tsx` (reads `plans`)

### Implementation Steps

- [ ] **Step 1**: Create `goalSessionStore.ts` with state + actions + selectors
- [ ] **Step 2**: Migrate `chatStore` message handling → goalSessionStore
- [ ] **Step 3**: Migrate `orchestrationStore` task/plan state → goalSessionStore
- [ ] **Step 4**: Update `App.tsx` and `PlanList.tsx` to use new store
- [ ] **Step 5**: Delete `chatStore.ts` and `orchestrationStore.ts`
- [ ] **Step 6**: Update `GoalCoordinator` to use single store

---

## v2.1 — Type-Safe Socket.IO + Split SocketServerV2 (Option B)

### Scope

Apply shared types to Socket.IO (compile-time safety), split SocketServerV2 from 1438 lines into focused services.

### Key Design (Socket.IO v4 typed events — industry standard)

```typescript
// packages/shared/events.ts — single source of truth
export interface ServerToClientEvents {
  stream: (payload: StreamPayload) => void;
  state: (response: StateResponse) => void;
  error: (error: ErrorPayload) => void;
  'goal:created': (data: { goalId: string; nonce?: string }) => void;
  'goal:stateChange': (data: GoalStateChange) => void;
}

export interface ClientToServerEvents {
  message: (data: MessagePayload) => void;
  action: (data: ActionPayload) => void;
  subscribeToGoal: (data: { teamId: string; goalId: string }) => void;
  unsubscribeFromGoal: (data: { teamId: string; goalId: string }) => void;
  register: (data: { userId: string }) => void;
}
```

**Backend usage:**
```typescript
const io = new Server<ClientToServerEvents, ServerToClientEvents>(httpServer);
// TypeScript enforces correct event names + payload shapes at compile time
```

**Frontend usage:**
```typescript
const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(url);
// Same type safety on the client
```

### Split SocketServerV2

| New Service | Responsibility | Lines |
|------------|---------------|-------|
| `StreamBroadcaster` | Accumulate stream parts, emit to goal rooms | ~150 |
| `StateBroadcaster` | Build + emit state responses, handle goal:stateChange | ~100 |
| `MessageRouter` | Route incoming messages to orchestrator/worker/chatAgent | ~150 |
| `SocketServer` | Auth, registration, wires services together | ~200 |

### Implementation Steps

- [ ] **Step 1**: Define `ServerToClientEvents` + `ClientToServerEvents` in `packages/shared/events.ts`
- [ ] **Step 2**: Apply types to `SocketServerV2` — `new Server<C2S, S2C>`
- [ ] **Step 3**: Apply types to `AgentServiceV2` — `Socket<S2C, C2S>`
- [ ] **Step 4**: Extract `StreamBroadcaster` from SocketServerV2
- [ ] **Step 5**: Extract `StateBroadcaster`
- [ ] **Step 6**: Extract `MessageRouter`
- [ ] **Step 7**: Reduce SocketServerV2 to thin `SocketServer` orchestrator
- [ ] **Step 8**: Consolidate channels: merge `task_update` → `state`, `progress` → `stream`

---

## v3.0 — Backend-First Sessions (Option F)

### Scope

Server becomes sole source of truth. GoalContext + tasks persisted to MongoDB. Frontend is a stateless view.

### Key Design (ChatGPT/Claude model)

```
Frontend: GET /api/v2/goals/{goalId}/session → { messages, tasks, state, plan }
Frontend renders it. No sessionStorage. No localStorage for data.
User types → POST /api/v2/goals/{goalId}/messages → server processes → Socket.IO broadcast
```

### Implementation Steps

- [ ] **Step 1**: Add MongoDB `GoalContext` schema (persist state, repoUrl, title, planner status)
- [ ] **Step 2**: Add MongoDB `Task` schema (persist full task objects, not just in-memory)
- [ ] **Step 3**: Scope planner conversation per-goal (currently flat `messages[]` in OrchestratorService)
- [ ] **Step 4**: New endpoint `GET /api/v2/goals/{goalId}/session` — returns complete GoalSession
- [ ] **Step 5**: `loadActivePlan()` reads from MongoDB instead of JSON files
- [ ] **Step 6**: Frontend removes sessionStorage dependency — server is truth
- [ ] **Step 7**: Frontend `goalSessionStore.goalLoaded()` populates from server response only

### Testing

- Backend restart → all goals recoverable from MongoDB
- Close browser, reopen next day → full state restored
- Two tabs open same goal → both see same state
- New device → login → see all previous goals

---

## Dependency Graph

```
v1.0 GoalCoordinator ──────────► v2.0 GoalSessionStore ──► v3.0 Backend-first
     (fixes bugs now)                (clean architecture)       (full persistence)
                          
v1.1 Shared types ─────────────► v2.1 Type-safe Socket.IO + split SocketServer
     (dead code, errors)              (structural cleanup)
```

v1.0 and v1.1 are independent — can be done in parallel.
v2.0 depends on v1.0 (coordinator patterns inform store design).
v2.1 depends on v1.1 (shared types needed before applying to Socket.IO).
v3.0 depends on v2.0 (store must be unified before backend can be source of truth).
- `AgentServiceV2.restoreSession()` — catch returns null

**Missing patterns:**
- No 401 auto-redirect to login
- No HTTP retry mechanism
- No global error interceptor
- Background API failures invisible

### Issue 3: Dead Code

- `useOrchestration.ts:142` — `{ response }` unwrapping (never triggers on current `message` events)
- References to `worker:stream` internal event (replaced by direct callbacks)
- `WORKER_EVENT_ROUTES` entries for `message`, `message_delta`, `error`, `done` (all map to `[]`, handled separately)

### Issue 4: Channel Proliferation

| Channel | Purpose | Could Merge Into |
|---------|---------|-----------------|
| `stream` | AI SDK data stream parts | Keep (primary) |
| `progress` | Legacy thinking/tool events | → `stream` (as custom parts) |
| `state` | Plan/task state changes | Keep (separate concern) |
| `task_update` | Coarse task lifecycle | → `state` |
| `message` | Legacy chat messages | → `stream` (as message parts) |
| `error` | Error notifications | Keep (separate concern) |

**Target:** 3 channels (`stream`, `state`, `error`) instead of 6.

### Issue 5: SocketServerV2 Complexity

- 1438 lines in single file
- Handles: auth, rate limiting, message routing, stream accumulation, broadcasting, state building, message persistence
- `ensureTeamCallbacks()` alone is 200+ lines

---

## Implementation Steps (Option A — Incremental)

> *Steps for Option B/C will be written after architecture decision*

### Step 1: Remove Dead Code
- Delete `{ response }` unwrapping from `useOrchestration.ts`
- Remove empty `WORKER_EVENT_ROUTES` entries (`message: []`, `error: []`, `done: []`)
- Remove `worker:stream` references in comments/docs
- **Files:** `useOrchestration.ts`, `SocketServerV2.ts`
- **Risk:** Low — removing unused code paths

### Step 2: Add Global HTTP Error Handler
- Wrap `authFetch()` in `AgentServiceV2.ts` with:
  - 401 detection → redirect to `/login` (or emit auth-expired event)
  - Single retry with 500ms delay for 5xx errors
  - `console.error` for all failures (no silent swallowing)
- Add error toast callback for background failures
- **Files:** `AgentServiceV2.ts`, `App.tsx`
- **Risk:** Medium — retry could cause duplicate side effects on POST

### Step 3: Type-Safe Socket.IO Events
- Define `ServerToClientEvents` and `ClientToServerEvents` interfaces
- Location: `packages/backend/api/types/socketEvents.ts`
- Apply to `Server<ClientToServerEvents, ServerToClientEvents>` in SocketServerV2
- Copy interfaces to frontend (until shared package exists)
- **Files:** `SocketServerV2.ts`, new `socketEvents.ts`, `AgentServiceV2.ts`
- **Risk:** Low — additive change, no runtime behavior change

### Step 4: Fix Silent Error Swallowing
- `chatStore.restoreFromServer()` — log error + return typed error result
- `sessionStorage` operations — add `console.warn`
- `App.tsx` JSON parse — add `console.warn` with context
- `AgentServiceV2.restoreSession()` — throw instead of returning null
- **Files:** `chatStore.ts`, `App.tsx`, `AgentServiceV2.ts`
- **Risk:** Low — adding visibility, not changing control flow

### Step 5: Consolidate Event Channels
- Merge `task_update` into `state` channel (add `type: "task_update"` discriminator)
- Merge `progress` events into `stream` channel as custom stream parts
- Update frontend listeners to handle merged events
- Deprecate old channels with warning log for 1 release
- **Files:** `SocketServerV2.ts`, `AgentServiceV2.ts`, `orchestrationStore.ts`
- **Risk:** Medium — frontend must handle both old and new during transition

### Step 6: Implement Missing Actions
- Wire `cancel-task` in `AgentManagerV2.ts` (stop worker, update MemoryManager status)
- Wire `modify-task` in `AgentManagerV2.ts` (update task description/assignment)
- **Files:** `AgentManagerV2.ts`, `SocketServerV2.ts`
- **Risk:** Medium — task cancellation needs worker cleanup

---

## Implementation Steps (Option B — Service Layer)

### Step 1-4: Same as Option A

### Step 5: Create Shared Types Package
- `packages/shared/src/events.ts` — Socket.IO event interfaces
- `packages/shared/src/messages.ts` — Message, StreamPayload types
- `packages/shared/src/tasks.ts` — Task, TaskStatus types
- Update `tsconfig.json` references in backend + frontend
- Replace duplicated types with imports from `@ping/shared`
- **Files:** New package, `package.json` updates, type import changes

### Step 6: Split SocketServerV2
- Extract `StreamBroadcaster` class (~200 lines) — accumulation + stream emission
- Extract `StateBroadcaster` class (~100 lines) — state + task_update emission
- Extract `MessageHandler` class (~150 lines) — incoming message/action routing
- Reduce `SocketServerV2` to ~200 lines (auth + wiring)
- **Files:** 3 new files in `packages/backend/api/`, refactored `SocketServerV2.ts`

### Step 7: Frontend Zustand Middleware
- Create Socket.IO middleware for Zustand stores
- Socket events directly update relevant store (no App.tsx manual wiring)
- App.tsx drops from 850+ → ~200 lines
- **Files:** New `packages/frontend/middleware/socketMiddleware.ts`, refactored `App.tsx`

---

## Versioning

- **v1.0**: Steps 1-4 (cleanup + error handling) — no breaking changes
- **v1.1**: Steps 5-6 (channel consolidation + missing actions) — deprecation period
- **v2.0**: Steps 5-7 from Option B (if chosen) — structural refactor

---

## Testing Strategy

- **Unit tests:** Type-safe event interfaces (compile-time validation)
- **Integration tests:** Stream pipeline end-to-end (AiSdkAgent → frontend store)
- **Manual tests:** Error scenarios (401, network failure, stream interruption)
- **Regression:** Existing Socket.IO tests must pass unchanged for v1.0
