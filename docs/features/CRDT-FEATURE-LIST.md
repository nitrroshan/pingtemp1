# CRDT & Agent Memory — Feature List

**Last Updated:** May 2, 2026  
**Master Research:** [crdt-team-memory/research.md](crdt-team-memory/research.md) (2552 lines)  
**Infrastructure Package:** `packages/collab-service/` (Hocuspocus CRDT server)

---

## Strategic Overview: CRDT as the Agent Operating System

### Current State — CRDT is a Dumb Notebook

Agents have one tool (`collab`) with 7 actions: write, read, write-block, read-block, discuss, list, get-presence. They write plans, tasks, and discussions to shared Y.js docs scoped per goal (`{teamId}/{goalId}/`).

**What's broken:**
- **No search.** 36 tools for files (grep, glob, read, search). For CRDT: zero search. Agents rationally ignore CRDT.
- **No memory.** Knowledge dies when the goal ends.
- **No personal space.** Every agent writes to the same docs.
- **No identity.** Agents are role strings, not users with permissions.
- **Single-instance.** Hocuspocus runs in-process — can't scale.

### Target State — Real-Time Shared Brain

Three industry patterns mapped to Ping:

| Industry | Pattern | Ping Layer |
|----------|---------|------------|
| **Liveblocks** | Rooms + Auth + ACL | Multi-tenant isolation, agent identity |
| **CrewAI Memory** | MemoryScope + Consolidation | remember/recall API, cross-goal persistence |
| **Y-Sweet** | Document tokens + S3 persistence | Horizontal scale |

```
┌────────────────────────────────────────────────────────────────┐
│                    CRDT Memory Service                         │
│                                                                │
│  ROOMS                                                         │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐         │
│  │ team-memory   │  │ agent:coder  │  │ goal:abc123  │         │
│  │ decisions    │  │ scratchpad   │  │ plan/tasks   │         │
│  │ conventions  │  │ context      │  │ discussion   │         │
│  │ knowledge    │  │ preferences  │  │ outputs      │         │
│  └──────────────┘  └──────────────┘  └──────────────┘         │
│  Shared (all write)  Private (self)    Goal-scoped (existing) │
│                                                                │
│  SEARCH (Orama — unified index, P0)                           │
│  BM25 keyword · regex grep · glob · JSONPath                  │
│  onChange → auto-index · 10-100x faster than disk I/O          │
│                                                                │
│  MEMORY (CrewAI pattern, P2)                                   │
│  remember() → auto-scoped · recall() → BM25 ranked            │
│  consolidation → dedup/merge/supersede · async saves           │
│                                                                │
│  SYMBOLS (LSP for CRDT, P1)                                    │
│  go-to-definition · find-references · entity extraction        │
│                                                                │
│  VERSIONING (P2)                                               │
│  jsondiffpatch · snapshots · temporal validity                 │
└────────────────────────────────────────────────────────────────┘
```

### How Each Layer Changes Agent Behavior

**Search (P0):** `l2_search({ action: "grep", pattern: "PostgreSQL" })` — agents treat CRDT like a filesystem.

**Rooms (P1):** Researcher gets private scratchpad. Team decisions persist across goals. Frontend can't see system config.

**Symbols (P1):** `l2_navigate({ action: "definition", symbol: "task-003" })` — entities become navigable like code symbols.

**Team Memory (P2):** `team_memory({ action: "recall", query: "database" })` → returns decision from Goal 1, usable in Goal 5.

**Versioning (P2):** `l2_search({ action: "whatsnew", since: "2h" })` → human-readable changelog of who changed what.

### Why CRDT Over Files or Database

| | Files (L1) | MongoDB (L3) | CRDT (L2) |
|-|-----------|-------------|-----------|
| Latency | 1-10ms (disk) | 5-50ms (network) | **<0.1ms** (in-memory) |
| Concurrent writes | Git merge conflicts | Last-write-wins | **Auto-merge** |
| Real-time sync | ❌ Poll | ❌ Change streams | **✅ WebSocket push** |
| Cross-goal persistence | ❌ Dies with branch | ✅ | ✅ (team-memory room) |
| Agent private space | ❌ All visible | ❌ Shared DB | ✅ (agent rooms + ACL) |
| Frontend live editing | ❌ | ❌ | ✅ (BlockNote + Hocuspocus) |

### Progress

```
Infrastructure ████████████████████ 100%  (collab-service extracted, deployed)
Scoped Memory  ░░░░░░░░░░░░░░░░░░░░   0%  (agent rooms + team memory — NEXT)
Goal Lifecycle ░░░░░░░░░░░░░░░░░░░░   0%  (archive + cleanup + decay)
Search         ░░░░░░░░░░░░░░░░░░░░   0%  (Orama integration)
Symbols        ░░░░░░░░░░░░░░░░░░░░   0%  (entity index, navigation)
Versioning     ░░░░░░░░░░░░░░░░░░░░   0%  (diffs, snapshots, rollback)
```

---

## Status Legend

| Status | Meaning |
|--------|---------|
| ✅ Done | Code implemented, builds pass, tests exist |
| 🔧 Partial | Infrastructure done, intelligence not built |
| 📐 Architected | Architecture doc exists, zero code |
| 🔬 Research | Research complete, no architecture doc yet |

---

## Feature 0: Infrastructure (DONE)

**Status:** ✅ Complete

| # | Item | Status | What Exists |
|---|------|--------|-------------|
| I1 | Collab-Service Extraction | ✅ Done | `packages/collab-service/` — CollabServer, BlobStorage, Dockerfile, docker-compose, health check, 4 tests |
| I2 | COLLAB_MODE External Wiring | ✅ Done | `COLLAB_MODE=external` env var, `RemoteCollabClient`, production docker-compose |
| F1 | Server-Generated GoalId | ✅ Done | Backend nonce echo, `sendToManagerAsync`, optimistic rendering |
| F2 | Infinite Loop Fix | ✅ Done | `activeGoalId` explicit state in uiStore |

---

## Feature 1: Agent-Scoped Memory (Personal + Team Rooms)

**Priority:** P0 — First feature to implement  
**Goal:** Each agent has its own CRDT room (read/write/delete). Team has a shared memory room. Current goal-scoped functionality preserved.  
**Depends on:** I1 (done)  
**Docs:** [crdt-scoped-memory](crdt-scoped-memory/)  
**Status:** 📐 Architected

### What This Feature Delivers

```
BEFORE (today):
  All agents → same docs under {teamId}/{goalId}/
  No personal space. No team-level persistence.

AFTER:
  {orgId}/team-memory          — shared decisions, conventions, knowledge
  {orgId}/agent:{role}         — private scratchpad, context, task-history
  {orgId}/goal:{goalId}        — existing goal-scoped work (unchanged)
```

### Scope

- **Room creation** — Hocuspocus `onAuthenticate` creates rooms on first access
- **Agent personal room** — each agent role gets `{orgId}/agent:{role}` with read/write/delete
- **Team memory room** — `{orgId}/team-memory` with Y.Map for decisions, conventions, knowledge
- **Agent tools** — `team_memory` (remember/recall/list/delete) and `personal_notes` (write/read/delete/list)
- **Room isolation** — agent can only write to its own room + team memory. Can read other agents' rooms.
- **No auth/JWT yet** — room isolation via doc name prefix checking (simple, no infra changes)

### What It Does NOT Include

- JWT/token authentication (Feature 5)
- Orama search (Feature 3)
- Memory consolidation/dedup (Feature 2)
- Multi-tenant (cloud) isolation (Feature 5)

### Implementation Location

```
packages/collaboration/src/L2/
  memory/
    MemoryScope.ts              — remember(), recall(), list(), delete(), tree()
    AgentMemoryRoom.ts          — opens/manages agent:{role} room
    TeamMemoryRoom.ts           — opens/manages team-memory room
  tools/
    team-memory.ts              — team_memory tool for agents
    personal-notes.ts           — personal_notes tool for agents
packages/collab-service/src/
  server/HocuspocusServer.ts    — room prefix validation in onAuthenticate
```

### Effort: ~300 lines code + ~50 lines tool definitions

---

## Feature 2: Goal Lifecycle (Archive + Stale Cleanup)

**Priority:** P0 — Must ship with Feature 1  
**Goal:** Completed goals are archived to cold storage. Stale memories decay. Agents can delete their own memories.  
**Depends on:** Feature 1  
**Docs:** [crdt-goal-lifecycle](crdt-goal-lifecycle/)  
**Status:** 🔬 Research

### What This Feature Delivers

```
BEFORE:
  Completed goal docs stay in memory forever.
  50 goals = 50 sets of plan/tasks/discussion in Hocuspocus memory.
  No way to clean up. No archival.

AFTER:
  Goal completed → extract key learnings → archive to team-memory → delete goal room
  Stale memories rank lower in recall (recency decay)
  Agents can explicitly forget() memories
```

### Scope

- **Goal archival pipeline** — on goal completion:
  1. LLM extracts key learnings from goal docs (decisions, outcomes, lessons)
  2. Learnings stored in team-memory room (cross-goal persistence)
  3. Goal room docs persisted to disk/S3 as binary snapshots (cold storage)
  4. Goal room evicted from Hocuspocus memory
- **Recency decay** — `recency_half_life_days` parameter on recall. Old memories rank lower. (CrewAI pattern)
- **Explicit forget** — `team_memory({ action: "forget", scope: "/project/old" })` deletes a subtree
- **Agent memory cleanup** — `personal_notes({ action: "clear" })` wipes personal room
- **Cold storage format** — `Y.encodeStateAsUpdate(doc)` saved as `.bin` files (already done by BlobStorage)

### What It Does NOT Include

- Automatic TTL-based deletion (too risky — let agents decide what to forget)
- Vector-based semantic dedup (Feature 4)
- Version history of archived goals (Feature 6)

### Industry Patterns

| Pattern | Source | Our Implementation |
|---------|--------|-------------------|
| `memory.forget(scope)` | CrewAI | `team_memory({ action: "forget", scope })` |
| `recency_half_life_days` | CrewAI | Score decay on recall results |
| `DELETE /rooms/{roomId}` | Liveblocks | Evict goal room from Hocuspocus after archival |
| `extract_memories(output)` | CrewAI | LLM breaks goal output into atomic facts for team-memory |

### Implementation Location

```
packages/collaboration/src/L2/
  memory/
    GoalArchiver.ts             — extract learnings + archive + evict
    MemoryDecay.ts              — recency scoring for recall
packages/collab-service/src/
  server/RoomManager.ts         — evictRoom(), archiveRoom()
packages/backend/
  agentManager/AgentManagerV2.ts — hook into goal completion lifecycle
```

### Effort: ~200 lines code

---

## Feature 3: CRDT Search (Orama)

**Priority:** P1 — Makes CRDT usable  
**Goal:** Agents can grep, glob, search, and query CRDT docs like they do with files.  
**Depends on:** I1 (done). Independent of Feature 1/2.  
**Docs:** [crdt-search](crdt-search/)  
**Status:** 📐 Architected

### What This Feature Delivers

```
BEFORE:
  Agents have 36 file tools (grep, glob, read, search). For CRDT: zero search.

AFTER:
  l2_search({ action: "search", query: "database decision" })  → BM25 ranked
  l2_search({ action: "grep", pattern: "PostgreSQL" })          → regex match
  l2_search({ action: "glob", pattern: "*/decisions/*" })       → doc name match
  l2_search({ action: "query", path: "$.status" })              → JSONPath on live data
  l2_search({ action: "whatsnew", since: "2h" })                → changelog
```

### Scope

- **Orama in-memory index** — BM25 keyword search over all CRDT doc content
- **Hocuspocus extension** — `onChange` hook → debounce (2s) → extract text → re-index
- **Text extraction** — Y.Map → JSON, Y.Text → string, Y.XmlFragment → markdown
- **Agent tool** — `l2_search` with search/grep/glob/query/cat/stat/whatsnew actions
- **No vectors** — pure keyword search. Vectors added later in Feature 4.

### What It Does NOT Include

- Entity/symbol extraction (Feature 5)
- Vector embeddings (Feature 4)
- Room-scoped search isolation (works on all accessible docs)

### Implementation Location

```
packages/collab-service/src/
  extensions/
    CrdtSearchExtension.ts      — Orama index + onChange hook
    TextExtractor.ts            — Y.Doc → searchable text
packages/collaboration/src/L2/
  tools/
    l2-search.ts                — l2_search agent tool
```

### Effort: ~200 lines extension + ~80 lines tool

---

## Feature 4: Memory Consolidation (Dedup + Semantic Recall)

**Priority:** P2 — Quality improvement  
**Goal:** Prevent memory bloat across goals. Semantic dedup on save. Hybrid recall scoring.  
**Depends on:** Feature 1 (MemoryScope), Feature 3 (Orama for keyword recall)  
**Docs:** [crdt-consolidation](crdt-consolidation/)  
**Status:** 📐 Architected

### What This Feature Delivers

```
BEFORE:
  remember("Use PostgreSQL") × 5 goals = 5 duplicate entries

AFTER:
  Cosine > 0.98 → skip (no LLM call, pure vector math)
  Cosine 0.85-0.98 → LLM decides: keep / update / delete / insert_new
  recall() → composite score: semantic × 0.5 + recency × 0.3 + importance × 0.2
```

### Scope

- **MemoryConsolidation** — on every `remember()`, check for similar existing records
- **Batch dedup** — `remember_many()` drops near-duplicates within same batch
- **Composite scoring** — `semantic_weight * similarity + recency_weight * decay + importance_weight * importance`
- **Async saves** — `remember()` queues save, returns immediately. `recall()` drains queue first.
- **Embeddings** — optional. Start without (pure BM25 recall). Add embeddings when needed.

### What It Does NOT Include

- Graph memory / entity linking (future)
- Temporal validity (Feature 6)

### Implementation Location

```
packages/collaboration/src/L2/
  memory/
    MemoryConsolidation.ts      — dedup/merge/supersede pipeline
    CompositeScorer.ts          — weighted scoring for recall
```

### Effort: ~150 lines consolidation + ~50 lines scoring

---

## Feature 5: Rooms, Auth, ACL (Multi-Tenant)

**Priority:** P2 — Required for cloud deployment  
**Goal:** JWT-based authentication. Per-room permissions. Multi-tenant isolation.  
**Depends on:** Feature 1 (rooms exist), I1 (collab-service)  
**Docs:** [crdt-auth](crdt-auth/)  
**Status:** 📐 Architected

### What This Feature Delivers

```
BEFORE:
  No auth on Hocuspocus. Any connection accesses any doc. Single-user.

AFTER:
  identifyUser({ userId, orgId }) → JWT
  identifyAgent({ agentId, role }) → agentToken
  Per-room: defaultAccesses, usersAccesses (Liveblocks pattern)
  agent:coder room → only coder writes, others read
  _system room → agents read, frontend denied
```

### Scope

- **JWT tokens** for humans, agent tokens for agents
- **Three-level permissions** — defaultAccesses → groupsAccesses → usersAccesses
- **Hocuspocus `onAuthenticate`** — verify token, check room ACL
- **Multi-tenant** — `{userId}/{teamId}` prefix isolates all data per user
- **System rooms** — `_system` hidden from frontend

### What It Does NOT Include

- Horizontal scaling (multiple Hocuspocus instances)
- Agent presence (cursors, status indicators)

### Implementation Location

```
packages/collab-service/src/
  auth/
    TokenService.ts             — JWT creation + verification
    RoomManager.ts              — room ACL resolution
  server/HocuspocusServer.ts    — onAuthenticate hook with ACL
```

### Effort: ~300 lines

---

## Feature 6: Symbol Index + Versioning

**Priority:** P3 — Navigation + History  
**Goal:** Entities become navigable. History shows what changed and when.  
**Depends on:** Feature 3 (Orama)  
**Docs:** [crdt-symbols-versioning](crdt-symbols-versioning/)  
**Status:** 📐 Architected

### What This Feature Delivers

```
Symbols:
  l2_navigate({ action: "definition", symbol: "task-003" })     → doc + block
  l2_navigate({ action: "references", symbol: "PostgreSQL" })   → all mentions

Versioning:
  l2_search({ action: "whatsnew", since: "2h" })                → changelog
  snapshots({ action: "list", doc: "plan" })                    → version list
  snapshots({ action: "restore", doc: "plan", version: 3 })    → rollback

Temporal validity (Graphiti pattern):
  Each memory record has validFrom/invalidAt
  "Used Express" (Jan-Mar) → "Use Fastify" (Mar-present)
  Agents can ask "what was true at step 5?"
```

### Scope

- **CRDT_SYMBOL_SPEC** — declarative grammar defining what counts as a symbol
- **Two-tier entity model** — Tier 1 (structural, navigable) + Tier 2 (searchable content)
- **jsondiffpatch** — human-readable diffs for versioning
- **Snapshot storage** — `Y.encodeStateAsUpdate()` at key moments
- **y-utility** — multi-doc undo manager
- **Temporal validity** — `validFrom`/`invalidAt` fields on memory records

### Implementation Location

```
packages/collab-service/src/
  extensions/
    SymbolIndexExtension.ts     — entity extraction + Orama schema
    VersioningExtension.ts      — snapshot creation + diff API
packages/collaboration/src/L2/
  tools/
    l2-navigate.ts              — definition/references tool
    l2-snapshots.ts             — version list/restore tool
```

### Effort: ~400 lines total

---

## Feature 7: Inter-Agent Collaboration

**Priority:** P3 — Independent track  
**Goal:** Structured @mention routing, decision tracking, discussion threads.  
**Depends on:** Feature 1 (rooms for discussion docs)  
**Docs:** [inter-agent-collaboration](inter-agent-collaboration/)  
**Status:** 📐 Architected

### Scope

- **@mention routing** — `@researcher` in discussion → notification to researcher agent
- **Decision tracking** — structured Y.Map for decisions with `agreedBy` arrays
- **Discussion redesign** — typed blocks (question, proposal, decision, observation)
- **Socket.IO delivery** — @mention → `discussion:mention` event to the right agent's worker

### Effort: ~300 lines

---

## Dependency Graph (Revised)

```
Feature 0 (DONE) ────────────────────────────────────────
  │
  ├── Feature 1: Scoped Memory ◄── P0 NEXT (independent)
  │     │
  │     └── Feature 2: Goal Lifecycle ◄── ships with F1
  │           │
  │           └── Feature 4: Consolidation ◄── P2
  │
  ├── Feature 3: Search (Orama) ◄── P1 (independent of F1/F2)
  │     │
  │     └── Feature 6: Symbols + Versioning ◄── P3
  │
  ├── Feature 5: Auth/ACL ◄── P2 (independent, needs F1 rooms)
  │
  └── Feature 7: Collaboration ◄── P3 (independent)
```

### Implementation Order

| Phase | Features | Can Parallelize |
|-------|----------|----------------|
| **Phase 1** | F1 (Scoped Memory) + F2 (Goal Lifecycle) | Together — same package |
| **Phase 2** | F3 (Search) | Independent — can start during Phase 1 |
| **Phase 3** | F4 (Consolidation) + F5 (Auth/ACL) | Independent of each other |
| **Phase 4** | F6 (Symbols + Versioning) + F7 (Collaboration) | Independent of each other |

## Research Packages Selected (from research.md)

| Package | Purpose | License | Size |
|---------|---------|---------|------|
| `@orama/orama` | Unified search index (BM25 + vector + filters) | Apache-2.0 | 10.3k stars |
| `micromatch` | Glob patterns for doc name filtering | MIT | — |
| `jsonpath-plus` | Structured queries on Y.Map JSON | MIT | — |
| `jsondiffpatch` | Human-readable diffs for versioning | MIT | — |
| `deep-object-diff` | Change detection for onChange hooks | MIT | — |
| `toposort` | DAG ordering for task dependencies | MIT | — |
| `y-utility` | Multi-doc undo manager | MIT | — |
| `@hocuspocus/transformer` | Content extraction from Y.Doc | MIT | — |
| `traverse` | AST walking for entity extraction | MIT | — |
