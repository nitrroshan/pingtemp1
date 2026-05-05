# Platform Roadmap — Phased Delivery Plan

**Date:** May 4, 2026
**Purpose:** Unified plan for all major features, ordered by dependency and impact.

---

## Current State (Audited May 4, 2026)

| Area | Status | Details |
|------|--------|---------|
| **MongoDB** | ✅ Working | Chat, goals, tasks persisted. Write-through TaskStore. Unique index: `{teamId, goalId, taskId}`. |
| **Auth** | ✅ Working | better-auth (email+password, GitHub OAuth). Socket.IO + HTTP middleware. |
| **Workspace** | ✅ Working | Per-task git worktrees. Per-goal clone. Branch isolation. |
| **Frontend** | ✅ Working | GoalScreen, PlanList, multi-goal switching, goalSessionStore, Document Pane (MVP). |
| **CRDT** | ✅ Working | Event-driven projection (GoalEventBus → CrdtProjectionHandler). `Y.Map("meta")` standard. Plan docs written at proposal time. |
| **Plan approval** | ✅ Working | `awaiting_approval` state. PlanApproval dialog + Document Pane approve/reject. Request Changes with feedback. |
| **Completion protocol** | ✅ Enforced | Agents must write `{taskId}/report` to CRDT before `complete_task`. Tool-level enforcement. |
| **Document Pane** | ✅ MVP | DocumentList, CrdtDocViewer, WorkspaceFileViewer. Auto-open on approval. `Cmd+D` shortcut. |
| **Conversation persistence** | ✅ v1.2 | Planner + ChatAgent save/restore wired end-to-end. User-scoped session restore (B-008). |
| **Goal isolation** | ✅ Working | Parallel goals. Goal-scoped tasks, notifications, DAG. |
| **Database** | ⚠️ Transitional | MongoDB (cloud) + SQLite (local). Hybrid PostgreSQL + MongoDB planned. |
| **Redis** | ❌ None | Zero deps. All state in-memory. Single-server only. |
| **Team membership** | ❌ Owner-only | No multi-member teams. No organizations. |
| **Process isolation** | ❌ None | All workers in same Node.js process. |

### What Was Shipped (this branch — `user/nitrroshan/fixplans`)

**PR1-4: CRDT-First Architecture**
- CRDT writes restored via GoalEventBus + CrdtProjectionHandler
- MongoDB safety: unique index, async persist, GoalSchema
- `Y.Map("meta")` standardized across all docs
- TaskStore write-through: MongoDB BEFORE Map cache
- DocumentRef context pipeline: `inputDocs`, `producedDocs`, `decisions` on Task type
- BlockNote server-side: `write-block`/`read-block` via ServerBlockNoteEditor
- `record-decision` / `get-decisions` collab tool actions
- `complete_task` enforces CRDT report doc (exact URI match)
- Plan proposed → CRDT projection at submit time (not just approval)
- Planner has collab tools (was missing L2 tools)

**Plan Approval Flow**
- `awaiting_approval` state (no auto-approve)
- PlanApproval dialog with Approve + Request Changes
- `reject-plan` socket action routes feedback to planner
- Document Pane auto-opens with plan doc on `awaiting_approval`
- Planner prompt updated: `submit_plan` → awaiting_approval (stale `request_approval` removed)

**Document Pane**
- DocumentPane container with list/editor/file viewer routing
- DocumentList: CRDT docs grouped by type (plan/tasks/reports/workspace)
- CrdtDocViewer: lazy-loaded BlockNote/Hocuspocus
- WorkspaceFileViewer: monospace code viewer
- Backend workspace file endpoints
- "View Documents" button in DetailPanel
- `Cmd+D` keyboard shortcut
- Approve/reject footer when viewing plan doc

**Persistence & Safety**
- Atomic approval: upsert new tasks, delete stale by planId (no crash data loss)
- Planner conversation save/restore (v1.2): wired end-to-end with userId + agentLayer
- User-scoped session restore: userId filter on IChatService queries
- DispatchManager async-aware error handling
- requestTaskTool rollback through TaskStore (single writer)
- PlanStore removed from hot path (MongoDB taskPersistence for cross-plan refs, PlanStore fallback only)
- decisions type unified: `{decision, rationale?}` across all surfaces

### What's Still Open

| Issue | Priority | Notes |
|-------|----------|-------|
| Hocuspocus filesystem persistence | P1 | Must switch to S3 for production |
| Document Pane polish | P1 | Resize, metadata header, read-only, report visibility, syntax highlighting |
| PlanStore full removal | P2 | Now fallback-only, blocked by cross-plan ref migration |
| Team ownership model | P1 | Organizations → agent teams hierarchy. See [team-ownership](features/team-ownership/feature_architecture.md) |
| Hybrid database (PostgreSQL + MongoDB) | P1 | See [team-ownership](features/team-ownership/feature_architecture.md) for migration plan |

---

## Deployment

### Production Stack (PMF Phase — $5-20/month)

| Service | Provider | Free Tier | Est. Cost | Purpose |
|---------|----------|-----------|-----------|---------|
| **PostgreSQL** | Neon | 0.5 GB, 100 CU-hrs, scale-to-zero | $0-15/mo | Teams, goals, tasks, members (relational data) |
| **MongoDB** | Atlas M0 | 512 MB free forever | $0 | Chat messages, index snapshots (document data) |
| **S3 Storage** | Cloudflare R2 | 10 GB + 10M reads, zero egress | $0 | CRDT document blobs (Hocuspocus persistence) |
| **Backend** | Railway | $5 Hobby credit, per-second billing | $5-20/mo | API server + collab-service |
| **Frontend** | Vercel | Free Hobby plan | $0 | Vite/React static build, CDN, auto-deploy |

**Why this stack:**
- **Neon**: Serverless PG, scales to zero when idle. Built-in better-auth support via Neon Auth. Drizzle-native.
- **Atlas M0**: Already in use. Chat messages fit in free 512 MB. Document-shaped data stays in MongoDB.
- **R2**: Zero egress fees — critical for read-heavy CRDT docs. S3-compatible (`@aws-sdk/client-s3`).
- **Railway**: Git push deploy, usage-based billing by the second. Built-in PG/Redis templates if needed.
- **Vercel**: Free for static sites. Automatic CI/CD from Git.

### Local Development

```yaml
# docker-compose.dev.yml
services:
  postgres:
    image: postgres:16-alpine
    ports: ["5432:5432"]
    environment:
      POSTGRES_DB: ping
      POSTGRES_USER: ping
      POSTGRES_PASSWORD: ping
    volumes: ["pg_data:/var/lib/postgresql/data"]

  minio:
    image: minio/minio
    ports: ["9000:9000", "9001:9001"]
    environment:
      MINIO_ROOT_USER: minioadmin
      MINIO_ROOT_PASSWORD: minioadmin
    command: server /data --console-address ":9001"
    volumes: ["minio_data:/data"]

  mongo:
    image: mongo:7
    ports: ["27017:27017"]
    volumes: ["mongo_data:/data/db"]

volumes:
  pg_data:
  minio_data:
  mongo_data:
```

```bash
# .env (local dev)
DATABASE_URL=postgresql://ping:ping@localhost:5432/ping
MONGODB_URI=mongodb://localhost:27017/ping
S3_ENDPOINT=http://localhost:9000
S3_BUCKET=ping-crdt
S3_ACCESS_KEY=minioadmin
S3_SECRET_KEY=minioadmin
COLLAB_PORT=1234
PING_MODE=hybrid

# .env (production)
DATABASE_URL=postgresql://...@ep-xxx.neon.tech/ping?sslmode=require
MONGODB_URI=mongodb+srv://...@cluster0.mongodb.net/ping
S3_ENDPOINT=https://xxx.r2.cloudflarestorage.com
S3_BUCKET=ping-crdt
S3_ACCESS_KEY=xxx
S3_SECRET_KEY=xxx
COLLAB_URL=wss://collab-service.up.railway.app
PING_MODE=hybrid
```

### Architecture

```
┌─────────────┐    ┌─────────────────┐    ┌──────────────┐
│   Vercel     │    │    Railway       │    │  Railway      │
│   Frontend   │───▶│    Backend API   │───▶│  Collab Svc   │
│   (React)    │    │    (Express)     │    │  (Hocuspocus) │
└─────────────┘    └────────┬────────┘    └──────┬───────┘
                            │                     │
                   ┌────────┴────────┐    ┌──────┴───────┐
                   │                 │    │              │
              ┌────▼────┐   ┌───────▼──┐ │  ┌───────────▼┐
              │  Neon    │   │ Atlas M0 │ │  │ R2 Storage  │
              │  (PG)    │   │ (Mongo)  │ │  │ (CRDT blobs)│
              │ relational│   │ documents│ │  │ S3-compat   │
              └──────────┘   └──────────┘ │  └────────────┘
                                          │
                              Teams, goals,│  Chat messages,
                              tasks, auth  │  index snapshots
```

### Desktop App
- Electron wrapper loading the cloud web app — no local storage
- Package: `@ping/desktop`
- Same as browser, with native window controls + system tray

**Feature docs:** [dev-prod-setup](features/dev-prod-setup/), [team-ownership](features/team-ownership/feature_architecture.md)

## Architecture Principle: Three Storage Layers

```
PostgreSQL (Neon)              MongoDB (Atlas)              CRDT (Hocuspocus + R2)
= Relational data              = Document data               = Collaborative artifacts
= Teams, goals, tasks          = Chat messages                = Plan docs, reports
= Members, auth                = Index snapshots              = Agent workspace
= FK constraints               = Append-heavy, JSON blobs     = Real-time, multi-writer
```

**Each database for its strength:**

| | PostgreSQL | MongoDB | CRDT |
|---|---|---|---|
| **Purpose** | Relational tracking — who owns what, task lifecycle | Content storage — chat history, LLM context | Collaborative docs — agents and users edit together |
| **What lives here** | organizations, teams, members, goals, tasks, agent definitions, auth | chat messages, stream parts, contextMessages, index snapshots | plan docs, task descriptions, completion reports, team memory |
| **Schema** | Strict — Drizzle ORM, FK constraints, enums, cascading deletes | Flexible — variable JSON blobs, no joins | Standard page pattern — `Y.Map("meta")` + `Y.XmlFragment("content")` |
| **Survives restart?** | Yes (managed PG) | Yes (managed Atlas) | Yes (R2 blob storage) |
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

### What Goes Where (After Phase 2 Migration)

**PostgreSQL (Neon)** — relational data with FK constraints:

| Table | Key Fields | Why PG |
|-------|-----------|--------|
| **`organizations`** | id, name, plan | Root entity, FK cascade to teams |
| **`org_members`** | orgId → orgs, userId → users, role | Join table, role enums |
| **`agent_teams`** | id, orgId → orgs, pluginName | FK to org, cascade delete |
| **`goals`** | id, agentTeamId → teams, createdBy, approvedBy, status | FK chain, status enums |
| **`tasks`** | id, goalId → goals, assignedRole, output (JSONB) | FK cascade, dependencies array |
| **`agent_definitions`** | id, agentTeamId → teams, role, capabilities (JSONB) | Team-scoped, config as JSONB |
| **auth tables** | users, sessions, accounts (better-auth Drizzle adapter) | Shares same PG connection |

**MongoDB (Atlas M0)** — document data:

| Collection | Key Fields | Why Mongo |
|------------|-----------|-----------|
| **`chatmessages`** | goalId, agentId, userId, content, streamParts, contextMessages | Variable JSON blobs, append-heavy, no joins |
| **`indexsnapshots`** | branchId, searchIndex (Buffer), symbols[] | Binary data, no relations |

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

Each phase has concrete steps grounded in the actual codebase (audited May 4, 2026).

---

### Phase 1: CRDT-First + Document-Based Planning ✅ COMPLETE
**Priority:** P0 | **Status:** Shipped on `user/nitrroshan/fixplans` branch

**What was delivered:**
- PR1: DB safety (unique index, async persist, GoalSchema)
- PR2: CRDT standardize (meta maps, event-driven projection, agent status)
- PR3: DocumentRef + BlockNote + collab tools
- PR4: Plan approval, completion protocol, reject/replan, CRDT plan docs
- Document Pane MVP: list, CRDT viewer, workspace files, approve/reject footer
- Atomic approval: upsert new → delete stale by planId
- Planner conversation save/restore (v1.2)
- User-scoped session restore
- Completion protocol enforcement (exact report URI)
- decisions type unified: `{decision, rationale?}`
- PlanStore removed from hot path (MongoDB for cross-plan refs)

**Feature docs:** [crdt-first-architecture](features/crdt-first-architecture/), [document-pane](features/document-pane/), [conversation-persistence](features/conversation-persistence/)

**Remaining polish (P1/P2):** Document Pane resize, metadata header, read-only system docs, syntax highlighting, auto-refresh. See [TASK-BACKLOG.md](features/TASK-BACKLOG.md).

---

### Phase 2: Hybrid Database + Team Ownership ← NEXT
**Priority:** P1 | **Effort:** ~6.5 days | **Dependencies:** Phase 1 ✅

**Problem:** Relational data (teams, goals, tasks, memberships) in MongoDB/SQLite. No ownership hierarchy. No organizations.

**Architecture:** [team-ownership](features/team-ownership/feature_architecture.md) — hybrid PostgreSQL + MongoDB, two-tier org→agent team model

**Two-tier model:**
```
organizations (human teams)
  ├── org_members (userId, role: owner/admin/member/viewer)
  └── agent_teams (pluginName, agents)
       └── goals (createdBy, approvedBy)
            └── tasks (goalId FK, cascade delete)
```

| Step | What | Effort |
|------|------|--------|
| 2.1 | Add PostgreSQL + Drizzle ORM, schema definitions | 1 day |
| 2.2 | PgGoalService, PgTaskService, PgTeamService implementations | 2 days |
| 2.3 | Migration script: MongoDB → PostgreSQL | 1 day |
| 2.4 | org_members + access control middleware | 2 days |
| 2.5 | Cleanup: remove Mongo/SQLite for migrated collections | 0.5 day |

**Database split:** PostgreSQL for relational (teams, goals, tasks, members). MongoDB stays for chat messages + index snapshots.

**After Phase 2:** Organizations → agent teams → goals → tasks with FK constraints + cascading deletes. Multi-member teams with roles. Hybrid PostgreSQL + MongoDB.

---

### Phase 3: CRDT Team Workspace (Agent Memory)
**Priority:** P1 | **Effort:** 2 weeks | **Dependencies:** Phase 1 ✅

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

**After Phase 3:** Agents have personal rooms + shared team memory. Knowledge persists across goals. Room-level access control.

---

### Phase 4: Parallel Goals (State + Concurrency)
**Priority:** P1 | **Effort:** 3 weeks | **Dependencies:** Phase 2

**Problem:** Single goal at a time per team. All state in-memory. Goals lost on restart.

**Feature docs:** [parallel-goals](features/parallel-goals/feature_architecture.md), [goal-isolation](features/goal-isolation/), [workspace-isolation](features/workspace-isolation/)

| Step | What |
|------|------|
| 4.1 | Move GoalContext to PostgreSQL (Phase 2 already migrated goals/tasks) |
| 4.2 | Remove execution mutex — allow multiple goals executing |
| 4.3 | Per-goal concurrency budget in WorkerPool |
| 4.4 | Planner cross-goal awareness (inject active goals into prompt) |
| 4.5 | Workspace isolation per goal (own repo clone/branch) |
| 4.6 | Frontend goal dashboard |
| 4.7 | Goal CRUD endpoints |

**After Phase 4:** Users run 3-5 goals simultaneously. State in PostgreSQL. Survives restarts.

---

### Phase 5: Process Isolation + Horizontal Scaling
**Priority:** P2 | **Effort:** 4-6 weeks | **Dependencies:** Phase 4

**Problem:** All workers in same Node.js process. No crash isolation. Single server.

**Feature docs:** [process-isolation](features/process-isolation/feature_architecture.md), [redis-infrastructure](features/redis-infrastructure/)

| Step | What |
|------|------|
| 5.1 | Redis infrastructure (ioredis + socket.io adapter + pub/sub) |
| 5.2 | BullMQ task dispatch — tasks → Redis queue |
| 5.3 | Stateless worker process — pulls from queue, executes, writes results |
| 5.4 | Redis pub/sub for streaming (worker → web server → Socket.IO) |
| 5.5 | Stalled job detection + auto-retry |
| 5.6 | Multi-server deployment config |

**After Phase 5:** Production-ready. Horizontal scaling. Crash isolation. Workers on separate machines.

---

### Phase 6: CRDT Intelligence (Search + Symbols + Consolidation)
**Priority:** P3 | **Effort:** 3-4 weeks | **Dependencies:** Phase 3

**Problem:** No search across CRDT docs. No navigation. Memory bloats after many goals.

**Feature docs:** [crdt-search](features/crdt-search/feature_architecture.md), [crdt-symbol-index](features/crdt-symbol-index/feature_architecture.md), [CRDT-FEATURE-LIST](features/CRDT-FEATURE-LIST.md) Features 3-6

| Step | What |
|------|------|
| 6.1 | Orama search extension (onChange → index text) |
| 6.2 | `l2_search` agent tool |
| 6.3 | PageRegistry (`_pages`) + IdentityRegistry (`_identities`) |
| 6.4 | `l2_navigate` agent tool (definition/references/impact) |
| 6.5 | MemoryConsolidation (dedup/merge on remember) |
| 6.6 | Versioning extension (jsondiffpatch snapshots) |

**After Phase 6:** CRDT is a searchable knowledge base. Entity navigation. Memory doesn't bloat.

---

## Dependency Graph

```
Phase 1: CRDT-First + Document Planning     ✅ COMPLETE
  │
  ├── Phase 2: Hybrid DB + Team Ownership    ← NEXT (~6.5 days)
  │     │
  │     ├── Phase 3: CRDT Team Workspace     (parallel with 4)
  │     │     │
  │     │     └── Phase 6: CRDT Intelligence
  │     │
  │     └── Phase 4: Parallel Goals          (parallel with 3)
  │           │
  │           └── Phase 5: Process Isolation
  │
  └── (Document Pane polish — see TASK-BACKLOG.md)
```

**Critical path to production:** 1 ✅ → 2 → 4 → 5

**Intelligence track:** 1 ✅ → 3 → 6 (can run in parallel with critical path)

---

## Path to Production

| Milestone | Phases | Timeline | What It Enables |
|-----------|--------|----------|------------------|
| **Alpha** | 1 ✅ | Done | Document-first planning. CRDT context. DocumentRef. Document Pane. |
| **Foundation** | 2 | +1 week | PostgreSQL + MongoDB hybrid. Organizations. Team membership. |
| **Beta** | 2 + 4 | +4 weeks | Multi-user, parallel goals, persistent state |
| **Production** | 2-5 | +10 weeks | Horizontal scaling, crash isolation |
| **Intelligence** | 3 + 6 | Anytime | Cross-goal memory, semantic search |

---

## New Infrastructure Per Phase

| Phase | New Infra | New Packages |
|-------|-----------|--------------|
| 1 ✅ | **None** | `@blocknote/server-util`, `@blocknote/core` |
| 2 | **PostgreSQL** | `drizzle-orm`, `pg` (or `@neondatabase/serverless`) |
| 3-4 | **None** | Uses existing PostgreSQL + MongoDB + Hocuspocus |
| 5 | **Redis** | `ioredis`, `bullmq`, `@socket.io/redis-adapter` |
| 6 | **None** | `@orama/orama`, `jsondiffpatch` |

---

## Feature Doc Cross-Reference

| Phase | Feature Docs |
|-------|-------------|
| 1 ✅ | [crdt-first-architecture](features/crdt-first-architecture/), [document-pane](features/document-pane/), [conversation-persistence](features/conversation-persistence/), [plan-session](features/plan-session/), [task-context-and-crdt](features/task-context-and-crdt/) |
| 2 | [team-ownership](features/team-ownership/) (hybrid DB + organizations) |
| 3 | [crdt-scoped-memory](features/crdt-scoped-memory/), [crdt-team-memory](features/crdt-team-memory/), [CRDT-FEATURE-LIST](features/CRDT-FEATURE-LIST.md) |
| 4 | [parallel-goals](features/parallel-goals/), [goal-isolation](features/goal-isolation/), [workspace-isolation](features/workspace-isolation/) |
| 5 | [process-isolation](features/process-isolation/), [redis-infrastructure](features/redis-infrastructure/) |
| 6 | [crdt-search](features/crdt-search/), [crdt-symbol-index](features/crdt-symbol-index/), [crdt-consolidation](features/crdt-consolidation/) |

## Cross-Cutting Feature Docs (Not Phase-Specific)

| Feature | Doc | Relevance |
|---------|-----|-----------|
| [communication-layer-refactor](features/communication-layer-refactor/) | v1-v5.1 all done | Socket.IO split, typed events — foundation for all phases |
| [inter-agent-collaboration](features/inter-agent-collaboration/) | Architected | @mention routing — future |
| [chat-agent-layer](features/chat-agent-layer/) | Implemented | Per-role ChatAgents |
| [external-agent-invocation](features/external-agent-invocation/) | Architected | Team stacking, MCP — future |
| [FEATURE-LIST](features/FEATURE-LIST.md) | Master index | All features with status and priority |
| [TASK-BACKLOG](features/TASK-BACKLOG.md) | Active backlog | All open tasks with priorities |
