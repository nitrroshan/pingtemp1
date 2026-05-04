# Platform Roadmap — Phased Delivery Plan

**Date:** May 3, 2026
**Purpose:** Unified plan for all major features, ordered by dependency and impact.

---

## Current State (What Exists Today)

| Area | Status | Details |
|------|--------|---------|
| **MongoDB** | ✅ Working | Chat, goals, tasks persisted. Persistence awaited (throws on failure). Unique index: `{teamId, goalId, taskId}`. |
| **Auth** | ✅ Working | better-auth (email+password, GitHub OAuth). Socket.IO + HTTP middleware. |
| **Workspace** | ✅ Working | Per-task git worktrees. Per-goal clone. Branch isolation. |
| **Frontend** | ✅ Working | GoalScreen, PlanList, multi-goal switching, goalSessionStore. |
| **CRDT** | ✅ Restored | CRDT writes via event-driven projection (GoalEventBus → CrdtProjectionHandler). Standardized `Y.Map("meta")`. Agent status tracking. `collab read` works. |
| **Goal isolation** | ✅ Working | Parallel goals supported. Goal-scoped tasks, notifications, DAG. Per-goal concurrency fairness is Phase 3 optimization. |
| **Redis** | ❌ None | Zero deps. All state in-memory. Single-server only. |
| **Team membership** | ❌ Owner-only | No multi-member teams. `canAccess()` checks owner only. |
| **Process isolation** | ❌ None | All workers in same Node.js process. No BullMQ, no worker_threads. |
| **Resource quotas** | ❌ None | No per-user limits. One user can monopolize everything. |

### What's Fixed (this branch)
- ✅ CRDT writes restored via GoalEventBus + CrdtProjectionHandler (event-driven, not direct calls)
- ✅ MongoDB unique index fixed: `{teamId, goalId, taskId}`
- ✅ DB writes awaited and throw on failure (persist-then-publish contract)
- ✅ Goal DB status persisted via SocketEventBroadcaster.onGoalStatusChange
- ✅ GoalSchema has repoUrl/repoBranch fields
- ✅ CrdtTaskSync page-type discriminator bug fixed (`type` vs `taskType`)
- ✅ CRDT fallback recovery removed (MongoDB-only recovery)
- ✅ TaskStore write-through: all writes await MongoDB BEFORE updating Map cache
- ✅ MongoTaskService errors propagate (no swallowing)
- ✅ SQLite unique key fixed: `{teamId, goalId, taskId}`
- ✅ Dependency cascade routes through `updateStatus()` (persists to MongoDB)
- ✅ planMutationTools duplicate persistence removed — TaskStore is single writer
- ✅ request_task duplicate persistence removed — TaskStore is single writer
- ✅ DocumentRef-based context: agents read via `collab read` URIs, no raw text summaries
- ✅ `complete_task` upgraded with `producedDocs` + `decisions`
- ✅ BlockNote server-side: `write-block`/`read-block` use `ServerBlockNoteEditor`
- ✅ `record-decision` / `get-decisions` collab tool actions

### What's Still Broken / Missing
- Plan approval is non-atomic — crash between clear and create loses all tasks (rollback added but crash window remains)
- Hocuspocus currently uses local filesystem persistence — must switch to S3 for production
- ✅ ~~Planner conversation history lost on restart~~ — save/restore wired via `saveConversationFn`/`loadConversationFn` (v1.2)
- ✅ ~~contextMessages saved to MongoDB but never restored~~ — planner restores via `AiSdkAgent.setMessages()`, chat agents via `loadMessages()`
- Conversation restore is not user-scoped — all users on same team share planner/chat history (v2.0)

---

## Deployment Modes

### Cloud App (Primary)
- MongoDB for persistence
- Hocuspocus as a separate hosted service (`@ping/collab-service`) — deployed at its own URL (e.g. `wss://collab.ping.dev`), persists CRDT docs to S3-compatible object storage
- better-auth with MongoDB adapter
- Future: Redis + BullMQ for scaling

> **Hocuspocus is NOT embedded in the backend.** It runs as its own hosted service at a separate URL — `packages/collab-service/src/standalone.ts`. The backend connects via `RemoteCollabClient` (WebSocket) using the `COLLAB_URL` environment variable (e.g. `wss://collab.ping.dev`). CRDT docs persist to **S3-compatible object storage** (AWS S3, MinIO, R2, etc.) via the `HocuspocusBlobStorageAdapter` — not local filesystem. This ensures docs survive service restarts and enables horizontal scaling of the collab service.

### Desktop App (Electron Shell)
- **NOT a separate mode** — desktop is just an Electron wrapper that loads the cloud web app
- No local storage, no SQLite, no offline mode
- User must be connected to the cloud backend
- Same as opening the web app in a browser, but with native window controls + system tray
- Desktop package exists at `@ping/desktop` — thin shell only

**Feature docs:**
- [local-first-desktop](features/local-first-desktop/feature_architecture.md) — original desktop architecture (for reference)
- [dev-prod-setup](features/dev-prod-setup/) — environment configuration

## Architecture Principle: CRDT for Artifacts, MongoDB for Tracking

### Two Layers, Two Purposes

```
CRDT (Hocuspocus)                    MongoDB
= Collaborative artifacts            = Operational data
= What agents READ and WRITE         = What the system TRACKS
= Documents, knowledge, context      = Status, metrics, recovery
= Real-time, multi-writer            = Durable, queryable
```

**CRDT is NOT replacing MongoDB.** They serve completely different purposes:

| | CRDT | MongoDB |
|---|---|---|
| **Purpose** | Shared working documents — agents and users collaborate on content | Operational tracking — status, metrics, queries, recovery |
| **What lives here** | Plan documents, task context, research findings, completion reports, team knowledge, agent notes, discussion threads | Task status, goal lifecycle, chat history, user accounts, metrics, audit log |
| **Who reads** | Agents (via `collab read`), frontend (via Hocuspocus provider) | Backend (queries, restore), frontend (API calls for history/search) |
| **Who writes** | Agents (via tools), planner (plan docs), users (edits/comments) | Backend (state machine transitions), persistence layer |
| **Survives restart?** | Yes (Hocuspocus blob storage) | Yes (durable database) |
| **Real-time sync?** | Yes (CRDT auto-merge, multi-writer) | No (write-then-query) |

### How They Work Together

```
Planner creates plan
  → Writes plan DOCUMENT to CRDT (readable, agents/users can read)
  → MongoDB: nothing yet (plan is draft)

User approves plan  
  → Backend reads plan from CRDT → derives task records
  → MongoDB: creates task records (status tracking, queryable)
  → CRDT: per-task docs populated with context

Worker executes task
  → Reads context from CRDT docs (plan, upstream outputs, team knowledge)
  → Writes completion report to CRDT (for downstream agents)
  → MongoDB: updates task status (completed, output summary)

Server restarts
  → MongoDB: source of truth for status/tracking → rehydrate
  → CRDT: Hocuspocus reloads from blob storage → documents available
```

### What Stays as Socket.IO (Ephemeral — too fast or too transient for CRDT)

| Data | Why Socket.IO |
|------|---------------|
| LLM text/reasoning tokens (`text-delta`, `reasoning-delta`) | 50-200 events/response, token-level streaming |
| Tool progress indicators (`thinking`, `tool_start`, `tool_result`) | Real-time display only |
| User commands (`message`, `action`) | RPC-style, not documents |
| Connection lifecycle (`register`, `subscribeToGoal`) | Session management |
| Error notifications | One-time signals |

### What Lives in CRDT

**Standard page pattern** — every CRDT document uses `Y.Map("meta")` for structured fields + optional `Y.XmlFragment("content")` for rich text (BlockNote) + optional `Y.Text("source")` for code (LSP). Exception: discussion threads (Y.Array, append-only).

**How agents use CRDT:**

| Use Case | What Happens | Who Creates |
|----------|-------------|-------------|
| **Plan review** | Planner writes plan-doc with rationale + task breakdown. User reviews in BlockNote. System derives task records on approval. | System (on proposal) |
| **Task context** | Each task gets a page with description, acceptance criteria, inputDocs, expectedOutputDocs. Workers read before executing. | System (on approval) |
| **Completion report** | Worker writes findings, producedDocs, decisions. Downstream agents read for context. Replaces lossy `output.summary`. | Worker (on completion) |
| **Discussion** | Multi-agent structured debate. Proposals, decisions, @mentions. Already CRDT. | System (with task) |
| **Team memory** | Shared decisions, conventions, knowledge that persist across goals. Agents write via `team_memory` tool. | System (on team init, Phase 4) |
| **Personal notes** | Agent's private scratchpad — accumulated context, task learnings. Only the owning agent writes. | System (on agent init, Phase 4) |
| **Research / specs / design docs** | Agents create any document they need — research findings, API specs, architecture notes. Not pre-defined. | Agent (on demand via `collab write`) |
| **Page registry** | Auto-populated list of all pages in a scope. Replaces `collab discover` introspection. | System (Phase 8, auto) |
| **Identity map** | Symbol table for "go to definition" across pages. Aggregated from per-page symbols. | System (Phase 8, auto) |

**Standard page pattern** — all system-managed and agent-created pages use:
- `Y.Map("meta")` — REQUIRED. Structured fields (id, type, status, etc.)
- `Y.XmlFragment("content")` — OPTIONAL. Rich text body (BlockNote). Add when humans read it.
- `Y.Text("source")` — OPTIONAL. Code (LSP-compatible). Add when it contains code.
- `Y.Map("symbols")` — OPTIONAL (Phase 8). Named entities in this page.

**Exceptions:** Discussion threads (Y.Array, append-only), registries (_pages, _identities), scratchpad/team-memory (flat Y.Map, no content).

### What Stays in MongoDB (Tracking — operational data)

| Collection | Key Fields | Why MongoDB |
|------------|-----------|-------------|
| **`tasks`** | taskId, goalId, teamId, status, assignedRole, dependencies[], producedDocs: DocumentRef[], output | Queryable (find all failed tasks), indexed, DAG recovery on restart |
| **`goals`** | goalId, userId (Phase 6), teamId, status, currentPlanId, repoUrl, repoBranch, autoExecute | Dashboard queries, lifecycle tracking, config recovery |
| **`messages`** | goalId, role, content, type, timestamp | Chat history + **planner conversation history** (save/restore wired in v1.2) |
| **`user` / `session` / `account`** | (better-auth managed) | Auth, identity |
| **`teamMemberships`** (Phase 6) | teamId, userId, role | Authorization, team member lookups |
| **`userQuotas`** (Phase 6) | userId, maxGoals, maxWorkers, tokenBudget | Resource limits per user |
| **`metrics`** (future) | goalId, taskId, tokensUsed, cost, duration | Token usage, cost tracking, audit trail |

> **`output.summary` is kept for backward compatibility.** Task output in MongoDB stores both `summary` (short text) and `producedDocs: DocumentRef[]` (URIs pointing to CRDT completion reports and workspace files). Rich content lives in the CRDT report doc. Downstream agents receive `inputDocs` (DocumentRef URIs) and read content via `collab read` — not raw summary strings. Summary is used as a fallback description when no `producedDocs` are specified.

### DocumentRef: Universal Exchange Type Between Tasks

Everything that moves between tasks should be a `DocumentRef` — a URI with a name, not a bare string.

```typescript
interface DocumentRef {
  uri: string;       // workspace:src/api.ts, crdt:{taskId}/report, https://...
  name: string;      // "api-spec", "competitor-analysis"
  description?: string;
  hint?: string;     // "Read sections 2-4 for pricing tiers"
}
```

| Current (bare strings) | Proposed (DocumentRef) | URI Scheme |
|---|---|---|
| `output.deliverables: string[]` → `["src/api.ts"]` | `producedDocs: DocumentRef[]` | `workspace:src/api.ts` |
| `context.upstreamArtifacts: string[]` | `inputDocs: DocumentRef[]` on dependent task | `workspace:path` |
| `context.files: string[]` | `inputDocs: DocumentRef[]` | `workspace:path` |
| `context.expectedOutput: string` | `expectedOutputDocs: ExpectedDoc[]` | `workspace:suggested-path` |
| `crdtRefs.task/plan/goal` | `contextDocs: DocumentRef[]` | `crdt:docName` |
| Discussion decisions | `contextDocs: DocumentRef[]` | `crdt:{taskId}/discussion` |

**Feature doc:** [task-context-and-crdt](features/task-context-and-crdt/feature_architecture.md) — full DocumentRef design, 13 context flows audited, SOLID analysis

### What Gets Eliminated (Future — When Document Pane Ships)

These eliminations are **planned**, not yet implemented. The current runtime still uses all of these.

| Current | Future Target |
|---------|-------------|
| `state` Socket.IO event (sends full plan array on every task change) | **Reduce** — frontend reads task content from CRDT docs, `state` event carries only status changes |
| `goal:stateChange` event (sends all goal summaries) | **Reduce** — lightweight event notifies frontend to refresh |
| `output` Socket.IO event | **Reduce** — output written to CRDT task report, event carries only taskId + status |
| PlanStore JSON disk files | **Eliminate** — plan is a CRDT document, MongoDB has task index (PlanStore still active as backup) |
| `/api/v2/sessions/:teamId/restore` (full state dump via HTTP) | **Simplify** — frontend connects to CRDT for documents, HTTP for status only |
| `goalSessionStore.handleStateEvent()` (processes full plan arrays) | **Simplify** — reads from CRDT for documents, small status updates via events |

---

## Phases — Implementation Plans

Each phase has concrete steps grounded in the actual codebase (audited May 3, 2026).

---

### Phase 1: CRDT-First + Document-Based Planning
**Priority:** P0 | **Effort:** 3-4 weeks | **Dependencies:** None

**Problem:** CRDT writes deleted. MongoDB index broken. Plans are JSON, not documents. No user review before execution. No BlockNote integration. `complete_task` captures only strings.

**4 PRs, merged sequentially.** Each independently testable and deployable.

**Feature docs:**
- [crdt-first-architecture](features/crdt-first-architecture/feature_architecture.md) — page pattern, BlockNote, CRDT restore
- [plan-session](features/plan-session/feature_architecture.md) — document-first planning, wireframes, Document Pane
- [task-context-and-crdt](features/task-context-and-crdt/feature_architecture.md) — DocumentRef vision (13 flows audited)
- [implementation plan](features/crdt-first-architecture/v1.0/feature_implementation_planning.md) — 4 PRs with code-level steps

#### PR 1: DB Safety + Dispatch Fixes (2 days)

| Step | File(s) | What |
|------|---------|------|
| 1.1 | `TaskSchema.ts` + `MongoTaskService.ts` | Fix unique index: `{ teamId, taskId }` → `{ teamId, goalId, taskId }` |
| 1.2 | `GoalManager.ts` L107-126 | Make 3 persist methods async + awaited |
| 1.3 | `GoalSchema.ts` + `MongoGoalService.ts` | Add repoUrl/repoBranch. Write goal status to DB. |
| 1.4 | `OrchestratorService.ts` | Fix dispatch signature compile errors |

#### PR 2: CRDT Standardize + Restore (3 days)

| Step | File(s) | What |
|------|---------|------|
| 2.1 | `CrdtTaskSync.ts` | Standardize Y.Map names to `"meta"` (keep class, don't rewrite) |
| 2.2 | `CrdtGoalStore.ts` | Same — `"goal"` → `"meta"` |
| 2.3 | `collab tool index.ts` | Delete `resolveDataMap()` + `KNOWN_MAP_NAMES`. Always `getMap("meta")`. |
| 2.4 | `GoalManager.ts` | Fill all 7 blank-line gaps (restore CRDT writes) |
| 2.5 | `CrdtTaskSync.ts` | Add `updateAgentStatus()` (FIX-1) |
| 2.6 | 6 files | Add `ICrdtTaskSync` interface, replace `any` (FIX-2) |

#### PR 3: DocumentRef + BlockNote Integration (1 week)

| Step | File(s) | What |
|------|---------|------|
| 3.1 | `collaboration/package.json` | Install `@blocknote/server-util` + `@blocknote/core` |
| 3.2 | `collab tool index.ts` | Rewrite write-block/read-block with ServerBlockNoteEditor |
| 3.3 | `CrdtTaskSync.ts` persistTask() | Move body → Y.XmlFragment("content") via BlockNote |
| 3.4 | `agent-manager/memory/types/` | Add DocumentRef, ExpectedDoc, TaskRisk types |
| 3.5 | `completeTaskTool.ts` | Add producedDocs, decisions, risksEncountered |
| 3.6 | `OrchestratorService.ts` + `TaskStore.ts` | Capture producedDocs → enrich dependant inputDocs |
| 3.7 | `OrchestratorService.ts` dispatchTask() | Inject inputDocs + expectedOutputDocs in agent prompt |
| 3.8 | `WorkerPool.ts` | Fix double-context in buildMessageWithContext |
| 3.9 | `collab tool index.ts` | Add record-decision / get-decisions actions |

#### PR 4: Document-First Plan Session (2 weeks)

| Step | File(s) | What |
|------|---------|------|
| 4.1 | `submitPlan.ts` | Planner writes CRDT document (not JSON). Status: "draft". No auto-approve. |
| 4.2 | `GoalManager.ts` | `deriveTasks()` reads plan-doc from CRDT → extracts task array |
| 4.3 | `GoalManager.ts` | Delete PlanStore dependency |
| 4.4 | Frontend: new `DocumentPane` | Resizable right pane: file list → BlockNote editor |
| 4.5 | Frontend: `DetailPanel` | "📄 View Documents" button |
| 4.6 | Frontend: `PlanTaskList` | "📋 Plan Document" sidebar entry |
| 4.7 | Frontend: Hocuspocus + BlockNote | Connect to plan-doc Y.XmlFragment |
| 4.8 | Frontend: approval flow | Approve/Replan buttons in Document Pane. Auto-open on awaiting_approval. |

**After Phase 1:** Document-first architecture. Plans in CRDT. User reviews in BlockNote. DocumentRef between tasks. MongoDB safe. PlanStore gone.

---

### Phase 2: CRDT Team Workspace (Agent Memory)
**Priority:** P1 | **Effort:** 2 weeks | **Dependencies:** Phase 1

**Problem:** No personal space per agent. No team-level knowledge persistence across goals. Knowledge dies when goal ends.

**Feature docs:** [crdt-scoped-memory](features/crdt-scoped-memory/feature_architecture.md), [crdt-scoped-memory impl](features/crdt-scoped-memory/feature_implementation_planning.md), [CRDT-FEATURE-LIST](features/CRDT-FEATURE-LIST.md) Feature 1-2

| Step | File(s) | What | Code Change |
|------|---------|------|-------------|
| 2.1 | `collab-service/src/rooms/` | IdentityRegistry — agents get real identities | `register(teamId, role)` → `AgentIdentity { id, teamId, role }` (~40 lines) |
| 2.2 | `collab-service/src/rooms/` | RoomManager — rooms as first-class entities | `createRoom()`, `getRoomForDoc()`, `listRooms()` (~60 lines) |
| 2.3 | `collab-service/src/rooms/` | AccessControl — room permissions | `resolveAccess(identity, docName)` → write/read/deny (~50 lines) |
| 2.4 | `HocuspocusServer.ts` | onAuthenticate hook with identity + access | Verify agent token → resolve room access |
| 2.5 | `collaboration/src/L2/memory/` | MemoryScope — remember/recall/list/delete API | Write to Y.Map in team or personal room (~80 lines) |
| 2.6 | `collaboration/src/L2/tools/` | `team_memory` agent tool | remember/recall/list/delete actions (~60 lines) |
| 2.7 | `collaboration/src/L2/tools/` | `personal_notes` agent tool | write/read/delete/list actions (~50 lines) |
| 2.8 | `GoalManager.ts` / goal completion | Goal archival → extract learnings to team memory | LLM extracts decisions/lessons → writes to `{teamId}/team/decisions` |

**After Phase 2:** Agents have personal rooms + shared team memory. Knowledge persists across goals. Room-level access control.

---

### Phase 3: Parallel Goals (MongoDB State + Concurrency)
**Priority:** P1 | **Effort:** 3 weeks | **Dependencies:** Phase 1

**Problem:** Single goal at a time per team. All state in-memory. Goals lost on restart.

**Feature docs:** [parallel-goals](features/parallel-goals/feature_architecture.md), [goal-isolation](features/goal-isolation/), [workspace-isolation](features/workspace-isolation/)

| Step | File(s) | What | Code Change |
|------|---------|------|-------------|
| 3.1 | `GoalManager.ts` | Move GoalContext Map to MongoDB | Replace `Map<goalId, GoalContext>` → `MongoGoalService.get/set/list` |
| 3.2 | `TaskStore.ts` | Move task state to MongoDB | Replace in-memory Map → `MongoTaskService.get/set/update` per operation |
| 3.3 | `GoalManager.ts` | Remove execution mutex | Delete `FF_PARALLEL_PLANS` gate. Allow multiple goals executing. |
| 3.4 | `WorkerPool.ts` | Per-goal concurrency budget | `goalBudget: Map<goalId, { max, current }>` — check before dispatch |
| 3.5 | `OrchestratorService.ts` | Planner cross-goal awareness | Inject other active goals into planner system prompt |
| 3.6 | `GoalManager.ts` | Workspace isolation per goal | Each goal gets own repo clone/branch. `repoPath` scoped by goalId. |
| 3.7 | Frontend | Goal dashboard | List all goals across teams, status, progress bars |
| 3.8 | `HttpServer` / routes | Goal CRUD endpoints | `/api/goals` — list, get, create, cancel |

**After Phase 3:** Users run 3-5 goals simultaneously. State persisted in MongoDB. Survives restarts.

---

### Phase 4: Multi-User (Auth + Team Membership + Quotas)
**Priority:** P2 | **Effort:** 3-4 weeks | **Dependencies:** Phase 3

**Problem:** No userId on goals. No shared teams. No resource quotas.

**Feature docs:** [multi-user](features/multi-user/feature_architecture.md), [auth-security](features/auth-security/), [cost-tracking](features/cost-tracking/)

| Step | File(s) | What | Code Change |
|------|---------|------|-------------|
| 4.1 | `GoalContext` type + MongoDB schema | Add `userId` field | Every goal has an owner |
| 4.2 | MongoDB | `teamMemberships` collection | `{ teamId, userId, role: owner/admin/member/viewer }` |
| 4.3 | `HttpServer` middleware | Authorization middleware | Check TeamMembership before goal CRUD, stream subscribe |
| 4.4 | `SocketServerV2` | Goal room authorization | `subscribeToGoal` → check userId owns goal or is team admin |
| 4.5 | `collab-service/rooms/` | Per-user CRDT room prefix | `{userId}/{teamId}/agent:{role}` for personal rooms |
| 4.6 | MongoDB | `userQuotas` collection | `{ userId, maxGoals, maxWorkers, tokenBudget }` |
| 4.7 | `GoalManager.ts` | Quota check before goal creation | Reject if user at limit |
| 4.8 | Frontend | User dashboard | All goals across teams. Team management UI. |

**After Phase 4:** Multi-tenant. Users own goals. Teams have members. Resource quotas.

---

### Phase 5: Process Isolation + Horizontal Scaling
**Priority:** P2 | **Effort:** 4-6 weeks | **Dependencies:** Phase 4

**Problem:** All workers in same Node.js process. No crash isolation. Single server.

**Feature docs:** [process-isolation](features/process-isolation/feature_architecture.md), [parallel-goals](features/parallel-goals/feature_architecture.md) (BullMQ section), [redis-infrastructure](features/redis-infrastructure/)

| Step | File(s) | What | Code Change |
|------|---------|------|-------------|
| 5.1 | New package or infra | Redis infrastructure | `ioredis` + `@socket.io/redis-adapter` + pub/sub |
| 5.2 | `WorkerPool.ts` refactor | BullMQ task dispatch | Tasks → Redis queue. Workers pull from queue. |
| 5.3 | New: `worker-process.ts` | Stateless worker process | Pulls BullMQ job → creates AiSdkAgent → executes → writes results to MongoDB |
| 5.4 | `SocketServerV2.ts` | Redis pub/sub for streaming | Worker publishes stream_part to Redis → web server forwards to Socket.IO |
| 5.5 | BullMQ | Stalled job detection + auto-retry | Worker dies → job becomes stalled → BullMQ auto-retries |
| 5.6 | Deployment | Multi-server config | N web servers + M worker processes + Redis + MongoDB + Hocuspocus |

**After Phase 5:** Production-ready. Horizontal scaling. Crash isolation. Workers on separate machines.

---

### Phase 6: CRDT Intelligence (Search + Symbols + Consolidation)
**Priority:** P3 | **Effort:** 3-4 weeks | **Dependencies:** Phase 2

**Problem:** No search across CRDT docs. No navigation. Memory bloats after many goals.

**Feature docs:** [crdt-search](features/crdt-search/feature_architecture.md), [crdt-symbol-index](features/crdt-symbol-index/feature_architecture.md), [crdt-consolidation](features/crdt-consolidation/feature_architecture.md), [CRDT-FEATURE-LIST](features/CRDT-FEATURE-LIST.md) Features 3-6

| Step | File(s) | What | Code Change |
|------|---------|------|-------------|
| 6.1 | `collab-service/extensions/` | Orama search extension | `CrdtSearchExtension.ts` — onChange → debounce → extract text → index (~200 lines) |
| 6.2 | `collaboration/src/L2/tools/` | `l2_search` agent tool | search/grep/glob/query actions (~80 lines) |
| 6.3 | `collaboration/src/L2/registry/` | PageRegistry (`_pages`) | Auto-populate Y.Map("pages") on page create/update (~60 lines) |
| 6.4 | `collaboration/src/L2/registry/` | IdentityRegistry (`_identities`) | Aggregated symbol table from page symbols (~80 lines) |
| 6.5 | `collaboration/src/L2/tools/` | `l2_navigate` agent tool | definition/references/impact/outline actions (~80 lines) |
| 6.6 | `collaboration/src/L2/memory/` | MemoryConsolidation | Dedup/merge/supersede on `remember()` (~150 lines) |
| 6.7 | `collab-service/extensions/` | Versioning extension | jsondiffpatch snapshots, whatsnew action (~100 lines) |

**After Phase 6:** CRDT is a searchable knowledge base. Entity navigation. Memory doesn't bloat.

---

## Dependency Graph

```
Phase 1: CRDT-First + Document Planning     ← START HERE (3-4 weeks)
  │       (DB safety + page pattern + DocumentRef + BlockNote + plan session)
  │
  ├── Phase 2: Team Workspace (Memory)       (parallel with 3)
  │     │
  │     └── Phase 6: CRDT Intelligence
  │
  └── Phase 3: Parallel Goals (MongoDB)      (parallel with 2)
        │
        └── Phase 4: Multi-User
              │
              └── Phase 5: Process Isolation
```

**Critical path to production:** 1 → 3 → 4 → 5

**Intelligence track:** 1 → 2 → 6 (can run in parallel with critical path)

---

## Path to Production

| Milestone | Phases | Timeline | What It Enables |
|-----------|--------|----------|------------------|
| **Alpha** | 1 | Week 4 | Document-first planning. BlockNote plan review. CRDT context works. DocumentRef. |
| **Beta** | 1 + 3 + 4 | Week 12 | Multi-user, parallel goals |
| **Production** | 1-5 | Week 18 | Horizontal scaling, crash isolation |
| **Intelligence** | 2 + 6 | Anytime | Cross-goal memory, semantic search |

---

## New Infrastructure Per Phase

| Phase | New Infra | New Packages |
|-------|-----------|--------------|
| 1 | **None** | `@blocknote/server-util`, `@blocknote/core` (in collaboration pkg) |
| 2-4 | **None** | None (uses existing MongoDB + Hocuspocus + better-auth) |
| 5 | **Redis** | `ioredis`, `bullmq`, `@socket.io/redis-adapter` |
| 6 | **None** | `@orama/orama`, `jsondiffpatch` |

---

## Feature Doc Cross-Reference

| Phase | Feature Docs |
|-------|-------------|
| 1 | [crdt-first-architecture](features/crdt-first-architecture/), [plan-session](features/plan-session/), [task-context-and-crdt](features/task-context-and-crdt/), [data-persistence](features/data-persistence/) |
| 2 | [crdt-scoped-memory](features/crdt-scoped-memory/), [crdt-team-memory](features/crdt-team-memory/), [crdt-goal-lifecycle](features/crdt-goal-lifecycle/), [CRDT-FEATURE-LIST](features/CRDT-FEATURE-LIST.md) |
| 3 | [parallel-goals](features/parallel-goals/), [goal-isolation](features/goal-isolation/), [workspace-isolation](features/workspace-isolation/), [task-orchestration](features/task-orchestration/) |
| 4 | [multi-user](features/multi-user/), [auth-security](features/auth-security/), [browser-auth](features/browser-auth/), [cost-tracking](features/cost-tracking/) |
| 5 | [process-isolation](features/process-isolation/), [redis-infrastructure](features/redis-infrastructure/), [worker-architecture](features/worker-architecture/) |
| 6 | [crdt-search](features/crdt-search/), [crdt-symbol-index](features/crdt-symbol-index/), [crdt-consolidation](features/crdt-consolidation/), [crdt-diff-versioning](features/crdt-diff-versioning/) |

## Cross-Cutting Feature Docs (Not Phase-Specific)

| Feature | Doc | Relevance |
|---------|-----|-----------|
| [communication-layer-refactor](features/communication-layer-refactor/) | v1-v5.1 all done | Socket.IO split, typed events — foundation for all phases |
| [inter-agent-collaboration](features/inter-agent-collaboration/) | Architected | @mention routing — future Phase 8+ |
| [chat-agent-layer](features/chat-agent-layer/) | Implemented | Per-role ChatAgents — used in Phase 5 dashboard |
| [planner-as-agent](features/planner-as-agent/) | Design | Planner restructure — relevant to Phase 3 |
| [external-agent-invocation](features/external-agent-invocation/) | Architected | Team stacking, MCP — future |
| [callback-refactoring](features/callback-refactoring/) | Research | Flatten 5-layer callback chain — deferred |
| [FEATURE-LIST](features/FEATURE-LIST.md) | Master index | All features with status and priority |
