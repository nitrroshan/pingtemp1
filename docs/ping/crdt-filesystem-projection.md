# CRDT Filesystem Projection — Vision & Research

**Status:** 🔴 Open Problem — Active Research  
**Goal:** Project Y-Sweet CRDT documents as a readable filesystem so L1 tools (read_file, list_dir, grep, keyword_search) work on ALL L2 data — zero new tools needed.

---

## 1. The Problem

### Current State

L2 Team Collaboration data lives in **two fundamentally different storage backends**:

| Data | Storage | Access | L1 Tools Work? |
|------|---------|--------|----------------|
| Output manifests | Git (`.ping/outputs/*.json`) | File read | ✅ Yes |
| Plan state | Filesystem (`data/plans/*.json`) | File read | ✅ Yes |
| Agent statuses | Y-Sweet (`Y.Map`) | HTTP → hydrate → Yjs API | ❌ No |
| Shared context | Y-Sweet (`Y.Map`) | HTTP → hydrate → Yjs API | ❌ No |
| Group chat outcomes | Y-Sweet (`Y.Array`) | HTTP → hydrate → Yjs API | ❌ No |
| Structured documents | Y-Sweet (CRDT doc) | HTTP → hydrate → BlockNote parse | ❌ No |
| Shared binaries | Y-Sweet (`Y.Map<Uint8Array>`) | HTTP → hydrate → Yjs API | ❌ No |

**60% of L2 data is inaccessible to standard file tools.** The Planner (and any agent wanting L2 context) would need separate Y-Sweet-specific tools: `get_collaboration_state()`, `list_chat_outcomes()`, `read_document()`, etc.

### Why This Matters

Workers already have **10 powerful L1 tools** for exploring their workspace:

```
read_file, write_file, list_dir, glob, grep, keyword_search, find_symbol, repo_map, scratchpad_write, commit
```

If Y-Sweet data could appear as **files in a directory**, the Planner gets full L2 exploration using the SAME tools. No new tool code. No new agent schemas. No cognitive load on the LLM learning Y-Sweet-specific APIs.

### The Vision

```
.ping/
  outputs/                          # Already git files ✅
    task-001.json
    task-002.json
  collaboration/                    # ← PROJECTED from Y-Sweet
    shared-context.json             # Y.Map → JSON file
    agent-statuses.json             # Y.Map → JSON file
    chat-outcomes/                  # Y.Array → directory of files
      session-001.json
      session-002.json
    documents/                      # CRDT docs → markdown files
      design-spec.md               # BlockNote → markdown
      api-contract.md
    binaries/                       # Binary metadata (not content)
      diagram.png.meta.json         # { size, createdBy, mimeType }
  plans/                            # Already filesystem ✅
    current-plan.json
    plan-v1.json
```

**Result:** `list_dir(".ping/collaboration/")` → sees everything. `grep("auth", ".ping/")` → searches across ALL L2 data. `read_file(".ping/collaboration/documents/design-spec.md")` → reads CRDT doc as markdown.

---

## 2. The Core Challenge

Y-Sweet stores **opaque binary blobs** (bincode-serialized BTreeMap of CRDT entries). You can't read them as files. To get readable content:

```
Y-Sweet storage (S3/local) → HTTP API (getDocAsUpdate) → Uint8Array → Y.Doc → Yjs API → data
```

This pipeline must run **every time** you want to read the data. The question is: **when and where do we materialize the result as a file?**

### Sub-Problems

1. **Materialization timing** — When do we convert CRDT → file? (On every read? On write? Periodically?)
2. **Staleness** — CRDT docs change in real-time via WebSocket. A materialized file is immediately stale.
3. **Write-back** — If Planner writes to a projected file, how does that propagate back to Y-Sweet?
4. **Consistency** — Two agents read the same projected file at different times, get different content.
5. **Performance** — Hydrating a Y.Doc from HTTP takes ~10-50ms. Acceptable per-read? What about grep across 50 docs?
6. **Binary content** — CRDT docs contain rich blocks (tables, images). Markdown lossy conversion loses structure.
7. **Search** — Can we build a MiniSearch index over projected files? When does it refresh?

---

## 3. Possible Approaches (Research Needed)

### Approach A: Lazy Virtual Filesystem (FUSE-like)

Intercept file operations and hydrate Y-Sweet on-demand. No actual files on disk.

**How it could work:**
- Custom `read_file` / `list_dir` implementations that check if path is under `.ping/collaboration/`
- If yes → hydrate from Y-Sweet, return content
- If no → delegate to real filesystem

**Pros:** Always fresh, no disk usage, no sync job  
**Cons:** Every read is an HTTP call. `grep` across 20 docs = 20 HTTP calls. No standard `fs` APIs.  
**Research:** Can we wrap this transparently so agents don't know the difference?

### Approach B: Periodic Materialization (Snapshot)

Background job writes Y-Sweet content to disk as real files, periodically.

**How it could work:**
- Every N seconds (e.g., 5s), materialize all Y-Sweet docs to `.ping/collaboration/`
- Agents read real files — fast, grepable, indexable
- Staleness = max N seconds

**Pros:** Real files, all tools work natively, fast reads, easy to grep/index  
**Cons:** Stale by up to N seconds. Disk writes. Must handle doc creation/deletion.  
**Research:** Is 5s staleness acceptable for planning? (Planner runs once, not continuously)

### Approach C: On-Demand Materialization (Cache)

Materialize on first access, cache with TTL.

**How it could work:**
- First `read_file(".ping/collaboration/shared-context.json")` → hydrate from Y-Sweet, write to disk, return
- Subsequent reads within TTL → return cached file
- After TTL → re-hydrate

**Pros:** Fresh enough, no background job, only materializes what's actually read  
**Cons:** First read is slow. Cache invalidation complexity. TTL tuning.  
**Research:** What TTL is appropriate? Can we invalidate on Y-Sweet change events?

### Approach D: Write-Through Materialization

Every write to Y-Sweet also writes the projected file. Reads are always disk reads.

**How it could work:**
- `CollaborationSpace.updateAgentStatus()` → writes Y-Sweet AND `.ping/collaboration/agent-statuses.json`
- All reads go to disk
- Since we control ALL write paths (CollaborationSpace API), we intercept at the application layer

**Pros:** Always fresh (at write time), fast reads, no background job  
**Cons:** Only works for writes we control. External Y-Sweet writes (WebSocket from frontend) won't be projected. Dual-write complexity.  
**Research:** Do we ever have writes that bypass CollaborationSpace? (Frontend editing docs via WebSocket = yes)

### Approach E: Hybrid (Write-Through + Periodic Sync for External Writes)

Combine D (write-through for our API) + B (periodic for external/WebSocket writes).

**How it could work:**
- Backend writes via CollaborationSpace → immediate file projection (Approach D)
- Frontend/WebSocket writes → periodic sync catches them (Approach B, 5-10s interval)
- Best of both: controlled writes are instant, uncontrolled writes are near-real-time

**Pros:** Fresh for backend writes, near-fresh for frontend writes  
**Cons:** Most complex. Two mechanisms.  
**Research:** Is frontend editing during planning even a real scenario?

---

## 4. Conversion Formats

How each Y-Sweet data type maps to a file:

| Y-Sweet Type | Projected File | Format | Conversion |
|--------------|---------------|--------|------------|
| `Y.Map` (shared-context) | `shared-context.json` | JSON | `map.toJSON()` |
| `Y.Map` (agent-statuses) | `agent-statuses.json` | JSON | `map.toJSON()` |
| `Y.Array` (chat-outcomes) | `chat-outcomes/session-{id}.json` | JSON per entry | `array.toJSON()` → split by sessionId |
| CRDT doc (BlockNote) | `documents/{title}.md` | Markdown | `yDocToBlocks()` → `blocksToMarkdownLossy()` |
| `Y.Map<Uint8Array>` (binaries) | `binaries/{name}.meta.json` | JSON metadata only | metadata fields, NOT binary content |

### BlockNote → Markdown Concerns

`blocksToMarkdownLossy()` is **lossy** — it drops:
- Table formatting edge cases
- Image sizing/positioning
- Custom block types
- Nested list indentation (sometimes)

**Is this acceptable for Planner?** Planner needs to *understand* the document content, not reproduce it perfectly. Markdown is sufficient for comprehension.

**For Workers who need to edit CRDT docs?** They should use the real CRDT connection, not the projected file. Projection is **read-only** for planning/search.

---

## 5. Key Questions to Resolve

| # | Question | Why It Matters | Current Thinking |
|---|----------|----------------|------------------|
| 1 | Is projection read-only or read-write? | Read-write adds massive complexity (conflict resolution, write-back) | **Read-only for MVP** — Planner reads, Workers use real CRDT for writes |
| 2 | What staleness is acceptable? | Determines approach (A=0ms, B=Ns, C=TTL, D=0ms for our writes) | Planning runs infrequently — **5-10s staleness is fine** |
| 3 | Does frontend edit during planning? | If yes, write-through alone (D) isn't enough | **Unlikely** — planning happens before human interaction |
| 4 | How many Y-Sweet docs per goal? | Affects hydration cost for periodic sync | **3-5 docs** (shared-context, chat-outcomes, 1-3 structured docs) |
| 5 | Can L1 tools be intercepted? | Virtual filesystem (A) needs custom tool implementations | **Yes** — we build the tools, can add routing logic |
| 6 | Should projected files live in git or outside? | Git = versioned but noisy. Outside = no commits needed. | **Outside git** — `.ping/collaboration/` in working dir, gitignored |
| 7 | Can MiniSearch index projected files? | If yes, `keyword_search` works across L2 for free | **Yes** — just add projection dir to MiniSearch file sources |

---

## 6. Recommendation Direction (Tentative)

**For MVP / v1.1:** Approach C (On-Demand Materialization) seems simplest:

1. Planner starts → `createPlannerWorkspace()` materializes all Y-Sweet content to `.ping/collaboration/`
2. Planner explores using L1 tools — everything is real files
3. Planner finishes → materialized files are ephemeral (deleted or left as stale cache)
4. No background job, no write-back, no TTL complexity
5. Staleness is bounded by planning duration (seconds to minutes)

**Call this "snapshot before planning"** — one-time hydration, not continuous sync.

```typescript
// Before invoking PlanBuilder
async function materializeCollaborationState(collabSpace: CollaborationSpace, targetDir: string): Promise<void> {
  // 1. Hydrate Y-Sweet docs via HTTP
  const sharedContext = await collabSpace.getSharedContext();   // Y.Map → JSON
  const agentStatuses = await collabSpace.getAgentStatuses();   // Y.Map → JSON  
  const chatOutcomes = await collabSpace.getGroupChatOutcomes(); // Y.Array → JSON[]
  const documents = await collabSpace.listDocuments();           // doc metadata
  
  // 2. Write as files
  await writeJSON(`${targetDir}/shared-context.json`, sharedContext);
  await writeJSON(`${targetDir}/agent-statuses.json`, agentStatuses);
  for (const outcome of chatOutcomes) {
    await writeJSON(`${targetDir}/chat-outcomes/${outcome.sessionId}.json`, outcome);
  }
  for (const doc of documents) {
    const markdown = await collabSpace.exportDocumentAsMarkdown(doc.id);
    await writeFile(`${targetDir}/documents/${doc.title}.md`, markdown);
  }
  
  // 3. Planner now uses L1 tools on targetDir — no Y-Sweet awareness needed
}
```

**Long-term (v2.0+):** Approach E (Hybrid) for continuous projection when multiple agents need near-real-time L2 file access.

---

## 7. Impact on Architecture

If this works, the architecture simplifies dramatically:

### Before (12 custom L2 tools for Planner)
```
Planner tools: list_outputs, read_output, search_outputs, get_agent_statuses,
               get_shared_context, list_chat_outcomes, read_chat_outcome,
               list_documents, read_document, search_l2, get_plan_history, read_plan
```

### After (L1 tools + materialization step)
```
Planner tools: read_file, list_dir, glob, grep, keyword_search  (SAME as Worker L1 tools)
Pre-step: materializeCollaborationState() → writes .ping/collaboration/ files
```

**12 bespoke tools → 0 new tools + 1 materialization function.**

The Planner is just an agent with L1 workspace tools, pointed at a workspace that includes materialized L2 content. The LLM doesn't need to know about Y-Sweet, CRDTs, or collaboration protocols.

### For Workers

Workers ALSO benefit. Instead of needing separate L2 read tools, they can:
- **Read** L2 data via projected files (same L1 tools)
- **Write** L2 data via CollaborationSpace API + real-time CRDT connection (specialized, but only for writes)

This means Worker L2 tools reduce to **write-only** collaboration tools:
```
update_shared_context(key, value)    # Write to Y-Sweet
edit_document(docId, blocks)          # Edit CRDT doc  
store_binary(name, content)           # Store binary in Y-Sweet
```

Reads are free via L1 tools + projected files.

---

## 8. Research Log

*(Append findings here as we research solutions)*

### Entry 1 — Initial Problem Statement (2026-02-21)
- Problem identified: Y-Sweet data is opaque binary blobs, not files
- 5 approaches documented (A-E)
- Tentative recommendation: Approach C (on-demand materialization before planning)
- Key insight: "snapshot before planning" bounds staleness to planning duration
- Open: Need to validate hydration performance for 3-5 docs (~10-50ms each)

### Entry 2 — Deep Research: Existing Solutions (2026-02-21)

Exhaustive research across the Yjs ecosystem, CRDT databases, virtual filesystem libraries, and the CQRS/materialized-view pattern space. Key findings organized by relevance:

---

#### A. Hocuspocus `onChange` Hook — **APPROACH D VALIDATED IN PRODUCTION** ⭐

Hocuspocus (Yjs collaboration server, MIT, v3.4.4) already implements our Approach D (write-through) via hooks:

```typescript
// From Hocuspocus docs — exact pattern we need
new Hocuspocus({
  async onChange(data) {
    const json = TiptapTransformer.fromYdoc(data.document);
    await writeFile(`/docs/${data.documentName}.json`, JSON.stringify(json));
  }
});
```

Key details:
- `onChange` fires on every document change (debounced, default 2-4s)
- `onStoreDocument` is the recommended persistence hook (also debounced)
- `data.document` is a live Y.Doc instance — call `.toJSON()` or use transformers
- Production-proven by Hocuspocus users for file-based persistence

**Relevance:** This is the EXACT write-through pattern (Approach D). The difference is we use Y-Sweet (no server hooks) instead of Hocuspocus, so we can't intercept at the collaboration server level. We'd need to either: (a) subscribe to Y-Sweet updates client-side, or (b) wrap our CollaborationSpace API writes.

#### B. `@hocuspocus/transformer` — Y.Doc ↔ JSON Conversion

- **npm:** 39,140 weekly downloads, MIT, v3.4.4
- `TiptapTransformer.fromYdoc(ydoc)` → ProseMirror JSON
- `TiptapTransformer.toYdoc(json, 'default', extensions)` → Y.Doc
- Bidirectional conversion for Tiptap/ProseMirror documents
- **Not directly usable** for BlockNote (different block schema), but validates the server-side conversion pattern

#### C. `@blocknote/server-util` — Y.Doc → Markdown ⭐

- **npm:** 14,750 weekly downloads, MPL-2.0, v0.46.2
- `ServerBlockNoteEditor.create()` → `editor.yDocToBlocks(ydoc)` → `editor.blocksToMarkdownLossy(blocks)`
- Lossy conversion drops: table edge cases, image sizing, custom blocks
- **This is our conversion pipeline for CRDT docs → markdown files**
- Confirmed: adequate for Planner comprehension, not for round-trip editing

#### D. Liveblocks Node.js API — Server-Side Yjs Access ⭐

Liveblocks (`@liveblocks/node`) provides exactly the server-side CRDT access pattern we need:

```typescript
// Get Yjs doc as JSON (human-readable)
const json = await liveblocks.getYjsDocument(roomId, { format: true });

// Get as binary update (for Y.applyUpdate)
const binary = await liveblocks.getYjsDocumentAsBinaryUpdate(roomId);

// Send binary update back
await liveblocks.sendYjsBinaryUpdate(roomId, update);

// For Storage (LiveObject, LiveMap, LiveList — their CRDT primitives)
const storage = await liveblocks.getStorageDocument(roomId, 'json');

// Server-side mutation with full CRDT semantics
await liveblocks.mutateStorage(roomId, ({ root }) => {
  root.set("status", "completed");
});
```

**Key insight:** Liveblocks exposes `getYjsDocument()` returning **JSON directly** — no manual Y.Doc hydration needed. Y-Sweet's equivalent is `GET /d/{docId}/as-update` which returns binary requiring `Y.applyUpdate()` + manual JSON extraction. Liveblocks is more ergonomic but we're committed to Y-Sweet (open-source, self-hosted).

**Relevance:** Validates the REST-based server-side CRDT read pattern. Our `materializeCollaborationState()` follows the same pattern but requires the extra hydration step.

#### E. Automerge `automerge-repo-storage-nodefs` — CRDT-to-Filesystem Persistence

- `NodeFSStorageAdapter` class: `load(key) → Uint8Array`, `save(key, binary)`, `loadRange(keyPrefix)`
- Stores **raw CRDT binary** as files on disk — NOT human-readable projections
- In-memory cache + disk persistence layer
- **Different problem:** They store CRDT state for persistence/replication. We need readable content projections.
- **Pattern validated:** CRDT data CAN live as files. The missing step is content extraction before writing.

#### F. `memfs` + `unionfs` — Virtual Filesystem Toolkit ⭐

**memfs** (11.6M weekly downloads, Apache-2.0):
- In-memory filesystem with full Node.js `fs` module API compatibility
- `vol.writeFileSync('/hello.txt', 'world')`, `vol.readFileSync('/hello.txt')`
- Could enable Approach A (virtual FS) without disk I/O

**unionfs** (353K weekly downloads, Unlicense):
- Combines multiple `fs` implementations into one unified view
- `ufs.use(realFs).use(memfsVol)` → reads from whichever has the file
- Works with `memfs`, real `fs`, `memory-fs`, and any `fs`-like object

**Combined pattern for Approach A:**
```typescript
import { ufs } from 'unionfs';
import { Volume } from 'memfs';
import * as fs from 'fs';

const crdtVol = Volume.fromJSON({});
// Populate from Y-Sweet
crdtVol.writeFileSync('/.ping/collaboration/shared-context.json', JSON.stringify(sharedCtx));
crdtVol.writeFileSync('/.ping/collaboration/documents/spec.md', markdown);

// Union: real git workspace + virtual CRDT files
ufs.use(fs).use(crdtVol);
// Now: ufs.readFileSync('/.ping/collaboration/shared-context.json') → works!
// And: ufs.readFileSync('/src/main.ts') → falls through to real fs
```

**Relevance:** Makes Approach A (virtual FS) technically feasible with zero disk I/O. However, L1 tools use real `fs` APIs — we'd need to inject `ufs` as the filesystem module, which may not be transparent enough. Better suited for future exploration.

#### G. Fireproof — CRDT Database (Different Problem Space)

- CRDT-based document database with offline-first sync
- Content-addressed encrypted blobs, prolly trees, Merkle clock
- Exposes document API (`put`, `get`, `query`) — not file projection
- **Not directly useful** for our problem — it's a database, not a CRDT→file bridge
- Interesting: uses CRDTs internally but hides them behind a query API. The opposite of what we want (we want to EXPOSE CRDT data as files).

#### H. CQRS / Materialized View — **CONCEPTUAL FRAMEWORK** ⭐⭐

**Martin Kleppmann, "Turning the Database Inside-Out" (Strange Loop 2014):**

Our CRDT→file projection is a **materialized view** in the classic CQRS sense:
- **Event source** = Y-Sweet CRDT updates (the "log" of mutations)
- **Materialized view** = projected files in `.ping/collaboration/`
- **View is disposable** — can be fully rebuilt from the source CRDTs at any time
- **View is read-only** — writes go through the real CRDT API

Key Kleppmann insights that apply directly:
1. "A materialized view is a cached subset of the log" → our projected files are a cached, human-readable subset of Y-Sweet state
2. "Build the view from a consistent snapshot, track changes since" → our "snapshot before planning" pattern
3. "Secondary indexes and caches are not fundamentally different" → our MiniSearch index over projected files IS a secondary index of CRDT data
4. "The view doesn't add new information — it represents existing data in a different structure" → Markdown files represent the same content as Y.Doc blocks

**Microsoft Materialized View pattern confirms:**
- "A materialized view is completely disposable — can be rebuilt from source data stores"
- "A materialized view is never updated directly by an application — it's a specialized cache"
- Update strategies: event-driven (on change), scheduled, or manual trigger
- Directly maps to our Approaches: D (event-driven), B (scheduled), C (manual trigger)

---

### Entry 3 — Revised Analysis (2026-02-21)

Based on research, our 5 approaches map to established patterns:

| Approach | Pattern | Existing Implementation | Feasibility |
|----------|---------|------------------------|-------------|
| A: Lazy Virtual FS | CQRS read-through | `memfs` + `unionfs` | Medium — requires fs injection |
| B: Periodic Snapshot | Scheduled materialized view | Database REFRESH MATERIALIZED VIEW | High — simple cron |
| C: On-Demand Cache | Manual trigger materialized view | — | **High — simplest for MVP** |
| D: Write-Through | Event-driven materialized view | Hocuspocus `onChange` hook | High — but can't intercept Y-Sweet server |
| E: Hybrid D+B | Multi-strategy materialized view | — | Medium — most complex |

**Key finding:** Approach C (our tentative recommendation) is the "manually triggered materialized view" pattern — thoroughly validated in database literature. Approach D is the gold standard but requires server-side hooks we don't have with Y-Sweet (Hocuspocus has them, Y-Sweet doesn't).

**Revised recommendation:** Keep Approach C for v1.1 MVP. The research strongly validates it. For v2.0, consider migrating collaboration server from Y-Sweet SDK-only to Y-Sweet + a thin Hocuspocus-like hook layer that projects on write.

**No existing turnkey solution found.** The specific combination of Y-Sweet + file projection doesn't exist as a library. But the component parts are all available:
- Y-Sweet HTTP API → `Uint8Array` → `Y.applyUpdate()` (**Y-Sweet SDK**)
- `Y.Map.toJSON()`, `Y.Array.toJSON()` (**yjs**)
- `yDocToBlocks()` → `blocksToMarkdownLossy()` (**@blocknote/server-util**)
- File writing (**Node.js fs or memfs**)

Our `materializeCollaborationState()` function is ~50 lines that orchestrates these existing components. No novel engineering required — just composition.

### Entry 4 — Hocuspocus vs Y-Sweet: Full Use-Case Comparison (2026-02-21)

Strategic analysis of whether to switch from **Y-Sweet** to **Hocuspocus** as the L2 collaboration backbone.

---

#### Platform Profiles

| | **Y-Sweet** | **Hocuspocus** |
|---|---|---|
| **Language** | Rust (server) + TypeScript (SDK) | TypeScript (server + extensions) |
| **License** | MIT | MIT |
| **Architecture** | Stateless HTTP API + WebSocket relay | Stateful WebSocket server with extension system |
| **Persistence** | S3/Azure Blob/local FS (opaque binary blobs, automatic) | Pluggable via Database extension (SQLite, Postgres, S3, anything) |
| **Server hooks** | ❌ None | ✅ 18 hooks: `onChange`, `onStoreDocument`, `onConnect`, `onAuthenticate`, `onAwarenessUpdate`, `onDisconnect`, `onLoadDocument`, `beforeHandleMessage`, etc. |
| **HTTP API** | ✅ `getDocAsUpdate()`, `updateDoc()`, `createDoc()`, `getClientToken()` | ✅ `onRequest` hook (custom routes on same port) |
| **Scaling** | Session backend model (horizontal via Jamsocket or DIY) | Redis extension (`@hocuspocus/extension-redis`) for horizontal scaling |
| **Auth** | Document-level tokens (`full` / `read-only`) | `onAuthenticate` hook — full custom auth, per-connection `readOnly`, `onTokenSync` for mid-session refresh |
| **Deployment** | Rust binary / Docker / `npx y-sweet serve` | Node.js process — **can embed in our existing backend** |
| **Performance** | Rust = high throughput, low memory | Node.js = adequate for our scale (<100 docs) |

---

#### Use-Case Comparison (8 L2 use cases)

##### UC1: Agent Status Tracking (`Y.Map`)

| | Y-Sweet | Hocuspocus |
|---|---|---|
| **Server read** | `getDocAsUpdate()` → hydrate → `map.toJSON()` (HTTP roundtrip) | `onChange` receives live `Y.Doc` — `map.toJSON()` in-process |
| **Verdict** | Works. Extra hydration step. | **Better.** In-process access. |

##### UC2: Shared Context Between Agents (`Y.Map`)

Same as UC1. **Hocuspocus better** — in-process access vs HTTP roundtrip.

##### UC3: Group Chat Outcomes (`Y.Array`)

| | Y-Sweet | Hocuspocus |
|---|---|---|
| **Server write** | `updateDoc()` HTTP call | Direct Y.Doc mutation in-process |
| **Volume** | <100 outcomes per goal — HTTP overhead negligible | Same |
| **Verdict** | Both fine. Hocuspocus slightly better — no HTTP for server writes. |

##### UC4: Structured Document Collaboration (BlockNote CRDT)

| | Y-Sweet | Hocuspocus |
|---|---|---|
| **Real-time sync** | ✅ WebSocket relay (Rust, fast) | ✅ WebSocket relay (Node.js) |
| **BlockNote compat** | ✅ Official BlockNote demo exists | ✅ Via Yjs — Tiptap/ProseMirror native, BlockNote compatible |
| **Verdict** | **Equal.** Both work well. Y-Sweet has official BlockNote example. |

##### UC5: Binary Sharing (`Y.Map<Uint8Array>`)

| | Y-Sweet | Hocuspocus |
|---|---|---|
| **Storage** | S3/Azure Blob (auto-persisted, zero code) | Must implement via Database extension |
| **Verdict** | **Y-Sweet better.** Auto-persists to S3. Hocuspocus requires implementing storage manually. |

##### UC6: CRDT → Filesystem Projection ⭐ THE KEY USE CASE

| | Y-Sweet | Hocuspocus |
|---|---|---|
| **Approach C (Snapshot)** | ✅ `getDocAsUpdate()` → hydrate → write files | ✅ Same capability |
| **Approach D (Write-through)** | ❌ **Impossible server-side.** No hooks. Frontend WebSocket writes invisible. | ✅ **Native.** `onChange` fires on EVERY change (all sources, debounced 2-4s). Write projected files directly. |
| **Verdict** | Stuck at Approach C forever. | **Clear winner.** `onChange` = write-through materialized view pattern. |

##### UC7: Real-Time Presence/Awareness

| | Y-Sweet | Hocuspocus |
|---|---|---|
| **Client awareness** | ✅ Standard Yjs awareness | ✅ Standard Yjs awareness |
| **Server awareness** | ❌ No hook | ✅ `onAwarenessUpdate` with `states`, `added`, `updated`, `removed` |
| **Verdict** | Both work client-side. **Hocuspocus better for server-side** awareness tracking. |

##### UC8: Authentication & Authorization

| | Y-Sweet | Hocuspocus |
|---|---|---|
| **Model** | Token-based (`full` / `read-only`) | Hook-based — full custom logic, per-connection |
| **Verdict** | Both adequate. **Equal** for our needs. |

---

#### Summary Scorecard

| Use Case | Winner |
|----------|--------|
| UC1: Agent statuses | Hocuspocus |
| UC2: Shared context | Hocuspocus |
| UC3: Chat outcomes | Tie |
| UC4: Document collab | Tie |
| UC5: Binary sharing | **Y-Sweet** |
| UC6: CRDT→File projection | **Hocuspocus** ⭐ |
| UC7: Presence/awareness | Hocuspocus |
| UC8: Auth | Tie |

**Score: Hocuspocus 4, Y-Sweet 1, Tie 3.**

---

#### What We Lose / Gain by Switching

**Lose:**
1. S3 auto-persistence — must implement via Database extension (~30 lines)
2. Rust performance — irrelevant at <100 docs
3. Simpler deployment — Rust binary vs Node.js + Redis (for HA)

**Gain:**
1. `onChange`/`onStoreDocument` — Approach D (write-through projection) natively
2. `onAwarenessUpdate` — Server-side presence tracking
3. `onAuthenticate`/`onTokenSync` — Richer auth with session refresh
4. `onLoadDocument` — Custom document initialization/migration
5. `onConnect`/`onDisconnect` — Connection lifecycle visibility
6. `beforeHandleMessage` — Fine-grained message filtering
7. **Same-process embedding** — No separate Rust binary, runs in our Node.js backend
8. Extension system — Database, Redis, Logger, SQLite out of the box
9. `onRequest` — Custom HTTP routes on same port
10. Future-proof — every new server-side need is a hook, not an architectural workaround

---

#### Recommendation: **Switch to Hocuspocus**

**Decisive factor:** The `onChange` hook enables write-through CRDT→file projection (Approach D) — the gold standard pattern. With Y-Sweet, we're permanently stuck at Approach C (manual snapshot), and frontend WebSocket writes are invisible to the projection layer.

**Same-process embedding** eliminates IPC overhead. Instead of running a separate Rust binary, Hocuspocus runs inside our existing Node.js backend.

**The losses are manageable.** S3 persistence via Database extension is ~30 lines. Performance at our scale makes Rust irrelevant.

**Extensibility gap is massive.** Y-Sweet: 5 SDK methods. Hocuspocus: 18 hooks + extension system. Every server-side need with Y-Sweet forces workarounds; Hocuspocus has a first-class hook.

**Implementation impact:**
- `YSweetClient` → `HocuspocusServer` (same `CollaborationSpace` interface)
- `DocumentManager` SDK calls → direct Y.Doc access in hooks
- Add `@hocuspocus/server`, `@hocuspocus/extension-database`, optionally `@hocuspocus/extension-redis`
- Remove `@y-sweet/sdk` (keep `yjs`)
- Frontend: `@y-sweet/client` → `@hocuspocus/provider` (or raw `y-websocket`)
- Storage: `fetch()` + `store()` in Database extension (~30 lines)
- **Timeline: Minimal impact.** CollaborationSpace interface unchanged. Only transport layer changes.

---

### Entry 5 — "Power of Both": Exhaustive Platform Comparison (2026-02-21)

**Question:** Is there a platform that combines Y-Sweet's strengths (Rust performance, S3 auto-persistence) with Hocuspocus's strengths (18 server hooks, extensibility, same-process embedding)?

**Short answer:** No turnkey solution exists. But **Hocuspocus + S3 Database extension** achieves effectively 100% of both platforms' capabilities for our use case.

---

#### All Candidates Evaluated

##### 1. PartyKit / Cloudflare (5.5K stars, MIT)

**What it is:** Programmable WebSocket room platform built on Cloudflare Workers + Durable Objects. Now maintained at `cloudflare/partykit`. Used by BlockNote (our editor!) and tldraw.

**`y-partykit` package:** First-class Yjs integration with built-in persistence:
```ts
// Server — ~10 lines
import { onConnect } from "y-partykit";
export default class YjsServer implements Party.Server {
  onConnect(conn: Party.Connection) {
    return onConnect(conn, this.party, {
      persist: { mode: "snapshot" }, // Durable Objects auto-persist
      callback: {
        handler: async (yDoc) => sendDataToExternalService(yDoc),
        debounceWait: 2000,
        debounceMaxWait: 10000,
      }
    });
  }
}
```

**`Party.Server` API (10 hooks):**
| Hook | Purpose |
|------|---------|
| `onStart` | Load data from storage before first connection |
| `onConnect` | New WebSocket connection |
| `onMessage` | Incoming message from client |
| `onClose` | Connection closed |
| `onError` | Connection error |
| `onRequest` | HTTP request to room URL |
| `onAlarm` | Scheduled task trigger |
| `getConnectionTags` | Tag connections for filtering |
| `static onBeforeRequest` | Edge middleware for HTTP |
| `static onBeforeConnect` | Edge middleware for WS |

**Additional capabilities:**
- `Room.storage`: Per-room key-value store (128KB/value, 128MB/room total)
- `Room.broadcast`: Message all connected clients
- `Room.context.ai`: Built-in AI bindings
- `Room.context.vectorize`: Built-in vector search
- `Room.context.parties`: Cross-room communication
- `static onCron`: Scheduled cron jobs
- `static onFetch / onSocket`: Catch-all HTTP/WS handlers
- Hibernation API for memory efficiency at scale
- Cloud-prem: Can deploy to your own Cloudflare account

**Verdict: DISQUALIFIED** — Requires Cloudflare Workers + Durable Objects infrastructure. Cannot run on bare Node.js. Our backend is a standard Node.js process; adopting PartyKit would require migrating our entire runtime to Cloudflare. The programming model is excellent but the platform lock-in is absolute.

---

##### 2. Liveblocks (Commercial, NOT open-source)

**What it is:** Full-featured collaboration SaaS. Yjs support + their own CRDT (Liveblocks Storage). Comments, AI Agents, Notifications built-in.

**Server-side APIs:** `getYjsDocument()`, `sendYjsBinaryUpdate()`, `mutateStorage()`. Webhooks with 60s frequency (Pro plan).

**Pricing:** Free (500 rooms/mo) → Pro ($30/mo) → Team ($600/mo) → Enterprise (custom)

**Verdict: DISQUALIFIED** — Not self-hostable, not open-source, commercial cloud-only. Vendor lock-in + recurring cost + zero control over data residency.

---

##### 3. y/hub (formerly y-redis) — NEW DISCOVERY (260 stars, AGPL)

**What it is:** The official scalable Yjs backend by **Kevin Jahns** (Yjs creator). Production-grade distributed architecture:

```
┌──────────┐    ┌────────┐    ┌───────┐
│ Clients  │───▶│ Server │───▶│ Redis │
│(y-websocket)◀──│  (WS)  │◀──│(pub/sub)│
└──────────┘    └────────┘    └───────┘
                     │             │
                     │             ▼
                     │       ┌──────────┐
                     │       │  Worker  │
                     │       │(background)│
                     │       └──────────┘
                     │             │
                     ▼             ▼
              ┌──────────┐  ┌──────────┐
              │PostgreSQL│  │    S3    │
              │(metadata)│  │ (blobs)  │
              └──────────┘  └──────────┘
```

**Key capabilities:**
- **Memory efficient:** Server doesn't keep Y.Doc in memory after initial sync — streams through Redis
- **Horizontally scalable:** Multiple servers behind load balancer, Redis pub/sub for distribution
- **S3 + PostgreSQL auto-persistence:** Worker periodically persists Redis → S3 (blobs) + PostgreSQL (metadata, state vectors, content maps)
- **REST API:**
  - `GET /ydoc/{org}/{docid}` — retrieve document state
  - `PATCH /ydoc/{org}/{docid}` — update document programmatically (with attribution!)
  - `GET /activity/{org}/{docid}` — editing timestamps
  - `GET /changeset/{org}/{docid}` — visualize attributed changes with deltas
  - `POST /rollback/{org}/{docid}` — selective undo by user/time range/content
- **Webhooks:** `YDOC_UPDATE_CALLBACK` (debounced), `YDOC_CHANGE_CALLBACK` (with delta), `AUTH_PERM_CALLBACK`
- **Attribution tracking:** Automatic per-user, plus custom attributions (`source:ai,model:gpt4`)
- **Document branching:** `branch` parameter for document forks (suggestions!)
- **GC toggle:** `gc=true/false` for full history preservation
- **Auth:** JWT-based with permission callback to your backend

**What y/hub has that nobody else does:**
1. **Attribution-aware editing** — Every edit tracked to a user + custom attributes
2. **Document branching** — Fork documents for suggestions, merge back later
3. **Selective rollback** — Undo changes by user, time range, or custom criteria
4. **Changeset visualization** — Diff between any two points in time
5. **Activity timeline** — Complete editing history with attributions

**Verdict: FASCINATING but DISQUALIFIED for v1.1** — Three deal-breakers:
1. **AGPL license** — Viral copyleft. Must open-source your entire codebase or buy proprietary license.
2. **Heavy infrastructure** — Requires Redis + PostgreSQL + S3 (MinIO). Massive overhead for <100 docs.
3. **No same-process embedding** — Separate server binary + worker binary. Cannot embed in our Node.js backend.

**Future consideration:** If we ever need attribution tracking, document branching, or horizontal scaling to thousands of concurrent docs, y/hub's architecture is the gold standard. Worth revisiting in v2.0+ if license terms are acceptable.

---

##### 4. Custom y-websocket server (679 stars, MIT)

**What it is:** The bare-bones Yjs WebSocket server. The `@y/websocket-server` package (extracted from y-websocket) provides minimal server implementation.

**Built-in:** HTTP callback on document update (`CALLBACK_URL` env var), LevelDB persistence (`YPERSISTENCE` env var).

**Verdict: TOO LOW-LEVEL** — No hooks, no extension system, no authentication. Would require building everything from scratch. Hocuspocus already did this work.

---

##### 5. Hocuspocus + S3 Database Extension (THE WINNER)

**What it is:** Hocuspocus (18 hooks, MIT, same-process) plus a custom S3 storage adapter via the Database extension.

**The Database extension source is 62 lines total:**
```ts
// @hocuspocus/extension-database — the entire implementation
export class Database implements Extension {
  configuration: DatabaseConfiguration = {
    fetch: async () => null,
    store: async () => {},
  };
  
  async onLoadDocument(data: onLoadDocumentPayload): Promise<any> {
    const update = await this.configuration.fetch(data);
    if (update) {
      Y.applyUpdate(data.document, update);
    }
  }
  
  async onStoreDocument(data: onStoreDocumentPayload): Promise<void> {
    // Encodes document state and calls store()
    await this.configuration.store(data);
  }
}
```

**S3 adapter — ~20 lines of our code:**
```ts
import { Database } from "@hocuspocus/extension-database";
import { S3Client, GetObjectCommand, PutObjectCommand } from "@aws-sdk/client-s3";

const s3 = new S3Client({ /* config */ });
const Bucket = "ping-collaboration";

new Database({
  fetch: async ({ documentName }) => {
    try {
      const obj = await s3.send(new GetObjectCommand({ Bucket, Key: `${documentName}.yjs` }));
      return new Uint8Array(await obj.Body!.transformToByteArray());
    } catch { return null; } // Document doesn't exist yet
  },
  store: async ({ documentName, state }) => {
    await s3.send(new PutObjectCommand({
      Bucket, Key: `${documentName}.yjs`,
      Body: Buffer.from(state),
    }));
  },
});
```

**What this achieves — side-by-side with both parent platforms:**

| Capability | Y-Sweet | Hocuspocus+S3 | Achieved? |
|------------|---------|---------------|-----------|
| S3 auto-persistence | Native (Rust) | Via Database extension (~20 lines) | YES |
| Server hooks | None (0) | 18 native hooks | YES |
| `onChange` for projection | N/A | Native hook | YES |
| Same-process embedding | No (Rust binary) | Yes (Node.js) | YES |
| Extension system | None | Database, Redis, SQLite, Logger | YES |
| Auth hooks | None | `onAuthenticate`, `onTokenSync` | YES |
| Connection lifecycle | None | `onConnect`, `onDisconnect`, `connected` | YES |
| Awareness tracking | Via client only | `onAwarenessUpdate` hook | YES |
| HTTP routes on same port | No | `onRequest` hook | YES |
| Message filtering | No | `beforeHandleMessage` | YES |
| Document init/migration | No | `onLoadDocument`, `afterLoadDocument` | YES |
| Debounced persistence | N/A | `debounce` (2s), `maxDebounce` (10s) config | YES |
| Rust performance | Yes | No (Node.js) | IRRELEVANT (<100 docs) |
| Horizontal scaling | Single instance | Via Redis extension | YES |
| MIT license | Yes | Yes | YES |

**Score: 14/15 capabilities achieved. The only "loss" is Rust performance, which is irrelevant at <100 concurrent documents.**

---

#### Comparative Scorecard — All Platforms

| Criterion | Hocuspocus+S3 | y/hub | PartyKit | Liveblocks | Y-Sweet | y-websocket |
|-----------|:---:|:---:|:---:|:---:|:---:|:---:|
| Server hooks | 18 | Webhooks | 10 | Webhooks | 0 | 1 (HTTP callback) |
| S3 persistence | ~20 lines | Built-in | Via callback | Cloud-only | Built-in | LevelDB only |
| Same-process | YES | NO | NO | N/A | NO | YES |
| License | MIT | **AGPL** | MIT | Commercial | MIT | MIT |
| Self-hostable | YES | YES | Cloudflare only | NO | YES | YES |
| Server-side doc access | In-memory hooks | REST API | onMessage | REST API | HTTP SDK | None |
| Infrastructure needed | Node.js | Redis+PG+S3 | Cloudflare | Cloud | Rust binary | Node.js |
| Attribution/history | No | YES (best) | No | Limited | No | No |
| Document branching | No | YES | No | No | No | No |
| Horizontal scaling | Redis ext | Built-in | Built-in | Built-in | No | Manual |
| **Our Use Case Fit** | **BEST** | Good | Poor | Poor | Moderate | Poor |

---

#### Final Verdict

**Nothing combines "power of both" as a single platform.** The landscape is:

1. **Hocuspocus** = maximum hooks/extensibility, zero infrastructure, MIT
2. **Y-Sweet** = maximum ease of S3 persistence, zero hooks
3. **y/hub** = maximum enterprise features (attribution, branching, rollback), heavy infrastructure, AGPL
4. **PartyKit** = maximum edge performance, Cloudflare-locked
5. **Liveblocks** = maximum convenience, commercial cloud-only

**The hybrid Hocuspocus + S3 Database extension is the closest thing to "power of both":**
- Gets Y-Sweet's S3 persistence in ~20 lines of adapter code
- Keeps all 18 Hocuspocus hooks
- Runs in our existing Node.js process
- MIT licensed
- Zero additional infrastructure
- `onChange` enables our critical CRDT→file projection requirement

**Recommendation: CONFIRMED — proceed with Hocuspocus + S3 Database extension as the v1.1 collaboration backbone.**

**Migration note on y/hub:** If we ever need attribution tracking, document branching, or selective rollback (v2.0+ features for audit trails / suggestion mode), y/hub's architecture is the right reference. Its REST API for server-side doc access (`GET/PATCH /ydoc`) and changeset visualization are capabilities no other platform offers. Worth revisiting when:
- Scale exceeds ~500 concurrent docs (horizontal scaling becomes critical)
- Product requires audit trails / blame / suggestion mode
- License terms are negotiated or we go open-source
