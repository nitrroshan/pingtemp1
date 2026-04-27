# CRDT Search & Navigation — Architecture

**Date:** April 27, 2026  
**Status:** Research complete, ready for implementation planning  
**Priority:** P0 — Prerequisite for all other CRDT features  
**Research:** [crdt-team-memory/research.md](../crdt-team-memory/research.md)  
**Depends on:** None (uses existing Hocuspocus + Y.js)

---

## Problem

Agents have 36 tools for navigating workspace files (grep, keyword search, glob, read, write, search-and-replace). For CRDT docs, they have 1 tool (`collab`) with 7 actions — none of which include search, grep, or glob. Agents rationally skip CRDT and write everything to files, killing collaboration.

CRDT has a structural speed advantage (everything already in memory, 10-100x faster than disk I/O), but it's unexploited because no search/navigation layer exists.

## Architecture

A Hocuspocus extension that maintains an Orama index over all CRDT docs, plus agent tools that expose search/grep/glob/query/changelog capabilities.

```
Hocuspocus Server
├── CRDT Sync (existing)
├── Persistence (existing)
└── CrdtSearchExtension (new)
    ├── Orama index (in-memory, BM25 keyword search)
    ├── onChange → debounce (2s) → extract text → re-index
    ├── Capabilities:
    │   ├── search(query)      — BM25 keyword search across all docs
    │   ├── grep(pattern)      — regex on extracted text
    │   ├── glob(pattern)      — micromatch on doc names
    │   ├── query(jsonpath)    — JSONPath on live doc.toJSON()
    │   ├── cat(docName)       — read doc content
    │   ├── stat(docName)      — doc metadata (size, last modified)
    │   └── whatsnew(since)    — changelog since timestamp
    └── Agent tool: `l2_search` wrapping all capabilities
```

### Text Extraction (the Bridge)

CRDT docs are in-memory JavaScript objects, not files. Every search operation needs extraction:

```typescript
function extractSearchableText(ydoc: Y.Doc): string {
  const parts: string[] = [];
  for (const [key, sharedType] of ydoc.share.entries()) {
    if (sharedType instanceof Y.Map) parts.push(JSON.stringify(sharedType.toJSON()));
    else if (sharedType instanceof Y.Array) parts.push(sharedType.toArray().map(i => JSON.stringify(i)).join('\n'));
    else if (sharedType instanceof Y.Text) parts.push(sharedType.toString());
    else if (sharedType instanceof Y.XmlFragment) parts.push(xmlFragmentToText(sharedType));
  }
  return parts.join('\n');
}
```

This function partially exists already (`xmlFragmentToText` and `projectToFilesystem` in `HocuspocusServer.ts`).

### Packages

| Package | License | What it does |
|---------|---------|-------------|
| **@orama/orama** | Apache-2.0 | BM25 keyword search (no embeddings in Phase 0) |
| **micromatch** | MIT | Glob pattern matching on doc name strings |
| **jsonpath-plus** | MIT | JSONPath queries on `doc.toJSON()` |

### Agent Tool

```typescript
tool({
  name: "l2_search",
  description: "Search, grep, list, and query CRDT collaboration docs. " +
    "Faster than workspace file tools because CRDT is in-memory.",
  inputSchema: z.object({
    action: z.enum(["search", "grep", "glob", "query", "cat", "stat", "whatsnew"]),
    query: z.string().optional(),
    pattern: z.string().optional(),
    path: z.string().optional(),
    docName: z.string().optional(),
    since: z.string().optional(),
  }),
});
```

### Speed Comparison

| Operation | Files (disk I/O) | CRDT (in-memory) |
|-----------|-----------------|-------------------|
| Keyword search | ~2-10ms (MiniSearch) | ~1-5ms (Orama) |
| Grep | ~5-50ms (ripgrep process) | ~0.5-2ms (regex on string) |
| Glob | ~10-100ms (readdir) | ~0.1ms (micromatch on Map.keys()) |
| Structured query | ~5ms (read + parse + jq) | ~0.5ms (JSONPath on toJSON()) |

### Implementation Location

```
packages/collaboration/src/L2/
  search/                          ← NEW
    CrdtSearchExtension.ts         — Hocuspocus extension: onChange → Orama
    extractSearchableText.ts       — Y.Doc → string extraction
  tools/
    l2-search.ts                   ← NEW: agent search tool
```

### Effort

~200 lines. Replaces the need for filesystem projection (`projectToFilesystem`).

---

## Why Orama Instead of MiniSearch

L1 workspace already uses MiniSearch. Why not reuse it for L2?

| Feature | MiniSearch (L1) | Orama (L2) |
|---------|----------------|------------|
| Full-text search | ✅ BM25 | ✅ BM25 |
| Fuzzy/typo tolerance | ✅ | ✅ |
| Vector search | ❌ | ✅ built-in `vector[N]` type |
| Hybrid search | ❌ | ✅ `mode: "hybrid"` |
| Faceted search | ❌ | ✅ filter by field values |
| Embedded plugin | ❌ | ✅ `@orama/plugin-embeddings` |
| Size | 7KB | 2KB |
| Persistence | Manual JSON export | `@orama/plugin-data-persistence` |

MiniSearch is fine for L1 (files, no vectors). Orama is better for L2 because the symbol index feature (`crdt-symbol-index`) needs field filtering (`where: { kind: "decision" }`), and the team memory feature (`crdt-team-memory`) will need vector search later. One Orama instance serves all features.

---

## Why This Must Be Phase 0

Without search, agents can't find anything in CRDT. All other features (symbol index, memory, rooms) are useless if agents skip CRDT because they can't search it. This is the unlock — search makes CRDT usable, everything else makes it powerful.

### Today: Files Win (Agents Skip CRDT)

| Operation | L1 Files | L2 CRDT | Gap |
|-----------|---------|---------|-----|
| Search | ✅ `keyword_search` | ❌ Nothing | **Agents can't find CRDT content** |
| Grep | ✅ `workspace_grep` | ❌ Nothing | **Agents can't pattern-match CRDT** |
| Glob | ✅ `workspace_glob` | ❌ `collab discover` (no filter) | **Agents get everything, can't filter** |

### After This Feature: CRDT Matches Files

All three gaps closed. Plus CRDT is 10-100x faster (in-memory vs disk I/O).

---

## Projection Elimination

This feature makes `projectToFilesystem()` in `HocuspocusServer.ts` obsolete:

| Today (projection) | After (direct) |
|-------------------|----------------|
| CRDT → write JSON/markdown files to `.ping/collaboration/` → grep files | CRDT → onChange → Orama index → search directly |
| Stale (debounced disk write) | Real-time (indexed on change) |
| Two copies of data | One copy (CRDT binary + Orama index) |
| ~100-500ms (disk I/O) | ~1-5ms (in-memory) |

---

## Complete Package Table (All CRDT Features)

These 9 packages power all 5 CRDT features. All open source, all free:

| Package | License | Stars / Weekly DL | Used By Feature |
|---------|---------|-------------------|-----------------|
| **@orama/orama** | Apache-2.0 | 10.3k / 527K | crdt-search, crdt-symbol-index, crdt-team-memory |
| **micromatch** | MIT | 4.8k / 144M | crdt-search |
| **jsonpath-plus** | MIT | 2k / 10M | crdt-search |
| **traverse** | MIT | 1.7k / 61M | crdt-symbol-index |
| **jsondiffpatch** | MIT | 5.3k / 10.6M | crdt-diff-versioning |
| **deep-object-diff** | MIT | 597 deps / 14M | crdt-diff-versioning |
| **toposort** | MIT | 567 deps / 10.6M | crdt-diff-versioning |
| **y-utility** | MIT | by Y.js author / 36K | crdt-diff-versioning |
| **@hocuspocus/transformer** | MIT | 150K | crdt-search (content extraction) |

---

## Small Gaps to Cover (Not Full Features)

These are small tools (~10-40 lines each) that complete the filesystem parity. They can be added to `l2_search` or as separate micro-tools:

| Gap | Effort | Solution |
|-----|--------|----------|
| Delete doc/entry | ~10 lines | `doc.getMap().delete(key)` — add `delete` action to collab tool |
| Doc metadata (stat) | ~20 lines | Y.Doc size, shared type count, last modified timestamp |
| Search & replace across docs | ~40 lines | Orama search → collect matches → batch Y.Map updates |
| Export CRDT → workspace file | ~20 lines | `doc.toJSON()` → `workspace_write_file()` — bridge L1↔L2 |
| Import file → CRDT | ~30 lines | `workspace_read_file()` → parse → `doc.getMap().set()` |

---

## Open Questions

1. **Should `projectToFilesystem()` be removed immediately or kept as fallback?** Recommend: keep but deprecate. Remove once agents confirm they use `l2_search` instead of reading projected files.

2. **Should `l2_search` be a new tool or merged into existing `collab` tool?** Recommend: new tool. `collab` is for read/write/discuss. `l2_search` is for search/grep/glob/query — different verb category.

---

## Industry Comparison: How Others Implement CRDT Search

No standard "CRDT search" package exists. Every major collaborative app built their own:

### AFFiNE / OctoBase (67k stars)

```
Y.js/y-octo CRDT → OctoBase extracts blocks → SQLite full-text index (persistent)
```

- **SQLite for indexing, not in-memory.** Survives restarts. Handles 100K+ blocks
- **Block-level indexing.** Each paragraph/heading is a separate index entry with its block ID
- **Multilingual word segmentation.** Proper CJK tokenization beyond basic BM25
- **License: AGPL-3.0** (can't embed in commercial products without open-sourcing)

### Notion

- **Searches page TITLES only.** Body text search is limited
- **No block-level search.** You search pages, not blocks within pages
- **Server-side only.** No local/offline search

### Liveblocks

- **No content search at all.** Only room metadata filtering (`roomId`, `metadata` key-value)
- **Expects you to build your own.** Even the leading CRDT-as-a-service doesn't provide content search

### How We Compare

| Aspect | AFFiNE/OctoBase | Notion | Liveblocks | **Our Design** |
|--------|----------------|--------|-----------|---------------|
| **What's searchable** | Block content | Page titles | Room metadata | Doc content + entity fields |
| **Index storage** | SQLite (persistent) | Server DB | None | Orama (in-memory → persistent) |
| **Search granularity** | Block-level | Page-level | Room-level | Entity-level (doc:block) |
| **Full-text** | ✅ + CJK | ⚠️ Titles only | ❌ | ✅ BM25 via Orama |
| **Structured query** | ❌ | Filter by type/time | Filter by metadata | ✅ JSONPath on live CRDT |
| **Regex/grep** | ❌ | ❌ | ❌ | ✅ In-memory regex |
| **Vector/semantic** | ❌ | ❌ | ❌ | ✅ Orama hybrid (Phase 2) |
| **Offline capable** | ✅ (SQLite local) | ❌ | ❌ | ✅ (in-memory) |

**Our design is more capable than all three for our use case.** The key learning from AFFiNE: **add index persistence** for fast cold starts. Orama's `plugin-data-persistence` or SQLite FTS5 fallback at scale.

### What to Steal from AFFiNE

1. **Index persistence** — Orama `plugin-data-persistence` writes index to disk/MongoDB. Rebuilds from CRDT on startup, but persists for fast cold-start
2. **Block-level indexing** — Index entities (from `crdt-symbol-index` CRDT_SYMBOL_SPEC) as individual Orama documents, not whole docs as single entries
3. **SQLite FTS5 fallback** — If Orama in-memory grows too large at 100K+ entities, SQLite with FTS5 is the proven alternative

### How We Steal Each Pattern and Integrate It

#### 1. Index Persistence (from AFFiNE's SQLite approach)

AFFiNE persists their search index to SQLite so cold starts don't re-index everything. We use Orama's built-in persistence plugin instead:

```typescript
import { create } from '@orama/orama';
import { persist, restore } from '@orama/plugin-data-persistence';

// On startup: try to restore persisted index, fall back to rebuild
let symbolIndex;
try {
  const saved = await fs.readFile('./data/orama-index.json', 'utf-8');
  symbolIndex = await restore('json', saved);
  console.log('Index restored from disk');
} catch {
  // Cold start: create empty index, will be populated by onChange
  symbolIndex = create({ schema: { /* ... */ } });
  console.log('Fresh index, rebuilding from CRDT docs');
}

// On shutdown / periodic: persist to disk
const serialized = await persist(symbolIndex, 'json');
await fs.writeFile('./data/orama-index.json', serialized);
```

**Integration point:** Add `persist()` call to Hocuspocus `onDestroy` hook and on a periodic timer (every 5 min). Add `restore()` to `CrdtSearchExtension` constructor.

**Where in code:**
```
packages/collaboration/src/L2/search/
  CrdtSearchExtension.ts
    constructor()     → restore index from disk if exists
    onDestroy()       → persist index to disk
    startPeriodicSave() → persist every 5 min
```

#### 2. Block-Level Indexing (from AFFiNE's per-block approach)

AFFiNE indexes each paragraph/heading as a separate entry. We do this via `CRDT_SYMBOL_SPEC` from the `crdt-symbol-index` feature — each entity (task, decision, convention) becomes its own Orama document:

```typescript
// AFFiNE approach: one index entry per block
// { blockId: "abc123", content: "POST /users returns 201", docId: "api-spec" }

// Our approach: one index entry per entity (from CRDT_SYMBOL_SPEC)
// { entityId: "db-choice", content: "Use PostgreSQL...", docName: "team-memory/decisions", kind: "decision" }
```

**Integration point:** The `crdt-search` feature extracts full doc text for keyword search. The `crdt-symbol-index` feature adds entity-level entries to the SAME Orama instance. Both use the same `onChange` hook:

```typescript
// In CrdtSearchExtension onChange:
async onChange({ documentName, document }) {
  // STEP 1 (crdt-search): Index full doc text for keyword search
  const text = extractSearchableText(document);
  await orama.update(symbolIndex, `doc:${documentName}`, {
    entityId: `doc:${documentName}`,
    kind: 'document',
    content: text,
    docName: documentName,
  });

  // STEP 2 (crdt-symbol-index): Extract and index individual entities
  // This runs only when crdt-symbol-index feature is enabled
  if (symbolSpec) {
    const entities = extractEntities(documentName, document, symbolSpec);
    for (const entity of entities) {
      await orama.update(symbolIndex, entity.entityId, entity);
    }
  }
}
```

**Where in code:**
```
packages/collaboration/src/L2/search/
  CrdtSearchExtension.ts     → onChange calls both extractText AND extractEntities
  CrdtSymbolSpec.ts           → defines what entities to extract (from crdt-symbol-index)
```

#### 3. SQLite FTS5 Fallback (from AFFiNE's production architecture)

AFFiNE uses SQLite because they serve millions of users. We start with Orama in-memory and swap to `better-sqlite3` + FTS5 only if needed:

```typescript
// Interface that both backends implement
interface SearchBackend {
  index(id: string, doc: SearchDocument): Promise<void>;
  search(query: string, opts?: SearchOpts): Promise<SearchResult[]>;
  filter(where: Record<string, any>): Promise<SearchResult[]>;
}

// Phase 0: Orama in-memory (default)
class OramaBackend implements SearchBackend { /* ... */ }

// Phase N (if scale demands): SQLite FTS5
class SqliteBackend implements SearchBackend {
  private db = new Database('./data/search.db');
  
  constructor() {
    this.db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS entities USING fts5(
        entityId, kind, docName, blockPath, content, title, createdBy
      )
    `);
  }
  
  async search(query: string) {
    return this.db.prepare(
      `SELECT * FROM entities WHERE entities MATCH ? ORDER BY rank`
    ).all(query);
  }
}

// Switch via env var
const searchBackend = process.env.SEARCH_BACKEND === 'sqlite'
  ? new SqliteBackend()
  : new OramaBackend();
```

**Integration point:** `CrdtSearchExtension` uses `SearchBackend` interface instead of Orama directly. Default is Orama. Switch to SQLite via env var when RAM becomes a concern.

**When to switch:** Monitor Orama RAM usage. At ~200MB+ (roughly 50K entities with content), evaluate if SQLite is needed. The `SearchBackend` interface makes the swap a config change, not a rewrite.

**Where in code:**
```
packages/collaboration/src/L2/search/
  SearchBackend.ts              — Interface definition
  OramaBackend.ts               — Default implementation (in-memory)
  SqliteBackend.ts              — Fallback (only created when needed)
  CrdtSearchExtension.ts        → uses SearchBackend, not Orama directly
```

### Integration Summary

```
                 Phase 0 (now)                    Phase N (scale)
                 ─────────────                    ──────────────
Hocuspocus onChange
  │
  ├─► extractSearchableText()    ── same ──►    same
  │     → full doc text
  │
  ├─► extractEntities()          ── same ──►    same
  │     → individual entities
  │
  ▼
SearchBackend.index()
  │
  ├─ OramaBackend (default)      ── swap ──►    SqliteBackend (if RAM > 200MB)
  │   └─ in-memory, ~1ms search                 └─ persistent, ~5ms search
  │
  └─ persist() on shutdown       ── same ──►    N/A (SQLite is persistent)
```

All three AFFiNE patterns integrate cleanly because:
1. **Persistence** is an Orama plugin — add to existing code, don't change it
2. **Block-level indexing** uses the same onChange hook — `crdt-symbol-index` extends `crdt-search`, doesn't replace it
3. **SQLite fallback** hides behind an interface — swap backend without touching tool or extraction code
