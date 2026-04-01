# L2 Search Infrastructure Research

> **Scope:** Search over Yjs/CRDT collaborative documents, plans, and output manifests at the L2 (team-shared) level  
> **Date:** March 2026  
> **Status:** Research complete — architecture decided  
> **Context:** The system already uses MiniSearch for L1 (per-workspace) keyword search. This research evaluates options for L2 team-scoped search.  
> **Related:** [VIRTUAL_FILESYSTEM_RESEARCH.md](VIRTUAL_FILESYSTEM_RESEARCH.md) — virtual FS abstraction patterns

---

## Table of Contents

1. [Current State](#1-current-state)
2. [What Needs to Be Searchable](#2-what-needs-to-be-searchable)
3. [A — Keyword / Full-Text Search Options](#3-a--keyword--full-text-search-options)
4. [B — Semantic / Vector Search Options](#4-b--semantic--vector-search-options)
5. [C — Structured Query / Indexing Approaches](#5-c--structured-query--indexing-approaches)
6. [D — Yjs-Specific Patterns](#6-d--yjs-specific-patterns)
7. [Comparison Matrix](#7-comparison-matrix)
8. [Recommendation (Original — Superseded by §9-12)](#8-recommendation)
9. [Hocuspocus Search Extension — Architecture Decision](#9-hocuspocus-search-extension)
10. [Agent Context-Finding Patterns — Industry Research](#10-agent-context-finding-patterns)
11. [L2-Specific Context Capabilities for Multi-Agent](#11-l2-specific-capabilities)
12. [Final Consolidated Design](#12-final-consolidated-design)

---

## 1. Current State

### What exists today

| Component | Technology | Where |
|-----------|-----------|-------|
| **L1 keyword search** | MiniSearch 7.2.0 (BM25 + fuzzy + prefix) | `memory/L1/workspace/search/WorkspaceSearchIndex.ts` |
| **L1→L2 persistence** | Gzipped MiniSearch JSON snapshots in MongoDB | `memory/L2/codeintel/IndexPersistence.ts` |
| **Skill vector search** | MongoDB Atlas Vector Search + cosine similarity fallback | `skillRegistry/services/SkillRegistryService.ts` |
| **Embedding service** | Azure OpenAI `text-embedding-3-small` (1536-dim) | `skillRegistry/services/EmbeddingService.ts` |
| **CRDT collaboration** | Hocuspocus + Yjs (Y.Map, Y.Array, Y.XmlFragment, Y.Text) | `memory/L2/collaboration/HocuspocusServer.ts` |
| **CRDT → FS projection** | onChange hook → writes JSON/MD/TXT to `.ping/collaboration/` | `HocuspocusServer.ts` `projectToFilesystem()` |
| **Plan storage** | JSON files on disk at `data/plans/{teamId}/{goalId}/` | `memory/L2/collaboration/PlanStore.ts` |
| **Output manifests** | JSON files at `.ping/outputs/{taskId}.json` | `L2CollaborationPlugin.ts` |
| **Agent L2 tool** | Unified `collab` tool with discover/list/read/write/write-block/read-block actions | `memory/L2/tools/index.ts` |

### L1 MiniSearch configuration

```typescript
this.miniSearch = new MiniSearch({
  fields: ["content"],
  storeFields: ["file", "content", "lineStart", "lineEnd"],
  searchOptions: {
    boost: { content: 1 },
    fuzzy: 0.2,
    prefix: true,
  },
});
```

- Files split into chunks (30 lines for code, 50 lines for docs)
- Incremental add/remove/update (debounced 500ms)
- Serializable via `toJSON()` / `loadJSON()` for L2 snapshot persistence
- Already supports 80+ file extensions

### Key existing dependencies (from `src/worker/package.json`)

```
minisearch (via L1)      — already installed
fuse.js (transitive)     — already available
mongoose                 — MongoDB driver
@langchain/core          — LangChain base
yjs                      — CRDT library
@hocuspocus/server       — Yjs collaboration server
fast-glob                — file pattern matching
```

---

## 2. What Needs to Be Searchable

### L2 data types and their structure

| Data Source | Storage Format | Yjs Type | Typical Size | Update Pattern |
|------------|---------------|----------|-------------|---------------|
| **Agent statuses** | CRDT (real-time) | `Y.Map<{ role, status, lastUpdated }>` | ~10-50 keys | Frequent (every task state change) |
| **Chat outcomes** | CRDT (append-only) | `Y.Array<{ sessionId, participants, outcome, summary }>` | Grows over time, 10-100 items | Append after group chats |
| **Custom CRDT docs** | CRDT (agent-created) | `Y.Map` (structured data) | Varies — agents create ad-hoc docs | Per agent write |
| **Collaborative editor docs** | CRDT (rich text) | `Y.XmlFragment` (BlockNote) | Multi-paragraph rich text | Real-time co-editing |
| **Plans** | JSON files on disk | N/A (file-based) | 1-5 KB per plan (goal + 5-20 tasks) | Created once, updated on replan |
| **Output manifests** | JSON files on disk | N/A (file-based) | 0.5-2 KB per manifest | Written once on task completion |
| **Binaries metadata** | CRDT | `Y.Map<{ filename, size, mime }>` | Small — metadata only | On binary upload |

### Search scenarios agents would perform

| Scenario | Query Example | Needed Capability |
|----------|--------------|-------------------|
| "What tasks are assigned to me?" | `{ assigned_role: "researcher" }` | Structured query over plan JSON |
| "Find previous research on auth" | `"authentication JWT"` | Keyword search over CRDT docs + plans |
| "What did the designer decide about the UI?" | `"designer decision interface"` | Full-text search over chat outcomes |
| "Show all completed tasks" | `{ status: "completed" }` | Structured filter on plan tasks |
| "Find docs related to payment processing" | Semantic: "payment handling billing" | Vector similarity over all L2 content |
| "What files did the backend agent produce?" | `{ role: "backend-developer" }` | Structured query over output manifests |
| "Find everything about the API schema" | `"API schema endpoint routes"` | Cross-doc keyword search |
| "What's in the collaborative design doc?" | Read `doc-design` XmlFragment | Direct CRDT read (not really search) |

---

## 3. A — Keyword / Full-Text Search Options

### A1. MiniSearch (Second Instance for L2)

**npm:** `minisearch` · **Version:** 7.2.0 · **Weekly downloads:** ~705K · **Dependencies:** 0 · **License:** MIT

Already used for L1 workspace search. A second MiniSearch instance at the L2 level would index CRDT-projected content, plan text, and manifest descriptions.

**How it would work:**

```typescript
class L2SearchIndex {
  private miniSearch = new MiniSearch({
    fields: ["content", "title", "role"],
    storeFields: ["docType", "docId", "title", "content"],
    searchOptions: { fuzzy: 0.2, prefix: true },
  });

  // Index a plan
  indexPlan(plan: StoredPlan) {
    for (const task of plan.plan.tasks) {
      this.miniSearch.add({
        id: `plan:${plan.metadata.planId}:${task.id}`,
        docType: "plan-task",
        docId: plan.metadata.planId,
        title: task.title,
        content: `${task.title} ${task.description}`,
        role: task.assigned_role,
      });
    }
  }

  // Index CRDT doc content (materialized from Y.Doc.toJSON())
  indexCrdtDoc(docName: string, json: Record<string, any>) {
    const content = JSON.stringify(json);
    this.miniSearch.add({
      id: `crdt:${docName}`,
      docType: "crdt",
      docId: docName,
      title: docName,
      content,
    });
  }

  search(query: string, topK = 20) {
    return this.miniSearch.search(query, { fuzzy: 0.2, prefix: true }).slice(0, topK);
  }
}
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit with CRDT types** | ★★★★☆ — Works after `toJSON()` materialization. XmlFragment needs text extraction (already implemented). |
| **Incremental updates** | ★★★★★ — Native `add()`, `remove()`, `discard()` — no rebuild needed. Best in class. |
| **Query types** | ★★★★☆ — Keyword ✅, Fuzzy ✅, Prefix ✅, Regex ❌, Semantic ❌, Structured ❌ |
| **Dependencies** | ★★★★★ — Zero new deps. Already installed. |
| **Complexity** | ★★★★★ — Copy the L1 pattern. Team already knows the API. |

**Pros:**
- Zero new dependencies — already in the dependency tree
- Team familiarity — same API as L1 search
- Proven incremental add/remove (critical for CRDT updates)
- Built-in fuzzy + prefix matching
- Serializable for persistence (`toJSON()` / `loadJSON()`)
- Auto-suggest built in

**Cons:**
- No vector/semantic search
- No structured query (can't filter by `role === "researcher"`)
- In-memory only — scales to ~100K documents, not millions
- Each doc must be flattened to text fields — loses CRDT structure
- No built-in ranking by recency or document type

**Verdict:** **Strong contender for L2 keyword search** because of zero-cost incremental updates and zero new deps. The team already understands the pattern. Best as the keyword layer in a hybrid approach.

---

### A2. Orama (@orama/orama, formerly Lyra)

**npm:** `@orama/orama` · **Version:** 3.1.x · **Weekly downloads:** ~160K · **Dependencies:** 0 · **License:** Apache 2.0

Embedded full-text + vector search engine. Written in TypeScript. Positions itself as the "search engine you can run anywhere."

**API overview:**

```typescript
import { create, insert, search, remove } from "@orama/orama";

// Create a typed schema
const db = await create({
  schema: {
    title: "string",
    content: "string",
    role: "string",
    docType: "enum",
    embedding: "vector[1536]",  // Optional vector field
  },
});

// Insert documents
await insert(db, {
  title: "Implement authentication",
  content: "Build JWT-based auth handler with refresh token support",
  role: "backend-developer",
  docType: "plan-task",
  embedding: await getEmbedding("JWT auth handler"),  // Optional
});

// Full-text search
const textResults = await search(db, {
  term: "authentication JWT",
  properties: ["title", "content"],
  limit: 10,
});

// Vector search
const vectorResults = await search(db, {
  mode: "vector",
  vector: { value: queryEmbedding, property: "embedding" },
  limit: 10,
});

// Hybrid search (text + vector combined)
const hybridResults = await search(db, {
  mode: "hybrid",
  term: "authentication",
  vector: { value: queryEmbedding, property: "embedding" },
  limit: 10,
});

// Structured filter
const filtered = await search(db, {
  term: "auth",
  where: {
    role: { eq: "backend-developer" },
    docType: { eq: "plan-task" },
  },
});

// Remove a document
await remove(db, documentId);
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit with CRDT types** | ★★★★☆ — Requires materialization (same as MiniSearch). Schema-typed fields are a plus for structured CRDT data. |
| **Incremental updates** | ★★★★☆ — `insert()`, `remove()`, `update()` supported. Slightly slower than MiniSearch on individual operations. |
| **Query types** | ★★★★★ — Keyword ✅, Fuzzy ✅, Vector ✅, Hybrid ✅, Filters ✅, Facets ✅, Geo ✅ |
| **Dependencies** | ★★★★☆ — 0 runtime deps. New package to install (~150 KB). |
| **Complexity** | ★★★★☆ — Clean API. Slightly more setup than MiniSearch (schema definition). |

**Pros:**
- **Hybrid search built in** — text + vector in one query. This is the killer feature. No need to manually merge BM25 + cosine scores.
- Zero runtime dependencies (like MiniSearch)
- TypeScript-first with strong typing
- Built-in `where` filters — can filter by role, docType, status without post-processing
- Faceted search (count results by category)
- Pluggable tokenizers and stemmers
- Can serialize to/from JSON for persistence
- Active development, good docs

**Cons:**
- New dependency (team doesn't know it)
- Slightly larger API surface than MiniSearch
- Vector indexing adds memory overhead (but only if using vectors)
- Less battle-tested than MiniSearch in the long run (younger project)
- No built-in persistence to MongoDB (would need custom save/load)

**Verdict:** **Best option if vector search is a requirement.** The hybrid mode (text + vector in one query) eliminates the complexity of manually combining separate search backends. If L2 should support semantic search over CRDT content, Orama is the strongest single-library solution.

---

### A3. FlexSearch

**npm:** `flexsearch` · **Version:** 0.7.43 · **Weekly downloads:** ~916K · **Dependencies:** 0 · **License:** Apache 2.0

Known for raw speed — benchmark claims 250x faster than Lunr.js. Uses a unique "context-based scoring" algorithm instead of BM25.

**API overview:**

```typescript
import FlexSearch from "flexsearch";

// Document index (for multi-field objects)
const index = new FlexSearch.Document({
  document: {
    id: "id",
    index: ["title", "content"],
    store: ["title", "docType", "role"],
  },
  tokenize: "forward",   // or "reverse", "full", "strict"
  resolution: 9,          // Scoring resolution (1-9)
  cache: true,
});

// Add documents
index.add({
  id: "plan:001:task-1",
  title: "Implement auth",
  content: "JWT-based authentication handler",
  docType: "plan-task",
  role: "backend-developer",
});

// Search
const results = index.search("auth", { limit: 10, enrich: true });
// Returns: [{ field: "title", result: [...] }, { field: "content", result: [...] }]

// Remove
index.remove(docId);

// Update
index.update({ id: "plan:001:task-1", title: "Updated title", ... });

// Export/Import for persistence
const exported = index.export();
index.import(key, exported[key]);
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit with CRDT types** | ★★★☆☆ — Works after materialization, but results grouped by field (not merged). Needs post-processing. |
| **Incremental updates** | ★★★★☆ — `add()`, `remove()`, `update()` supported. |
| **Query types** | ★★★☆☆ — Keyword ✅, Fuzzy (partial, via tokenize mode) ✅, Regex ❌, Semantic ❌, Structured ❌ |
| **Dependencies** | ★★★★★ — Zero deps. |
| **Complexity** | ★★☆☆☆ — Quirky API. Results come per-field, not merged. Export/import is key-by-key. Documentation is sparse. |

**Pros:**
- Fastest raw search speed (microsecond range for small indexes)
- Zero dependencies
- Multiple tokenization strategies (forward, reverse, full)
- Good for auto-complete scenarios

**Cons:**
- **Quirky API** — search returns results grouped by field, not as a unified ranked list. Must manually merge.
- **No filters** — can't say `where: { role: "researcher" }`. Must filter post-search.
- **No fuzzy in the MiniSearch sense** — "fuzzy" is achieved via tokenize modes, not edit-distance
- **Export/Import is complex** — not a single `toJSON()`; must iterate keys
- **Documentation is poor** — many features undocumented or documented only in GitHub issues
- **TypeScript types are incomplete** — community-maintained `@types/flexsearch` doesn't cover all APIs
- Already evaluated and rejected in [AGENT_WORKSPACE_RESEARCH.md §13](AGENT_WORKSPACE_RESEARCH.md) for L1 search

**Verdict:** **Not recommended for L2.** While fast, the API complexity, lack of unified ranking, no structured filters, and poor TypeScript support make it a worse fit than MiniSearch or Orama. Speed isn't the bottleneck for L2 search (index sizes are small — dozens to hundreds of documents, not millions).

---

### A4. Lunr.js

**npm:** `lunr` · **Version:** 2.3.9 · **Weekly downloads:** ~1.1M · **Dependencies:** 0 · **License:** MIT

The original JS full-text search library. Pre-dates MiniSearch, FlexSearch, and Orama.

**Key characteristics:**

```typescript
import lunr from "lunr";

// Build index (immutable after creation)
const idx = lunr(function () {
  this.field("title", { boost: 10 });
  this.field("content");
  this.ref("id");

  documents.forEach((doc) => this.add(doc));
});

// Search
const results = idx.search("authentication +JWT");
// Results: [{ ref: "doc-id", score: 1.234, matchData: {...} }]
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit with CRDT types** | ★★★☆☆ — Works with materialized text. |
| **Incremental updates** | ★☆☆☆☆ — **Index is immutable after build.** Cannot add/remove documents. Must rebuild entirely. **Fatal for CRDT use case.** |
| **Query types** | ★★★☆☆ — Keyword ✅, Boost ✅, Wildcards ✅, Fuzzy (edit-distance) ✅, Semantic ❌ |
| **Dependencies** | ★★★★★ — Zero deps. |
| **Complexity** | ★★★★☆ — Simple API, but immutable index is a hard constraint. |

**Pros:**
- Battle-tested (10+ years)
- Decent query language (boost, wildcard, fuzzy, required/prohibited terms)
- Zero dependencies

**Cons:**
- **Index is immutable** — once built, cannot add, update, or remove documents. Must rebuild from scratch on every change. This is a **fundamental disqualifier** for CRDT documents that change in real-time.
- No TypeScript built-in types
- No vector search
- No structured filters
- Last published 5+ years ago (effectively unmaintained)
- Superseded by MiniSearch in every dimension

**Verdict:** **Disqualified.** Immutable index is a non-starter for real-time CRDT updates. Even for static content (plans, manifests), MiniSearch is strictly better.

---

### A5. Fuse.js

**npm:** `fuse.js` · **Version:** 7.1.0 · **Weekly downloads:** ~3M · **Dependencies:** 0 · **License:** Apache 2.0

Fuzzy-matching library. Already a transitive dependency (`src/worker/package-lock.json`).

**Key characteristics:**

```typescript
import Fuse from "fuse.js";

const fuse = new Fuse(documents, {
  keys: [
    { name: "title", weight: 2 },
    { name: "content", weight: 1 },
    { name: "role", weight: 0.5 },
  ],
  threshold: 0.4,         // 0 = exact match, 1 = match anything
  includeScore: true,
  includeMatches: true,
  minMatchCharLength: 2,
});

const results = fuse.search("authentcation");  // note: typo → still matches
// [{ item: { title: "authentication", ... }, score: 0.12, matches: [...] }]
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit with CRDT types** | ★★★☆☆ — Works on any JS objects. No materialization needed if you pass the JSON directly. Good for searching Y.Map keys/values. |
| **Incremental updates** | ★★☆☆☆ — `setCollection()` replaces the entire dataset. No add/remove per document. Must re-set full collection on change. |
| **Query types** | ★★☆☆☆ — Fuzzy ✅ (best in class), Exact ✅, Weighted fields ✅, but: No keyword ranking (no tf-idf/BM25), No prefix, No semantic. |
| **Dependencies** | ★★★★★ — Already installed (transitive). Zero additional cost. |
| **Complexity** | ★★★★★ — 3 lines to set up. Simplest API of all options. |

**Pros:**
- Already available (transitive dep)
- Best fuzzy matching of all options — great for typo-tolerant search
- Works directly on JS objects — no index build step
- Weighted field search
- Very simple API

**Cons:**
- **Not a search engine** — it's a fuzzy matcher. No inverted index, no BM25 scoring, no tf-idf. Just linear scan with Bitap/Levenshtein distance.
- **O(n) on every search** — scans every document on every query. Fine for < 1000 docs, unusable for large indexes.
- **No incremental updates** — must replace the entire collection
- No relevance ranking beyond fuzzy score (doesn't consider term frequency or document frequency)
- Not designed for multi-word queries or phrase matching

**Verdict:** **Not appropriate as the primary L2 search engine.** However, excellent as a **secondary fuzzy layer** for specific use cases — e.g., fuzzy matching agent role names, plan IDs, or document names where typos are likely. Use it complementarily, not as the index.

---

### A6. MongoDB Text Indexes / Atlas Search

**Already available** — the system uses Mongoose + MongoDB Atlas for skills, teams, and index persistence.

**Option 1: MongoDB Text Indexes (basic)**

```typescript
// Create text index on a collection
db.l2Documents.createIndex({
  title: "text",
  content: "text",
  role: "text",
}, { weights: { title: 10, content: 5, role: 1 } });

// Query
const results = await L2DocModel.find(
  { $text: { $search: "authentication JWT handler" } },
  { score: { $meta: "textScore" } }
).sort({ score: { $meta: "textScore" } }).limit(20);
```

**Option 2: MongoDB Atlas Search (Lucene-based)**

```typescript
// Requires Atlas Search index (configured in MongoDB Atlas UI)
const results = await L2DocModel.aggregate([
  {
    $search: {
      index: "l2_content_search",
      compound: {
        must: [{ text: { query: "authentication", path: "content" } }],
        filter: [{ equals: { path: "docType", value: "plan-task" } }],
      },
    },
  },
  { $limit: 20 },
  { $project: { title: 1, content: 1, score: { $meta: "searchScore" } } },
]);
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit with CRDT types** | ★★★☆☆ — Requires serializing CRDT state to MongoDB documents. Not naturally real-time. |
| **Incremental updates** | ★★★★☆ — MongoDB upserts are incremental. Atlas Search index updates asynchronously (slight lag). |
| **Query types** | ★★★★★ (Atlas Search) / ★★★☆☆ (text index) — Atlas Search: keyword ✅, fuzzy ✅, autocomplete ✅, filters ✅, facets ✅, geo ✅, regex ✅. Text index: basic keyword + phrase only. |
| **Dependencies** | ★★★★★ — Already using MongoDB. No new deps. |
| **Complexity** | ★★☆☆☆ — Requires syncing CRDT state → MongoDB on every change. Network latency on every search. Atlas Search requires index configuration in Atlas UI. |

**Pros:**
- No new dependencies
- MongoDB text indexes work on any deployment (Atlas or self-hosted)
- Atlas Search is production-grade Lucene (same engine as Elasticsearch)
- Atlas Search supports facets, autocomplete, fuzzy, highlighting
- Already have the connection, already understand Mongoose
- Persistence is automatic — data survives restarts

**Cons:**
- **Network latency** — every search requires a round-trip to MongoDB (even with local Docker). In-memory search is 100-1000x faster for small datasets.
- **CRDT → MongoDB sync complexity** — must serialize CRDT state to MongoDB documents on every Yjs change event. This is a non-trivial integration (write amplification, conflict handling).
- **Atlas Search is Atlas-only** — not available on self-hosted/Docker MongoDB. The basic `$text` index is much less capable.
- **Index lag** — Atlas Search updates are near-real-time but not instant. CRDT changes won't be searchable for a few hundred milliseconds.
- **Overkill for L2 scale** — L2 typically has dozens to low-hundreds of documents per team. MongoDB overhead isn't justified.
- Basic text indexes don't support fuzzy matching

**Verdict:** **Not recommended as the primary L2 search layer.** The CRDT → MongoDB sync overhead is significant, and the latency penalty isn't justified for L2's small document counts. However, **MongoDB should remain the persistence/backup layer** — search results are ephemeral (in-memory), but the authoritative data should persist in MongoDB for disaster recovery. The existing Atlas Vector Search for skills is the right pattern for skill search; extending it to L2 general content adds complexity without proportional benefit.

---

## 4. B — Semantic / Vector Search Options

### B1. Orama with Vector Search

(Covered above in A2 — Orama's hybrid mode is its killer feature)

**To use vectors with Orama at L2:**

```typescript
import { create, insert, search } from "@orama/orama";

const l2Index = await create({
  schema: {
    content: "string",
    docType: "enum",
    embedding: "vector[1536]",
  },
});

// Insert with embedding
await insert(l2Index, {
  content: "JWT auth handler implementation plan",
  docType: "plan-task",
  embedding: await generateEmbedding("JWT auth handler implementation plan"),
});

// Hybrid search — text + vector combined
const results = await search(l2Index, {
  mode: "hybrid",
  term: "authentication",
  vector: { value: queryEmbedding, property: "embedding" },
  limit: 10,
});
```

**Cost consideration:** Every indexed document needs an embedding. At L2 scale (dozens to low-hundreds of docs), the embedding API cost is negligible (~$0.001 per 1000 tokens with `text-embedding-3-small`). But it adds latency to index-time operations.

**Verdict:** Best hybrid option if we adopt Orama. The single-library text+vector approach eliminates the complexity of merging scores from separate backends.

---

### B2. MongoDB Atlas Vector Search

**Already in use** for skill embeddings in `SkillRegistryService.ts`.

```typescript
// Existing pattern from SkillRegistryService:
const pipeline = [
  {
    $vectorSearch: {
      index: "skill_vector_search",
      path: "embedding",
      queryVector: queryEmbedding,
      numCandidates: limit * 10,
      limit: limit,
      filter: Object.keys(filter).length > 0 ? filter : undefined,
    },
  },
];
```

**Extending to L2 content:**

Would require:
1. A new MongoDB collection for L2 documents (plans, CRDT snapshots, manifests)
2. Embedding each document on insert/update
3. A new Atlas Vector Search index configured on that collection
4. CRDT → MongoDB sync pipeline

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★★☆☆ — Works but requires CRDT → MongoDB materialization pipeline |
| **Incremental** | ★★★★☆ — MongoDB upserts + re-embed on change. Vector index updates async. |
| **Query types** | ★★★★☆ — Vector ✅, pre-filter ✅, post-filter ✅. No built-in text+vector hybrid (requires separate $text pipeline). |
| **Dependencies** | ★★★★★ — Already using MongoDB Atlas. |
| **Complexity** | ★★☆☆☆ — Requires Atlas cluster (not available on local Docker). Write pipeline for CRDT sync. |

**Pros:**
- Already proven pattern (skills)
- Production-grade vector search
- Can filter results by teamId, goalId, docType
- Persists across restarts

**Cons:**
- Atlas-only (development requires Atlas connection or local mock)
- Network latency on every search
- Need to maintain a CRDT → MongoDB sync pipeline
- Cannot do true hybrid (text + vector) in a single query without workarounds
- Overkill for L2 document counts

**Verdict:** **Good for L3 (organization-wide knowledge base) but overkill for L2.** The existing skill search pattern works well when data naturally lives in MongoDB. For CRDT data that lives in Yjs, adding a MongoDB sync layer adds complexity that isn't justified at L2 scale. Keep this as the L3 strategy.

---

### B3. Vectra (Local Vector DB for Node.js)

**npm:** `vectra` · **Weekly downloads:** ~4K · **Dependencies:** Few (fs-based) · **License:** MIT  
**Author:** Steven Ickman (Microsoft), used in some Teams AI samples

**How it works:**

```typescript
import { LocalIndex } from "vectra";

// Create a local vector index (stores on disk as JSON files)
const index = new LocalIndex(path.join(dataDir, "l2-vectors"));

// Create if not exists
if (!await index.isIndexCreated()) {
  await index.createIndex();
}

// Insert with vector
await index.insertItem({
  vector: await generateEmbedding("plan task text"),
  metadata: { docType: "plan-task", role: "researcher", content: "..." },
});

// Query
const results = await index.queryItems(queryVector, 10);
// results: [{ item: { metadata, vector }, score: 0.94 }, ...]

// Delete
await index.deleteItem(itemId);
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★★☆☆ — Works with any text after embedding. Not CRDT-aware. |
| **Incremental** | ★★★★☆ — Insert/delete per item. Updates = delete + insert. |
| **Query types** | ★★☆☆☆ — Vector only ✅. No text search, no fuzzy, no filters (only post-filter on metadata). |
| **Dependencies** | ★★★☆☆ — New small dependency. File-based storage. |
| **Complexity** | ★★★★☆ — Simple API. But vector-only means you need a separate text search engine alongside. |

**Pros:**
- Fully local — no external service needed
- File-based persistence (no database required)
- Simple API
- Used in Microsoft Teams AI samples

**Cons:**
- **Vector only** — no text search. Must pair with MiniSearch/Orama for keyword search
- Small community (~4K weekly downloads)
- Brute-force linear scan (no approximate nearest neighbor) — O(n) per query
- No built-in metadata filtering during search (only post-filter)
- Stores vectors as JSON on disk — not memory-efficient for large indexes

**Verdict:** **Not recommended.** At L2 scale, any in-memory option is better. If we need vector search, Orama's built-in vector support or the existing cosine similarity function are simpler solutions. Vectra adds complexity without adding capability that Orama + MiniSearch don't already cover.

---

### B4. In-Memory Cosine Similarity (Existing Pattern)

**Already implemented** in `EmbeddingService.ts`:

```typescript
export function cosineSimilarity(a: number[], b: number[]): number {
  let dotProduct = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}
```

**Scaling to L2:**

```typescript
class L2VectorIndex {
  private documents: { id: string; embedding: number[]; metadata: any }[] = [];

  add(doc: { id: string; text: string; metadata: any }) {
    const embedding = await generateEmbedding(doc.text);
    this.documents.push({ id: doc.id, embedding, metadata: doc.metadata });
  }

  search(queryText: string, topK = 10) {
    const queryEmb = await generateEmbedding(queryText);
    return this.documents
      .map(doc => ({ ...doc, score: cosineSimilarity(queryEmb, doc.embedding) }))
      .sort((a, b) => b.score - a.score)
      .slice(0, topK);
  }
}
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★★☆☆ — Works with any text. |
| **Incremental** | ★★★★★ — Array push/splice. Simplest possible. |
| **Query types** | ★★☆☆☆ — Vector only. No text search. |
| **Dependencies** | ★★★★★ — Zero. Already implemented. |
| **Complexity** | ★★★★★ — ~20 lines of code total. |

**Performance at L2 scale:**
- 100 documents × 1536 dimensions = ~600 KB in memory
- Cosine similarity: ~0.1ms per comparison → 10ms for 100 docs → 100ms for 1000 docs
- At L2 scale (< 500 docs), brute force is instantaneous

**Verdict:** **Perfectly adequate for L2 semantic search at current scale.** If the team decides semantic search is needed at L2 (not certain it is), this is the simplest path. Pair with MiniSearch for keyword search. Only outgrown if L2 document counts exceed ~5000, which is unlikely.

---

### B5. LangChain MemoryVectorStore

**Package:** `langchain/vectorstores/memory` · **Already in deps:** `@langchain/core` is installed

```typescript
import { MemoryVectorStore } from "langchain/vectorstores/memory";
import { AzureOpenAIEmbeddings } from "@langchain/openai";

const embeddings = new AzureOpenAIEmbeddings({
  azureOpenAIApiDeploymentName: "text-embedding-3-small",
});

const store = await MemoryVectorStore.fromTexts(
  ["plan task 1 content", "plan task 2 content", "crdt doc content"],
  [{ docType: "plan-task" }, { docType: "plan-task" }, { docType: "crdt" }],
  embeddings,
);

// Similarity search
const results = await store.similaritySearch("authentication", 5);

// With score
const scored = await store.similaritySearchWithScore("auth", 5);

// Add more documents later
await store.addDocuments([{ pageContent: "new content", metadata: {} }]);
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★★☆☆ — Works with Document objects. CRDT content must be extracted to text. |
| **Incremental** | ★★★★☆ — `addDocuments()` works. Delete by ID is not well-supported. |
| **Query types** | ★★☆☆☆ — Vector only ✅. No text/keyword search built in. |
| **Dependencies** | ★★★★☆ — `langchain` is already installed. `MemoryVectorStore` is in the base package. |
| **Complexity** | ★★★★☆ — Clean API. Wraps the same cosine similarity logic but with LangChain Document abstraction. |

**Pros:**
- Already in dependency tree
- Consistent with LangChain patterns used elsewhere
- Can swap to other vectorstores (Pinecone, Chroma) later via same interface
- Handles embedding generation automatically

**Cons:**
- Just a wrapper around cosine similarity — no efficiency advantage over DIY
- LangChain abstraction layer adds overhead without clear benefit for simple in-memory use
- No text search, no filters during search
- Document deletion is awkward
- Extra abstraction layer for something that's ~20 lines of custom code

**Verdict:** **Viable but over-engineered for the use case.** The LangChain abstraction provides swappability (could move to Pinecone later), but at L2 scale, the raw cosine similarity function is simpler and more transparent. Consider only if there's a plan to swap vector backends later.

---

## 5. C — Structured Query / Indexing Approaches

### C1. JSONPath / JMESPath Queries

**Libraries:**
- `jsonpath-plus` (NPM: ~1.5M weekly) — JSONPath with extensions
- `@metrichor/jmespath` (NPM: ~50K weekly) — JMESPath for JS

**Use case:** Query structured CRDT JSON (materialized via `Y.Doc.toJSON()`) or plan JSON files without building a search index.

```typescript
import { JSONPath } from "jsonpath-plus";

// Query all tasks assigned to "researcher"
const tasks = JSONPath({
  path: "$.tasks[?(@.assigned_role==='researcher')]",
  json: planData,
});

// Find all completed tasks
const completed = JSONPath({
  path: "$.tasks[?(@.status==='completed')]",
  json: planData,
});

// Get all chat outcome summaries
const summaries = JSONPath({
  path: "$[*].summary",
  json: chatOutcomesArray,
});
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★★★★ — Perfect for structured JSON from Y.Map.toJSON() and plan files. |
| **Incremental** | ★★★★★ — No index to maintain. Queries run directly on live data. |
| **Query types** | ★★★☆☆ — Structured filters ✅, Path traversal ✅. No full-text search, no fuzzy, no semantic. |
| **Dependencies** | ★★★★☆ — Small new dep (`jsonpath-plus`: 13 KB). |
| **Complexity** | ★★★★★ — Query strings, no setup. |

**Pros:**
- **No index needed** — queries run directly on JSON objects. Perfect for CRDT data that's already in memory as Y.Map/Y.Array.
- Standards-based (JSONPath RFC 9535)
- Ideal for structured queries: "find tasks where role = X and status = Y"
- Works on live `Y.Doc.toJSON()` output — no materialization pipeline needed
- Trivially composable with Yjs observe callbacks

**Cons:**
- No full-text search (can't search within string values for keywords)
- No fuzzy matching
- No ranking/scoring — returns all matches or none
- JSONPath syntax is terse and not self-documenting
- Not a search engine — it's a query language for traversing JSON

**Verdict:** **Excellent complement to keyword search.** Use JSONPath for structured queries ("find all tasks for role X") and MiniSearch/Orama for text queries ("find docs mentioning authentication"). They solve different problems and work well together.

---

### C2. Custom Inverted Index over Y.Map Keys/Values

Build a lightweight inverted index that maps tokens → document locations, maintained incrementally via Yjs observe callbacks.

```typescript
class CrdtInvertedIndex {
  // token → Set of { docName, key }
  private index = new Map<string, Set<string>>();

  // Called on Y.Map observe event
  onMapChange(docName: string, key: string, value: any) {
    const oldRef = `${docName}:${key}`;
    // Remove old tokens for this entry
    this.removeRef(oldRef);
    // Tokenize and index new value
    const text = typeof value === "string" ? value : JSON.stringify(value);
    for (const token of this.tokenize(text)) {
      if (!this.index.has(token)) this.index.set(token, new Set());
      this.index.get(token)!.add(oldRef);
    }
  }

  search(query: string): string[] {
    const tokens = this.tokenize(query);
    // Intersection of all token posting lists
    const sets = tokens.map(t => this.index.get(t) ?? new Set());
    if (sets.length === 0) return [];
    return [...sets.reduce((acc, s) => new Set([...acc].filter(x => s.has(x))))];
  }

  private tokenize(text: string): string[] {
    return text.toLowerCase().split(/\W+/).filter(t => t.length > 1);
  }

  private removeRef(ref: string) {
    for (const [_token, refs] of this.index) {
      refs.delete(ref);
    }
  }
}
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★★★★ — Designed explicitly for CRDT. Hooks into Y.Map.observe. |
| **Incremental** | ★★★★★ — Updates on every CRDT change event. |
| **Query types** | ★★☆☆☆ — Basic keyword matching only. No ranking, no fuzzy, no BM25. |
| **Dependencies** | ★★★★★ — Zero. Custom code. |
| **Complexity** | ★★★☆☆ — Must build and maintain. Edge cases (tokenization, unicode, CJK). |

**Verdict:** **Not recommended.** MiniSearch already does this better (BM25 scoring, fuzzy matching, prefix search) with zero dependencies. Building a custom inverted index is reinventing MiniSearch but worse. The only advantage — direct Yjs observe integration — can be achieved by feeding MiniSearch from observe callbacks (see §6D1).

---

### C3. SQLite FTS5 via better-sqlite3

**npm:** `better-sqlite3` · **Weekly downloads:** ~2.1M · **License:** MIT

Embedded SQLite in Node.js with FTS5 (Full-Text Search 5) — the same technology behind macOS Spotlight search.

```typescript
import Database from "better-sqlite3";

const db = new Database(":memory:"); // or file path for persistence

// Create FTS5 virtual table
db.exec(`
  CREATE VIRTUAL TABLE l2_search USING fts5(
    docId,
    docType,
    title,
    content,
    role,
    tokenize='porter unicode61'
  );
`);

// Insert
const insert = db.prepare("INSERT INTO l2_search VALUES (?, ?, ?, ?, ?)");
insert.run("plan:001:task-1", "plan-task", "Implement auth", "JWT handler", "backend");

// Search with BM25 ranking
const results = db.prepare(`
  SELECT docId, docType, title, snippet(l2_search, 3, '<b>', '</b>', '...', 20) as snippet,
         rank
  FROM l2_search
  WHERE l2_search MATCH ?
  ORDER BY rank
  LIMIT ?
`).all("authentication", 10);

// Boolean queries
db.prepare("SELECT * FROM l2_search WHERE l2_search MATCH 'JWT AND NOT session'").all();

// Prefix queries
db.prepare("SELECT * FROM l2_search WHERE l2_search MATCH 'auth*'").all();

// Column-specific search
db.prepare("SELECT * FROM l2_search WHERE l2_search MATCH 'title:auth OR content:JWT'").all();

// Delete
db.prepare("DELETE FROM l2_search WHERE docId = ?").run("plan:001:task-1");
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★★★☆ — Works with materialized text. FTS5 tokenizer handles content well. |
| **Incremental** | ★★★★★ — Standard SQL INSERT/UPDATE/DELETE. FTS5 index updates automatically. |
| **Query types** | ★★★★★ — BM25 ✅, Boolean (AND/OR/NOT) ✅, Prefix ✅, Column filtering ✅, Phrase ✅, NEAR ✅, Snippet highlighting ✅. Best query language of all options. |
| **Dependencies** | ★★☆☆☆ — Native C addon. Requires node-gyp/prebuilt binaries. ~5 MB download. New dependency. |
| **Complexity** | ★★★☆☆ — SQL is familiar but adds a new runtime dependency and data management concern. |

**Pros:**
- **Most powerful query language** of all options — boolean operators, phrase matching, NEAR proximity, column-specific search, BM25 ranking, snippet highlighting all built in
- True FTS5 BM25 ranking (same algorithm as MiniSearch but implemented at the C level — faster)
- Can persist to disk for instant startup (no re-index needed)
- Can combine FTS5 with regular SQL queries (JOIN with structured metadata tables)
- Concurrent read access (WAL mode)
- Widely used, well-understood technology

**Cons:**
- **Native addon** — requires node-gyp or prebuilt binaries. Adds CI/CD complexity. Can fail on ARM/Alpine/Windows edge cases.
- **New runtime dependency** — 5 MB binary, not a JS library
- **Impedance mismatch** — CRDT data is in Yjs (JavaScript objects), search is in SQLite (SQL). Must maintain a sync pipeline.
- **Overpowered** — FTS5's full SQL query language is more than agents need for L2 search
- **Memory model** — SQLite uses its own memory for the index, not shared with Node.js heap. At L2 scale, this overhead isn't justified.

**Verdict:** **Technically excellent but architecturally heavy for L2.** The native dependency and SQL-based data model add friction that isn't justified for L2's small document counts. If the system grew to L3 scale (thousands of documents, need for persistence, complex boolean queries), SQLite FTS5 would be the strongest option. For L2, MiniSearch or Orama provide sufficient capability with less complexity.

---

### C4. DuckDB

**npm:** `duckdb` or `@duckdb/node-api` · **Weekly downloads:** ~70K · **License:** MIT

Analytical SQL database. Excellent for running aggregations over structured data (plans, manifests). Overkill for text search but powerful for structured queries.

```typescript
import duckdb from "duckdb";    
const db = new duckdb.Database(":memory:");

// Load plan JSON directly
db.run(`
  CREATE TABLE tasks AS 
  SELECT * FROM read_json_auto('data/plans/team-1/*/plan-*.json', 
    union_by_name=true)
`);

// Analytical queries
db.all(`
  SELECT assigned_role, status, COUNT(*) as count
  FROM tasks
  GROUP BY assigned_role, status
  ORDER BY count DESC
`);

// Filter queries
db.all(`
  SELECT title, description, assigned_role
  FROM tasks
  WHERE status = 'completed' AND assigned_role = 'researcher'
`);
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★☆☆☆ — For structured JSON queries, excellent. For text search, not its purpose. |
| **Incremental** | ★★☆☆☆ — Designed for bulk analytics, not real-time incremental updates. |
| **Query types** | ★★★☆☆ — SQL aggregates ✅, JSON ✅, Regex ✅. No FTS, no fuzzy, no semantic. |
| **Dependencies** | ★☆☆☆☆ — Large native dependency (~50 MB). |
| **Complexity** | ★★☆☆☆ — Powerful but heavy. Learning curve. |

**Verdict:** **Not recommended for L2 search.** DuckDB excels at analytical workloads (OLAP) — not at search. If the system needed analytical queries over plan/manifest data at scale (e.g., "what's the average task completion time by role across all teams?"), DuckDB would be excellent. For L2 search, it's the wrong tool.

---

## 6. D — Yjs-Specific Patterns

### D1. Yjs Observe + Index (Real-Time Incremental)

The most natural integration: use Yjs's built-in observe mechanism to maintain a search index that updates in real-time as CRDT documents change.

**How Y.Map.observe works:**

```typescript
const ymap = ydoc.getMap("agent-statuses");

ymap.observe((event) => {
  event.changes.keys.forEach((change, key) => {
    if (change.action === "add" || change.action === "update") {
      const value = ymap.get(key);
      searchIndex.upsert(`${docName}:${key}`, {
        content: JSON.stringify(value),
        docType: "crdt-map-entry",
        key,
      });
    } else if (change.action === "delete") {
      searchIndex.remove(`${docName}:${key}`);
    }
  });
});
```

**How Y.Array.observe works:**

```typescript
const yarray = ydoc.getArray("chat-outcomes");

yarray.observe((event) => {
  // For arrays, it's simpler to re-index the whole array
  // (append-only means mostly new additions)
  let index = 0;
  event.changes.delta.forEach((delta) => {
    if (delta.retain) index += delta.retain;
    if (delta.insert) {
      for (const item of delta.insert as any[]) {
        searchIndex.add({
          id: `${docName}:${item.sessionId || index}`,
          content: JSON.stringify(item),
          docType: "chat-outcome",
        });
        index++;
      }
    }
    if (delta.delete) {
      // Items deleted — would need ID tracking
    }
  });
});
```

**How Y.XmlFragment.observe works:**

```typescript
const fragment = ydoc.getXmlFragment("content");

// Deep observe — catches changes to any nested element/text
fragment.observeDeep((events) => {
  // Re-extract full text and re-index the document
  const text = xmlFragmentToText(fragment);
  searchIndex.upsert(`${docName}:content`, {
    content: text,
    docType: "rich-text",
  });
});
```

**Integration with MiniSearch:**

```typescript
class L2SearchIndex {
  private miniSearch = new MiniSearch({
    fields: ["content", "title"],
    storeFields: ["docType", "docId", "key", "content"],
    searchOptions: { fuzzy: 0.2, prefix: true },
  });

  private observers = new Map<string, () => void>();

  /** Attach to a Yjs document and keep index in sync */
  attachToDoc(docName: string, ydoc: Y.Doc) {
    // Index all shared types
    for (const [typeName, sharedType] of ydoc.share.entries()) {
      if (sharedType instanceof Y.Map) {
        this.indexMap(docName, typeName, sharedType);
        sharedType.observe((event) => {
          this.onMapChange(docName, typeName, sharedType, event);
        });
      } else if (sharedType instanceof Y.Array) {
        this.indexArray(docName, typeName, sharedType);
        sharedType.observe((event) => {
          this.onArrayChange(docName, typeName, sharedType, event);
        });
      } else if (sharedType instanceof Y.XmlFragment) {
        this.indexXml(docName, typeName, sharedType);
        sharedType.observeDeep(() => {
          this.reindexXml(docName, typeName, sharedType);
        });
      } else if (sharedType instanceof Y.Text) {
        this.indexText(docName, typeName, sharedType);
        sharedType.observe(() => {
          this.reindexText(docName, typeName, sharedType);
        });
      }
    }
  }
  
  // ... handler implementations
}
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★★★★ — Designed for Yjs. Hooks directly into CRDT change events. |
| **Incremental** | ★★★★★ — Updates on every CRDT mutation. No polling, no full re-index. |
| **Query types** | Depends on backing engine (MiniSearch → keyword+fuzzy, Orama → +vector+filters) |
| **Dependencies** | ★★★★★ — Uses Yjs observe API (already available). |
| **Complexity** | ★★★☆☆ — Must handle all shared types (Map, Array, XmlFragment, Text). Observer lifecycle management. Debouncing to avoid excessive re-indexing on rapid changes. |

**Key design considerations:**

1. **Debouncing:** XmlFragment (BlockNote rich text) can fire dozens of events per keystroke. Debounce re-indexing at 300-500ms.
2. **Observer cleanup:** Store observer references and `unobserve()` when docs are closed or spaces archived.
3. **Initial index:** When a doc is opened, index all existing content first, then attach observers.
4. **Thread safety:** Yjs mutations are single-threaded per Y.Doc, so observer callbacks are safe. But don't do async work inside observers — extract data synchronously, enqueue async index updates.

**Verdict:** **This is the correct integration pattern regardless of which search engine is chosen.** The question isn't "observe vs. poll" (observe wins) but "what do we feed the observations into?" (MiniSearch, Orama, or custom).

---

### D2. Y.Doc.toJSON() Materialization

The simplest approach: serialize the entire Yjs document to JSON and search the JSON.

```typescript
const doc = await space.openDoc("agent-statuses");
const json = doc.toJSON();
// json = { "agent-statuses": { researcher: { status: "working", ... }, ... }, "default": { _meta: {...} } }

// Search with Fuse.js over the JSON
const entries = Object.entries(json["agent-statuses"])
  .map(([key, value]) => ({ key, ...value as any }));
const fuse = new Fuse(entries, { keys: ["key", "status", "role"] });
const results = fuse.search("researcher");
```

**Or with JSONPath:**

```typescript
import { JSONPath } from "jsonpath-plus";

const allDocs = {};
for (const docName of await space.listDocs()) {
  const doc = await space.openDoc(docName);
  allDocs[docName] = doc.toJSON();
}

// Query across all docs
const findings = JSONPath({
  path: "$..tasks[?(@.status==='completed')]",
  json: allDocs,
});
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★★★☆ — Works for any CRDT type. Y.XmlFragment.toJSON() returns raw XML structure though (not human-readable text). |
| **Incremental** | ★★☆☆☆ — `toJSON()` serializes the entire doc every time. No delta. O(n) on every search. |
| **Query types** | Depends on what you do with the JSON (JSONPath for structured, Fuse for fuzzy, etc.) |
| **Dependencies** | ★★★★★ — Built into Yjs. |
| **Complexity** | ★★★★★ — One line: `doc.toJSON()`. |

**When it's good:**
- Ad-hoc/one-off queries where search latency doesn't matter
- Small documents (< 100 KB JSON)
- Situations where building an index isn't justified

**When it's bad:**
- Repeated queries (no caching/indexing — reserialize every time)
- Large documents (XmlFragment serialization can produce large XML trees)
- Real-time search (latency of toJSON() + search on every keystroke)

**Verdict:** **Good for bootstrapping and ad-hoc queries.** Use `toJSON()` + JSONPath for structured queries on small docs (plan tasks, agent statuses). Don't use it as the primary search mechanism for text content. The existing `collab` tool already uses `toJSON()` for its read operations — extending it with JSONPath for structured queries is low-effort and high-value.

---

### D3. Hocuspocus onChange Hooks

The Hocuspocus server already has an `onChange` hook that fires after CRDT mutations are persisted:

```typescript
// Already in HocuspocusServer.ts:
async onChange({ document, documentName }: { document: Y.Doc; documentName: string }) {
  await projectToFilesystem(documentName, document, repoPath);
}
```

This hook could be extended to also feed a search index:

```typescript
async onChange({ document, documentName }) {
  // Existing: project to filesystem
  await projectToFilesystem(documentName, document, repoPath);
  
  // NEW: Update search index
  await l2SearchIndex.indexDoc(documentName, document);
}
```

**Evaluation:**

| Criterion | Assessment |
|-----------|-----------|
| **Fit** | ★★★★★ — Already fires on every CRDT change. Perfect hook point. |
| **Incremental** | ★★★★☆ — Fires per-document (not per-key). Re-indexes entire doc on any change. Better than full rebuild, worse than per-key observe. |
| **Query types** | N/A — this is an event source, not a search engine. |
| **Dependencies** | ★★★★★ — Already exists. 2 lines of code to extend. |
| **Complexity** | ★★★★★ — Add 2 lines to existing onChange handler. |

**Key difference from D1 (observe):**

| Aspect | Y.Map.observe (D1) | Hocuspocus onChange (D3) |
|--------|-------------------|------------------------|
| **Granularity** | Per-key changes with add/update/delete action | Whole document changed (no delta info) |
| **When fires** | Immediately on mutation | After persistence (batched/debounced by Hocuspocus) |
| **Access to change** | Full change event with old/new values | Only the current document state |
| **Where it runs** | On any Y.Doc (in-process or remote) | Only on the Hocuspocus server |

**Verdict:** **Simplest integration point** for "good enough" search indexing. Use `onChange` to rebuild the entire doc's index entry on each change. For most L2 documents (small JSON maps, short arrays), this is fast enough. Only switch to per-key observe (D1) if profiling shows `onChange` is a bottleneck.

---

### D4. y-indexeddb / y-mongodb Patterns

**y-indexeddb** and **y-mongodb-provider** are Yjs persistence providers. They store raw CRDT updates (binary deltas), not searchable content. There are **no search-over-persistence patterns** in the Yjs ecosystem.

| Provider | What it Stores | Search Capability |
|----------|---------------|-------------------|
| **y-indexeddb** | Binary Yjs updates in browser IndexedDB | None — binary blobs only |
| **y-mongodb-provider** | Binary Yjs updates in MongoDB | None — binary blobs only |
| **@hocuspocus/extension-database** (what we use) | Binary state snapshot as Buffer | None — binary blob |
| **y-leveldb** | Binary Yjs updates in LevelDB | None |

**The Yjs ecosystem pattern for search:**

There is no established pattern. The community approach is:
1. Materialize CRDT state to readable format (JSON, text, markdown)
2. Index the materialized content with an external search engine
3. Re-index on observe events or persistence hooks

We're already doing step 1 (`projectToFilesystem`) and step 3 (`onChange`). Step 2 is what this research is about.

**Verdict:** **No reusable patterns from the Yjs ecosystem.** We must build the search layer ourselves. The good news: our `projectToFilesystem` + `onChange` hook architecture is already the right foundation.

---

## 7. Comparison Matrix

### Full-Text / Keyword Search

| | MiniSearch (A1) | Orama (A2) | FlexSearch (A3) | Lunr.js (A4) | Fuse.js (A5) | MongoDB (A6) |
|---|---|---|---|---|---|---|
| **BM25 ranking** | ✅ | ✅ | ❌ (custom) | ✅ | ❌ | ✅ (Atlas) |
| **Fuzzy matching** | ✅ (0.0-1.0) | ✅ | Partial | ✅ | ✅ (best) | ✅ (Atlas) |
| **Prefix search** | ✅ | ✅ | ✅ | ✅ | ❌ | ✅ (Atlas) |
| **Incremental add/remove** | ✅ | ✅ | ✅ | ❌ FATAL | ❌ (full replace) | ✅ |
| **Structured filters** | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ |
| **Vector search** | ❌ | ✅ | ❌ | ❌ | ❌ | ✅ (Atlas) |
| **Hybrid (text+vector)** | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ (separate pipes) |
| **Serializable** | ✅ | ✅ | ✅ (complex) | ✅ | N/A | N/A (DB) |
| **New dependency** | None | ~150 KB | ~50 KB | ~8 KB | None (transitive) | None |
| **TypeScript** | ✅ built-in | ✅ built-in | ❌ (community) | ❌ | ✅ built-in | ✅ |
| **Weekly downloads** | 705K | 160K | 916K | 1.1M | 3M | N/A |

### Vector / Semantic Search

| | Orama vectors (B1) | Atlas Vector (B2) | Vectra (B3) | DIY cosine (B4) | LangChain Memory (B5) |
|---|---|---|---|---|---|
| **Accuracy** | Good | Best (HNSW) | Good (brute force) | Good (brute force) | Good (brute force) |
| **Text+vector hybrid** | ✅ built-in | ❌ (separate) | ❌ | ❌ | ❌ |
| **Persistence** | Custom | ✅ (MongoDB) | ✅ (filesystem) | ❌ (in-memory) | ❌ (in-memory) |
| **New dependency** | Orama (if adopted) | None | ~50 KB | None | None |
| **Performance at L2 scale** | ⚡ | Network latency | ⚡ | ⚡ | ⚡ |
| **Max practical scale** | ~100K docs | Millions | ~10K | ~5K | ~5K |

### Structured Query

| | JSONPath (C1) | Custom Index (C2) | SQLite FTS5 (C3) | DuckDB (C4) |
|---|---|---|---|---|
| **Path traversal** | ✅ | ❌ | ❌ | ✅ |
| **Filter predicates** | ✅ | ❌ | ✅ (SQL) | ✅ (SQL) |
| **No index needed** | ✅ | ❌ | ❌ | ✅ |
| **Full-text search** | ❌ | ✅ (basic) | ✅ (BM25) | ❌ |
| **New dependency** | ~13 KB | None | ~5 MB (native) | ~50 MB (native) |
| **Fit for L2** | ★★★★★ | ★★☆☆☆ | ★★★★☆ | ★★☆☆☆ |

### Yjs Integration

| | Observe (D1) | toJSON (D2) | onChange (D3) | y-* providers (D4) |
|---|---|---|---|---|
| **Granularity** | Per-key/item | Whole doc | Whole doc | N/A (no search) |
| **Latency** | Instant | On demand | After persist | N/A |
| **Complexity** | Medium (observer lifecycle) | Trivial | Trivial (2 lines) | N/A |
| **Best for** | High-frequency docs | Ad-hoc queries | General indexing | Not applicable |

---

## 8. Recommendation

### Recommended Architecture: Tiered L2 Search

Given the constraints (small document counts at L2, CRDT data that changes in real-time, existing MiniSearch expertise, existing MongoDB + Atlas Vector Search infrastructure), the recommended approach is a **tiered search system**:

```
┌──────────────────────────────────────────────────────────────────┐
│                    L2 SEARCH ARCHITECTURE                         │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  TIER 1: Structured Query (JSONPath)                             │
│  ├── "Find tasks where role = researcher"                        │
│  ├── "List completed tasks with their outputs"                   │
│  ├── Operates on live Y.Doc.toJSON() — no index needed           │
│  └── Perfect for plan tasks, agent statuses, manifests           │
│                                                                  │
│  TIER 2: Keyword Search (MiniSearch — second instance)           │
│  ├── "Find documents mentioning authentication"                  │
│  ├── BM25 ranking, fuzzy, prefix matching                        │
│  ├── Fed by Hocuspocus onChange hook (D3)                        │
│  ├── Zero new dependencies                                      │
│  └── Covers: CRDT text, plan descriptions, manifest summaries   │
│                                                                  │
│  TIER 3: Semantic Search (if/when needed)                        │
│  ├── "Find content related to payment processing"                │
│  ├── Option A: Orama hybrid (if Tier 2 swaps to Orama)          │
│  ├── Option B: DIY cosine similarity (simplest, proven)          │
│  └── Defer until Tier 1+2 prove insufficient                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### Phase 1 (Immediate — Low Risk)

**MiniSearch second instance + JSONPath for structured queries**

| Component | Technology | Why |
|-----------|-----------|-----|
| Keyword search | MiniSearch (second instance) | Zero new deps, team familiarity, proven incremental updates |
| Structured query | `jsonpath-plus` on `Y.Doc.toJSON()` | ~13 KB dep, no index, perfect for plan/status queries |
| Index updates | Hocuspocus `onChange` hook | Already exists, 2 lines to extend |
| Text extraction | Existing `xmlFragmentToText()` / `xmlFragmentToMarkdown()` | Already implemented in `HocuspocusServer.ts` and `tools/index.ts` |

**Why MiniSearch over Orama for Phase 1:**

1. **Zero new dependencies** — already installed, already understood
2. **Proven incremental updates** — the L1 index already does add/remove/discard
3. **Serializable** — can snapshot to MongoDB (same as L1 → L2 IndexPersistence)
4. **Risk reduction** — reusing a known-working pattern vs. adopting a new library
5. **Sufficient for L2 scale** — dozens to low-hundreds of documents don't need more

**Estimated effort:** 2-3 days

### Phase 2 (When Text Search Proves Insufficient)

**Evaluate Orama for hybrid text+vector**

If agents frequently need semantic search over L2 content (e.g., "find research related to payment handling" where keywords don't match), upgrade from MiniSearch to Orama:

| What changes | From | To |
|-------------|------|-----|
| Search engine | MiniSearch | Orama |
| Embedding | None | `text-embedding-3-small` (already available) |
| Query types | Keyword + fuzzy | Keyword + fuzzy + vector + hybrid + filters |
| New dependency | None | `@orama/orama` (~150 KB) |

**Why Orama and not separate MiniSearch + DIY cosine:**

Orama's single-library hybrid mode eliminates the manual score merging that separate engines require. One `search()` call does text + vector + filters. This is architecturally simpler than maintaining two search backends and a score fusion layer.

**Trigger for Phase 2:** When agents report that keyword search isn't finding relevant L2 content (synonyms, conceptual queries, cross-language matching).

**Estimated effort:** 2 days (swap search backend, add embeddings on index)

### What NOT to Do

| Avoid | Why |
|-------|-----|
| MongoDB as L2 search backend | Network latency, CRDT → MongoDB sync complexity, overkill for L2 scale |
| SQLite FTS5 | Native addon complexity, not justified at L2 scale |
| DuckDB | Wrong tool for the job (analytics, not search) |
| FlexSearch | Quirky API, poor TypeScript, no filters, already rejected |
| Lunr.js | Immutable index — fatal for CRDT updates |
| Custom inverted index | Reinventing MiniSearch but worse |
| Vectra | Vector-only, small community, no advantage over Orama |
| Per-key Y.Map.observe for all docs | Over-engineering for Phase 1. Use onChange hook. Switch to observe only for specific high-frequency docs if profiling shows onChange is too coarse. |

### Integration Sketch

```typescript
// In L2CollaborationPlugin — extend with search

class L2CollaborationPlugin implements IL2CollaborationPlugin {
  private searchIndex: L2SearchIndex;  // NEW

  async initialize() {
    // ... existing init ...
    this.searchIndex = new L2SearchIndex();

    // Index existing plans
    const plans = await this._planStore.listAllPlans();
    for (const meta of plans) {
      const plan = await this._planStore.loadPlan(meta.planId, meta.goalId);
      if (plan) this.searchIndex.indexPlan(plan);
    }

    // Index existing output manifests
    const manifests = await this.getAllManifests(this.config.repoPath || ".");
    for (const m of manifests) this.searchIndex.indexManifest(m);
  }

  // Called from HocuspocusServer onChange hook
  onCrdtDocChange(docName: string, doc: Y.Doc) {
    this.searchIndex.indexCrdtDoc(docName, doc);
  }

  // Exposed to collab tool
  search(query: string, opts?: { docType?: string; topK?: number }) {
    return this.searchIndex.search(query, opts);
  }

  structuredQuery(path: string, data?: any) {
    return JSONPath({ path, json: data || this.getAllLiveDocState() });
  }
}
```

### Summary Table

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Keyword search engine** | MiniSearch (Phase 1), Orama (Phase 2 if needed) | Zero deps → proven → upgrade path |
| **Structured queries** | JSONPath (`jsonpath-plus`) | No index, perfect for plan/status/manifest queries |
| **CRDT → index pipeline** | Hocuspocus `onChange` hook | Already exists, minimal code |
| **Text extraction** | Existing `xmlFragmentToText()` | Already implemented |
| **Semantic search** | Defer (DIY cosine or Orama hybrid when needed) | Not proven necessary at L2 yet |
| **Persistence** | MiniSearch `toJSON()` → MongoDB (same as L1) | Proven pattern |
| **Vector embeddings** | Existing `text-embedding-3-small` via `EmbeddingService` (when ready) | Already integrated for skills |

> **Note:** The above recommendation (section 8) was the initial analysis. Sections 9-12 below supersede it with a more complete architectural decision after further research into Hocuspocus internals, the Yjs ecosystem, and agent context-finding patterns across the industry.

---

## 9. Hocuspocus Search Extension — Architecture Decision

### The Ecosystem Answer: Nobody Has Built This

Exhaustive research (npm, GitHub, Hocuspocus issues, Yjs community forums) confirmed:

| What we looked for | Result |
|---|---|
| `@hocuspocus/extension-search` | **Does not exist** |
| `y-search` / `yjs-search` on npm | **Does not exist** |
| Hocuspocus query/search/filter API | **None** — it is a sync server only |
| Yjs wire protocol (`y-protocols`) query ops | **None** — sync, awareness, auth only |
| `y-mongodb-provider` content queries | **No** — stores binary blobs, has `getAllDocNames()` but no text search |
| Liveblocks cross-document search | **No** |
| Y-Sweet search API | **No** |
| Tiptap cross-doc search | **No** (single-doc find/replace only, paid) |
| Hocuspocus GitHub issues about search | **Zero** feature requests — ever |

**How production Yjs apps solve search:**

| App | Uses Yjs? | Search approach |
|---|---|---|
| **AFFiNE** | Yes (BlockSuite/Yjs) | **SQLite FTS5** locally, server-side index for cloud |
| **Outline** | Yes (y-prosemirror) | **PostgreSQL tsvector/tsquery** — documents stored as Markdown in Postgres |
| **Obsidian** | Proprietary CRDT | Materialize to `.md` files on disk then search local files |

**Reason nobody built it:** Yjs/CRDTs are replication primitives, not databases. Documents are stored as binary blobs (`Uint8Array`). Search is considered an application-level concern. Every app builds its own secondary index.

### Why L2 Search Can Be Faster Than L1

L1 actual latency chain:

| L1 Tool | What happens | Latency |
|---|---|---|
| `workspace_grep` | Spawns ripgrep child process, disk I/O, parse stdout | **50-200ms** |
| `keyword_search` | In-memory MiniSearch BM25 | **<1ms** |
| `read_file` | `fs.readFileSync()` from disk | **1-10ms** |
| `find_symbol` | In-memory SymbolIndex | **<1ms** |

The expensive L1 tools (grep, read_file) hit **disk** and **spawn processes**. Yjs documents live entirely **in memory** as JavaScript objects. `Y.Map.toJSON()` is a pointer walk — nanoseconds. A search index over Yjs content skips the two slowest parts of L1.

### Hocuspocus Provides All Building Blocks

Confirmed from `@hocuspocus/server@3.4.4` source code:

| Building block | Available | API |
|---|---|---|
| Index on doc change | Yes | `onStoreDocument` — debounced (2s/10s), receives full `Y.Doc` |
| Index on doc load | Yes | `afterLoadDocument` — fires when any doc loads from persistence |
| Serve HTTP search endpoints | Yes | `onRequest` — raw Node.js `IncomingMessage`/`ServerResponse` on same port |
| Extension holds persistent state | Yes | Extension is a class instance — lives for server lifetime |
| Iterate all loaded docs | Yes | `instance.documents` is `Map<string, Document>` |
| Load any doc server-side | Yes | `openDirectConnection(docName)` — triggers persistence fetch if not in memory |
| Extract text from all Yjs types | Yes | Existing helpers: `xmlFragmentToText()`, `Y.Map.toJSON()`, `Y.Text.toString()`, `doc.share` iteration |

### Key Hooks

**`onStoreDocument`** — The right hook for search indexing:
- Debounced at 2000ms (configurable), max 10000ms
- Fires immediately on last client disconnect
- Receives full `Y.Doc` — extract text via `doc.share.entries()`
- Runs inside `saveMutex` — no concurrent calls
- Better than `onChange` (which fires on every keystroke)

**`onRequest`** — Custom HTTP endpoints on the same port:
- Receives `{ request, response, instance }` — standard Node.js HTTP handler
- Write response + `throw null` to prevent default handler
- Full access to `instance.documents` and `instance.openDirectConnection()`

**Key insight: index survives doc unload.** Extension state persists for the server lifetime. Even after a doc is unloaded from memory, its index entries remain searchable.

---

## 10. Agent Context-Finding Patterns — Industry Research

### How Top AI Agents Find Context

Studied: Cursor, GitHub Copilot Workspace, Aider, Cline, Devin, SWE-Agent, OpenHands, Claude Code, Windsurf, Amazon Q.

**Core strategies every agent uses:**

| Strategy | Best example | Our L1 | Our L2 |
|---|---|---|---|
| Regex grep | ripgrep (universal) | Yes `workspace_grep` | **Gap — need /grep** |
| BM25 keyword search | Cursor, Claude Code | Yes `keyword_search` | **Gap — need /search** |
| Repo map (ranked symbols) | Aider (ctags + PageRank) | Yes `get_repo_map` | N/A (not code) |
| Symbol search | Cursor (LSP), Cline (tree-sitter) | Yes `find_symbol` | N/A |
| Dependency analysis | Aider, Windsurf, Amazon Q | Yes `get_dependencies` | N/A |
| Progressive disclosure | SWE-Agent (viewport), Aider | Yes `collab discover` | Partial — no drill-down search |
| File summary | Claude Code, Cline | Yes `get_file_summary` | N/A |
| Project conventions | Claude Code (CLAUDE.md) | Yes (Identity card) | Yes |

**Advanced strategies (where we have gaps):**

| Strategy | What it does | Used by | Our status |
|---|---|---|---|
| **Semantic search** | Embedding-based conceptual match | Cursor, Windsurf, Amazon Q | Missing at L1/L2 |
| **Find all references** | "What calls this function?" | Cursor (LSP) | Exists in SymbolIndex but uses naive text search, not exposed as tool |
| **Git diff** | What changed in a commit | Aider, Claude Code, Devin | Missing as L1 tool |
| **Error-driven context** | Compiler/test errors as context signals | SWE-Agent, Amazon Q, Aider | Missing |
| **Context budget management** | Rank + trim context to token budget | Cursor (packer), OpenHands (condenser) | Missing |
| **Viewport scrolling** | Fixed-size window into files | SWE-Agent | Missing |

### SWE-bench Key Findings

1. **Repo maps are critical** — Agents with compressed codebase overviews significantly outperform grep-only agents
2. **~40% of failures** come from identifying the wrong files — better symbol/dependency tools reduce this
3. **Precision > recall** — 3 highly relevant files beat 15 somewhat-relevant files ("lost in the middle" effect)
4. **Iterative search** outperforms single-shot — search, read, refine, search more
5. **Tool diversity** has positive marginal value — each additional context tool improves outcomes

---

## 11. L2-Specific Context Capabilities for Multi-Agent

These capabilities exist **only because multiple agents share L2 state**. Not found in single-agent tools (Cursor, Aider, Claude Code, etc.).

| Capability | Description | Priority |
|---|---|---|
| **Cross-agent search** | "Search what ALL agents have written/discovered" — keyword search across all CRDT docs, output manifests, chat outcomes | **P0** |
| **Cross-agent output search** | "What did anyone write about error handling?" — search ALL output manifests, not just prerequisite outputs | **P0** |
| **Structured query on plans** | "Find tasks assigned to me", "Show completed tasks" — JSONPath filters on plan JSON | **P0** |
| **What's new feed** | "What changed since I last checked?" — timestamp-based changelog | **P1** |
| **Role-filtered search** | "Show only backend-relevant results" — search scoped by agent role | **P1** |
| **Semantic deduplication** | "Has anyone already investigated X?" — prevents redundant work across agents | **P1** |
| **Collective knowledge accumulation** | Team's L2 docs grow into a searchable knowledge base over time | **P1** |
| **Plan change awareness** | "Did my task change while I was working?" | **P2** |
| **Expertise routing** | "Which teammate knows about topic X?" | **P2** |
| **Provenance metadata** | "Who produced this? When? Confidence level?" | **P2** |
| **Conflict-aware editing** | "Another agent is editing the same area" | **P2** |

**Why this matters (research):** MetaGPT, CAMEL, and ChatDev papers show that teams with structured shared memory produce higher quality output. Role-specific context filtering improves performance. Plan visibility reduces coordination errors.

---

## 12. Final Consolidated Design

### Architecture: Hocuspocus Search Extension

`
Hocuspocus Server (same port: WebSocket + HTTP)
+-- Database Extension (existing — binary persistence)
+-- Search Extension (NEW)
|   +-- MiniSearch index (in-memory, server-lifetime, survives doc unloads)
|   +-- afterLoadDocument --> index doc on load
|   +-- onStoreDocument --> re-index on change (debounced 2s)
|   +-- onChange --> append to changelog (for whatsnew)
|   +-- onConfigure --> startup indexing of all persisted docs
|   +-- onRequest --> HTTP endpoints:
|       +-- GET /search?q=auth&limit=20&role=researcher
|       +-- GET /grep?pattern=TODO&doc=shared-context
|       +-- GET /ls?path=/crdt/
|       +-- GET /cat?path=/crdt/shared-context/blockers
|       +-- GET /query?path=$.tasks[?(@.assignedRole=='researcher')]
|       +-- GET /stat?path=/crdt/shared-context
|       +-- GET /whatsnew?since=1710000000000
|       +-- GET /stats
+-- onChange (existing — filesystem projection, to be removed)
`

### Performance vs L1

| Operation | L1 | L2 (this design) | L2 Advantage |
|---|---|---|---|
| Grep | 50-200ms (ripgrep process spawn + disk) | 2-10ms (HTTP + in-memory regex) | **10-30x faster** |
| Keyword search | <1ms (MiniSearch) | 2-10ms (HTTP + MiniSearch) | Slightly slower (network), but shared index |
| List files | 5-50ms (fast-glob, disk scan) | 2-5ms (HTTP + in-memory doc list) | **5-10x faster** |
| Read file | 1-10ms (disk I/O) | 5-20ms (HTTP + Y.Doc.toJSON) | Comparable |
| Structured query | N/A | 2-10ms (HTTP + JSONPath on live Y.Doc) | **Unique to L2** |
| What's new | N/A | 2-5ms (HTTP + changelog scan) | **Unique to L2** |

### Agent Tool (`l2`)

Agents get one tool with filesystem-inspired verbs:

| Verb | What it does | Speed vs L1 |
|---|---|---|
| `search` "authentication JWT" | BM25 ranked results with snippets | Comparable to `keyword_search` |
| `grep` "TODO" or "FIXME" | Regex matches: doc:key:line: content | **10-30x faster** than `workspace_grep` |
| `ls` /crdt/ | List available docs | **5-10x faster** than `workspace_glob` |
| `cat` /crdt/shared-context/blockers | Read specific content | Comparable to `read_file` |
| `query` $.tasks[?(@.status=='completed')] | Structured filter results | **Unique to L2** |
| `find` *.json | Name-pattern match across L2 paths | Comparable to `workspace_glob` |
| `whatsnew` --since=1710000000000 | Changes since timestamp | **Unique to L2** (multi-agent only) |
| `stat` /crdt/shared-context | Type, size, keys, last-modified | Comparable to `workspace_file_stats` |

### Virtual Path Schema

`
/                                     --> Root: [crdt/, plans/, outputs/]
/crdt/                                --> List CRDT doc names
/crdt/{docName}                       --> Full doc as JSON (Y.Map.toJSON)
/crdt/{docName}/{key}                 --> Specific key from Y.Map
/crdt/{docName}/{key}/{subkey}        --> Nested value drill-down
/plans/                               --> List plan IDs with metadata
/plans/{planId}                       --> Full plan JSON (StoredPlan)
/plans/{planId}/tasks                 --> Task list
/plans/{planId}/tasks/{taskId}        --> Specific task
/outputs/                             --> List output manifests
/outputs/{taskId}                     --> Full manifest JSON
/outputs/{taskId}/files               --> Output file list
`

### What This Unlocks for Multi-Agent Context

| Scenario | How an agent does it |
|---|---|
| "Has anyone researched X?" | `l2 search "X"` -- finds results across all CRDT docs, output manifests |
| "What tasks are assigned to me?" | `l2 query "$.tasks[?(@.assignedRole=='researcher')]"` |
| "What did the architect decide?" | `l2 search "architect decision"` + `l2 cat "/crdt/chat-outcomes"` |
| "Show completed tasks" | `l2 query "$.tasks[?(@.status=='completed')]"` |
| "What files did the backend agent produce?" | `l2 grep "backend-developer" --type=output` |
| "What changed while I was working?" | `l2 whatsnew --since=1710000000000` |
| "Find all security-related context" | `l2 search "security vulnerability CVE"` |

### Decisions

| Decision | Choice | Rationale |
|---|---|---|
| **Where index lives** | Hocuspocus server process | Single index, always warm, shared by all agents |
| **Search engine** | MiniSearch (Phase 1), Orama (Phase 2) | Zero new deps, upgrade when semantic search needed |
| **Agent to server communication** | HTTP to Hocuspocus `onRequest` endpoints | Same port, no new infra |
| **Index update hooks** | `afterLoadDocument` + `onStoreDocument` | Debounced, full Y.Doc, battle-tested |
| **Structured queries** | JSONPath on live `Y.Doc.toJSON()` | No index needed, instant |
| **Remove `projectToFilesystem()`** | Yes | HTTP endpoints replace filesystem reads |
| **Changelog for "what's new"** | `onChange` appends to ring buffer with timestamps | Novel multi-agent capability |

### Gap Checklist — What to Build Beyond Search

| Capability | Priority | Part of this feature? |
|---|---|---|
| L2 keyword search | P0 | Yes — core of search extension |
| L2 structured query (JSONPath) | P0 | Yes — /query endpoint |
| Cross-agent output search | P0 | Yes — output manifests indexed |
| L2 grep (regex) | P0 | Yes — /grep endpoint |
| Incremental sync ("what's new") | P1 | Yes — /whatsnew endpoint |
| Role-filtered search | P1 | Yes — role filter on search/query |
| Find all references (callers) at L1 | P1 | No — separate feature, extends SymbolIndex |
| Git diff tool at L1 | P1 | No — separate feature, `workspace_diff` |
| Context budget management | P1 | No — separate cross-cutting feature |
| Semantic/vector search | P2 | No — upgrade MiniSearch to Orama when needed |
| Call graph / type hierarchy | P2 | No — separate feature, extends tree-sitter |
| Error-driven context | P2 | No — separate feature, build/test integration |
| Plan change notifications | P2 | Partial — whatsnew covers plan changes |
