# API Improvements — Architecture

## Problem Statement

The frontend makes the backend work harder than it should. Five specific gaps cause workarounds, slow loads, and lost data:

| # | Gap | Impact | Current Workaround |
|---|-----|--------|--------------------|
| 1 | **N+1 team loading** | `getTeams()` + N × `getAgents(id)` = sequential calls | Slow sidebar, loading spinner per team |
| 2 | **Monolithic restore** | `/sessions/:id/restore` returns 100KB+ blob (messages + tasks + goals + plans) | Can't refresh one piece; entire cache invalidated |
| 3 | **streamParts lost** | Tool calls, reasoning sections not persisted on messages | Messages render as plain text after page refresh |
| 4 | **cancel/modify task unimplemented** | Socket actions defined in schema but return TODO | Buttons silently fail |
| 5 | **Stream events use role, not agentId** | Frontend does O(n) tree walk per stream event to resolve role → agentId | Performance degrades with more agents |

### Integration Points
- `packages/backend/api/HttpServer.ts` (635 lines) — REST endpoints
- `packages/backend/api/SocketServerV2.ts` (1438 lines) — Socket.IO events
- `packages/backend/api/agentManagerHandlerV2.ts` (328 lines) — team CRUD
- `packages/backend/services/mongo/MongoChatService.ts` — message persistence
- `packages/agent-manager/src/AgentManagerV2.ts` — task lifecycle
- `packages/frontend/services/AgentServiceV2.ts` — API consumer

---

## Architecture Options

### Option A: Fix In-Place (Minimal Changes)

**Implementation:** Add/modify endpoints one by one in existing files. No structural changes.

1. Add `?include=agents` query param to `GET /api/v2/teams` in `agentManagerHandlerV2.ts`
2. Add 2 new goal-scoped routes in `HttpServer.ts`: `GET /api/v2/goals/:goalId/plan`, `GET /api/v2/goals/:goalId/messages`
3. Add `streamParts` column to `ChatMessageSchema.ts`, persist in `SocketServerV2.ts` message accumulator
4. Implement `cancelTask()` + `modifyTask()` in `AgentManagerV2.ts`, wire in `SocketServerV2.ts`
5. Add `agentId` field to stream event payloads in `SocketServerV2.ts` `ensureTeamCallbacks`

**Pros:**
- Smallest diff — 5 isolated changes
- No new files, no new patterns
- Each fix deployable independently
- Frontend can adopt incrementally

**Cons:**
- Restore endpoint stays monolithic (still returns everything, new endpoints are additive)
- No versioning — changes are in `/api/v2/` alongside existing endpoints
- `HttpServer.ts` grows (already 635 lines)

**Effort:** Small — 1-2 days total across all 5 fixes.

---

### Option B: Goal-Scoped API Redesign

**Implementation:** Restructure the API around goals as the primary entity. New router file for goal endpoints. Deprecate monolithic restore.

New endpoints:
```
GET  /api/v2/teams?include=agents              # batch team+agents
GET  /api/v2/teams/:teamId/goals               # goal list (exists)
GET  /api/v2/goals/:goalId                      # goal detail + status
GET  /api/v2/goals/:goalId/plan                 # tasks for this goal
GET  /api/v2/goals/:goalId/messages             # messages scoped to goal
GET  /api/v2/goals/:goalId/messages/:agentId    # per-agent within goal
PATCH /api/v2/tasks/:taskId                     # update task (status, assignment)
DELETE /api/v2/tasks/:taskId                    # cancel task
```

New file: `packages/backend/api/goalRouter.ts` (~150 lines)
New file: `packages/backend/api/taskRouter.ts` (~80 lines)

**Pros:**
- Clean API design — goals are first-class entities
- Frontend can fetch exactly what it needs (no over-fetching)
- Prepares for Phase 4 (parallel plans) — each goal independently queryable
- Old restore endpoint stays for backward compat, new endpoints are preferred path
- Smaller response payloads → faster loads

**Cons:**
- More files to maintain (2 new routers)
- Frontend must update to use new endpoints (but can migrate incrementally)
- Goal-scoped message queries need goalId on all messages (already exists but nullable)
- Need to ensure goalId is always set on messages (backfill or enforce)

**Effort:** Medium — 3-4 days. New routers + frontend migration.

---

### Option C: GraphQL Layer

**Implementation:** Add a GraphQL endpoint that lets the frontend query exactly what it needs. Keep REST as fallback.

```graphql
query TeamWithAgents($teamId: ID!) {
  team(id: $teamId) {
    id, name
    agents { id, name, role }
    goals {
      id, status
      plan { tasks { id, title, status, assignedRole } }
      messages(limit: 50) { id, role, content, streamParts }
    }
  }
}
```

**Pros:**
- Frontend requests exactly what it needs in one call
- No over-fetching or under-fetching
- Type-safe with codegen
- Self-documenting via schema

**Cons:**
- Major new dependency (apollo-server or mercurius)
- Learning curve for team
- Overkill for current data model (~5 entity types)
- Adds complexity to a codebase that already has REST + Socket.IO
- Doesn't help with real-time (still need Socket.IO for streaming)

**Effort:** Large — 5-8 days. New dependency, schema, resolvers, frontend client.

---

## Recommendation: **Option A (Fix In-Place)**

Option A is the right choice because:

1. **Each fix is independent** — deploy and test one at a time. No big-bang migration.
2. **Smallest risk** — no new abstractions, no new router files, no new dependencies.
3. **Aligns with Zustand migration** — the frontend is about to be rewritten anyway. Clean API design (Option B) makes more sense AFTER the Zustand stores are in place and we know exactly what each store needs.
4. **GraphQL is overkill** — we have 5 entity types and Socket.IO for real-time. GraphQL adds complexity without proportional benefit.

### Why not Option B?

Option B is the right long-term answer (goal-scoped API), but doing it now means:
- Changing the API surface while simultaneously rewriting the frontend (Zustand migration)
- Two moving targets = harder debugging
- Better to do Zustand first → know exactly what the stores need → then design goal-scoped APIs to match

**Sequence: F5 (Zustand) first → F6 (API) second.**

If the Zustand migration reveals that Option B's goal-scoped endpoints are needed, we can upgrade from A → B incrementally (the fixes in Option A are compatible with B's design).

---

## Detailed Fix Specifications

### Fix 1: Batch Team + Agents

**Current:** Frontend calls `GET /api/v2/teams` → gets team list → calls `GET /api/v2/teams/:id/agents` per team.

**Change:** Add `?include=agents` query param to existing teams endpoint.

**File:** `agentManagerHandlerV2.ts` — modify `GET /api/v2/teams` handler.
**Response change:** Each team object gains `agents: Agent[]` when `include=agents`.
**Frontend:** `AgentServiceV2.getTeams()` passes `?include=agents`, removes per-team agent fetches.

---

### Fix 2: Goal-Scoped Plan + Messages

**Current:** `/sessions/:teamId/restore` returns everything. No way to fetch just one goal's data.

**Change:** Add 2 endpoints in `HttpServer.ts`:
- `GET /api/v2/goals/:goalId/plan` — returns `{ tasks, status, planId }`
- `GET /api/v2/goals/:goalId/messages` — returns `{ messages[] }` filtered by goalId

**Existing restore stays** — used for initial page load. New endpoints used for goal switching.

---

### Fix 3: Persist streamParts on Messages

**Current:** `SocketServerV2.ts` accumulates stream parts in `messageAccumulator` but saves only `content` (plain text).

**Change:** In the `onDone` callback, include accumulated `parts` as JSON in the saved message.

**Files:**
- `ChatMessageSchema.ts` — add `streamParts: String` (JSON blob)
- `SocketServerV2.ts` — in `ensureTeamCallbacks` → `onDone`, save `acc.parts` as `streamParts`
- `HttpServer.ts` — return `streamParts` in message queries

---

### Fix 4: Implement cancelTask + modifyTask

**Current:** `SocketServerV2.ts` has `modify-task` in schema with `// TODO`, `cancelTask` has `// TODO: Add cancelTask method`.

**Change:**
- `AgentManagerV2.ts` — add `cancelTask(taskId)` (sets status to cancelled, stops worker if running)
- `SocketServerV2.ts` — implement `handleCancelTask` and `handleModifyTask`

---

### Fix 5: Include agentId in Stream Events

**Current:** Stream events contain `role` (e.g., "backend") but not the MongoDB agent ID.

**Change:** In `SocketServerV2.ts` `ensureTeamCallbacks` → `onStream`, resolve role → agentId using `WorkerPool.getRoleAgentIdMap()` and include in payload.

**Frontend impact:** `useOrchestration.subscribeToTeam` removes `findAgentByRole()` tree walk. Zustand `agentStore.roleMap` still useful for other lookups but stream events no longer need it.
