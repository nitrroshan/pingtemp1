# CRDT Team Memory — Architecture

**Date:** April 27, 2026  
**Status:** Research  
**Related:** `crdt-undo-rollback/`, `collaboration-toolkit/`, `inter-agent-collaboration/`

---

## Problem

Today's CRDT infrastructure is **goal-scoped and single-instance** — `CollaborationSpace` creates a `{teamId}/{goalId}/` prefix for every goal, and the Hocuspocus server runs in-process inside the backend. This creates five gaps:

1. **No persistent team memory** — knowledge dies with the goal. "We decided to use PostgreSQL" is lost when the next goal starts.
2. **No agent personal space** — every agent writes to the same shared docs. No scratchpads, no private context accumulation.
3. **No agent identity in CRDT** — agents are role strings, not registered users with cursors, presence, and access boundaries.
4. **No multi-tenancy** — in-process Hocuspocus means each backend instance has its own CRDT state. Multiple users each need their own backend. This doesn't scale.
5. **No hidden documents** — system config, prompts, and orchestration state are either not in CRDT or visible to the frontend.

---

## How the Industry Solves This

### Liveblocks — Room-Based CRDT-as-a-Service

Liveblocks is the most mature commercial solution for multi-tenant collaborative state:

- **Rooms, not databases.** Each collaborative artifact (document, whiteboard, form) is a "room" — a stateful WebSocket server on the edge. Rooms have their own Storage (CRDT), Presence (ephemeral), Threads (comments), and Feeds (message lists).
- **Organizations for multi-tenancy.** Each `organizationId` compartmentalizes all rooms, notifications, and data. Users authenticate with an `organizationId` and can only access that org's rooms.
- **ID tokens (JWT) for auth.** Server creates a JWT via `liveblocks.identifyUser({ userId, organizationId })`. The token encodes identity. Liveblocks checks permissions when the user enters a room.
- **Three-level permissions.** `defaultAccesses` (room-wide), `groupsAccesses` (by group ID), `usersAccesses` (by user ID). Each level overrides the one above. Permissions: `room:write`, `room:read`, `room:presence:write`.
- **AI agents are first-class users.** Agents get their own `userId`, can set presence (`liveblocks.setPresence` with TTL), appear in avatar stacks alongside humans, and read/write Storage and Feeds via the Node.js SDK.
- **Feeds for AI collaboration.** Real-time message lists within rooms. Any backend (LangChain, CrewAI, n8n, custom) can create feed messages, and the frontend renders them live.

**Key takeaway:** Agents are just users with a special `userId`. The permission model doesn't distinguish humans from AI — it only cares about `userId`, `groupIds`, and room membership.

### Y-Sweet — CRDT Document Store Backed by Object Storage

Y-Sweet (by Jamsocket) is an open-source Y.js document store written in Rust:

- **Session backend model.** Each document gets its own lightweight server process. Processes spin up on-demand, persist to S3, and shut down when idle. Horizontal scaling comes from routing connections to the right session.
- **Client tokens for access control.** Server SDK creates tokens: `manager.getOrCreateDocAndToken(docId)`. The token grants access to a specific document. Read-only tokens are supported.
- **S3-compatible persistence.** CRDT binary state is stored as objects in S3 (or compatible). No database needed — just object storage.

**Key takeaway:** Document-level access tokens + S3 persistence. The "session backend" pattern (spin up a process per document, hibernate when idle) enables scale without a monolithic server.

### CrewAI Memory — Hierarchical Scopes + Semantic Recall

CrewAI's unified `Memory` class is the best model for how agents should interact with memory:

- **Hierarchical scopes.** Memories organized in a tree: `/project/alpha/decisions`, `/agent/researcher/findings`, `/company/engineering`. Agents get scoped views — a `MemoryScope` restricts all operations to a branch.
- **LLM-inferred placement.** When you call `memory.remember(content)` without specifying a scope, the LLM analyzes content and places it in the right scope. The tree grows organically.
- **Memory slices.** A `MemorySlice` spans multiple disjoint scopes — e.g., an agent reads from both `/agent/researcher` and `/company/knowledge`. Read-only slices prevent writing to shared areas.
- **Composite scoring.** Recall ranks by `semantic_weight * similarity + recency_weight * decay + importance_weight * importance`. Configurable per use case.
- **Source and privacy.** Each memory has a `source` tag and optional `private` flag. Private memories are only visible when the source matches.
- **Memory consolidation.** On save, checks for similar existing records. LLM decides: keep, update, delete, or insert. Prevents unbounded growth.
- **Per-agent scoped views with shared crew memory.** Agents use `memory.scope("/agent/researcher")` for private space, while the crew-level memory at `/` is shared.

**Key takeaway:** Hierarchical scopes + slices is the right abstraction for team memory. Agents need both private branches and read access to shared knowledge. LLM-powered consolidation prevents memory bloat.

### PartyKit — Stateful Edge Rooms

- **Each "party" is a stateful server.** A party has storage (KV or Durable Object), WebSocket connections, and custom server-side logic. Multiple parties per project for different concerns.
- **Y-PartyKit provides Y.js integration.** Hocuspocus-like Y.js sync as a first-class party type.
- **Auth via `onConnect` hook.** Custom authentication logic on connection.

**Key takeaway:** The "party per concern" pattern (one stateful server for team memory, another for goal work, another for agent state) maps cleanly to our room types.

---

## What Exists Today

| Concept | Status | Implementation |
|---------|--------|---------------|
| Team CRDT space | ✅ Per-goal | `CollaborationSpace` scoped to `{teamId}/{goalId}/` |
| Agent writes to shared docs | ✅ | `collab` tool: `write`, `write-block`, `discuss` |
| Hocuspocus server | ✅ In-process | `HocuspocusServer.ts` — runs inside backend process |
| Agent identity in CRDT | ❌ | Agents are `agentRole` strings, not registered users |
| Agent personal space | ❌ | All docs are team-visible |
| Team-level memory (cross-goal) | ❌ | Everything under `{goalId}/` — nothing persists |
| Hidden/system docs | ❌ | All CRDT docs visible to frontend |
| Multi-tenancy | ❌ | In-process Hocuspocus = one instance per backend |
| Memory consolidation | ❌ | No dedup, no summarization, no garbage collection |
| Presence/awareness | ❌ | `getPresence()` stub returns `[]` |

---

## Architecture: CRDT Memory Service

Based on industry patterns, the architecture has three layers:

```
┌─────────────────────────────────────────────────────────────────┐
│                     CRDT Memory Service                         │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Room Manager (Liveblocks pattern)                        │   │
│  │  - createRoom(roomId, { defaultAccesses, usersAccesses }) │   │
│  │  - Rooms: team-memory, agent:{role}, goal:{goalId}        │   │
│  │  - System rooms: _system:{teamId} (agents-only)           │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Identity & Auth (Liveblocks + Y-Sweet pattern)           │   │
│  │  - identifyUser({ userId, organizationId }) → JWT         │   │
│  │  - identifyAgent({ agentId, teamId, role }) → agentToken  │   │
│  │  - Permissions: room:write, room:read, room:admin         │   │
│  │  - Per-room: defaultAccesses, groupsAccesses, usersAccesses│  │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Memory Layer (CrewAI pattern)                            │   │
│  │  - Hierarchical scopes within rooms                       │   │
│  │  - remember(content, scope?) → LLM-inferred placement     │   │
│  │  - recall(query, scope?) → composite scored results       │   │
│  │  - Consolidation on save (dedup, merge, supersede)        │   │
│  │  - Source tracking + private flag                          │   │
│  └──────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │  Hocuspocus Server (existing, extracted)                  │   │
│  │  - onAuthenticate: validate JWT / agentToken              │   │
│  │  - onLoadDocument: enforce room ACL per doc path          │   │
│  │  - Storage: MongoDB (production) / LevelDB (dev)          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
         ▲              ▲              ▲
         │ WS           │ WS           │ HTTP+WS
    Backend-1       Backend-2      Frontend
    (User A)        (User B)       (any user)
```

### Core Concepts (Industry → Ping Mapping)

| Industry Concept | Ping Equivalent | Source |
|-----------------|-----------------|--------|
| **Room** | A collaborative space (team memory, agent personal, goal work) | Liveblocks |
| **Organization** | `{userId}/{teamId}` — tenant isolation | Liveblocks |
| **User** | Human user OR agent (both are first-class) | Liveblocks |
| **ID Token / Client Token** | JWT for humans, agentToken for agents | Liveblocks + Y-Sweet |
| **Room permissions** | Per-room ACL: `defaultAccesses`, `usersAccesses` | Liveblocks |
| **Hierarchical scopes** | Tree of memory within a room: `/decisions`, `/conventions` | CrewAI |
| **Memory scope** | Agent's restricted subtree view within its personal room | CrewAI |
| **Memory slice** | Agent reads from personal room + team memory room (multi-scope) | CrewAI |
| **Composite scoring** | Semantic + recency + importance for recall ranking | CrewAI |
| **Session backend** | Hocuspocus process per active room (future scaling) | Y-Sweet |

### Room Types

```
{orgId}/team-memory                      — Team-level persistent memory
  └─ Y.Map("decisions")                    Decision log (cross-goal)
  └─ Y.Map("conventions")                  Team coding conventions
  └─ Y.Map("knowledge")                    Accumulated domain knowledge
  └─ Y.Map("lessons-learned")              Past mistakes, what worked

{orgId}/agent:{role}                     — Agent personal room
  └─ Y.Map("scratchpad")                   Working notes, drafts
  └─ Y.Map("context")                      Accumulated task context
  └─ Y.Map("preferences")                  Learned preferences
  └─ Y.Map("task-history")                 Completed task summaries

{orgId}/goal:{goalId}                    — Goal-scoped work (existing)
  └─ (existing: plan, tasks, discussion, doc-{name})

{orgId}/_system                          — System config (agents-only)
  └─ Y.Map("prompts")                      System prompt templates
  └─ Y.Map("model-config")                 Model settings
  └─ Y.Map("guard-rails")                  Operational limits
  └─ Y.Map("skill-assignments")            Role → skill mappings
```

Where `orgId = {userId}/{teamId}` — fully isolates each user's team.

### Permission Model

Following Liveblocks' three-level pattern:

| Room | defaultAccesses | Agent (self) | Agent (other) | Human (frontend) |
|------|----------------|-------------|---------------|-----------------|
| `team-memory` | `room:read` | `room:write` | `room:write` | `room:read` |
| `agent:{role}` | `[]` (private) | `room:write` | `room:read` | `room:read` |
| `goal:{goalId}` | `room:write` | `room:write` | `room:write` | `room:write` |
| `_system` | `[]` (private) | `room:read` | `room:read` | `[]` (denied) |

Enforced in Hocuspocus hooks:

```typescript
// Hocuspocus onAuthenticate hook
onAuthenticate: async ({ token, documentName }) => {
  const identity = verifyToken(token); // JWT or agentToken
  // identity: { type: "user"|"agent", id, orgId, role?, groups? }
  
  const roomId = extractRoomId(documentName);
  const room = await roomManager.getRoom(roomId);
  
  // Liveblocks-style resolution:
  // usersAccesses[identity.id] ?? groupsAccesses[identity.group] ?? defaultAccesses
  const access = resolveAccess(room, identity);
  
  if (access === "deny") throw new Error("Access denied");
  return { readOnly: access === "room:read" };
}
```

### Agent Identity & Registration

Agents register as first-class users (Liveblocks pattern):

```typescript
// On worker creation in WorkerPool:
const agentToken = await crdtMemoryService.identifyAgent({
  agentId: `${teamId}:${role}`,
  organizationId: `${userId}/${teamId}`,
  role: role,
  groups: ["team-agents"],
  capabilities: ["typescript", "api-design"],
  userInfo: {
    name: `Agent: ${role}`,
    avatar: `/avatars/agent-${role}.png`,
    color: roleColors[role],
  },
});

// Agent uses this token for all CRDT operations
const memoryClient = new CrdtMemoryClient(agentToken);
```

### Memory API (CrewAI-Inspired)

Within rooms, memory uses hierarchical scopes with semantic recall:

```typescript
// Agent's team_memory tool — scoped to team-memory room
const teamMemory = new MemoryScope(memoryClient, "team-memory");

// Remember — LLM infers scope placement
await teamMemory.remember("We decided to use PostgreSQL for the user database.");
// → LLM places under /decisions with categories: ["database", "architecture"]

// Remember with explicit scope
await teamMemory.remember("API endpoints use /v2 prefix", { scope: "/conventions/api" });

// Recall — composite scored (semantic + recency + importance)
const matches = await teamMemory.recall("What database did we choose?", { limit: 5 });
// Returns: [{ content, score, scope, categories, source, createdAt }]

// Agent personal memory — scoped to agent:{role} room
const personal = new MemoryScope(memoryClient, `agent:${role}`);
await personal.remember("Found edge case in auth — PKCE tokens expire too fast");

// Memory slice — read from personal + team knowledge (CrewAI pattern)
const agentView = MemorySlice.create({
  scopes: [
    { room: `agent:${role}`, access: "write" },
    { room: "team-memory", access: "read", path: "/knowledge" },
    { room: "team-memory", access: "write", path: "/decisions" },
  ],
});
```

---

## Deep Dive: MemoryScope & MemoryConsolidation

### What Problem Do They Solve?

Today, agents write to CRDT docs (`collab write`, `collab write-block`) but there's **no semantic understanding of what was written**. If an agent writes "Use PostgreSQL" to a shared doc, and later another agent writes "We chose Postgres for the DB" — you now have two entries saying the same thing. After 50 goals, team memory is full of duplicates, stale facts, and noise. There's no way to search by meaning ("what database did we pick?"), no ranking of what's important vs trivial, and no cleanup.

**MemoryScope** is the read/write interface — how agents store and retrieve memories.  
**MemoryConsolidation** is the garbage collector — how the system prevents memory from growing into garbage.

They work together: every `remember()` call goes through consolidation before persisting, and every `recall()` call uses composite scoring to rank results.

---

### MemoryScope — What It Is

A `MemoryScope` is a **scoped read/write view over a CRDT room's memory**. It's the agent-facing API. An agent never writes raw Y.Map entries — it calls `remember()` and `recall()`, and MemoryScope handles embedding, scoring, scope placement, and consolidation behind the scenes.

Think of it like this:

```
Without MemoryScope (today):
  Agent calls: collab({ action: "write", docName: "decisions", key: "db", value: "PostgreSQL" })
  → Raw key-value write to Y.Map
  → No search, no scoring, no dedup
  → Reading requires knowing the exact key

With MemoryScope:
  Agent calls: team_memory({ action: "remember", content: "We decided to use PostgreSQL" })
  → Content gets embedded (vector)
  → LLM analyzes: scope=/decisions/database, importance=0.8, categories=[database, architecture]
  → Consolidation checks: is this a duplicate? does it update existing knowledge?
  → Stored with metadata for semantic retrieval

  Agent calls: team_memory({ action: "recall", query: "what database?" })
  → Query gets embedded
  → Vector similarity search across all memories in scope
  → Results scored: 60% semantic match + 30% recency + 10% importance
  → Returns ranked list: [{content: "We decided to use PostgreSQL", score: 0.92, ...}]
```

#### How It Works Internally

```typescript
class MemoryScope {
  private roomId: string;        // Which CRDT room (e.g., "team-memory", "agent:backend-dev")
  private scopePath: string;     // Subtree filter (e.g., "/decisions", "/" for all)
  private storage: MemoryStorage; // Reads/writes MemoryRecords (Y.Map backed)
  private embedder: Embedder;     // text → float[1536] vector
  private scorer: CompositeScorer;
  private consolidation: MemoryConsolidation;

  /**
   * Store a memory. The pipeline:
   * 1. Embed the content → vector
   * 2. Run consolidation (dedup/merge check against existing memories)
   * 3. If not duplicate: LLM analyzes content → infer scope, categories, importance
   * 4. Persist as a MemoryRecord in the CRDT Y.Map
   */
  async remember(content: string, opts?: {
    scope?: string;        // Explicit scope (skip LLM inference)
    source?: string;       // Who wrote it: "agent:backend-dev", "user", "planner"
    categories?: string[]; // Explicit categories (skip LLM inference)
    importance?: number;   // 0-1, explicit (skip LLM inference)
  }): Promise<MemoryRecord | null> {
    // Returns null if consolidation determined it's a duplicate
  }

  /**
   * Search memories by meaning. The pipeline:
   * 1. Embed the query → vector
   * 2. Find top-K similar records by cosine similarity (within this scope)
   * 3. Score each: composite = semantic*0.6 + recency*0.3 + importance*0.1
   * 4. Return sorted by composite score
   */
  async recall(query: string, opts?: {
    limit?: number;        // Max results (default 5)
    scope?: string;        // Narrow search to sub-scope
    minScore?: number;     // Filter out low-confidence results
    source?: string;       // Only from specific source
  }): Promise<MemoryMatch[]> {
    // Returns ranked list of matches with scores
  }

  /**
   * Browse the scope tree — see what categories of knowledge exist.
   */
  async tree(maxDepth?: number): Promise<ScopeTree> {
    // Returns: { "/decisions": 12 records, "/conventions": 8 records, ... }
  }

  /**
   * Create a narrower sub-scope (CrewAI pattern).
   * Agent can only see/write within this subtree.
   */
  subscope(path: string): MemoryScope {
    // Returns a new MemoryScope restricted to scopePath + "/" + path
  }
}
```

#### The MemoryRecord — What Gets Stored

Each memory is a record in a Y.Map:

```typescript
interface MemoryRecord {
  id: string;              // UUID
  content: string;         // The actual text: "We decided to use PostgreSQL"
  embedding: number[];     // Float vector [1536] for semantic search
  scope: string;           // "/decisions/database"
  categories: string[];    // ["database", "architecture"]
  importance: number;      // 0-1 (0.8 = important decision, 0.2 = trivial note)
  source: string;          // "agent:backend-dev" or "planner" or "user"
  createdAt: string;       // ISO timestamp
  updatedAt: string;       // Updated when consolidation merges
  goalId?: string;         // Which goal produced this (for provenance)
}

interface MemoryMatch {
  record: MemoryRecord;
  score: number;           // Composite score 0-1
  matchReasons: string[];  // ["semantic", "recency"] — why this ranked high
}
```

#### CompositeScorer — How Ranking Works

When you `recall("what database?")`, results are ranked by three signals combined:

```
composite = semantic_weight × similarity + recency_weight × decay + importance_weight × importance
```

| Signal | Weight (default) | What it measures | Formula |
|--------|-----------------|------------------|---------|
| **Semantic** | 0.6 | How close the meaning is | `1 / (1 + cosine_distance)` → 0 to 1 |
| **Recency** | 0.3 | How recent the memory is | `0.5^(age_days / half_life_days)` — exponential decay |
| **Importance** | 0.1 | How important the memory was marked | The `importance` field from the record (0-1) |

**Example:**

```
Query: "what database did we choose?"

Record A: "We decided to use PostgreSQL" (2 days old, importance: 0.8)
  semantic: 0.95 (very close match)
  recency:  0.96 (2 days / 30 day half-life → barely decayed)
  importance: 0.8
  composite = 0.6×0.95 + 0.3×0.96 + 0.1×0.8 = 0.57 + 0.29 + 0.08 = 0.94

Record B: "Database schema has 12 tables" (10 days old, importance: 0.4)
  semantic: 0.60 (mentions database but different topic)
  recency:  0.79 (10 days / 30 day half-life)
  importance: 0.4
  composite = 0.6×0.60 + 0.3×0.79 + 0.1×0.4 = 0.36 + 0.24 + 0.04 = 0.64

Result: Record A (0.94) ranked above Record B (0.64) ✓
```

The weights are configurable per use case:
- **Sprint retrospective**: high recency weight (0.5), short half-life (7 days) — favor recent memories
- **Architecture knowledge base**: high importance weight (0.4), long half-life (180 days) — favor important enduring decisions

---

### MemoryConsolidation — What It Is

MemoryConsolidation is the **garbage collector for semantic memory**. Without it, calling `remember()` 1000 times produces 1000 records — many duplicates, many superseded, many contradictory. After a few goals, team memory becomes a junk pile.

Consolidation runs **on every `remember()` call** (before persisting) and answers one question: **"Does this new content duplicate, update, or contradict something we already know?"**

#### The Problem It Solves

```
Goal 1: Agent writes "We're using Express for the API server"
Goal 2: Agent writes "The API server uses Express.js"
Goal 3: Agent writes "Migrated API from Express to Fastify"
Goal 4: Agent writes "API server runs on Fastify"

Without consolidation → 4 records. Records 1 and 2 say the same thing.
  Record 3 contradicts records 1 and 2. Record 4 duplicates record 3.
  An agent recalling "what API framework?" gets all 4 — confusing.

With consolidation → 1 record: "API server runs on Fastify"
  Records 1+2 merged (duplicate).
  Record 3 superseded records 1+2 (contradiction → keep newer).
  Record 4 merged with record 3 (duplicate of current truth).
```

#### How It Works

When `remember(content)` is called, before inserting:

```
Step 1: EMBED — Convert content to vector

Step 2: FIND SIMILAR — Search existing records with cosine similarity > 0.85
  If none found → skip to Step 4 (new knowledge, just insert)

Step 3: LLM CONSOLIDATION — Ask LLM to compare new content vs similar records
  Prompt: "Given new content X and existing records [A, B, C],
           decide for each: keep, update, delete, or insert_new"
  
  LLM returns one of:
  ┌─────────────┬──────────────────────────────────────────────────┐
  │ "keep"      │ New content is a duplicate. Don't insert.        │
  │             │ Example: "Use PostgreSQL" when "We chose          │
  │             │ PostgreSQL for the DB" already exists.            │
  ├─────────────┼──────────────────────────────────────────────────┤
  │ "update"    │ New content refines/updates an existing record.  │
  │             │ LLM provides merged text.                         │
  │             │ Example: "PostgreSQL 16 on RDS" updates           │
  │             │ "We chose PostgreSQL" → "PostgreSQL 16 on RDS"    │
  ├─────────────┼──────────────────────────────────────────────────┤
  │ "delete"    │ New content supersedes/contradicts old record.   │
  │             │ Delete old, insert new.                           │
  │             │ Example: "Migrated to Fastify" supersedes         │
  │             │ "API uses Express"                                │
  ├─────────────┼──────────────────────────────────────────────────┤
  │ "insert_new"│ Content is related but distinct. Keep both.      │
  │             │ Example: "PostgreSQL for users DB" doesn't        │
  │             │ conflict with "Redis for session cache"           │
  └─────────────┴──────────────────────────────────────────────────┘

Step 4: ANALYZE — If inserting (new or after delete), LLM infers metadata
  → scope: "/decisions/database"
  → categories: ["database", "infrastructure"]
  → importance: 0.8

Step 5: PERSIST — Write MemoryRecord to CRDT Y.Map
```

#### The Consolidation Pipeline in Code

```typescript
class MemoryConsolidation {
  private embedder: Embedder;
  private storage: MemoryStorage;
  private llm: LLMProvider;

  // Thresholds
  private batchDedupThreshold = 0.98;     // Near-exact duplicate (no LLM needed)
  private consolidationThreshold = 0.85;  // Similar enough to check with LLM
  private consolidationLimit = 5;         // Max records to compare against

  /**
   * Run consolidation pipeline for a new piece of content.
   * Returns: { action, record? } — what to do with the new content.
   */
  async consolidate(
    content: string,
    embedding: number[],
  ): Promise<ConsolidationResult> {

    // 1. Fast dedup — cosine > 0.98 means near-identical text, skip without LLM
    const nearExact = await this.storage.findSimilar(embedding, {
      threshold: this.batchDedupThreshold,
      limit: 1,
    });
    if (nearExact.length > 0) {
      return { action: "keep" }; // Exact duplicate, don't insert
    }

    // 2. Find semantically similar records (0.85-0.98 range)
    const similar = await this.storage.findSimilar(embedding, {
      threshold: this.consolidationThreshold,
      limit: this.consolidationLimit,
    });
    if (similar.length === 0) {
      return { action: "insert_new" }; // No similar records, just insert
    }

    // 3. Ask LLM to decide — only runs when there ARE similar records
    const decision = await this.llm.generate({
      prompt: this.buildConsolidationPrompt(content, similar),
      schema: ConsolidationDecisionSchema, // structured output
    });

    return decision;
    // → { action: "keep" }
    // → { action: "update", targetId: "record-xyz", mergedContent: "..." }
    // → { action: "delete", targetId: "record-xyz" }
    // → { action: "insert_new" }
  }
}

type ConsolidationResult =
  | { action: "keep" }                                           // duplicate, skip
  | { action: "update"; targetId: string; mergedContent: string } // merge into existing
  | { action: "delete"; targetId: string }                       // supersede old, insert new
  | { action: "insert_new" };                                    // related but distinct
```

#### Cost & Performance

| Step | Cost | When it runs |
|------|------|-------------|
| Embedding | ~$0.0001 per call (OpenAI text-embedding-3-small) | Every `remember()` and `recall()` |
| Fast dedup (cosine > 0.98) | Zero — pure vector math | Every `remember()` |
| Find similar (cosine > 0.85) | Zero — vector search in storage | Every `remember()` |
| LLM consolidation | ~$0.001 per call (gpt-4o-mini) | Only when similar records found (~30% of calls) |
| LLM analysis (scope inference) | ~$0.001 per call | Only when scope not explicitly provided |

**Optimization: async saves.** Following CrewAI's pattern, `remember()` returns immediately and consolidation runs in the background. `recall()` drains pending writes first (read barrier) so queries always see latest state.

```typescript
// remember() is non-blocking — returns immediately
await teamMemory.remember("Use PostgreSQL"); // → queued, returns fast

// recall() waits for pending saves before searching
const results = await teamMemory.recall("database?"); // → drains queue, then searches
```

#### When Consolidation Does NOT Run

- **`recall()`** — read-only, no consolidation
- **`personal_notes` with explicit keys** — simple key-value writes skip the pipeline (agent writes `scratchpad.api-notes = "..."`, no semantic analysis needed)
- **Goal-scoped `collab` tool** — existing writes to task/plan/discussion docs are unchanged. Consolidation only applies to the memory layer (`team_memory` and `personal_notes` with `recall`)

---

### How They Fit Into Existing Code

These components live in `packages/collaboration/src/L2/memory/` (new folder, ~500 lines total):

```
packages/collaboration/src/L2/
  memory/                          ← NEW (~500 lines)
    MemoryScope.ts                 — remember(), recall(), tree(), subscope()
    MemoryConsolidation.ts         — consolidate(), buildConsolidationPrompt()
    CompositeScorer.ts             — score(query_embedding, records) → ranked
    MemoryStorage.ts               — CRDT-backed storage: findSimilar(), insert(), update()
    types.ts                       — MemoryRecord, MemoryMatch, ConsolidationResult
  collaboration/                   ← EXISTING (unchanged)
    CollabDocument.ts
    CollaborationSpace.ts
    HocuspocusServer.ts
    ...
  tools/
    index.ts                       ← EXISTING collab tool (unchanged)
    team-memory.ts                 ← NEW (~150 lines, uses MemoryScope)
    personal-notes.ts              ← NEW (~100 lines, uses MemoryScope for recall)
```

`MemoryStorage` wraps a CRDT Y.Map as the persistence layer — each MemoryRecord is a Y.Map entry. The embedding vector is stored alongside the content. `findSimilar()` iterates all records and computes cosine similarity (good enough for <10,000 records per team; can add a vector index later).

### Deployment Modes

```
CRDT_MODE=embedded (dev, single user)
────────────────────────────────────────
  Backend Process
  ├─ AgentManager, WorkerPool
  └─ CrdtMemoryService (in-process)
     └─ Hocuspocus (in-process, LevelDB)
  
  → Same as today. No auth, no ACL. Zero config.


CRDT_MODE=service (production, multi-user)
────────────────────────────────────────
  CRDT Memory Service (separate container)
  ├─ Room Manager + Identity + ACL
  ├─ Memory Layer (scopes, consolidation)
  └─ Hocuspocus (MongoDB persistence)

  Backend-1 ──WS──→ Service
  Backend-2 ──WS──→ Service
  Frontend  ──WS──→ Service (user JWT)
  
  → Shared state. JWT + ACL. Horizontal scaling.
```

Abstracted by a common interface:

```typescript
interface ICrdtMemoryProvider {
  identifyAgent(opts: AgentIdentity): Promise<AgentToken>;
  identifyUser(opts: UserIdentity): Promise<UserToken>;
  openDoc(roomId: string, docPath: string): Promise<Y.Doc>;
  createRoom(roomId: string, opts: RoomOptions): Promise<Room>;
  setPresence(roomId: string, presence: AgentPresence): Promise<void>;
}

class EmbeddedCrdtProvider implements ICrdtMemoryProvider { ... } // dev
class RemoteCrdtProvider implements ICrdtMemoryProvider { ... }   // production

const provider = process.env.CRDT_MODE === "service"
  ? new RemoteCrdtProvider(process.env.CRDT_SERVICE_URL)
  : new EmbeddedCrdtProvider();
```

---

## Architecture Options Summary

### Option A: Convention-Only (Extend CollaborationSpace)

- Naming conventions (`@{role}/`, `_system/`) for pseudo-access control
- No new packages, no auth, no service
- **Fails at:** multi-tenancy, access enforcement, memory consolidation
- **Verdict:** Dev-only stopgap

### Option B: CRDT Memory Service (Recommended)

- Standalone service: rooms + JWT auth + ACL + semantic memory layer
- Liveblocks-style rooms/permissions, CrewAI-style scopes/recall, Y-Sweet-style tokens
- Embedded mode for dev, remote mode for production
- **Wins at:** multi-tenancy, real ACL, agent identity, memory consolidation, horizontal scaling
- **Cost:** New package, deployment artifact, embedding infrastructure

### Option C: In-Process Hybrid

- `TeamMemory` class with Hocuspocus hooks for filtering
- No separate service, convention + hook enforcement
- **Fails at:** multi-tenancy (in-process Hocuspocus per backend = N isolated servers)
- **Verdict:** Single-user only

---

## Recommendation: **Option B (CRDT Memory Service)**

1. **Multi-user is the deployment model.** In-process solutions mean N users = N isolated CRDT servers. Option B puts all state in one shared service.

2. **Industry-proven patterns.** Liveblocks validated rooms + org + JWT + ACL at scale. CrewAI validated hierarchical scopes + composite scoring for agent memory. Y-Sweet validated token-based document access with object storage. Option B combines all three.

3. **Agents as first-class users.** Liveblocks treats AI agents as users with presence, identity, and permissions. We should too.

4. **Memory consolidation is critical.** Without LLM-powered dedup/merge on save, team memory grows unbounded. CrewAI's pattern solves this.

5. **Embedded mode preserves DX.** `CRDT_MODE=embedded` means zero config locally. Same API, in-process Hocuspocus.

---

## Implementation Phases

### Phase 1: Rooms + Auth + ACL

- `packages/crdt-memory/` — new package
- `RoomManager` — create/list rooms with permissions
- `IdentityService` — JWT for humans, agentToken for agents
- `AccessControl` — resolve per-room access from token + room config
- `CrdtMemoryClient` with `EmbeddedProvider` + `RemoteProvider`
- `WorkerPool` integration — register agents, inject memory tools
- Agent tools: `team_memory`, `personal_notes`

### Phase 2: Semantic Memory Layer

- `MemoryScope` — hierarchical scopes, `remember()` / `recall()`
- `MemoryConsolidation` — dedup + merge on save
- `CompositeScorer` — semantic + recency + importance
- LLM-inferred scope placement
- `MemorySlice` — multi-room read views

### Phase 3: Frontend Integration

- Memory panel — browse team memory, search by scope
- Agent presence — cursors/avatars in shared docs
- System docs hidden from frontend (enforced by room ACL)

---

## Package Structure

```
packages/crdt-memory/
  src/
    server/
      CrdtMemoryService.ts         — Service entry point (HTTP + WS)
      RoomManager.ts                — Room CRUD + permission management
      IdentityService.ts            — JWT/agentToken issuance + verification
      AccessControl.ts              — resolveAccess(room, identity)
      HocuspocusConfig.ts           — Hocuspocus with auth/ACL hooks
    memory/
      MemoryScope.ts                — Scoped remember/recall within a room
      MemorySlice.ts                — Multi-room read view
      MemoryConsolidation.ts        — Dedup, merge, supersede on save
      CompositeScorer.ts            — Semantic + recency + importance ranking
    client/
      CrdtMemoryClient.ts           — Client API (used by backend tools)
      EmbeddedProvider.ts            — In-process mode (dev)
      RemoteProvider.ts              — WebSocket mode (production)
    types/
      index.ts                       — Room, Token, MemoryRecord, Score, etc.
  Dockerfile
  package.json
  tsconfig.json
```

---

## Agent Tool API

### `team_memory`

```typescript
tool({
  name: "team_memory",
  description: "Read/write persistent team memory that survives across goals. " +
    "Use for decisions, conventions, domain knowledge, and lessons learned.",
  inputSchema: z.object({
    action: z.enum([
      "remember",         // Store a fact/decision/convention
      "recall",           // Semantic search team memory
      "list_decisions",   // Browse decisions scope
      "list_conventions", // Browse conventions scope
      "tree",             // Show memory scope tree
    ]),
    content: z.string().optional(),
    query: z.string().optional(),
    scope: z.string().optional(),
    limit: z.number().default(5).optional(),
  }),
});
```

### `personal_notes`

```typescript
tool({
  name: "personal_notes",
  description: "Your private scratchpad. Store working notes, context, and " +
    "findings. Other agents can read but not write your notes.",
  inputSchema: z.object({
    action: z.enum(["write", "read", "append", "list", "recall"]),
    key: z.string().optional(),
    value: z.any().optional(),
    query: z.string().optional(),
  }),
});
```

---

## CRDT as Seamless Filestore: Search, Grep, and Beyond

### The Vision

Today, agents have two separate worlds:
- **L1 (Workspace files):** Full tooling — `workspace_read_file`, `workspace_grep`, `keyword_search` via MiniSearch, file watchers, git integration. Search is seamless because the filesystem is the native storage and tools like MiniSearch/ripgrep work directly on it.
- **L2 (CRDT docs):** Limited — `collab discover/list/read/write`. No keyword search, no grep, no structured queries. To search CRDT, you either iterate all docs manually or project to filesystem first (the `projectToFilesystem` hack in `HocuspocusServer.ts`).

The goal: **make CRDT team memory feel as seamless as a filesystem** — agents should `search`, `grep`, `query`, `ls`, `cat`, `whatsnew` across CRDT docs the same way they do with workspace files, without filesystem projection as a middleman.

### What Already Exists (L2 Search Feature)

The [L2 Search & Indexing](docs/features/l2-search-indexing/feature_architecture.md) feature already designed this:

| Capability | Tool | How |
|-----------|------|-----|
| **Keyword search** | `l2_search(query)` | MiniSearch BM25 over all CRDT docs, auto-indexed via Hocuspocus `onChange` |
| **JSONPath query** | `l2_query(jsonpath)` | `jsonpath-plus` on `doc.toJSON()` — query structured CRDT data (tasks, plans) |
| **Regex grep** | `l2_grep(pattern)` | In-memory regex over indexed content |
| **List docs** | `/ls` | In-memory doc registry |
| **Read doc** | `/cat/:docName` | `doc.toJSON()` |
| **Doc metadata** | `/stat/:docName` | Creation time, last modified, size |
| **Changelog** | `l2_whatsnew(since)` | Timestamp-based diff on CRDT version history |

This was planned as a **Hocuspocus Search Extension** — a plugin that hooks `onChange`, maintains a MiniSearch index in-memory, and exposes HTTP endpoints. Same pattern as L1's `WorkspaceSearchIndex.ts`.

### Why Projection Is the Wrong Answer

The current `projectToFilesystem()` function in `HocuspocusServer.ts` converts CRDT docs to JSON/markdown files in `.ping/collaboration/`. This is a hack:

1. **Lossy** — Y.XmlFragment → markdown loses block IDs, attributes, formatting metadata
2. **Stale** — projection runs on `onStoreDocument` with debounce. Between writes, files are out of date
3. **Duplicate storage** — same data stored twice (CRDT binary + projected files)
4. **No real-time** — agents searching projected files see yesterday's state, not what was written 5 seconds ago
5. **Doesn't scale** — projecting thousands of docs to filesystem is I/O heavy

### The Right Answer: Search Engine Over CRDT, Not Files

**Orama** solves this. It's a 2KB embedded search engine that supports full-text + vector + hybrid search in JavaScript, with no external dependencies. It's what MiniSearch is for L1, but with vectors built-in:

```typescript
import { create, insert, search } from '@orama/orama';

const db = create({
  schema: {
    docName: 'string',        // CRDT doc path
    content: 'string',        // Extracted text from Y.Doc
    scope: 'string',          // Memory scope: /decisions, /conventions
    source: 'string',         // Who wrote it: agent:backend-dev
    createdAt: 'number',      // Timestamp for recency
    embedding: 'vector[1536]', // For semantic search
  },
});

// On CRDT onChange → re-index
insert(db, {
  docName: "team-memory/decisions",
  content: "We decided to use PostgreSQL for the user database",
  scope: "/decisions/database",
  source: "agent:backend-dev",
  createdAt: Date.now(),
  embedding: [0.234, 0.891, ...],
});

// Agent searches — fulltext, vector, or hybrid
const results = search(db, { term: "what database", mode: "hybrid" });
```

**Orama replaces both MiniSearch AND the vector index** for team memory. One package handles:
- BM25 keyword search (like MiniSearch for L1)
- Vector search (embeddings for semantic recall)
- Hybrid search (combine both)
- Faceted search (filter by scope, source, room)
- 2-10ms latency, in-memory

### How It Unifies: One Search Engine for All CRDT

Instead of separate search for L2 goal docs vs team memory vs personal notes, **one Orama instance indexes everything**:

```
┌────────────────────────────────────────────────┐
│              Orama Search Index                 │
│                                                 │
│  Sources (auto-indexed via onChange):            │
│  ├─ team-memory/decisions/*                     │
│  ├─ team-memory/conventions/*                   │
│  ├─ team-memory/knowledge/*                     │
│  ├─ agent:backend-dev/scratchpad                │
│  ├─ agent:frontend-dev/context                  │
│  ├─ goal:build-api/plan                         │
│  ├─ goal:build-api/task-001/task                │
│  ├─ goal:build-api/doc-api-spec                 │
│  └─ (every CRDT doc that gets written)          │
│                                                 │
│  Search modes:                                  │
│  ├─ fulltext: "PostgreSQL" → BM25 ranked        │
│  ├─ vector:  embed("database choice") → cosine  │
│  ├─ hybrid:  both combined                      │
│  └─ filter:  { scope: "/decisions/*" }          │
└────────────────────────────────────────────────┘
```

Agent tools get a unified search interface:

```typescript
// Keyword search across all CRDT — like grep but semantic
team_memory({ action: "recall", query: "PostgreSQL" })

// Structured query on live CRDT state — like jq on a JSON file
l2_query({ path: "$.tasks[?(@.status=='ready')]" })

// Regex grep across CRDT content — like ripgrep but on CRDT
l2_grep({ pattern: "TODO|FIXME|HACK" })

// What changed since I last checked — like git log
l2_whatsnew({ since: "2026-04-27T10:00:00Z" })
```

### Orama vs MiniSearch for CRDT Memory

| Feature | MiniSearch (current L1) | Orama (proposed L2) |
|---------|------------------------|---------------------|
| Full-text search | ✅ BM25 | ✅ BM25 |
| Fuzzy/typo tolerance | ✅ | ✅ |
| Vector search | ❌ | ✅ built-in `vector[N]` type |
| Hybrid search | ❌ | ✅ `mode: "hybrid"` |
| Faceted search | ❌ | ✅ filter by field values |
| Embedded plugin | ❌ | ✅ `@orama/plugin-embeddings` auto-generates vectors |
| Size | 7KB | 2KB |
| Persistence | Manual JSON export | `@orama/plugin-data-persistence` |

**MiniSearch is fine for L1** (files, no vectors needed). **Orama is better for L2/memory** because it natively handles vectors — exactly what `MemoryScope.recall()` needs. Instead of building a custom vector store, Orama IS the vector store.

### What This Means for MemoryScope

With Orama as the storage backend, `MemoryScope` becomes a thin wrapper:

```typescript
class MemoryScope {
  private orama: OramaDB; // Orama instance
  
  async remember(content: string, opts?) {
    const embedding = await this.embed(content);
    // Consolidation check...
    await insert(this.orama, { content, embedding, scope, source, createdAt });
  }

  async recall(query: string, opts?) {
    // Orama handles BOTH keyword + vector ranking natively
    return search(this.orama, {
      term: query,
      mode: "hybrid",
      vector: { value: await this.embed(query), property: "embedding" },
      where: { scope: { eq: opts?.scope } },
      limit: opts?.limit ?? 5,
    });
  }
}
```

No separate `CompositeScorer` needed — Orama's hybrid mode combines BM25 + vector similarity. No separate `MemoryStorage` needed — Orama IS the storage + index.

### Eliminating Filesystem Projection

With Orama indexing CRDT docs directly:

| Today (projection) | After (direct) |
|-------------------|----------------|
| CRDT → `projectToFilesystem()` → `.ping/collaboration/*.json` → MiniSearch | CRDT → `onChange` → Orama index (in-memory) |
| Agent greps projected files | Agent searches Orama directly |
| Stale (debounced write to disk) | Real-time (indexed on onChange) |
| Two copies of every doc | One copy (CRDT binary + Orama index) |

The `projectToFilesystem()` function can be removed entirely once agents use Orama-backed search tools instead of reading projected files.

### Integration with L2 Search Feature

The [L2 Search & Indexing feature](docs/features/l2-search-indexing/) planned a Hocuspocus Search Extension with MiniSearch. **Orama replaces MiniSearch in that design** — same Hocuspocus `onChange` hook, same HTTP endpoints (`/search`, `/grep`, `/query`, `/ls`, `/cat`, `/stat`, `/whatsnew`), but backed by Orama instead of MiniSearch. Everything else stays the same.

The `l2_search` agent tool from that feature becomes the unified search tool for both goal-scoped docs AND team memory.

---

## Open Questions

1. **Vector storage for semantic recall.** Options: vectors in Y.Map (simple, no external dep), separate vector index per room (MongoDB Atlas Vector Search / LanceDB), or LLM-only ranking without vectors (slower). Recommend: LanceDB for dev, MongoDB Atlas for production.

2. **Memory consolidation cost.** Every `remember()` potentially triggers an LLM call. Mitigate with async background saves + batch dedup (CrewAI pattern — `remember()` returns immediately, consolidation runs async, `recall()` drains pending writes).

3. **Cross-team agent memory.** Should `backend-dev` in Team A share personal memory when assigned to Team B? Recommend: no — personal memory is `orgId`-scoped. Different teams may have contradictory conventions.

4. **Chat Agent integration (Phase 6).** Agent personal rooms become Chat Agent persistent context. The `personal_notes` tool evolves into Chat Agent memory. Room design is forward-compatible.

5. **Hocuspocus vs Y-Sweet.** Current infra is Hocuspocus (TypeScript). Y-Sweet (Rust, S3) may perform better at scale. `ICrdtMemoryProvider` interface allows swapping without changing agent tools.

---

## Toolchain: All Open Source, All Free

Every package in this architecture is open source with permissive licenses. No vendor lock-in.

### The Stack

| Package | License | Stars | What it does for us | Already in use? |
|---------|---------|-------|-------------------|-----------------|
| **[Y.js](https://github.com/yjs/yjs)** | MIT | 18k | CRDT engine — all shared state is Y.Doc objects | ✅ Yes |
| **[Hocuspocus](https://tiptap.dev/docs/hocuspocus/introduction)** | MIT | — | WebSocket CRDT server, persistence, auth hooks | ✅ Yes |
| **[@orama/orama](https://github.com/oramasearch/orama)** | Apache-2.0 | 10.3k | Full-text + vector + hybrid search in 2KB. Replaces MiniSearch for L2 AND the custom vector store for semantic recall | ❌ New |
| **[micromatch](https://github.com/micromatch/micromatch)** | MIT | 4.8k | Glob matching on strings (not files). `micromatch(docNames, "team-memory/**")` | ❌ New (transitive dep already present) |
| **[jsonpath-plus](https://github.com/s3u/JSONPath)** | MIT | 2k | JSONPath queries on `doc.toJSON()` — structured queries on live CRDT state | ❌ New |
| **[MiniSearch](https://github.com/lucaong/minisearch)** | MIT | 4.5k | BM25 keyword search (already used for L1 workspace files) | ✅ Yes |
| **[BlockSuite](https://github.com/toeverything/blocksuite)** | MPL-2.0 | 5.8k | Reference architecture: cross-document block references, multi-doc state management on Y.js | 📖 Study |
| **[AFFiNE/OctoBase](https://github.com/toeverything/OctoBase)** | MIT | — | Reference architecture: CRDT document indexing, backlinks, search over Y.js docs at scale | 📖 Study |
| **[Loro](https://github.com/loro-dev/loro)** | MIT | 5.5k | Next-gen CRDT with version control + time travel + inspector. Future upgrade path from Y.js | 📖 Study |
| **[Automerge](https://github.com/automerge/automerge)** | MIT | 6.2k | Change attribution (author + timestamp per change). Reference for provenance layer | 📖 Study |

### What We Use vs What We Study

**Use directly (npm install):**
- `@orama/orama` — replaces both MiniSearch (for L2 keyword search) and custom vector store (for semantic recall)
- `micromatch` — glob matching on CRDT doc name strings
- `jsonpath-plus` — structured JSONPath queries on live CRDT state
- Y.js + Hocuspocus — already in use, unchanged

**Study the patterns (don't import the code):**
- AFFiNE/OctoBase — how they built cross-doc references + backlinks + search over Y.js
- BlockSuite — how `@blocksuite/store` manages state across hundreds of CRDT docs
- Loro — version control + change attribution model (future Y.js replacement candidate)

---

## How Cursor/Copilot/Claude Work on Files vs How We Work on CRDT

### What They Have (File-Based)

Cursor, Copilot, and Claude navigate code via filesystem primitives:

| Capability | How they do it | Tool/Package |
|-----------|---------------|-------------|
| **Read file** | `fs.readFile(path)` | Node.js fs |
| **List files** | `fast-glob("**/*.ts")` | fast-glob |
| **Grep** | `ripgrep` or `grep` on file bytes | rg binary |
| **Keyword search** | MiniSearch / embeddings over file chunks | MiniSearch, vector DB |
| **Go to Definition** | LSP → TypeScript compiler → AST → symbol table | ts-server |
| **Find References** | LSP → reverse index: symbol → [locations] | ts-server |
| **File watcher** | `chokidar` / FSEvents → re-index on change | chokidar |

### What We Build (CRDT-Based Equivalents)

| Capability | Filesystem equivalent | CRDT implementation | Package |
|-----------|---------------------|---------------------|---------|
| **Read doc** | `fs.readFile()` | `doc.getMap("task").toJSON()` | Y.js (existing) |
| **List docs** | `fs.readdir()` / `fast-glob` | `hocuspocus.getDocNames()` + `micromatch(names, pattern)` | Y.js + micromatch |
| **Grep** | `ripgrep` on files | `extractText(ydoc)` → regex on extracted string | Y.js (manual extraction) |
| **Keyword search** | MiniSearch on file chunks | Orama BM25 on extracted CRDT text (indexed via `onChange`) | @orama/orama |
| **Semantic search** | Embeddings + vector DB | Orama hybrid mode: BM25 + vector in one query | @orama/orama |
| **Structured query** | jq / JSONPath on JSON files | `JSONPath({path, json: doc.toJSON()})` on live CRDT state | jsonpath-plus |
| **Go to Definition** | LSP symbol table | Entity index: `entityId → { docName, kind, content }` (built on onChange) | Custom (~200 lines) |
| **Find References** | LSP reverse index | Backlink index: `entityId → [{ docName, kind }]` (AFFiNE pattern) | Custom (~200 lines) |
| **File watcher** | chokidar / FSEvents | Hocuspocus `onChange` hook → re-index in Orama | Hocuspocus (existing) |
| **Changelog** | `git log` | CRDT version timestamps per doc change | Y.js (existing) |

### The Bridge: Y.Doc → Searchable Text

CRDT docs aren't files. They're in-memory objects. Every search operation needs an extraction step:

```
Y.Doc (in-memory)
  ├─ Y.Map("task")        → JSON.stringify(map.toJSON())
  ├─ Y.Array("discussion") → items.map(i => i.content).join("\n")
  ├─ Y.XmlFragment("content") → xmlFragmentToText() (already exists in codebase)
  └─ Y.Text("notes")      → text.toString()

                     ↓ extractSearchableText(ydoc) ↓

"task-1 Build API ready POST /users... PostgreSQL for users DB..."

                     ↓ fed to Orama on every onChange ↓

Orama index (in-memory, 2-10ms search)
  ├─ fulltext: BM25 keyword search
  ├─ vector: cosine similarity on embeddings
  ├─ hybrid: both combined
  └─ filter: by scope, source, room, docName
```

### The Entity Index (LSP-Like Navigation)

No off-the-shelf package exists for "LSP for CRDT." But AFFiNE has proven the pattern works at scale (67k stars, millions of users). Their approach:

1. **Blocks have stable IDs** — every entity in CRDT has a UUID
2. **References are explicit** — task dependencies, decision references stored in Y.Map fields
3. **Backlinks maintained on write** — when doc A references entity B, index updates: `B → [...refs, A]`
4. **Text mentions detected** — scan extracted text for known entity IDs/names

```typescript
// Entity index — built incrementally on each onChange
entities: Map<entityId, { docName, kind, content, createdBy }>
references: Map<entityId, Array<{ docName, context, kind }>>

// Agent tools:
l2_navigate({ action: "definition", entity: "PostgreSQL" })
  → { docName: "team-memory/decisions", content: "Use PostgreSQL for user DB" }

l2_navigate({ action: "references", entity: "db-choice" })
  → [{ docName: "goal-001/task-003/task", kind: "implements" }, ...]

l2_navigate({ action: "impact", entity: "db-choice" })
  → { directDependants: ["task-003", "task-007"], transitiveImpact: 5 }
```

### What This Means Competitively

| | Cursor/Copilot/Claude (files) | Ping (CRDT) |
|-|------------------------------|-------------|
| **Data model** | Files on disk (static, single-writer) | CRDT docs (real-time, multi-writer, conflict-free) |
| **Search** | File grep + embeddings | Orama hybrid (keyword + vector in one index) |
| **Structured query** | Parse JSON/YAML files | JSONPath on live CRDT state (real-time, not stale files) |
| **Cross-doc navigation** | LSP (code only, not docs/decisions/plans) | Entity index (works on decisions, tasks, conventions — not just code) |
| **Collaboration** | Git branches (async, merge conflicts) | CRDT (real-time, automatic merge, no conflicts) |
| **Memory persistence** | None (context window dies per session) | Team memory room (survives across goals, consolidates duplicates) |
| **Agent identity** | None (agents are anonymous tool callers) | Agents are registered users with presence, personal rooms, permissions |

The competitive advantage isn't doing the same thing as Cursor on files. It's doing things files **can't do**: real-time multi-agent collaboration on shared state, persistent team memory with semantic consolidation, and cross-document navigation over decisions/tasks/conventions — not just code symbols.

---

## The Core Requirement: CRDT Must Beat Files

### Why This Matters

If CRDT is slower or harder to use than files, agents will rationally skip collaboration and write everything to workspace files. The collaboration features (rooms, memory, discussions) become useless because nobody uses the underlying data layer.

### Today: Files Win, CRDT Loses

| Operation | L1 Files (current) | L2 CRDT (current) | Who wins? |
|-----------|-------------------|-------------------|-----------|
| Read | `workspace_read_file` — instant, one call | `collab({ action: "read", docName, key })` — verbose | Files |
| Search | `keyword_search` — MiniSearch, 2-10ms, BM25 | **Nothing.** Agent must discover → list → read each doc | Files by miles |
| Grep | `workspace_grep` — ripgrep, <5ms, regex | **Nothing** | Files by miles |
| List/glob | `fast-glob("**/*.ts")` — instant | `collab({ action: "discover" })` — all docs, no filtering | Files |
| Structured query | Parse JSON file | **Nothing** | Files |
| Watch for changes | File watcher → auto re-index | Nothing (onChange exists but no tools use it) | Files |
| Semantic search | Not built yet | **Nothing** | Nobody |

**An agent today would rationally choose files over CRDT for everything except real-time co-editing.** That's a collaboration killer.

### CRDT's Structural Speed Advantage

CRDT has one thing files don't: **everything is already in memory.** Files require disk I/O. CRDT docs are live JavaScript objects in Hocuspocus. If indexed properly, CRDT search is 10-100x faster:

| Operation | Files (disk I/O) | CRDT (in-memory) | Speed advantage |
|-----------|-----------------|-------------------|----------------|
| Read | ~1-5ms (SSD read) | ~0.01ms (`map.toJSON()`) | 100x |
| Search (keyword) | ~2-10ms (MiniSearch) | ~1-5ms (Orama in-memory) | 2x |
| Grep | ~5-50ms (ripgrep process spawn) | ~0.5-2ms (regex on in-memory strings) | 10-25x |
| List/glob | ~10-100ms (readdir + glob) | ~0.1ms (Map.keys() + micromatch) | 100x |
| Structured query | ~5ms (read + JSON.parse + query) | ~0.5ms (JSONPath on already-parsed toJSON()) | 10x |

The data is already loaded, parsed, and in RAM. Files can't compete — they always have the disk I/O penalty. **But this advantage is completely unexploited today.**

---

## The LSP Analogy: Why Search Alone Isn't Enough

### How LSP Made Claude Fast

Without LSP, Claude navigates code like this:
1. Grep for `getUserById` → scan 50 results
2. Read each file to figure out which one is the definition
3. Repeat for every reference
→ 10+ tool calls, slow, inaccurate

With LSP:
1. "Go to definition of `getUserById`" → instant, one result, exact location
→ 1 tool call, <1ms

**LSP didn't make files faster. It built a semantic index ON TOP of files.** The files are still slow disk I/O. But the LSP index (symbol table, type info, references graph) lives in memory and gives instant answers.

### We Need the Same Three Layers for CRDT

```
Files without LSP     = slow (grep + manual reading)
Files WITH LSP        = fast (instant semantic navigation)

CRDT without index    = slow (discover + list + read each doc)  ← WE ARE HERE
CRDT WITH Orama + entity index = fast (instant search + navigation)
```

| Layer | File equivalent | CRDT equivalent | What it gives agents |
|-------|---------------|-----------------|---------------------|
| **Storage** | Filesystem (read/write files) | Y.js + Hocuspocus (read/write Y.Docs) | Basic CRUD (already have this) |
| **Search** | ripgrep + MiniSearch | Orama (BM25 + vector, indexed via onChange) | Find by keyword/pattern/meaning |
| **Semantic** | **LSP** (symbol table + references) | **Entity index + backlinks** | Instant definition/references/impact |

Search gets us to filesystem parity. The entity index is what makes CRDT **better** than files — because decisions, conventions, and task dependencies aren't code symbols that LSP can navigate. But our entity index can.

---

## Entity Index + Backlinks — Deep Dive

### What It Is

Two `Map` objects that tell agents "where is this thing defined" and "what depends on it" — without reading every document.

**Map 1: Entity Definitions** (like LSP's symbol table — `function name → file:line`)

```typescript
entities = new Map<string, {
  docName: string;     // where it lives: "team-memory/decisions"
  kind: string;        // "decision" | "task" | "convention" | "agent"
  content: string;     // the actual text: "Use PostgreSQL for user database"
  createdBy: string;   // who wrote it: "planner"
  createdAt: string;   // when: "2026-04-27T10:00:00Z"
}>()

// Example entries:
// "db-choice"  → { docName: "team-memory/decisions", kind: "decision",
//                  content: "Use PostgreSQL for user database", createdBy: "planner" }
// "task-003"   → { docName: "goal-001/task-003/task", kind: "task",
//                  content: "Build API schema", createdBy: "planner" }
// "api-prefix" → { docName: "team-memory/conventions", kind: "convention",
//                  content: "All API endpoints use /v2 prefix", createdBy: "backend-dev" }
```

**Map 2: Backlinks / References** (like LSP's "Find All References" — `symbol → [file:line, ...]`)

```typescript
references = new Map<string, Array<{
  docName: string;     // which doc references this entity
  kind: string;        // "depends-on" | "mentions" | "implements" | "supersedes"
  context: string;     // surrounding text for preview
}>>()

// Example entries:
// "db-choice" → [
//   { docName: "goal-001/task-003/task", kind: "implements",
//     context: "Build PostgreSQL schema per DB decision..." },
//   { docName: "agent:backend-dev/scratchpad", kind: "mentions",
//     context: "Using PG as decided in goal-001..." },
//   { docName: "goal-002/task-001/task", kind: "depends-on",
//     context: "Data migration depends on DB choice" },
// ]
```

### Without vs With Entity Index

**Without** — agent wants to know "What did we decide about the database?":
```
1. collab({ action: "discover" })       → 47 docs listed
2. collab({ action: "read", doc: "team-memory/decisions" })  → maybe here?
3. collab({ action: "read", doc: "goal-001/task-003/task" }) → or here?
4. collab({ action: "read", doc: "goal-001/task-007/task" }) → or here?
5. ... keep reading docs hoping to find it ...
→ 5+ tool calls, 10+ seconds, most results irrelevant
```

**With** — same question:
```
1. l2_navigate({ action: "definition", entity: "database" })
→ Instant: { docName: "team-memory/decisions", key: "db-choice",
             content: "Use PostgreSQL for user database",
             madeBy: "planner", date: "2026-04-27" }
→ 1 tool call, <1ms
```

### How It Gets Populated

Incrementally, on the same `onChange` hook as search indexing:

```typescript
onChange({ documentName, document }) {
  const json = document.toJSON();

  // 1. STRUCTURED: Extract entities from known Y.Map fields
  //    (task IDs, decision keys, convention names — data we control)
  if (documentName.endsWith("/task")) {
    const task = json.task;
    entities.set(task.id, {
      docName: documentName, kind: "task",
      content: task.title, createdBy: task.createdBy,
    });
    // Task dependencies are EXPLICIT references (already in the data)
    for (const dep of task.dependencies) {
      addReference(dep, { docName: documentName, kind: "depends-on", context: task.title });
    }
  }

  if (documentName.startsWith("team-memory/decisions")) {
    for (const [key, decision] of Object.entries(json.decisions || {})) {
      entities.set(`decision:${key}`, {
        docName: documentName, kind: "decision",
        content: decision.text, createdBy: decision.madeBy,
      });
    }
  }

  // 2. TEXT: Scan content for mentions of known entity IDs/names
  const text = extractSearchableText(document);
  for (const [entityId, entity] of entities) {
    if (text.includes(entityId) || text.includes(entity.content)) {
      addReference(entityId, {
        docName: documentName, kind: "mentions",
        context: getSnippet(text, entityId),
      });
    }
  }
}
```

### Agent Tools for Navigation

```typescript
// "Go to Definition" — where was this decided/defined?
l2_navigate({ action: "definition", entity: "PostgreSQL" })
→ { docName: "team-memory/decisions", key: "db-choice",
    content: "Use PostgreSQL for user database", madeBy: "planner" }

// "Find All References" — what mentions/depends on this?
l2_navigate({ action: "references", entity: "db-choice" })
→ [
    { docName: "goal-001/task-003/task", kind: "implements", context: "Build PG schema..." },
    { docName: "agent:backend-dev/scratchpad", kind: "mentions", context: "Using PG..." },
    { docName: "goal-002/task-001/task", kind: "depends-on", context: "Migration needs..." },
  ]

// "Impact Analysis" — what breaks if I change this?
l2_navigate({ action: "impact", entity: "db-choice" })
→ { directDependants: ["task-003", "task-007"], transitiveImpact: 5,
    warning: "Changing DB choice affects 5 tasks across 2 goals" }

// "Outline" — structural overview (like VS Code outline panel)
l2_navigate({ action: "outline", scope: "team-memory" })
→ { decisions: { count: 12, latest: "Use Fastify for API" },
    conventions: { count: 8, latest: "snake_case for DB columns" },
    knowledge: { count: 23, latest: "Rate limit is 1000 req/min" } }
```

### LSP vs Entity Index — Honest Differences

| | Code LSP | CRDT Entity Index |
|-|---------|-------------------|
| Parsing | Deterministic AST from grammar | Heuristic: known Y.Map schemas + text mention scanning |
| Precision | Exact (type system resolves ambiguity) | Fuzzy (text mentions may false-positive) |
| Build cost | Expensive (full AST parse on change) | Cheap (Y.Map schema is known, text scan is fast) |
| Rename | Safe (type-checked across all files) | Risky (text mentions may miss some / hit false positives) |
| Coverage | Code symbols only | Decisions, tasks, conventions, knowledge — things LSP can't see |

Code LSP is precise because languages have grammars. CRDT entity indexing is fuzzy because team memory is natural language. But for agent navigation — "what depends on this decision?" — fuzzy is good enough. Agents don't need 100% precision, they need directional context.

---

## Revised Implementation Priority

Search is the unlock. Without it, agents won't use CRDT and all other features are moot.

### Phase 0: CRDT Search (Make CRDT Usable) — P1

**~450 lines. The prerequisite for everything else.**

| Component | Lines | What it does |
|-----------|-------|-------------|
| `CrdtSearchExtension` | ~200 | Hocuspocus extension: onChange → extractText → upsert Orama |
| `l2_search` tool | ~150 | Agent tool: search/grep/glob/query/whatsnew/cat |
| `extractSearchableText()` | ~100 | Y.Map/Y.Array/Y.XmlFragment/Y.Text → string (partially exists) |

Agents get: keyword search, regex grep, glob listing, JSONPath queries, changelog — all on live CRDT state, all faster than filesystem equivalents.

### Phase 1: Entity Index (Make CRDT Smart) — P2

**~400 lines. The "LSP for CRDT."**

| Component | Lines | What it does |
|-----------|-------|-------------|
| `EntityIndex` | ~200 | Two Maps (entities + references), populated via onChange |
| `l2_navigate` tool | ~150 | Agent tool: definition/references/impact/outline |
| Schema extractors | ~50 | Task/decision/convention → entity entries |

Agents get: go-to-definition for decisions, find-all-references for tasks, impact analysis for changes.

### Phase 2: Team Memory + Rooms — P2

Rooms, auth, ACL, MemoryScope, MemoryConsolidation, agent identity. All the features documented earlier in this doc. Only valuable AFTER agents can actually search and navigate CRDT.

### Phase 3: Frontend Integration — P3

Memory panel, agent presence, search UI. After Chat Agent layer.

---

## Block-Level Addressing: `doc:block` (LSP's `file:line` for CRDT)

### The Problem

LSP gives agents `symbol → file:line:column`. That's why Claude/Copilot can jump to any function instantly. Our entity index (above) currently only goes to the doc level — `entity → docName`. That's like an LSP that tells you "the function is somewhere in api.ts" but not which line. Agents still need to read the whole doc and scan for the entry.

### The Solution: Y.js Already Has Block IDs

Every entry in a Y.Map has a key. Every item in a Y.Array can have an `id` field. Every XmlFragment block has an `id` attribute. These are stable, survive sync, and can be used as block-level addresses — no new packages needed.

```
LSP:    symbol → file : line : column
                 src/api.ts : 42 : 5

CRDT:   entity → doc : block [: field]
                 team-memory/decisions : db-choice [: text]
                 goal-001/task-003/task : task : body
                 goal-001/doc-api-spec : block-abc123
```

### How It Works With Existing Y.js Primitives

```typescript
// Y.Map keys ARE block addresses:
doc.getMap("decisions").set("db-choice", { text: "Use PostgreSQL", madeBy: "planner" });
// Address: team-memory/decisions:decisions.db-choice
// Resolve: hocuspocus.getDoc("team-memory/decisions").getMap("decisions").get("db-choice")

// Y.Array items with ID fields:
doc.getArray("discussion").push([{ id: "block-003", role: "backend-dev", content: "Use REST" }]);
// Address: goal-001/task-003/discussion:block-003
// Resolve: array.find(item => item.id === "block-003")

// Y.XmlFragment blocks (BlockNote editor):
blockContainer.setAttribute("id", "abc123");
// Address: goal-001/doc-api-spec:abc123
// Resolve: walk XmlFragment tree, find element with id="abc123"
```

### Three-Level Address Resolution

| Level | What | Example | How to resolve |
|-------|------|---------|---------------|
| **Doc** | Which CRDT document | `team-memory/decisions` | `hocuspocus.getDoc(docName)` |
| **Block** | Which entry within doc | `db-choice` | `doc.getMap("decisions").get("db-choice")` |
| **Field** | Which field of entry | `text` | `.text` on the returned object |

### Entity Index With Block Addresses

```typescript
// Entity definitions now include block-level location:
entities.set("db-choice", {
  docName: "team-memory/decisions",     // which doc
  blockPath: "decisions.db-choice",      // which block within doc
  kind: "decision",
  content: "Use PostgreSQL for user database",
  createdBy: "planner",
});

// References also point to specific blocks:
references.set("db-choice", [
  {
    docName: "goal-001/task-003/task",
    blockPath: "task.body",              // the body field of the task
    kind: "implements",
    context: "Build PostgreSQL schema per DB decision...",
  },
  {
    docName: "agent:backend-dev/scratchpad",
    blockPath: "notes.api-patterns",     // specific note entry
    kind: "mentions",
    context: "Using PG as decided in goal-001...",
  },
]);
```

### Agent Navigation — Direct Jump to Block

```typescript
// "Go to definition" — returns doc:block address (like file:line)
l2_navigate({ action: "definition", entity: "db-choice" })
→ {
    docName: "team-memory/decisions",
    blockPath: "decisions.db-choice",      // exact block, not just the doc
    content: "Use PostgreSQL for user database",
    madeBy: "planner",
  }

// Agent reads JUST that block (not the whole doc):
l2_read({ docName: "team-memory/decisions", path: "decisions.db-choice" })
→ { text: "Use PostgreSQL for user database", madeBy: "planner", date: "2026-04-27" }

// "Find references" — returns doc:block for each reference
l2_navigate({ action: "references", entity: "db-choice" })
→ [
    { docName: "goal-001/task-003/task", blockPath: "task.body", kind: "implements" },
    { docName: "agent:backend-dev/scratchpad", blockPath: "notes.api-patterns", kind: "mentions" },
  ]
```

### Industry Validation: BlockSuite / AFFiNE

BlockSuite (5.8k stars, powers AFFiNE 67.7k stars) proves block-level addressing works at scale on Y.js:

- `doc.addBlock()` returns a stable UUID per block
- `doc.getBlockById(id)` resolves any block instantly
- Selection system addresses blocks by **path**: `[rootId, noteId, paragraphId]`
- Cross-doc references use block IDs — linked pages point to specific blocks in other docs

**We don't need BlockSuite as a dependency.** We just need to follow their pattern: stable IDs on every entity we write to CRDT, and an index that maps `entityId → docName:blockPath`.

### Complete Filesystem Parity

| Filesystem operation | CRDT equivalent | How | Package |
|---------------------|-----------------|-----|---------|
| `ls /path/` | List docs by glob | `micromatch(docNames, "team-memory/**")` | micromatch |
| `cat file` | Read full doc | `doc.toJSON()` | Y.js |
| `cat file:line` | Read specific block | `doc.getMap("x").get("key")` | Y.js |
| `grep -r pattern` | Regex search | regex on Orama indexed content | Orama |
| `find . -name "*.ts"` | Glob docs | `micromatch(docNames, pattern)` | micromatch |
| `rg keyword` | Keyword search | `orama.search({ term })` | Orama |
| Go to Definition | Entity lookup | `entities.get(id)` → `doc:block` | Custom Map (~200 lines) |
| Find References | Backlink lookup | `references.get(id)` → `[doc:block]` | Custom Map (~200 lines) |
| `jq '.tasks[]'` | JSONPath query | `JSONPath({path, json: doc.toJSON()})` | jsonpath-plus |
| `git log --since` | Changelog | Filter docs by `updatedAt > since` | Orama filter |
| `stat file` | Doc metadata | doc size, block count, last modified | Y.js |
| `inotifywait` | Change listener | Hocuspocus `onChange` hook | Hocuspocus |

Every filesystem operation agents use on L1 workspace files has a CRDT equivalent that's **faster** (in-memory vs disk I/O) and **richer** (structured data vs flat text). The only thing missing today is the search/index layer — ~650 lines total (Orama extension + entity index + agent tools).

---

## Full Audit: How Claude Code / Copilot / Cursor Navigate Files vs How We Navigate CRDT

### How Agentic Coding Tools Work on Files

All three (Claude Code, GitHub Copilot, Cursor) share the same fundamental architecture:

```
┌─────────────────────────────────────────────────────────┐
│                    AI Agent                               │
│                                                           │
│  Understands code via these layers:                       │
│                                                           │
│  Layer 1: RAW FILE ACCESS                                 │
│  ├─ Read file        (fs.readFile)                        │
│  ├─ Write file       (fs.writeFile)                       │
│  ├─ List files       (readdir / glob)                     │
│  ├─ Delete file      (fs.unlink)                          │
│  └─ File metadata    (fs.stat)                            │
│                                                           │
│  Layer 2: TEXT SEARCH                                     │
│  ├─ Grep/ripgrep     (regex on file bytes)                │
│  ├─ Keyword search   (embeddings or BM25 index)           │
│  ├─ Codebase index   (chunk + embed all files on open)    │
│  └─ Semantic search  (vector similarity on embeddings)    │
│                                                           │
│  Layer 3: SEMANTIC UNDERSTANDING (LSP)                    │
│  ├─ Go to definition (symbol → file:line)                 │
│  ├─ Find references  (symbol → [file:line, ...])          │
│  ├─ Symbol tree      (file → outline of classes/funcs)    │
│  ├─ Type info        (hover → type + docs)                │
│  ├─ Rename symbol    (across all files)                   │
│  ├─ Diagnostics      (errors/warnings per file)           │
│  └─ Code actions     (quick fixes, refactors)             │
│                                                           │
│  Layer 4: VERSION CONTROL                                 │
│  ├─ Git diff         (what changed)                       │
│  ├─ Git log          (history)                            │
│  ├─ Git blame        (who wrote this line)                │
│  └─ Branch/commit    (save checkpoints)                   │
│                                                           │
│  Layer 5: TERMINAL / RUNTIME                              │
│  ├─ Run commands     (bash/shell)                         │
│  ├─ Run tests        (test runner output)                 │
│  └─ Install deps     (npm/pip/etc)                        │
└─────────────────────────────────────────────────────────┘
```

**What makes them fast is Layer 3 (LSP).** Without it, they'd be stuck grep-ing files like a human. LSP gives instant structured answers about code: "where is this defined?", "who calls this?", "what type is this?". Claude Code uses VS Code's built-in LSP. Cursor embeds its own. Copilot piggybacks on VS Code's.

### What Our Agents Have Today (L1 + L2 Combined)

| Layer | Claude Code / Copilot / Cursor | Ping L1 (workspace files) | Ping L2 (CRDT) |
|-------|-------------------------------|--------------------------|-----------------|
| **Read** | `read_file` | ✅ `workspace_read_file` | ✅ `collab read` |
| **Write** | `write_file`, `edit_file` | ✅ `workspace_write_file`, `workspace_create_file` | ✅ `collab write`, `collab write-block` |
| **Delete** | `delete_file` | ✅ `workspace_delete_file` | ❌ No delete tool |
| **List** | `list_dir`, glob | ✅ `workspace_list_files`, `workspace_glob` | ⚠️ `collab discover` (no glob filter) |
| **File metadata** | `stat` | ✅ `workspace_file_stats` | ❌ No metadata |
| **Grep** | ripgrep / `grep_search` | ✅ `workspace_grep` | ❌ Nothing |
| **Keyword search** | embeddings index / `semantic_search` | ✅ `keyword_search` (MiniSearch BM25) | ❌ Nothing |
| **Semantic search** | codebase embeddings | ❌ Not built | ❌ Nothing |
| **Go to definition** | LSP `textDocument/definition` | ✅ `find_symbol` (code intel) | ❌ Nothing |
| **Find references** | LSP `textDocument/references` | ❌ Not built | ❌ Nothing |
| **Symbol tree** | LSP `textDocument/documentSymbol` | ✅ `get_symbols`, `get_file_summary` | ❌ Nothing |
| **Repo overview** | codebase map | ✅ `get_repo_map` | ❌ Nothing |
| **Dependencies** | LSP imports/exports | ✅ `get_dependencies` | ❌ Nothing |
| **Git diff** | `git diff` | ✅ `workspace_status` (uncommitted changes) | ❌ No CRDT diff |
| **Git log** | `git log` | ✅ `workspace_get_history` | ❌ No changelog |
| **Git blame** | `git blame` | ❌ Not built | ❌ Nothing |
| **Git commit** | `git commit` | ✅ `workspace_commit` | N/A (CRDT auto-syncs) |
| **Run commands** | bash/terminal | ✅ (via AI SDK tools) | N/A |
| **Scratchpad** | N/A | ✅ `scratch_note`, `scratch_todo`, `scratch_remember` | ❌ No personal space |
| **Progress tracking** | N/A | ✅ `workspace_progress`, `workspace_log_activity` | ❌ Nothing |
| **JSONPath query** | N/A | N/A | ❌ Nothing (data is structured but unqueryable) |
| **Discussion threads** | N/A | N/A | ✅ `collab discuss` |
| **Search & replace** | edit tools | ✅ `workspace_search_and_replace` | ❌ Nothing |
| **Publish/lifecycle** | N/A | ✅ `workspace_publish`, `workspace_reactivate` | N/A |

### The Gaps: What's Missing in CRDT

**Total L2 capabilities today: 4** (read, write, write-block, discover/list, discuss)  
**Total capabilities Claude Code has on files: ~20+**  
**Gap: 16+ missing capabilities on CRDT**

Sorted by impact:

| Priority | Capability | Impact if missing | Effort to build | Package |
|----------|-----------|------------------|-----------------|---------|
| **P0** | Keyword search | Agents can't find anything → skip CRDT entirely | ~150 lines | Orama |
| **P0** | Grep (regex) | Can't search for patterns across CRDT docs | ~50 lines | Regex (built-in) |
| **P0** | Glob/filter on list | `discover` returns everything, no filtering | ~20 lines | micromatch |
| **P1** | Entity definitions | Can't jump to "where was X decided" | ~200 lines | Custom Map |
| **P1** | Entity references | Can't find "what depends on X" | ~200 lines | Custom Map |
| **P1** | Changelog (whatsnew) | Can't see "what changed since I last checked" | ~80 lines | Timestamp filter |
| **P1** | JSONPath query | Can't query structured CRDT data | ~50 lines | jsonpath-plus |
| **P1** | Doc metadata (stat) | Can't see doc size, last modified, block count | ~30 lines | Y.js |
| **P2** | Semantic search | Can't search by meaning (vector similarity) | ~100 lines | Orama hybrid |
| **P2** | Doc outline | Can't see structure of a CRDT doc at a glance | ~80 lines | Custom |
| **P2** | Impact analysis | Can't assess "what breaks if I change X" | ~100 lines | Custom |
| **P2** | Block-level read | Can't read a specific block, must read whole doc | ~30 lines | Y.js |
| **P3** | Delete doc/entry | Can't remove CRDT entries | ~20 lines | Y.js |
| **P3** | Search & replace | Can't find-and-replace across CRDT docs | ~50 lines | Custom |
| **P3** | Personal scratchpad | Agents have no private CRDT space | Room feature | Hocuspocus |

### What's Possible vs Not Possible in CRDT

| Capability | Possible in CRDT? | How | Exists? |
|-----------|-------------------|-----|---------|
| Read file | ✅ Yes, faster than files | `doc.toJSON()` — already in memory, no disk I/O | ✅ Built |
| Write file | ✅ Yes, with real-time sync | `doc.getMap().set()` — auto-syncs to all peers | ✅ Built |
| Delete file | ✅ Yes | `doc.getMap().delete(key)` or `ydoc.destroy()` | ❌ No tool |
| List files | ✅ Yes, faster | `Map.keys()` on Hocuspocus doc registry | ⚠️ No filter |
| Glob | ✅ Yes | `micromatch(docNames, pattern)` — pure string match | ❌ Not built |
| Grep | ✅ Yes, faster | Extract text from Y.Doc → regex match (in-memory) | ❌ Not built |
| Keyword search | ✅ Yes, faster | Orama BM25 on extracted text, indexed via onChange | ❌ Not built |
| Semantic search | ✅ Yes | Orama hybrid mode: BM25 + vector in one query | ❌ Not built |
| Go to definition | ✅ Yes, for CRDT entities | Entity index: `entityId → doc:block` (two Maps) | ❌ Not built |
| Find references | ✅ Yes, for CRDT entities | Backlink index: `entityId → [doc:block, ...]` | ❌ Not built |
| Symbol/outline tree | ✅ Yes | Walk Y.Doc shared types, list keys/blocks | ❌ Not built |
| JSONPath query | ✅ Yes | `JSONPath({path, json: doc.toJSON()})` — native structured data | ❌ Not built |
| Changelog | ✅ Yes | CRDT tracks version timestamps per doc change | ❌ Not built |
| Git blame equiv | ⚠️ Partial | Y.js tracks `clientID` per change, not `agentRole` directly. Need to map clientID → agent at write time via `transact(fn, origin)` | ❌ Not built |
| Diff between versions | ⚠️ Partial | Y.js has `Y.encodeStateVector` + `Y.diffUpdate` for binary diffs, but no human-readable diff | ❌ Not built |
| Undo/Redo | ✅ Yes | `Y.UndoManager` — per-agent, per-doc (see crdt-undo-rollback feature) | ❌ Not built |
| Real-time co-editing | ✅ Yes — CRDT advantage | Multiple agents write simultaneously, conflicts auto-resolved | ✅ Built |
| Offline + sync later | ✅ Yes — CRDT advantage | Changes merge automatically regardless of order | ✅ Built |
| Cross-doc references | ✅ Yes | Stable block IDs (Y.Map keys, array item IDs) as addresses | ❌ Not built |
| Multi-doc state | ✅ Yes | Hocuspocus manages N docs, all in memory simultaneously | ✅ Built |
| Permissions/ACL | ✅ Yes | Hocuspocus `onAuthenticate` + `onLoadDocument` hooks | ❌ Not built |
| Persistent memory | ✅ Yes | Team-level room that persists across goals | ❌ Not built |
| Memory consolidation | ✅ Yes | LLM-powered dedup/merge on save (CrewAI pattern) | ❌ Not built |
| Presence/cursors | ✅ Yes | Y.js awareness protocol | ❌ Not built |

### What CRDT Can Do That Files CAN'T

| Capability | Files | CRDT | Why CRDT wins |
|-----------|-------|------|--------------|
| **Real-time multi-agent co-editing** | ❌ File locks / git merge conflicts | ✅ Automatic conflict-free merge | Multiple agents edit the same doc simultaneously |
| **Structured data queries** | Parse JSON/YAML files manually | ✅ JSONPath on live `toJSON()` | Data is already parsed, queryable without file I/O |
| **Cross-goal persistent memory** | ❌ Files die with workspace branch | ✅ Team memory room survives goals | Decisions, conventions accumulate over time |
| **Semantic memory consolidation** | ❌ No concept of "same fact stated differently" | ✅ LLM-powered dedup/merge/supersede | Memory stays clean as knowledge evolves |
| **Agent presence + identity** | ❌ Agents are anonymous file writers | ✅ Agents are registered users with cursors | Agents can see what others are doing in real-time |
| **Speed for read/search** | ~1-50ms (disk I/O) | ~0.01-5ms (in-memory) | 10-100x faster, data already loaded |
| **Automatic sync** | Manual git push/pull | ✅ CRDT auto-syncs on every change | No manual intervention needed |
| **Discussion threads** | ❌ (use comments in code at best) | ✅ Structured discussion Y.Array | Agents can discuss decisions, vote, decide |
| **Undo per agent** | `git revert` (whole commits) | ✅ `Y.UndoManager` per agent per doc | Revert one agent's changes without affecting others |

### The Bottom Line

**Today:** L1 has 36 tools. L2 has 1 tool (collab) with 7 actions. Agents are 5x more capable on files than on CRDT.

**After building ~650 lines (Phase 0 + Phase 1):** L2 gets keyword search, grep, glob, JSONPath, entity index, references, changelog, metadata, outline — plus all the CRDT-exclusive advantages (real-time sync, structured queries, persistent memory, consolidation).

**Result:** CRDT becomes not just at parity with files, but **superior** for collaboration. Agents use L1 for code (where LSP matters) and L2 for everything else (decisions, tasks, conventions, knowledge, discussions) — where CRDT's real-time, structured, persistent nature beats flat files.

---

## LSP-Equivalent Capabilities: What's Possible in CRDT

### How Code Agents Got Their Powers

Claude Code, Copilot, and Cursor didn't build LSP or AST parsers. They **plugged into** existing infrastructure that took decades to build:

| What agents plug into | Who built it | Time invested | Size |
|-----------------------|-------------|---------------|------|
| LSP (Language Server Protocol) | Microsoft + language teams | 10+ years | Millions of lines (TypeScript compiler alone: ~1M) |
| AST parsers (tree-sitter, Babel) | GitHub, community | 15+ years | Hundreds of thousands of lines |
| ripgrep | Andrew Galloway | 8 years | ~30K lines Rust |
| Git | Linus Torvalds + community | 20+ years | ~400K lines C |

For CRDT documents, **nothing equivalent exists yet.** No one has built a "Y.js document language server" or an "AST for CRDT." The use case of "AI agents navigating collaborative team memory as a structured document graph" is new.

### LSP Feature-by-Feature: Can CRDT Do It?

| LSP Feature | CRDT Equivalent | Possible? | How | Precision |
|-------------|----------------|-----------|-----|-----------|
| **Go to definition** | Entity → doc:block | ✅ Yes | Entity index Map lookup. `"db-choice" → team-memory/decisions:db-choice` | Exact for structured data (task IDs, decision keys). Fuzzy for text mentions |
| **Find references** | Entity → [doc:block, ...] | ✅ Yes | Backlink index. Explicit refs (task deps) are exact. Text mentions scanned | 90% — explicit refs perfect, text scanning may miss/false-positive |
| **Symbol tree / outline** | Doc → outline of entries | ✅ Yes | Walk Y.Doc shared types: `doc.share.entries()` → list all Map keys, Array lengths, blocks | Exact — Y.Doc structure IS the tree |
| **Type info / hover** | Entity → kind + metadata | ✅ Yes, **richer** | Entity index stores `kind`, `createdBy`, `createdAt`, `content`, provenance. Richer than code hover — includes who, when, why | Exact — we define the schema |
| **Rename symbol** | Rename entity across docs | ⚠️ Partial | Structured fields (task ID, decision key): exact rename. Text mentions: natural language → needs LLM, not find-replace | Structured: exact. Text: LLM-assisted |
| **Diagnostics** | Consistency checks | ⚠️ Different, **more useful** | No syntax errors. But: orphaned references, contradictory decisions, stale conventions. More valuable for collaboration than compiler errors | Custom — we define what "error" means |
| **Code actions** | Suggested fixes | ⚠️ Different | No "add missing import." But: "This decision contradicts an earlier one — resolve?", "3 agents wrote same convention differently — consolidate?" | LLM-powered, not deterministic |

**Three work exactly like LSP** (definition, references, symbol tree) — because we control the data schema. Y.Map keys and task IDs ARE symbols.

**One is better than LSP** (type info) — code LSP gives a type signature. Ours gives: who decided, when, why, what depends on it, full content.

**Three are fundamentally different** (rename, diagnostics, actions) — because CRDT content is natural language, not parsed code. But they're **more useful** for collaboration: "what contradicts what" matters more than "missing semicolon" when agents co-author decisions.

### Available Packages for Each Layer

```
┌─────────────────────────────────────────────────────────────┐
│  Layer 1: RAW ACCESS (already works — Y.js)                  │
│  └─ Y.js: doc.getMap(), doc.getArray(), doc.toJSON()         │
│     Package: yjs (MIT, 18k stars, already installed)         │
│                                                               │
│  Layer 2: SEARCH (plug in 4 packages)                        │
│  ├─ @orama/orama     → keyword + vector + hybrid search     │
│  │   (Apache-2.0, 10.3k stars, 527K weekly downloads)        │
│  ├─ micromatch        → glob on doc names                    │
│  │   (MIT, 4.8k stars, 144M weekly downloads)                │
│  ├─ jsonpath-plus     → JSONPath queries on doc.toJSON()     │
│  │   (MIT, 2k stars, 10M weekly downloads)                   │
│  └─ traverse          → recursive walk of doc.toJSON()       │
│      (MIT, 1.7k stars, 61M weekly downloads)                 │
│                                                               │
│  Layer 3: SEMANTIC (must build ~650 lines)                    │
│  ├─ EntityIndex        → entityId → doc:block                │
│  ├─ BacklinkIndex      → entityId → [doc:block, ...]         │
│  ├─ ChangeAttribution  → clientID → agentRole mapping        │
│  ├─ ConsistencyChecker → orphaned refs, contradictions       │
│  └─ HumanReadableDiff  → what changed in plain text          │
│                                                               │
│  Existing Y.js utilities:                                     │
│  ├─ y-utility          → YKeyValue, YMultiDocUndoManager     │
│  │   (MIT, by Y.js author, efficient key-value store)        │
│  └─ @hocuspocus/transformer → Y.Doc ↔ JSON/HTML converter   │
│      (MIT, 150K weekly downloads)                             │
└─────────────────────────────────────────────────────────────┘
```

### The `traverse` Package — AST Walking for CRDT

The `traverse` npm package (61M weekly downloads, MIT) works on **any JavaScript object**. Since `doc.toJSON()` produces a plain object, it gives us AST-like tree walking:

```typescript
import traverse from 'traverse';

const docJson = ydoc.toJSON();
// { task: { id: "task-3", title: "Build API", dependencies: ["task-1"] },
//   discussion: [{ id: "block-1", content: "Should use REST" }] }

// Walk every node — like @babel/traverse but for CRDT data
traverse(docJson).forEach(function (value) {
  // this.key    = current key ("id", "title", "dependencies")
  // this.path   = full path ["task", "dependencies", 0]
  // this.parent = parent node
  // this.level  = depth in tree

  // Find all entity references (task IDs, decision keys)
  if (this.key === 'dependencies' && Array.isArray(value)) {
    for (const dep of value) {
      addReference(dep, { docName, blockPath: this.path.join('.'), kind: "depends-on" });
    }
  }

  // Find all ID fields → register as entities
  if (this.key === 'id' && typeof value === 'string') {
    entities.set(value, {
      docName, blockPath: this.path.join('.'), kind: inferKind(this.parent)
    });
  }
});
```

This is the **closest thing to an AST walker for CRDT**. It doesn't know about Y.js, but `toJSON()` gives it a plain tree to walk.

### Why Layer 3 Needs ~650 Lines of Custom Code

| Component | Lines | Why no package exists |
|-----------|-------|---------------------|
| `EntityIndex` | ~200 | Entity indexing over CRDT is our invention — nobody has multiple AI agents navigating team decisions via CRDT |
| `BacklinkIndex` | ~200 | Cross-doc reference tracking in CRDT. AFFiNE built this in Rust (OctoBase), but it's not a reusable npm package |
| `ChangeAttribution` | ~50 | Map Y.js `clientID` to `agentRole` at write time via `transact(fn, origin)`. Y.js tracks edits but not who made them in our terms |
| `ConsistencyChecker` | ~100 | Detect orphaned refs, contradictory decisions, stale conventions. Domain-specific — no generic package possible |
| `HumanReadableDiff` | ~100 | Y.js has binary `diffUpdate` but no "what changed in English" — domain-specific summarization |

### The Key Insight

For **code navigation**, 20 years of tooling means agents plug in LSP/tree-sitter/ripgrep and get everything for free.

For **CRDT team memory navigation**, we're building a new category. Nine packages give us most of what we need. ~250 lines of custom code fills the last gap. That's the investment to make CRDT as navigable for agents as a codebase is with LSP.

The difference: code LSP is **deterministic** (grammars make everything exact). CRDT entity navigation is **heuristic** (natural language means some fuzziness). But agents don't need 100% precision — "here are the 5 docs that reference this decision" at 90% accuracy is infinitely better than "search 47 docs yourself" at 0%.

---

## Complete Package Toolkit: 9 Packages + 250 Lines Custom

### How Each Package Eliminates Custom Code

Originally estimated ~650 lines custom. After research, 9 battle-tested packages reduce this to ~250 lines:

| Package | Stars / Weekly Downloads | License | What it gives us | Custom code eliminated |
|---------|--------------------------|---------|------------------|-----------------------|
| **[@orama/orama](https://github.com/oramasearch/orama)** | 10.3k / 527K | Apache-2.0 | Full-text + vector + hybrid search. One index for keyword AND semantic search | ~200 lines (search index + vector store) |
| **[jsondiffpatch](https://github.com/benjamine/jsondiffpatch)** | 5.3k / 10.6M | MIT | Deep diff two `doc.toJSON()` snapshots → human-readable delta, visual HTML, reverse/unpatch, JSON Patch RFC 6902 | ~100 lines (HumanReadableDiff) |
| **[traverse](https://www.npmjs.com/package/traverse)** | 1.7k / 61M | MIT | Walk every node in `doc.toJSON()` with path/parent/level — our AST walker | ~80 lines (tree walker) |
| **[toposort](https://www.npmjs.com/package/toposort)** | 567 deps / 10.6M | MIT | Topological sort on DAGs. Task dependency edges → execution order, cycle detection, critical path | ~50 lines (dependency ordering) |
| **[micromatch](https://github.com/micromatch/micromatch)** | 4.8k / 144M | MIT | Glob pattern matching on doc name strings | ~20 lines (glob filter) |
| **[jsonpath-plus](https://github.com/s3u/JSONPath)** | 2k / 10M | MIT | JSONPath queries on `doc.toJSON()` — structured queries on live CRDT state | ~50 lines (structured query engine) |
| **[deep-object-diff](https://www.npmjs.com/package/deep-object-diff)** | 597 deps / 14M | MIT | `diff(a, b)` → only changed paths. Lightweight "what changed" detection | ~40 lines (change detection) |
| **[y-utility](https://www.npmjs.com/package/y-utility)** | by Y.js author / 36K | MIT | `YKeyValue` (efficient key-value on Y.Array), `YMultiDocUndoManager` (undo across subdocs) | ~80 lines (multi-doc undo) |
| **[@hocuspocus/transformer](https://www.npmjs.com/package/@hocuspocus/transformer)** | 150K | MIT | Y.Doc ↔ Tiptap JSON ↔ HTML. Extract readable content from CRDT rich text | ~60 lines (content extraction) |

### What Remains Custom (~250 lines)

| Component | Lines | Why no package exists |
|-----------|-------|---------------------|
| `EntityIndex` | ~120 | Domain-specific: what counts as an "entity" in our schema (task, decision, convention) and how to extract them from Y.Doc shared types |
| `BacklinkIndex` | ~100 | Domain-specific: how entities reference each other. Explicit refs (task deps) + text mention scanning |
| `ChangeAttribution` | ~30 | Map Y.js `clientID` → `agentRole` at write time. Trivial but unique to our agent system |

### How All 9 Packages Work Together

```typescript
import { create, insert, search } from '@orama/orama';
import micromatch from 'micromatch';
import { JSONPath } from 'jsonpath-plus';
import traverse from 'traverse';
import * as jsondiffpatch from 'jsondiffpatch';
import toposort from 'toposort';
import { diff as deepDiff } from 'deep-object-diff';

// ── GLOB: list docs matching pattern ──
const taskDocs = micromatch(allDocNames, "**/task");
// → ["goal-001/task-003/task", "goal-001/task-007/task"]

// ── SEARCH: keyword search across all CRDT docs ──
const results = await search(oramaDb, { term: "PostgreSQL" });
// → [{ docName: "team-memory/decisions", score: 0.92, content: "Use PostgreSQL..." }]

// ── STRUCTURED QUERY: JSONPath on live CRDT ──
const readyTasks = JSONPath({
  path: '$.task[?(@.status=="ready")]',
  json: doc.toJSON()
});

// ── AST WALK: find all entity references in a doc ──
traverse(doc.toJSON()).forEach(function(val) {
  if (this.key === 'dependencies') addReferences(val, this.path);
  if (this.key === 'id') entities.set(val, { docName, path: this.path });
});

// ── DIFF: human-readable "what changed" ──
const delta = jsondiffpatch.diff(oldSnapshot, newSnapshot);
const html = htmlFormatter.format(delta, oldSnapshot); // visual diff!
// → "<div class='jsondiffpatch-delta'>status: 'ready' → 'completed'</div>"

// ── CHANGE DETECTION: lightweight check ──
const changes = deepDiff(oldSnapshot, newSnapshot);
// → { "task.status": "completed", "task.output": "Built 12 tables" }

// ── TASK ORDERING: topological sort of dependency DAG ──
const edges = tasks.flatMap(t => t.dependencies.map(dep => [dep, t.id]));
const executionOrder = toposort(edges).reverse();
// → ["task-1", "task-3", "task-7"] — throws if cycles detected
```

---

## Final Gap Analysis: What's Still Missing to Match File Experience

Everything above covers search, navigation, and diffing. But comparing the full file experience agents have today with what CRDT will offer, there are a few remaining gaps:

### Still Missing (Not Covered by Any Package)

| Gap | File equivalent | Why it matters | Effort | Solution |
|-----|----------------|----------------|--------|----------|
| **Snapshot/versioning** | `git stash`, `git tag` | Agent can't "save checkpoint" of CRDT state before risky change | ~30 lines | `Y.snapshot(doc)` exists but no tool exposes it. Wrap in `l2_snapshot` tool |
| **Rollback** | `git checkout -- file` | Agent can't revert a CRDT doc to previous state | ~50 lines | `Y.applySnapshot()` + `Y.UndoManager` (see crdt-undo-rollback feature) |
| **Permissions check** | `fs.access()` | Agent can't ask "can I write to this doc?" before trying | ~10 lines | Query room ACL from entity index metadata |
| **Copy/clone doc** | `cp file1 file2` | Agent can't duplicate a CRDT doc | ~20 lines | `Y.encodeStateAsUpdate(doc)` → `Y.applyUpdate(newDoc, update)` |
| **Watch specific doc** | `fs.watch(file)` | Agent can't subscribe to changes on one doc and get notified | ~30 lines | Hocuspocus `observeDeep` per doc + callback to agent |
| **Batch operations** | Shell scripts | Agent can't "update all tasks with status=pending to status=cancelled" in one call | ~40 lines | Combine JSONPath query + write in a batch tool |
| **Export to file** | Already a file | Agent can't save CRDT content as a workspace file for git tracking | ~20 lines | `doc.toJSON()` → `workspace_write_file()` (bridge L1↔L2) |
| **Import from file** | Already in CRDT | Agent can't load a JSON/markdown file into a CRDT doc | ~30 lines | `workspace_read_file()` → parse → `doc.getMap().set()` |

### The Complete Parity Checklist

| Capability | Files (L1) | CRDT (L2) after packages | Status |
|-----------|-----------|--------------------------|--------|
| Read file / doc | ✅ `workspace_read_file` | ✅ `collab read` | ✅ Done |
| Read specific line / block | ✅ Read with range | ✅ `doc.getMap(x).get(key)` | ✅ Done |
| Write file / doc | ✅ `workspace_write_file` | ✅ `collab write` | ✅ Done |
| Create file / doc | ✅ `workspace_create_file` | ✅ `collab write` (auto-creates) | ✅ Done |
| Delete file / entry | ✅ `workspace_delete_file` | ⚠️ Y.js supports it, no tool | 🔨 ~10 lines |
| List with glob | ✅ `workspace_glob` | ✅ `micromatch(docNames, pattern)` | 📦 Package |
| Grep (regex search) | ✅ `workspace_grep` | ✅ Regex on Orama indexed text | 📦 Package |
| Keyword search | ✅ `keyword_search` | ✅ `orama.search({ term })` | 📦 Package |
| Semantic search | ❌ Not built | ✅ `orama.search({ mode: "hybrid" })` | 📦 Package |
| Structured query | ❌ Parse JSON manually | ✅ `JSONPath({path, json})` | 📦 Package |
| Go to definition | ✅ `find_symbol` (code only) | ✅ EntityIndex lookup | 🔨 ~120 lines |
| Find references | ❌ Not built | ✅ BacklinkIndex lookup | 🔨 ~100 lines |
| Symbol tree / outline | ✅ `get_symbols`, `get_file_summary` | ✅ `traverse(doc.toJSON())` | 📦 Package |
| Repo / doc overview | ✅ `get_repo_map` | ✅ Orama faceted search by scope | 📦 Package |
| File / doc diff | ❌ Not built (git diff exists) | ✅ `jsondiffpatch.diff(old, new)` | 📦 Package |
| Change detection | ❌ File watcher (binary) | ✅ `deepDiff(old, new)` → changed paths | 📦 Package |
| Dependency ordering | ❌ Not built | ✅ `toposort(edges)` | 📦 Package |
| File stats / metadata | ✅ `workspace_file_stats` | ⚠️ Y.js has size info, no tool | 🔨 ~20 lines |
| Search & replace | ✅ `workspace_search_and_replace` | ⚠️ Possible, no tool | 🔨 ~40 lines |
| Git commit / auto-sync | ✅ `workspace_commit` | ✅ CRDT auto-syncs (better!) | ✅ Done |
| Git history / changelog | ✅ `workspace_get_history` | ⚠️ Track timestamps on onChange | 🔨 ~30 lines |
| Undo / redo | ❌ Not built | ✅ `y-utility` YMultiDocUndoManager | 📦 Package |
| Content extraction | N/A (files are text) | ✅ `@hocuspocus/transformer` Y.Doc→HTML/JSON | 📦 Package |
| Scratchpad / personal space | ✅ `scratch_note`, `scratch_todo` | ⚠️ Agent room concept, not built | Room feature |
| Discussions | ❌ Nothing | ✅ `collab discuss` (better!) | ✅ Done |
| Real-time co-editing | ❌ Git conflicts | ✅ CRDT auto-merge (better!) | ✅ Done |
| Export CRDT → file | N/A | ⚠️ Bridge L1↔L2 | 🔨 ~20 lines |
| Import file → CRDT | N/A | ⚠️ Bridge L1↔L2 | 🔨 ~30 lines |

### Summary

| Category | Status |
|----------|--------|
| ✅ Done (already built) | 7 capabilities |
| 📦 Package (plug in, no custom code) | 12 capabilities |
| 🔨 Small custom (10-120 lines each) | 10 capabilities |
| **Total capabilities** | **29** |
| **Total custom code needed** | **~450 lines** (250 for entity/backlink index + 200 for small tools) |

**After plugging in 9 packages and writing ~450 lines of custom code, CRDT reaches full parity with the file experience AND adds 4 exclusive advantages** (real-time co-editing, auto-sync, structured queries, discussions) that files fundamentally can't match.

---

## Use Cases: What Problems Do These Tools Actually Solve for Agents?

### The 8 Core Agent Use Cases

Every tool Claude Code / Copilot / Cursor uses exists to solve a specific **agent workflow problem**. Here's each use case, how files solve it (with LSP/AST), how our CRDT solves it, and whether ours is better or worse:

---

#### UC1: "I need to understand the current state"

**Agent scenario:** Backend-dev agent gets assigned a task. First thing it does: understand what exists, what's been decided, what's in progress.

| | Files (LSP/AST) | CRDT (our solution) | Better/Worse |
|-|-----------------|---------------------|-------------|
| **How** | `get_repo_map` → compressed codebase overview. `get_symbols` → outline of each file. `workspace_grep` → find relevant patterns | `l2_navigate({ action: "outline" })` → scope tree. `orama.search()` → keyword search. `JSONPath` → query task statuses | **CRDT is better** — structured data means "show me all ready tasks" is a query, not a grep |
| **Speed** | ~50-200ms (read files, parse ASTs) | ~1-5ms (in-memory toJSON + index lookup) | **CRDT 10-100x faster** |
| **At scale** | Repo grows → slower scans, bigger ASTs | More docs → bigger Orama index, still in-memory | ✅ Both scale similarly |

---

#### UC2: "Where was X decided/defined?"

**Agent scenario:** Frontend agent needs to know "what database are we using?" before building API types. Needs to find the decision, not grep for the word "database" in 50 files.

| | Files (LSP/AST) | CRDT (our solution) | Better/Worse |
|-|-----------------|---------------------|-------------|
| **How** | `find_symbol("getUserById")` → exact file:line via LSP symbol table | `l2_navigate({ action: "definition", entity: "db-choice" })` → exact doc:block via EntityIndex | **Equivalent** for structured entities. LSP wins for code symbols, we win for decisions/conventions |
| **Precision** | Exact (type system resolves ambiguity) | Exact for structured data (task IDs, decision keys). 90% for text mentions | **LSP is more precise for code.** Ours is more precise for team knowledge (LSP can't navigate decisions at all) |
| **At scale** | Language server handles millions of symbols | EntityIndex is a Map — O(1) lookup regardless of size | ✅ Both O(1) |

---

#### UC3: "What depends on X / what breaks if I change X?"

**Agent scenario:** Planner wants to change the DB decision from PostgreSQL to MySQL. Needs to know: which tasks already started based on PostgreSQL? Which agents wrote code assuming PG? What's the blast radius?

| | Files (LSP/AST) | CRDT (our solution) | Better/Worse |
|-|-----------------|---------------------|-------------|
| **How** | `find_references("PostgreSQLAdapter")` → LSP reverse index. But only finds **code** references, not decisions/plans/discussions | `l2_navigate({ action: "references", entity: "db-choice" })` → BacklinkIndex. Finds task deps + agent notes + convention mentions | **CRDT is significantly better** — covers code AND non-code references. LSP misses decisions, plans, discussions entirely |
| **Impact analysis** | None built-in. Must manually trace call chains | `l2_navigate({ action: "impact", entity: "db-choice" })` → transitive dependency count via `toposort` | **CRDT is better** — `toposort` gives execution order + cycle detection |
| **At scale** | LSP handles large codebases well | BacklinkIndex + toposort are O(V+E) — linear in edges | ✅ Both scale linearly |

---

#### UC4: "What changed since I last looked?"

**Agent scenario:** Agent was working on task-3, paused, now resumes. Needs to know: "what did other agents change while I was away? Did anyone update the plan? New decisions? Modified tasks I depend on?"

| | Files (LSP/AST) | CRDT (our solution) | Better/Worse |
|-|-----------------|---------------------|-------------|
| **How** | `git log --since="1 hour ago"` → commit messages + diffs | `deepDiff(oldSnapshot, newSnapshot)` → changed paths. `jsondiffpatch.diff()` → human-readable delta with visual HTML | **CRDT is better** — diffs are structured (field-level: "task-3 status changed from ready to completed") not just text patches |
| **Granularity** | Commit-level (may include many unrelated changes) | Field-level (exact key:value changes) | **CRDT is much more granular** |
| **At scale** | Git log works at any repo size | `deepDiff` compares two JSON snapshots — O(n) in doc size | ⚠️ At very large doc sizes (>1MB JSON), deepDiff could slow. Mitigation: diff only changed docs (Hocuspocus `onChange` tells you which docs changed) |

---

#### UC5: "Find something by meaning, not exact text"

**Agent scenario:** Agent needs to find "that thing about rate limiting" but doesn't know the exact words used. Could be "rate limit", "throttling", "request quota", "API limits."

| | Files (LSP/AST) | CRDT (our solution) | Better/Worse |
|-|-----------------|---------------------|-------------|
| **How** | Codebase embedding index → vector similarity search (Cursor/Copilot do this) | `orama.search({ term: "rate limiting", mode: "hybrid" })` → BM25 + vector combined | **Equivalent** — same approach (embed + vector search), same quality |
| **Coverage** | Only code files | Code + decisions + conventions + discussions + agent notes | **CRDT covers more** — searches team knowledge, not just code |
| **At scale** | Embedding index grows with codebase | Orama index grows with CRDT docs. In-memory — may need persistence for very large datasets | ⚠️ At >100K CRDT docs, Orama in-memory usage could be significant (~1-2GB). Mitigation: Orama supports persistence plugin, or switch to MongoDB Atlas Vector Search |

---

#### UC6: "Navigate complex dependency chains"

**Agent scenario:** "task-7 depends on task-3 which depends on task-1 which is blocked. What's the critical path? Are there circular dependencies?"

| | Files (LSP/AST) | CRDT (our solution) | Better/Worse |
|-|-----------------|---------------------|-------------|
| **How** | Not applicable — LSP doesn't handle task dependencies | `toposort(taskEdges)` → execution order. Throws on cycles. Can compute critical path | **CRDT only** — files/LSP have zero concept of task DAGs |
| **At scale** | N/A | toposort is O(V+E) — handles thousands of tasks instantly | ✅ Scales well |

---

#### UC7: "Review/audit what an agent did"

**Agent scenario:** Human or planner wants to review: "What did backend-dev do during goal-001? What decisions were made? What files changed? Were there any mistakes?"

| | Files (LSP/AST) | CRDT (our solution) | Better/Worse |
|-|-----------------|---------------------|-------------|
| **How** | `git log --author="backend-dev"` → commits by agent. `git diff` → code changes | EntityIndex filter by `createdBy: "backend-dev"` → all decisions, task completions, discussion posts. `jsondiffpatch` → what they changed in CRDT docs | **CRDT is much better** — shows decisions, discussions, reasoning, not just code diffs. Full provenance trail |
| **Accountability** | Commit messages (often vague) | Structured: who, when, what entity, what action, in which goal context | **CRDT is more detailed** |
| **At scale** | Git log is fast at any size | EntityIndex filter is O(n) scan. For very large histories, index by `createdBy` | ⚠️ Need secondary index by agent if >10K entities. Easy to add |

---

#### UC8: "Edit multiple related things atomically"

**Agent scenario:** Agent needs to update a decision AND all tasks that reference it AND the convention that derives from it — all as one logical change.

| | Files (LSP/AST) | CRDT (our solution) | Better/Worse |
|-|-----------------|---------------------|-------------|
| **How** | Edit multiple files → `git commit` as atomic unit. LSP rename across files | `ydoc.transact(() => { /* update decision + tasks + convention */ })` → CRDT transaction, all-or-nothing, auto-synced | **CRDT is better** — true atomic transaction across multiple docs. Git commit is post-hoc grouping, not transactional |
| **Undo** | `git revert` (whole commit) | `Y.UndoManager` → undo just this agent's changes, per doc, preserving others | **CRDT is much better** — per-agent undo |
| **At scale** | Git handles large commits fine | Y.js transactions are local, sync happens after. No contention | ✅ CRDT scales better — no lock contention |

---

### Scale Analysis: What Happens with Multiple Users, Teams, Goals, Agents

#### The Scale Dimensions

| Dimension | Small (dev) | Medium (team) | Large (enterprise) |
|-----------|------------|---------------|-------------------|
| Users | 1 | 5-20 | 100+ |
| Teams per user | 1 | 2-5 | 10+ |
| Goals per team (total) | 5 | 50 | 500+ |
| Agents per team | 3-5 | 5-10 | 10-20 |
| CRDT docs total | ~50 | ~1,000 | ~50,000+ |
| Entities in index | ~100 | ~5,000 | ~100,000+ |

#### Component-by-Component Scale Assessment

| Component | Small | Medium | Large | Bottleneck | Mitigation |
|-----------|-------|--------|-------|-----------|-----------|
| **Orama search index** | ✅ Instant (50 docs, <1MB RAM) | ✅ Fast (1K docs, ~10MB RAM) | ⚠️ ~500MB-1GB RAM for 50K docs with embeddings | Memory | Orama `plugin-data-persistence` to offload. Or switch to MongoDB Atlas Vector Search at this scale |
| **EntityIndex** (Map) | ✅ O(1) lookup | ✅ O(1) lookup | ✅ O(1) lookup — Map handles millions of entries | None | None needed |
| **BacklinkIndex** (Map of arrays) | ✅ Instant | ✅ Instant | ⚠️ 100K entities × avg 5 refs = 500K entries. Map still O(1) but memory ~50MB | Memory | Acceptable. Could move to LRU cache if needed |
| **traverse (AST walk)** | ✅ <1ms per doc | ✅ <1ms per doc | ⚠️ Walking 50K docs on startup would take ~50s | Startup time | Only walk on `onChange`, not all at once. Incremental indexing |
| **jsondiffpatch** | ✅ Instant | ✅ <10ms per diff | ⚠️ Docs >1MB JSON take ~100ms to diff | Large doc size | Diff only changed keys (use `deepDiff` first to find changed paths, then `jsondiffpatch` only on those) |
| **toposort** | ✅ Instant | ✅ <1ms for 50 tasks | ✅ <10ms for 500 tasks | None | toposort is O(V+E), handles thousands |
| **Hocuspocus (CRDT server)** | ✅ In-process | ✅ In-process, ~100MB RAM | ⚠️ 50K active docs = ~2-5GB RAM | Memory, connections | Extract to separate service (already designed). Hocuspocus is battle-tested at scale |
| **onChange hooks** | ✅ ~1ms per change | ✅ ~5ms per change (re-index) | ⚠️ High write throughput → many onChange events | CPU | 2s debounce (already planned). Batch re-indexing. Skip unchanged docs |

#### The Real Scale Concerns (Honest)

**Problem 1: Orama memory at 50K+ docs with embeddings**
- Each doc with 1536-dim embedding = ~6KB vectors alone
- 50K docs × 6KB = ~300MB just for vectors
- Plus text index, metadata: ~500MB-1GB total
- **Mitigation:** At this scale, switch Orama to `plugin-data-persistence` (offload to disk) or use MongoDB Atlas Vector Search. This is a config change, not an architecture change

**Problem 2: onChange storm with 20 agents writing simultaneously**
- 20 agents × ~5 writes/second = 100 onChange events/second
- Each triggers: text extraction + Orama upsert + entity index update
- ~5ms per event = 500ms/second of CPU = 50% of one core
- **Mitigation:** Already have 2s debounce. Can batch: collect all changed docNames in a 2s window, re-index in one batch. Reduces 100 events → 1 batch

**Problem 3: EntityIndex text scanning at 100K entities**
- Scanning extracted text for mentions of 100K entity names = O(n×m) per doc change
- At 100K entities, scanning a 10KB text = ~100ms
- **Mitigation:** Only scan for entities that could plausibly appear (same team, same goal). Use Orama search instead of brute-force text scanning — search for entity names as queries, not string.includes()

**Problem 4: Multi-tenant Hocuspocus memory**
- Each Y.Doc in memory: ~10KB-100KB depending on content
- 100 users × 5 teams × 50 docs = 25K docs = ~250MB-2.5GB
- **Mitigation:** Already designed — CRDT Memory Service as separate container. Hocuspocus can lazy-load docs (only keep active docs in memory, persist inactive to MongoDB)

#### Scale Verdict

| Scale | Works? | Notes |
|-------|--------|-------|
| **1 user, 1 team, 5 agents** | ✅ Perfect | Everything in-process, <100MB RAM |
| **5 users, 3 teams, 15 agents** | ✅ Good | In-process still fine, ~500MB RAM |
| **20 users, 10 teams, 50 agents** | ⚠️ Needs tuning | Extract Hocuspocus to service. Debounce onChange. ~2GB RAM |
| **100+ users, 50+ teams, 200+ agents** | ⚠️ Architecture changes needed | MongoDB Atlas for search+vectors. Hocuspocus sharding by team. Entity index in Redis/DB, not in-process Map |

**The architecture is designed to scale gradually.** Small stays simple (in-process). Medium uses the same code but extracts Hocuspocus. Large needs the search backend to move out of memory. The `ICrdtMemoryProvider` interface (embedded vs remote) already handles the Hocuspocus extraction. The Orama → MongoDB Atlas migration is a storage backend swap, not a rewrite.

### Comparison Summary

| Use Case | Files + LSP | CRDT + Our Tooling | Winner |
|----------|-----------|-------------------|--------|
| UC1: Understand current state | Good (AST outline, grep) | **Better** (structured queries, scope tree) | CRDT |
| UC2: Find where X is defined | **Exact** for code symbols | Exact for entities, fuzzy for text | Tie (different domains) |
| UC3: Impact analysis | Code refs only | Code + decisions + tasks + discussions | **CRDT** |
| UC4: What changed | Git log (commit-level) | **Field-level** structured diffs | **CRDT** |
| UC5: Semantic search | Good (embeddings) | **Same** quality, wider coverage | CRDT (covers more) |
| UC6: Dependency chains | Not applicable | **Unique** (toposort, DAG analysis) | CRDT only |
| UC7: Audit agent work | Git log + diffs | **Full provenance** trail | **CRDT** |
| UC8: Atomic multi-edit | Git commit (post-hoc) | **CRDT transaction** (true atomic) | **CRDT** |

**CRDT wins 6/8 use cases, ties 1, and nobody loses.** The one "tie" (UC2: definition lookup) is actually "different domains" — LSP wins for code symbols, CRDT wins for team knowledge. They complement, not compete.

---

## The Symbol Problem: Defining a Grammar for CRDT

### Why Code Symbols "Just Work"

In code, symbols exist automatically because the **language grammar defines them**. Every `function`, `class`, `interface`, `export` becomes a symbol. The parser (TypeScript compiler, tree-sitter) creates them. Nobody manually registers "getUserById is a symbol." It just IS one because it's a function declaration.

```typescript
// Parser reads this code and AUTOMATICALLY creates symbols:
function getUserById(id: string) { }  // → symbol: getUserById, kind: function
class User { }                         // → symbol: User, kind: class
export const API_URL = "..."           // → symbol: API_URL, kind: variable
// Zero developer effort. Symbols emerge from the grammar.
```

### Why CRDT Symbols Don't "Just Work"

CRDT data has no grammar. When an agent writes:

```typescript
doc.getMap("decisions").set("db-choice", { text: "Use PostgreSQL" });
```

Is `"db-choice"` a symbol? Is `"decisions"` a symbol? Is `"PostgreSQL"` a symbol? **Nobody defined this.** Without a definition, nothing is indexable, and agents can't navigate.

### The Solution: `CRDT_SYMBOL_SPEC` — Our Grammar

Just like TypeScript says "every `function` keyword creates a symbol," we need rules that say "every X in CRDT creates a symbol." This is a declarative spec:

```typescript
const CRDT_SYMBOL_SPEC = {
  decision: {
    docPattern: "team-memory/decisions",    // which docs contain these symbols
    symbolSource: "map-keys",               // each Y.Map key is a symbol
    kind: "decision",                       // symbol kind (for filtering)
    extractContent: (key, val) => val.text, // what the symbol "says"
    extractRefs: (key, val) => [],          // what other symbols it references
  },
  task: {
    docPattern: "**/task",
    symbolSource: "map-field",              // the "id" field inside Y.Map("task")
    symbolField: "id",
    kind: "task",
    extractContent: (key, val) => val.title,
    extractRefs: (key, val) => val.dependencies?.map(dep => ({
      targetSymbol: dep, kind: "depends-on"
    })),
  },
  convention: {
    docPattern: "team-memory/conventions",
    symbolSource: "map-keys",
    kind: "convention",
    extractContent: (key, val) => val.text,
  },
  agent: {
    docPattern: "agent:*",
    symbolSource: "doc-name",               // the doc name itself is the symbol
    kind: "agent",
    extractContent: (docName) => docName.split(":")[1],
  },
  // Adding new symbol types = adding a new entry here. No code changes.
};
```

### Key Insight: Orama IS the Symbol Index

Originally we planned three separate components:
- Orama (for search)
- EntityIndex (custom Map for definitions)
- BacklinkIndex (custom Map for references)

**But Orama already does all three.** One Orama instance with a richer schema replaces all custom index code:

```typescript
const symbolIndex = create({
  schema: {
    // IDENTITY (the "symbol")
    entityId: 'string',           // "db-choice", "task-003"
    kind: 'enum',                 // "decision" | "task" | "convention" | "agent"
    docName: 'string',            // "team-memory/decisions"
    blockPath: 'string',          // "decisions.db-choice"

    // CONTENT (searchable)
    content: 'string',            // "Use PostgreSQL for user database"

    // METADATA (filterable)
    createdBy: 'string',          // "planner", "agent:backend-dev"
    createdAt: 'number',          // timestamp
    goalId: 'string',             // "goal-001"

    // REFERENCES (outgoing links to other symbols)
    references: 'string[]',       // ["task-001", "db-choice"]

    // SEMANTIC (vector search)
    embedding: 'vector[1536]',    // for "find things about databases"
  },
});
```

### Every Operation Maps to an Orama Query

| Operation | Before (custom code) | After (Orama query) |
|-----------|---------------------|---------------------|
| **Go to definition** | `entityIndex.get("db-choice")` | `search(index, { where: { entityId: "db-choice" } })` |
| **Find references** | `backlinkIndex.get("db-choice")` → scan | `search(index, { where: { references: { containsAll: ["db-choice"] } } })` |
| **Keyword search** | `orama.search({ term })` | `search(index, { term: "PostgreSQL" })` |
| **Semantic search** | Separate vector store | `search(index, { mode: "hybrid", term: "database choice", vector: { value: embed, property: "embedding" } })` |
| **Filter by kind** | Custom code | `search(index, { where: { kind: "decision" } })` |
| **Filter by agent** | Custom code | `search(index, { where: { createdBy: "agent:backend-dev" } })` |
| **Filter by goal** | Custom code | `search(index, { where: { goalId: "goal-001" } })` |
| **Outline** | Custom tree walk | `search(index, { where: { docName: "team-memory" }, groupBy: { properties: ["kind"] } })` |

### How Extraction Works (the onChange Hook)

```typescript
// On every CRDT doc change, apply the symbol spec to extract and index symbols:
function onCrdtChange(docName: string, ydoc: Y.Doc) {
  for (const [specName, spec] of Object.entries(CRDT_SYMBOL_SPEC)) {
    if (!micromatch.isMatch(docName, spec.docPattern)) continue;

    const json = ydoc.toJSON();
    let symbols = [];

    if (spec.symbolSource === "map-keys") {
      const map = json[specName] || {};
      symbols = Object.entries(map).map(([key, val]) => ({
        entityId: key,
        kind: spec.kind,
        docName,
        blockPath: `${specName}.${key}`,
        content: spec.extractContent(key, val),
        references: spec.extractRefs?.(key, val)?.map(r => r.targetSymbol) ?? [],
        createdBy: val.createdBy ?? val.madeBy ?? "unknown",
        createdAt: Date.parse(val.createdAt ?? val.date) || Date.now(),
      }));
    }

    if (spec.symbolSource === "map-field") {
      const data = json[specName] || json.task || {};
      if (data[spec.symbolField]) {
        symbols = [{
          entityId: data[spec.symbolField],
          kind: spec.kind,
          docName,
          blockPath: `${specName}.${spec.symbolField}`,
          content: spec.extractContent(data[spec.symbolField], data),
          references: spec.extractRefs?.(data[spec.symbolField], data)
            ?.map(r => r.targetSymbol) ?? [],
          createdBy: data.createdBy ?? "planner",
          createdAt: Date.parse(data.createdAt) || Date.now(),
        }];
      }
    }

    // Upsert into Orama — one index for everything
    for (const sym of symbols) {
      orama.update(symbolIndex, sym.entityId, sym);
    }
  }
}
```

### What This Eliminates

| Component | Lines before | Lines after | What happened |
|-----------|-------------|-------------|---------------|
| EntityIndex (custom Map) | ~120 | **0** | Replaced by Orama `where: { entityId }` filter |
| BacklinkIndex (custom Map) | ~100 | **0** | Replaced by Orama `where: { references: { containsAll } }` filter |
| Search index (Orama) | ~30 | ~30 | Same — but now includes entity/ref fields |
| Symbol spec | 0 | ~40 | New — defines what counts as a symbol |
| onChange extraction | ~50 | ~50 | Same — but uses spec instead of ad-hoc if/else |
| ChangeAttribution | ~30 | **0** | `createdBy` is a field in Orama schema |
| **Total custom code** | **~330** | **~120** | **63% reduction** |

### The Parallel to Code Indexing

| | Code | CRDT |
|-|------|------|
| **Grammar** | TypeScript language spec | `CRDT_SYMBOL_SPEC` (~40 lines) |
| **Parser** | TypeScript compiler, tree-sitter | `onChange` extraction loop (~50 lines) |
| **Index** | LSP SymbolInformation[] | Orama with entity schema (~30 lines) |
| **Symbol registration** | Automatic (parser finds every `function`, `class`) | Automatic (extractor finds every map key, task ID based on spec) |
| **Adding new types** | Add grammar to tree-sitter | Add entry to `CRDT_SYMBOL_SPEC` |
| **Developer effort** | Zero — write code, symbols appear | Zero — write to CRDT, symbols appear |

### How Agents Discover Symbols

Three paths (same as how developers find code symbols):

1. **From context** — task descriptions contain entity references (like seeing `getUserById` in code you're reading)
2. **From search** — keyword/semantic search finds symbols by meaning (like grepping when you don't know the function name)
3. **From browsing** — outline/tree shows all symbols in a scope (like VS Code's outline panel)

```typescript
// 1. CONTEXT: Agent reads its task, sees references
task.dependencies = ["task-001", "db-choice"]  // ← symbol names to navigate

// 2. SEARCH: Agent doesn't know the symbol name
search(symbolIndex, { term: "database" })
// → [{ entityId: "db-choice", content: "Use PostgreSQL...", kind: "decision" }]

// 3. BROWSE: Agent lists what exists
search(symbolIndex, { where: { kind: "decision" }, limit: 100 })
// → all decisions, browseable
```

---

## What Counts as an Entity? The Two-Tier Model

### The Problem

In code, the grammar is fixed — `function`, `class`, `const` are keywords. The parser decides what's a symbol. You don't choose.

In CRDT/documents, **everything is text.** "PostgreSQL" could be an entity or just a word. "Use REST" could be a decision or a passing comment. If you index everything, you get noise. If you index nothing, agents can't navigate.

### How the Industry Solves This

| System | What's an entity | What's searchable text | How entities are defined |
|--------|-----------------|----------------------|------------------------|
| **Code (LSP)** | `function`, `class`, `interface`, `export` | Everything inside function bodies, comments | Language grammar (automatic) |
| **Notion** | Pages, database rows, properties | Body text of pages | User creates pages/databases (explicit structure) |
| **Obsidian** | Anything inside `[[wikilinks]]` | Everything else | User wraps text in `[[...]]` (explicit marking) |
| **Google Docs** | Nothing — no entities | Everything | No entities, just full-text search |
| **CrewAI Memory** | Each `remember()` call = one record | Content within records | Each API call creates a record (explicit) |

### Our Answer: Structure IS the Grammar

Our CRDT already HAS structure. Y.Map keys, task IDs, and doc names are **structural landmarks** — like `function` keywords in code. We don't need users to manually mark entities (Obsidian) or create databases (Notion). The structure defines what's an entity automatically.

### Tier 1: Entities (Structural Landmarks — Navigable)

These are **automatically** extracted because they come from known CRDT structure:

| Is it an entity? | Rule | Example | Code parallel |
|-------------------|------|---------|--------------|
| ✅ Y.Map key in known doc | Map key = named slot | `decisions.db-choice`, `conventions.api-prefix` | `function getUserById` — function keyword creates symbol |
| ✅ `id` field in known schema | ID = unique identifier | `task-003`, `goal-001`, `plan-001` | `class User` — class keyword creates symbol |
| ✅ Doc name | Doc = page | `team-memory/decisions`, `goal-001/task-003/task` | File path `src/api/auth.ts` |
| ✅ Array item with `id` field | Block = addressable unit | Discussion `block-003` | Code block at `file:line` |
| ❌ Text inside entity content | Content = body text | "Use PostgreSQL because..." | Function body `{ return db.query(...) }` |
| ❌ Arbitrary word in text | Just a word | "the", "because", "PostgreSQL" | Comment text, string literals |

**"PostgreSQL" is NOT an entity.** `"db-choice"` (the map key) is. "PostgreSQL" is a word inside the entity's content that helps agents FIND the entity via search.

### Tier 2: Searchable Content (Helps Find Entities)

Everything inside entity content is full-text indexed in Orama. Not as entities — as text that helps agents **discover** entities:

```
Agent wants: "What about the database?"
Agent doesn't know entity name "db-choice"

Step 1: Search content → "PostgreSQL" matches in entity "db-choice"
Step 2: Now agent has the entity → can navigate to it, find references, see dependencies

"PostgreSQL" was the search term. "db-choice" was the entity found.
Like grepping for "user" to find function "getUserById" — you search content to find symbols.
```

### The Orama Schema Reflects This

```typescript
const symbolIndex = create({
  schema: {
    // ── TIER 1: Entity identity (navigable symbols) ──
    entityId: 'string',        // "db-choice" — THE symbol
    kind: 'enum',              // decision | task | convention | goal | agent
    docName: 'string',         // where it lives
    blockPath: 'string',       // exact location within doc
    references: 'string[]',    // links to other entities

    // ── TIER 2: Searchable content (helps find entities) ──
    content: 'string',         // "Use PostgreSQL because..." — full text, BM25 indexed
    title: 'string',           // "Database choice" — short label
    embedding: 'vector[1536]', // semantic search vector

    // ── Metadata (filterable) ──
    createdBy: 'string',
    createdAt: 'number',
    goalId: 'string',
  },
});

// SEARCH hits Tier 2 (content) → returns Tier 1 (entity)
search(symbolIndex, { term: "PostgreSQL" })
// → [{ entityId: "db-choice", kind: "decision", content: "Use PostgreSQL..." }]
//         ^^^^^^^^^^^^^^^^^^
//         This is the entity. "PostgreSQL" was just the search term.
```

### The Parallel

```
CODE:
  function getUserById() { return db.query("SELECT * FROM users WHERE id = ?") }
  ^^^^^^^^ ^^^^^^^^^^^    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
  keyword  ENTITY (Tier 1)            CONTENT (Tier 2, searchable)

CRDT:
  decisions.set("db-choice", { text: "Use PostgreSQL because it handles concurrent..." })
                 ^^^^^^^^^    ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                 MAP KEY       CONTENT (Tier 2, searchable)
                 ENTITY (Tier 1)
```

In both cases: the structural marker (keyword / map key) creates the entity. The content inside is searchable text that helps you find the entity. The entity is what you navigate to, get references for, track dependencies of.

---

## Symbol Resolution: How `symbol → doc:block` Actually Works

### The Core Pattern (Identical to LSP)

LSP and our CRDT index follow the **exact same pattern**: pre-built index, O(1) lookup, direct address resolution.

```
LSP:   symbol → pre-built index → file:line:column → read content
CRDT:  symbol → pre-built index → doc:block         → read content
```

### The Three Paths (Same in Both Systems)

**Path 1: Direct Lookup (agent already knows the symbol)**

```
Code:  Agent sees "getUserById" in code it's reading
       → LSP symbolTable["getUserById"]
       → src/api.ts:42:5
       → O(1), instant, no searching

CRDT:  Agent sees "db-choice" in its task dependencies
       → Orama filter: { where: { entityId: "db-choice" } }
       → team-memory/decisions:decisions.db-choice
       → O(1), instant, no searching
```

**Path 2: Search → Then Lookup (agent doesn't know the symbol name)**

```
Code:  Agent wants "something about database"
       → grep "database" across files
       → finds "PostgreSQLAdapter" at src/db.ts:10
       → NOW has the symbol, can navigate

CRDT:  Agent wants "something about database"
       → orama.search({ term: "database" })
       → finds entity "db-choice" with content "Use PostgreSQL..."
       → NOW has the symbol, can navigate
```

**Path 3: Browse → Then Lookup (agent explores what exists)**

```
Code:  Agent wants to see what's in a file
       → get_symbols("src/api.ts")
       → [getUserById, createUser, deleteUser, ...]
       → picks one to navigate to

CRDT:  Agent wants to see what decisions exist
       → orama.search({ where: { kind: "decision" } })
       → [db-choice, api-framework, auth-method, ...]
       → picks one to navigate to
```

### Address Format and Resolution

```
LSP address:    file : line : column
                src/api.ts : 42 : 5

CRDT address:   doc : block
                team-memory/decisions : decisions.db-choice
```

Resolving the address to content:

```typescript
// LSP: read file, go to line
const content = fs.readFileSync("src/api.ts");
const line = content.split('\n')[41]; // line 42

// CRDT: get doc, get block — no file I/O
const doc = hocuspocus.getDoc("team-memory/decisions");
const value = doc.getMap("decisions").get("db-choice");
// → { text: "Use PostgreSQL", madeBy: "planner", date: "2026-04-27" }
```

### Why CRDT Lookup Is Faster

| Step | LSP (files) | CRDT (in-memory) |
|------|------------|-------------------|
| Index lookup | O(1) Map/hash | O(1) Orama indexed filter |
| Address resolution | `fs.readFile()` → disk I/O ~1-5ms | `map.get(key)` → in-memory ~0.01ms |
| **Total** | **~2-6ms** | **~0.02-1ms** |

Both are fast. CRDT is faster because there's no disk I/O — the data is already in memory.

### Pre-Built Index: When It Gets Populated

| | LSP | CRDT |
|-|-----|------|
| **Trigger** | File saved / edited | CRDT doc changed (Hocuspocus `onChange`) |
| **What happens** | Parser re-parses file → updates symbol table | Extraction loop reads Y.Doc → upserts Orama entries |
| **Latency** | ~50-500ms (parse entire file) | ~1-5ms (extract from in-memory Y.Doc) |
| **Result** | Symbol → file:line mapping updated | Symbol → doc:block mapping updated |

### Bloat Consideration

Orama index without embeddings:

| Scale | Entities | Index RAM | Acceptable? |
|-------|----------|-----------|-------------|
| 1 user | ~100 | ~70KB | ✅ |
| 5 users | ~5,000 | ~3.5MB | ✅ |
| 20 users | ~50,000 | ~35MB | ✅ |
| 100 users | ~500,000 | ~350MB | ⚠️ Move to MongoDB Atlas |

Start without embeddings (keyword search only). Add vector field when semantic search is needed. Content text (~500 bytes/entity) is worth keeping — it's what makes keyword search work.

### Auto-Generating Symbol Spec from Zod Schemas

We already have Zod schemas for tasks, goals, plans. The symbol spec can be **derived** from them (~30 lines):

```typescript
function zodToSymbolSpec(schema: ZodObject, docPattern: string) {
  const fields = schema.shape;
  return {
    docPattern,
    symbolField: findField(fields, 'id'),                          // id → entity
    contentFields: findStringFields(fields, ['title', 'body', 'text', 'content']), // text → searchable
    referenceFields: findArrayFields(fields, ['dependencies', 'references']),       // arrays → refs
    filterFields: findEnumFields(fields, ['status', 'kind', 'type', 'role']),       // enums → filterable
  };
}
```

No manual spec maintenance — schemas change, symbol spec updates automatically.