# Goal-Scoped Sessions — Architecture

## Problem Statement

Every multi-conversation product (ChatGPT, Claude, Slack, Discord) isolates sessions. Our system broadcasts everything to the team room — all goals' streams, tasks, and state updates go to all connected clients. This causes:

1. **State collision** — new goal's task state overwrites old goal's tasks
2. **Stream bleed** — worker streams from Goal A show up while viewing Goal B
3. **No multi-tab** — opening the same team in two tabs shows mixed state
4. **Blocked UI** — frontend filters fail because `activePlanGoalIdRef` has stale goalId during transitions

### How the Industry Does It

**ChatGPT / Claude (1:1 conversations):**
- Each conversation has a unique `conversation_id`
- Client sends `conversation_id` with every message
- Server streams response scoped to that `conversation_id`
- SSE/WebSocket stream is per-request (not shared channel)
- Opening two conversations = two independent streams

**Slack / Discord (multi-channel real-time):**
- Socket.IO rooms (or equivalent) per channel
- Client joins/leaves rooms explicitly
- Events only broadcast to the relevant room
- State is per-channel, never global

**Socket.IO best practice (from docs):**
```
// Per-entity rooms — events only go where needed
socket.join(`project:${projectId}`);
io.to(`project:${projectId}`).emit("update", data);
```

**Our current architecture:**
```
// Everything goes to team room — all clients get everything
io.to(`team:${teamId}`).emit("stream", { goalId, ... });
io.to(`team:${teamId}`).emit("state", { allTasks... });
```

We already have `subscribeToGoal` and goal rooms, but they're only used for the initial `socketsJoin` on plan approval — not for ongoing event routing.

---

## What Exists Today

| Component | Status | What it does |
|-----------|--------|-------------|
| `subscribeToGoal` socket event | ✅ Exists | Client joins `team:{id}:goal:{goalId}` room |
| `socketsJoin(goalRoom)` on plan approval | ✅ Exists | Auto-joins all team sockets to goal room |
| `goalId` on stream payloads | ✅ Exists | Stream events include goalId |
| `goalId` on task objects | ✅ Exists (just added) | Tasks include goalId for frontend filtering |
| Goal-scoped event emission | ❌ Missing | All 14 broadcasts go to team room |
| Per-goal sessionState | ❌ Missing | One global sessionState for the whole team |
| Frontend goal-room subscription on plan switch | ❌ Missing | Only subscribes once on page load |

---

## Architecture Options

### Option A: Goal-Room Routing (Targeted Fix)

**Implementation:** Change the 14 `io.to(room).emit()` calls in `ensureTeamCallbacks` to emit to the goal room when a goalId is available. Keep team room for goal-agnostic events (goal list, team-level state).

```
// Before (team room — everyone gets everything):
io.to(`team:${teamId}`).emit("stream", payload);

// After (goal room — only subscribers of this goal):
const target = goalId ? `team:${teamId}:goal:${goalId}` : `team:${teamId}`;
io.to(target).emit("stream", payload);
```

**Backend changes (~40 lines):**
- `onStream` → emit to goal room (goalId from payload)
- `onDone` → emit to goal room
- `onError` → emit to goal room
- `onTaskUpdate` → emit to goal room (get goalId from task)
- `onPlanUpdate` → emit to team room (affects plan list sidebar)
- `goal:stateChange` → emit to team room (affects plan list sidebar)

**Frontend changes (~20 lines):**
- On plan switch: `agentServiceV2.subscribeToGoal(teamId, newGoalId)` (leave old, join new)
- `orchestrationStore.sessionState` → `Record<goalId, string>` (per-goal)
- Plan sidebar reads from team room events, chat area reads from goal room

**Pros:**
- Smallest change — uses existing Socket.IO room infrastructure
- No new dependencies, no new protocols
- Goal-agnostic events (plan list, team state) still work via team room
- Each browser tab subscribes to its own goal room — no cross-talk

**Cons:**
- Backend callbacks need goalId plumbed through (most already have it)
- Frontend must manage room switching (subscribe/unsubscribe on plan change)
- `sessionState` becomes per-goal, need to update all 15+ references

**Effort:** Small — 1-2 days.

---

### Option B: Per-Goal SSE Streams (REST + SSE)

**Implementation:** Replace Socket.IO room-based broadcasting with per-goal SSE streams. Each goal gets its own HTTP streaming endpoint.

```
// Client opens SSE connection per goal:
GET /api/v2/goals/{goalId}/stream
Accept: text/event-stream

// Server sends events:
event: task-update
data: {"taskId": "task-1", "status": "completed"}

event: stream-part  
data: {"type": "text-delta", "delta": "Hello..."}
```

**Pros:**
- Clean REST API — each goal is a separate stream
- Natural HTTP semantics (cacheable, proxy-friendly)
- No room management — each stream is isolated by design
- How ChatGPT/Claude do it (SSE per conversation)

**Cons:**
- Major protocol change — Socket.IO → SSE for goal events
- Need to keep Socket.IO for team-level events (plan list, agent status)
- Two real-time transports (Socket.IO + SSE) adds complexity
- Browser limits SSE connections (~6 per domain) — limits concurrent goals
- Need custom reconnection logic (Socket.IO handles this)

**Effort:** Large — 4-5 days. New endpoints, new frontend transport, dual protocol.

---

### Option C: Multiplexed Socket.IO Namespaces

**Implementation:** Each goal gets its own Socket.IO namespace (`/goals/{goalId}`). Client connects to the namespace for the active goal.

```
// Client:
const goalSocket = io("/goals/build-rest-api-123");
goalSocket.on("stream", handler);

// Server:
io.of(`/goals/${goalId}`).emit("stream", payload);
```

**Pros:**
- Complete isolation — each namespace is independent
- Built-in Socket.IO feature (middlewares, rooms per namespace)
- No room management needed

**Cons:**
- Each namespace = separate WebSocket connection (resource heavy)
- Dynamic namespace creation is complex
- Can't share auth state across namespaces without middleware
- Overkill for our use case (rooms achieve the same thing)

**Effort:** Medium — 3-4 days. Namespace management, auth middleware, connection lifecycle.

---

## Recommendation: **Option A (Goal-Room Routing)**

Option A wins because:

1. **Smallest delta** — 14 lines of `io.to(room)` → `io.to(goalRoom || room)`. No new transport, no new protocol.
2. **Infrastructure exists** — `subscribeToGoal`, goal rooms, goalId on payloads are all built. We just don't USE them for routing.
3. **How Socket.IO is designed** — rooms are exactly this use case. The docs literally show `io.to("project:4321").emit()`.
4. **SSE is wrong** — we're not a 1:1 chat product. We have multiple agents streaming simultaneously within one goal. SSE would need N connections per goal (one per agent), which is worse.
5. **Namespaces are overkill** — rooms give the same isolation without extra connections.

### What Changes

**Backend (`SocketServerV2.ts`):**

| Broadcast | Current Target | New Target | Why |
|-----------|---------------|------------|-----|
| `onStream` | team room | goal room | Stream belongs to a specific goal |
| `onDone` | team room | goal room | Finish belongs to a specific goal |
| `onError` | team room | goal room | Error belongs to a specific goal |
| `onTaskUpdate` state | team room | goal room | Task status belongs to a goal |
| `onTaskUpdate` stream | team room | goal room | Task-started/completed chips |
| `onPlanUpdate` | team room | **team room** (keep) | Sidebar plan list is team-wide |
| `goal:stateChange` | team room | **team room** (keep) | Sidebar plan list is team-wide |
| `progress` | team room | goal room | Progress belongs to a task/goal |
| `task_update` (Channel B) | team room | goal room | Worker updates belong to a goal |
| `discussion:*` | team room | **team room** (keep) | Discussion can span goals |

**Frontend:**
- `subscribeToGoal(teamId, goalId)` on every plan switch (already called, just needs to leave previous room)
- `orchestrationStore.sessionState` → `Record<goalId, string | null>` (per-goal)
- Remove `activePlanGoalIdRef` filter — goal room already isolates events

### Per-Goal Session State

```ts
// Before (global):
sessionState: string | null

// After (per-goal):
goalStates: Record<goalId, {
  sessionState: string | null;
  tasks: Task[];
}>
activeGoalId: string | null;

// Selectors:
getActiveSessionState = () => get().goalStates[get().activeGoalId]?.sessionState
getActiveTasks = () => get().goalStates[get().activeGoalId]?.tasks ?? []
```

---

## Implementation Plan (Summary)

| Step | What | Lines | Risk |
|------|------|-------|------|
| 1 | Backend: resolve goalId in each callback, emit to goal room | ~40 | Low |
| 2 | Frontend: subscribe/unsubscribe on plan switch | ~15 | Low |
| 3 | Frontend: per-goal sessionState in orchestrationStore | ~30 | Medium |
| 4 | Frontend: remove `activePlanGoalIdRef` filter (rooms handle it) | ~10 | Low |
| 5 | Test: two goals executing simultaneously, verify isolation | — | — |
| **Total** | | **~95 lines** | |
