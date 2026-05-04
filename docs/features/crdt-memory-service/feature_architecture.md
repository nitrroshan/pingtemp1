# CRDT Memory Service (Multi-Tenant) — Architecture

**Date:** April 27, 2026  
**Status:** Research complete, ready for implementation planning  
**Priority:** P2 — Required for multi-user deployment  
**Research:** [crdt-team-memory/research.md](../crdt-team-memory/research.md)  
**Depends on:** `crdt-search`, `crdt-symbol-index` (search must work before rooms matter)

---

## Problem

Hocuspocus runs in-process inside the backend. This means:
1. Each backend instance has its own isolated CRDT state — no sharing between users
2. No authentication — any connected client can read/write any doc
3. No access control — agents, frontends, and system config all in the same space
4. No multi-tenancy — N users = N Hocuspocus instances with zero shared state

## Architecture

Extract Hocuspocus into a standalone service with rooms, JWT auth, and per-room ACL. Following industry patterns from Liveblocks (rooms + orgs + permissions) and Y-Sweet (token-based access).

### Deployment Modes

```
CRDT_MODE=embedded (dev, single user)
  → Hocuspocus in-process, no auth, zero config
  → Same as today

CRDT_MODE=service (production, multi-user)
  → Separate container with Room Manager + Identity + ACL
  → Backends connect via WebSocket
  → Frontend connects directly with user JWT
```

### Room Types

```
{orgId}/team-memory          — Persistent team knowledge (cross-goal)
{orgId}/agent:{role}         — Agent personal room
{orgId}/goal:{goalId}        — Goal-scoped work (existing pattern)
{orgId}/_system              — System config (agents-only, hidden from frontend)
```

Where `orgId = {userId}/{teamId}` — tenant isolation.

### Permission Model (Liveblocks Pattern)

| Room | Default | Agent (self) | Agent (other) | Frontend |
|------|---------|-------------|---------------|----------|
| team-memory | read | write | write | read |
| agent:{role} | private | write | read | read |
| goal:{goalId} | write | write | write | write |
| _system | private | read | read | denied |

### Identity

```typescript
// Agent registration (on worker creation):
const agentToken = await crdtService.identifyAgent({
  agentId: `${teamId}:${role}`,
  organizationId: `${userId}/${teamId}`,
  role, groups: ["team-agents"],
});

// Human auth (on frontend connect):
const userToken = await crdtService.identifyUser({
  userId, organizationId: `${userId}/${teamId}`,
});
```

### Provider Interface

```typescript
interface ICrdtMemoryProvider {
  identifyAgent(opts: AgentIdentity): Promise<AgentToken>;
  identifyUser(opts: UserIdentity): Promise<UserToken>;
  openDoc(roomId: string, docPath: string): Promise<Y.Doc>;
  createRoom(roomId: string, opts: RoomOptions): Promise<Room>;
}

class EmbeddedCrdtProvider implements ICrdtMemoryProvider { } // dev
class RemoteCrdtProvider implements ICrdtMemoryProvider { }   // production
```

### What Already Exists (Reusable)

| Component | Exists? | Reuse |
|-----------|---------|-------|
| `ICollabProvider` interface | ✅ | Embedded/Remote pattern already built |
| `RemoteCollabClient` (WebSocket) | ✅ | Takes `token` param already |
| `L2CollaborationPlugin` | ✅ | Already switches embedded/remote |
| `standalone.ts` | ✅ | Entry point for separate service |
| `BlobStorageProvider` interface | ✅ | Swap fs for S3/MongoDB |

### Scale Analysis

| Scale | RAM | Status |
|-------|-----|--------|
| 1 user, 5 agents | ~100MB | ✅ In-process |
| 5 users, 15 agents | ~500MB | ✅ In-process |
| 20 users, 50 agents | ~2GB | ⚠️ Extract to service |
| 100+ users | ~5GB+ | ⚠️ Hocuspocus sharding by team |

### Implementation Location

**Package Split: `collab-service` (server) + `collaboration` (client)**

The Hocuspocus server moves to its own package (`packages/collab-service/`). The collaboration package becomes a client-only library. This is a clean separation — server concerns (persistence, auth, search indexing) stay on the service, client concerns (tools, CollaborationSpace, RemoteCollabClient) stay on the library.

```
packages/collab-service/                    ← NEW PACKAGE (the Hocuspocus service)
  src/
    server/
      HocuspocusServer.ts                   — MOVED from collaboration package
      HocuspocusBlobStorageAdapter.ts       — MOVED from collaboration package
    rooms/
      RoomManager.ts                        — NEW: Room CRUD + permissions (~100 lines)
      IdentityService.ts                    — NEW: JWT/agentToken issuance (~80 lines)
      AccessControl.ts                      — NEW: resolveAccess(room, identity) (~60 lines)
    search/
      CrdtSearchExtension.ts               — NEW: Orama index on onChange (from crdt-search feature)
      extractSearchableText.ts              — NEW: Y.Doc → string extraction
    index.ts                                — Service entry point (replaces standalone.ts)
  Dockerfile
  package.json
  tsconfig.json

packages/collaboration/                     ← STAYS (becomes client-only library)
  src/
    L2/
      collaboration/
        CollabDocument.ts                   — STAYS: Y.Doc wrapper
        CollaborationSpace.ts               — STAYS: goal-scoped namespace
        CrdtGoalStore.ts                    — STAYS: goal lifecycle
        CrdtTaskSync.ts                     — STAYS: task persistence
        GroupChatManager.ts                  — STAYS: discussions
        PlanStore.ts                        — STAYS: plan JSON files
        RemoteCollabClient.ts               — STAYS: WebSocket client to collab-service
        types/                              — STAYS: ICollabProvider, BlobStorageProvider interfaces
      L2CollaborationPlugin.ts              — STAYS: embedded/remote switch
      tools/                                — STAYS: collab tool, l2-search tool (future)
    index.ts                                — STAYS: exports
```

**What moves:**
| File | From | To | Why |
|------|------|-----|-----|
| `HocuspocusServer.ts` (502 lines) | `collaboration/` | `collab-service/server/` | Server code belongs on the service |
| `HocuspocusBlobStorageAdapter.ts` (71 lines) | `collaboration/` | `collab-service/server/` | Persistence is a server concern |
| `standalone.ts` (35 lines) | `collaboration/` | `collab-service/index.ts` | Entry point for the service |

**What stays:**
Everything else — `CollabDocument`, `CollaborationSpace`, `RemoteCollabClient`, `CrdtTaskSync`, `CrdtGoalStore`, `PlanStore`, `GroupChatManager`, tools, `L2CollaborationPlugin`.

**What changes in `L2CollaborationPlugin`:**
```typescript
// BEFORE: embedded mode creates CollabServer in-process
import { CollabServer } from "./collaboration/HocuspocusServer.js";

// AFTER: embedded mode imports from collab-service package
import { CollabServer } from "@ping/collab-service";
// OR: for dev, import directly. For production, use RemoteCollabClient.
```

**The `ICollabProvider` interface stays in `collaboration/`** — both `CollabServer` (in collab-service) and `RemoteCollabClient` (in collaboration) implement it. The interface is the contract between client and server.

### Effort

~300 lines new code (rooms, auth, ACL) + file moves. The split itself is ~0 new code — just moving `HocuspocusServer.ts` and `HocuspocusBlobStorageAdapter.ts` to the new package.

### Migration Steps

1. **Create `packages/collab-service/package.json`** — deps: `@hocuspocus/server`, `@hocuspocus/extension-database`, `yjs`
2. **Move 3 files** — HocuspocusServer.ts, HocuspocusBlobStorageAdapter.ts, standalone.ts → collab-service
3. **Update imports** in L2CollaborationPlugin for embedded mode
4. **Add to docker-compose.yml** — new `collab-service` container
5. **Wire `COLLAB_MODE` env var** — `embedded` (import CollabServer from collab-service) vs `external` (use RemoteCollabClient pointing to service URL)

---

## Per-Component Scale Analysis

| Component | 1 user | 5 users | 20 users | 100+ users | Bottleneck | Mitigation |
|-----------|--------|---------|----------|-----------|-----------|-----------|
| **Hocuspocus (CRDT server)** | ✅ In-process ~100MB | ✅ ~500MB | ⚠️ ~2GB | ⚠️ ~5GB+ | Memory, connections | Extract to service, lazy-load docs |
| **Orama (search index)** | ✅ ~70KB | ✅ ~3.5MB | ✅ ~35MB | ⚠️ ~350MB | Memory (if embeddings) | Start without vectors. At 100K+ entities, move to MongoDB Atlas Vector Search |
| **onChange hooks** | ✅ ~1ms | ✅ ~5ms | ⚠️ 100 events/sec at 20 agents | ⚠️ CPU | 2s debounce + batch re-indexing |
| **Y.Doc memory** | ✅ ~10KB/doc | ✅ ~100MB total | ✅ ~1GB | ⚠️ 25K docs × 100KB = 2.5GB | RAM | Lazy-load: only active docs in memory |

### The Real Scale Concerns (Honest)

**Problem 1: onChange storm with 20+ agents writing simultaneously**
- 20 agents × ~5 writes/sec = 100 onChange events/sec
- Each: text extraction + Orama upsert + entity extraction ~5ms
- Solution: 2s debounce. Collect changed docNames in window, batch re-index once

**Problem 2: Multi-tenant Hocuspocus memory**
- 100 users × 5 teams × 50 docs = 25K docs
- Solution: Hocuspocus lazy-loads docs. Only active docs in RAM. Inactive persisted to MongoDB

**Problem 3: Orama at 500K entities with embeddings**
- ~3.5GB for vectors alone
- Solution: Don't add embeddings until needed. Keyword search covers 90% of cases. When semantic search is needed at scale, swap to MongoDB Atlas Vector Search (config change via `ICrdtMemoryProvider`)

---

## Industry Patterns This Feature Follows

| Pattern | Source | How we use it |
|---------|--------|--------------|
| Rooms + Organizations | Liveblocks | `{userId}/{teamId}/` prefix = tenant isolation |
| JWT for auth | Liveblocks + Y-Sweet | `identifyAgent()` / `identifyUser()` → token |
| Three-level permissions | Liveblocks | `defaultAccesses`, `groupsAccesses`, `usersAccesses` |
| AI agents as first-class users | Liveblocks | Agents get `agentId`, presence, permissions |
| Session backend model | Y-Sweet | Hocuspocus process per active room (future) |
| Embedded / Remote dual mode | Already in codebase | `ICollabProvider` + `RemoteCollabClient` |

---

## Open Questions

1. **Hocuspocus vs Y-Sweet.** Current infra is Hocuspocus (TypeScript, Bun-friendly). Y-Sweet (Rust, S3 persistence) may perform better at scale. The `ICrdtMemoryProvider` interface lets us swap without changing agent tools. Evaluate when hitting 20+ user scale.

2. **Permissions check tool.** Should agents be able to ask "can I write to this doc?" before trying? ~10 lines to add a `permissions` action to the collab tool that queries room ACL.

3. **Doc watch.** Should agents subscribe to changes on specific docs? Hocuspocus `observeDeep` per doc + callback. ~30 lines. Useful for "notify me when task-003 completes."

---

## Industry Comparison: Nobody Has This Yet

"CRDT memory service for AI agents" doesn't exist as a product. What exists are pieces:

| Company | What they built | What's missing |
|---------|----------------|---------------|
| **Liveblocks** | Rooms + agent presence + JSON Patch + feeds | No persistent memory across rooms. No consolidation. No search. Agents are visitors, not residents |
| **CrewAI** | Memory with scopes, consolidation, recall, scoring | Not CRDT, not real-time, not collaborative. Single-process, LanceDB |
| **LangGraph** | Checkpointer + memory store for graph agents | Not CRDT, not collaborative. Single-agent state |
| **AFFiNE/OctoBase** | CRDT document engine with search | No "memory" concept. Database, not agent memory |

**Our design is the first to combine CRDT collaboration + agent memory + multi-tenancy.**

### What to Steal and How to Integrate

#### 1. JSON Patch (RFC 6902) — From Liveblocks

**What:** Liveblocks lets agents modify CRDT state via `PATCH /rooms/{roomId}/storage/json-patch` using standard RFC 6902 operations. LLMs already understand this format from training data — no special prompting needed.

**Why it helps:** Instead of agents learning our Y.js-specific `collab write` API, they can generate standard JSON Patch operations that any LLM already knows:

```typescript
// Current: agent must learn our custom API
collab({ action: "write", docName: "team-memory/decisions", key: "db-choice", value: { text: "Use PostgreSQL" } })

// With JSON Patch: LLM can generate this natively
l2_patch({ docName: "team-memory/decisions", ops: [
  { op: "add", path: "/decisions/db-choice", value: { text: "Use PostgreSQL", madeBy: "planner" } }
]})
```

**How to integrate:**

```typescript
import * as jsondiffpatch from 'jsondiffpatch';

// In l2_search or collab tool — add "patch" action
async function handlePatch(docName: string, ops: JsonPatchOp[]) {
  const doc = await hocuspocus.getDoc(docName);
  const current = doc.toJSON();
  
  // Apply JSON Patch ops to a clone
  const patched = applyJsonPatch(current, ops);
  
  // Write back to Y.Doc
  doc.transact(() => {
    for (const [key, value] of Object.entries(patched)) {
      doc.getMap(key).set(key, value);
    }
  });
}
```

**Where in code:**
```
packages/collaboration/src/L2/tools/
  index.ts      → add "patch" action to collab tool (~30 lines)
```

**Effort:** ~30 lines. Uses `fast-json-patch` package (MIT, 6M weekly downloads) for RFC 6902 apply.

---

#### 2. extract_memories() — From CrewAI

**What:** CrewAI's `extract_memories(content)` breaks raw task output into atomic facts before storing. Instead of storing "Built 12 database tables, added indexes, fixed migration script, chose PostgreSQL" as one blob, it extracts:

```
→ "Created 12 database tables for user schema"
→ "Added B-tree indexes on email and user_id columns"
→ "Fixed migration rollback script for PostgreSQL 16"
→ "Chose PostgreSQL as the database engine"
```

Each becomes a separate memory record — searchable, consolidatable, individually referenceable.

**Why it helps:** Our `complete_task` tool produces multi-paragraph summaries. Without extraction, the entire summary is one memory blob. With extraction, each fact is findable independently.

**How to integrate:**

```typescript
// In MemoryScope.remember() — add extraction mode
async rememberFromTaskOutput(output: string, opts?: { source?: string; goalId?: string }) {
  // Use LLM to extract atomic facts
  const facts = await this.llm.generate({
    prompt: `Extract discrete, atomic facts from this task output. 
             Return a JSON array of strings, each a single fact:
             
             "${output}"`,
    schema: z.array(z.string()),
  });
  
  // Remember each fact individually (consolidation handles dedup)
  for (const fact of facts) {
    await this.remember(fact, opts);
  }
}
```

**Where in code:**
```
packages/collaboration/src/L2/memory/
  MemoryScope.ts     → add rememberFromTaskOutput() method (~30 lines)

packages/agent-manager/src/agent/internal/tools/
  completeTaskTool.ts → after task completion, call rememberFromTaskOutput(output)
```

**Effort:** ~30 lines in MemoryScope + ~10 lines in completeTaskTool wiring. LLM call cost: ~$0.001 per extraction (gpt-4o-mini).

---

#### 3. Agent Checkpointer — From LangGraph

**What:** LangGraph saves complete agent state at each step — not just memory, but tool call history, reasoning, intermediate results. You can "rewind" to any step and inspect or replay from there.

**Why it helps:** When an agent makes a bad decision at step 5 of 20, you can inspect exactly what it knew at step 5, what tools it called, what results it got, and why it went wrong. Currently we have no step-level debugging.

**How to integrate:**

```typescript
// In WorkerPool — save agent state to CRDT after each tool call
async function* executeWithCheckpoints(agent, task) {
  const checkpointDoc = await space.openDoc(`${task.id}/checkpoints`);
  const checkpoints = checkpointDoc.getArray("steps");
  
  let stepNum = 0;
  for await (const event of agent.execute(task)) {
    if (event.type === "tool_result") {
      stepNum++;
      checkpoints.push([{
        step: stepNum,
        toolName: event.toolName,
        toolInput: event.input,
        toolOutput: event.output,
        timestamp: Date.now(),
        agentRole: agent.role,
        // Snapshot of what agent "knew" at this step
        contextWindow: event.messages?.length ?? 0,
      }]);
    }
    yield event;
  }
}
```

**Where in code:**
```
packages/agent-manager/src/services/WorkerPool.ts
  → wrap agent.execute() with checkpoint recording (~40 lines)

packages/collaboration/src/L2/
  The checkpoint Y.Array lives in goal-scoped CRDT: {goalId}/{taskId}/checkpoints
  Searchable via crdt-search — "what did backend-dev do at step 5?"
  Navigable via crdt-symbol-index — each step is an entity
```

**Effort:** ~40 lines in WorkerPool. Checkpoints are regular CRDT docs — automatically indexed by crdt-search, navigable by crdt-symbol-index, diffable by crdt-diff-versioning.

---

#### 4. Agent Presence with TTL — From Liveblocks

**What:** Liveblocks' agents set presence via HTTP with a TTL that auto-expires. Agent shows up as "reviewing email field..." then disappears when done.

**Why it helps:** Currently we have no way to show what agents are doing in real-time. Presence lets humans and other agents see: "backend-dev is working on task-003", "frontend-dev is idle."

**How to integrate:**

```typescript
// In WorkerPool — set presence on task start, clear on complete
async function executeTask(worker, task) {
  // Set presence — visible to frontend + other agents
  const awarenessState = {
    agentRole: worker.role,
    currentTask: task.id,
    status: "working",
    startedAt: Date.now(),
  };
  hocuspocus.awareness.setLocalState(awarenessState);
  
  try {
    const result = await worker.execute(task);
    hocuspocus.awareness.setLocalState({ ...awarenessState, status: "completed" });
    return result;
  } catch (err) {
    hocuspocus.awareness.setLocalState({ ...awarenessState, status: "failed" });
    throw err;
  } finally {
    // Auto-clear after 5 seconds
    setTimeout(() => hocuspocus.awareness.setLocalState(null), 5000);
  }
}
```

**Where in code:**
```
packages/agent-manager/src/services/WorkerPool.ts
  → set/clear awareness state around task execution (~20 lines)

packages/frontend/
  → useOthers-equivalent to show agent presence in UI (future, crdt-frontend feature)
```

**Effort:** ~20 lines backend. Y.js awareness protocol is built into Hocuspocus already — just unused.

---

### Integration Summary

| Pattern | Source | Effort | Where it goes | What it enables |
|---------|--------|--------|--------------|-----------------|
| JSON Patch | Liveblocks | ~30 lines | collab tool | LLMs generate standard patches, no custom API learning |
| extract_memories | CrewAI | ~40 lines | MemoryScope + completeTaskTool | Atomic facts instead of blobs, better search/consolidation |
| Checkpointer | LangGraph | ~40 lines | WorkerPool | Step-level debugging, "what did agent know at step 5" |
| Agent presence | Liveblocks | ~20 lines | WorkerPool + awareness | Real-time "what is agent doing" visibility |
| **Total** | | **~130 lines** | | |

All four integrate without changing existing architecture — they add to `WorkerPool`, `MemoryScope`, and `collab` tool respectively. Each is independently valuable and can ship separately.
