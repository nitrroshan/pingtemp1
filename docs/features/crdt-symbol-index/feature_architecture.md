# CRDT Symbol Index — Architecture

**Date:** May 3, 2026  
**Status:** Research complete, architecture updated with page + identity map model  
**Priority:** P1 — Makes CRDT navigable like code with LSP  
**Research:** [crdt-team-memory/research.md](../crdt-team-memory/research.md)  
**Depends on:** `crdt-search` (Orama for full-text search acceleration)  
**Related:** [crdt-first-architecture](../crdt-first-architecture/feature_architecture.md) — triple pattern + page model

---

## Problem

LSP gives code agents instant "go to definition" and "find references" by maintaining a symbol table. CRDT docs have no equivalent — agents must read every doc to find decisions, tasks, and conventions. This is like navigating code without LSP: grep everything, read everything, guess.

## Core Insight (Updated)

**`_identities` is the symbol table. Orama is the search acceleration layer.**

The [page model](../crdt-first-architecture/feature_architecture.md#page-model-inspired-by-notions-block-tree) introduces two registry docs per scope:
- **`_pages`** (`Y.Map("pages")`) — lists what pages exist (like a file system)
- **`_identities`** (`Y.Map("identities")`) — maps entity IDs to `{ page, blockId, type }` addresses (like LSP's symbol table)

`_identities` is a CRDT doc that **survives restarts**, **syncs in real-time**, and provides **O(1) direct lookups**. Orama adds full-text search and fuzzy matching on top — it indexes FROM `_identities` + page content.

```
_identities (Y.Map in CRDT)          Orama (in-memory search index)
= Source of truth                    = Search acceleration layer
= Survives restarts                  = Rebuilt from _identities on startup
= Direct lookup by entity ID        = Full-text search, fuzzy matching
= Real-time synced via CRDT          = Periodically synced from CRDT
= Small (entity refs only)           = Larger (includes content for search)
```

## Architecture

### Two-Level Symbol Model (LSP-Inspired)

LSP has **two separate symbol requests**. We mirror this:

| LSP Request | Scope | CRDT Equivalent | Storage |
|---|---|---|---|
| `textDocument/documentSymbol` | Single file → hierarchical tree | Per-page `Y.Map("symbols")` | Inside each page's Y.Doc |
| `workspace/symbol` | All files → flat query results | Per-scope `_identities` | Separate registry Y.Doc |

**Level 1: Per-page symbols** — each page's Y.Doc has a `Y.Map("symbols")` slot listing entities defined in THAT page. Agents write to it when creating significant content (decisions, conventions, risks):

```typescript
// plan-doc page → Y.Map("symbols")
{
  "decision:db-choice":    { blockId: "b-4f2a", kind: "decision", summary: "Use PostgreSQL" },
  "risk:api-breaking":     { blockId: "b-7e3f", kind: "risk", summary: "V1 clients will break" },
  "convention:rest-naming": { blockId: "b-1c9d", kind: "convention", summary: "kebab-case URLs" },
}
```

**Level 2: Scope-level `_identities`** — aggregated from all page symbols + page-level entries. Adds `page` field for cross-page lookup:

```typescript
// {goalId}/_identities → Y.Map("identities")
{
  // Page-level (auto-registered on page creation from meta.id)
  "plan:plan-doc":         { page: "plan-doc", kind: "plan", summary: "API Redesign" },
  "task:task-001":          { page: "task-001/task", kind: "task", summary: "Design REST endpoints" },
  // Block-level (propagated from page symbols)
  "decision:db-choice":    { page: "plan-doc", blockId: "b-4f2a", kind: "decision", summary: "Use PostgreSQL" },
  "risk:api-breaking":     { page: "plan-doc", blockId: "b-7e3f", kind: "risk", summary: "V1 clients will break" },
}
```

**Level 3: Orama** — indexes FROM `_identities` + page content. Adds full-text search and fuzzy matching. Acceleration layer only.

### The CRDT Grammar: `CRDT_SYMBOL_SPEC`

With the page pattern ([crdt-first-architecture](../crdt-first-architecture/feature_architecture.md#standard-crdt-document-structure)), every page has `Y.Map("meta")` with `id` and `type`, `Y.Map("symbols")` for in-page entities. The `CRDT_SYMBOL_SPEC` configures how **page-level** symbols are auto-extracted from `meta`:

```typescript
const CRDT_SYMBOL_SPEC = {
  // Page-level: meta.id → auto-registered in _identities on page creation
  task:       { docPattern: "**/task",        symbolField: "meta.id", kind: "task" },
  plan:       { docPattern: "**/plan-doc",    symbolField: "meta.id", kind: "plan" },
  goal:       { docPattern: "**/goal",        symbolField: "meta.id", kind: "goal" },
  report:     { docPattern: "**/report",      symbolField: "meta.taskId", kind: "report" },
  research:   { docPattern: "**/research/*",  symbolField: "meta.topic", kind: "research" },
  // Key-based: each Y.Map("meta") key = one symbol
  decision:   { docPattern: "**/decisions",   symbolSource: "meta-keys", kind: "decision" },
  convention: { docPattern: "**/conventions", symbolSource: "meta-keys", kind: "convention" },
};
```

**Block-level symbols** (decisions, risks, conventions inside pages) are NOT auto-extracted — agents register them explicitly in `Y.Map("symbols")` when writing significant content. The observer/system propagates them to `_identities`.

### Two-Tier Entity Model

Not everything is an entity. Page-level entities are auto-extracted; block-level entities are agent-registered:

| Tier | What | Example | Registration | Parallel |
|------|------|---------|-------------|----------|
| **Tier 1: Page entity** | `meta.id` or Y.Map key | `"task:task-001"`, `"plan:plan-doc"` | Auto (from `CRDT_SYMBOL_SPEC`) | `class UserService` — the file-level symbol |
| **Tier 2: Block entity** | Agent-registered in `Y.Map("symbols")` | `"decision:db-choice"`, `"risk:api-breaking"` | Agent writes block + registers symbol | `function getUserById` — the in-file symbol |
| **Tier 3: Content** | Text in `Y.XmlFragment("content")` or `Y.Text("source")` | "Use PostgreSQL because..." | Indexed by Orama for search | Function body — searchable, not a symbol |
| **Tier 2: Content** | Text in `Y.XmlFragment("content")` or `Y.Text("source")` | "Use PostgreSQL because..." | Function body — searchable, not a symbol |

### Orama Schema (Unified Index)

```typescript
const symbolIndex = create({
  schema: {
    entityId: 'string',        // the symbol (e.g. "decision:db-choice")
    kind: 'enum',              // decision | task | convention | goal | risk | report | research
    page: 'string',            // page path (from _identities)
    blockId: 'string',         // block ID within page (if block-level)
    content: 'string',         // searchable text (Tier 3)
    title: 'string',           // short label
    createdBy: 'string',       // who created it
    createdAt: 'number',       // when
    goalId: 'string',          // in which goal context
    references: 'string[]',    // outgoing links to other symbols
  },
});
```

No embeddings in Phase 1 (~70KB per 100 entities, not ~700KB). Add vectors later.

### Symbol Resolution: `entity → page:block`

Three paths (identical to LSP), now using `_identities` for direct lookup and Orama for search:

1. **Direct lookup** (agent knows entity): `_identities.get("decision:db-choice")` → `{ page, blockId }` → O(1), no Orama needed
2. **Search → lookup** (agent doesn't know): Orama `search({ term: "database" })` → finds entity → resolve via `_identities`
3. **Browse → lookup** (agent explores): Orama `search({ where: { kind: "decision" } })` → list all → pick one

**Direct lookup flow (most common):**
```
l2_navigate({ action: "definition", entity: "decision:db-choice" })
  → reads _identities.get("decision:db-choice")
  → { page: "plan-doc", blockId: "b-4f2a", type: "decision", summary: "Use PostgreSQL" }
  → opens page "plan-doc" → navigates to block b-4f2a
  → returns block content
```

**Search flow (fuzzy/full-text):**
```
l2_navigate({ action: "definition", entity: "database" })  // doesn't match any identity exactly
  → falls back to Orama: search({ term: "database" })
  → finds entity "decision:db-choice" with content matching "database"
  → resolves via _identities → same page:block address
```

### Auto-Generation from Zod Schemas

The symbol spec can be derived from existing Zod schemas (~30 lines):

```typescript
function zodToSymbolSpec(schema: ZodObject, docPattern: string) {
  return {
    docPattern,
    symbolField: findField(fields, 'id'),
    contentFields: findStringFields(fields, ['title', 'body', 'text']),
    referenceFields: findArrayFields(fields, ['dependencies', 'references']),
    filterFields: findEnumFields(fields, ['status', 'kind', 'role']),
  };
}
```

### Agent Tool

```typescript
tool({
  name: "l2_navigate",
  description: "Navigate CRDT entities: go to definition, find references, " +
    "impact analysis, outline. Like LSP but for decisions, tasks, conventions.",
  inputSchema: z.object({
    action: z.enum(["definition", "references", "impact", "outline"]),
    entity: z.string().optional(),
    kind: z.string().optional(),
    scope: z.string().optional(),
  }),
});
```

### LSP Feature Comparison

| LSP Feature | CRDT Equivalent | Layer | Precision |
|-------------|----------------|-------|-----------|
| Go to definition | `_identities.get("decision:db-choice")` → `{ page, blockId }` | `_identities` (CRDT) | Exact — O(1) |
| Find references | Orama `search({ where: { references: "decision:db-choice" } })` | Orama (search) | 90% (explicit refs exact, text mentions fuzzy) |
| Symbol tree | Orama `groupBy: kind` or `_pages` filtered by type | Both | Exact |
| Type info / hover | Entity metadata (createdBy, createdAt, content) | ✅ Richer than code LSP | Exact |
| Rename | Structured fields: exact. Text: needs LLM | ⚠️ Partial | |
| Diagnostics | Orphaned refs, contradictions | ⚠️ Different, more useful | Custom |
| Code actions | "Consolidate conflicting conventions" | ⚠️ LLM-powered | |

### Implementation Location

```
packages/collaboration/src/L2/
  registry/
    PageRegistry.ts                — NEW: auto-populate _pages on page create/update (~60 lines)
    IdentityRegistry.ts            — NEW: auto-populate _identities on page create + entity registration API (~80 lines)
  search/
    CrdtSearchExtension.ts         — EXTEND: index from _identities + page content into Orama
    CrdtSymbolSpec.ts              — NEW: symbol spec definition (~40 lines)
  tools/
    l2-navigate.ts                 — NEW: agent navigation tool — reads _identities first, falls back to Orama (~80 lines)
```

### Effort

~260 lines custom code. `_identities` CRDT map is the primary symbol table. Orama accelerates search but is not required for direct lookups.

---

## Bloat Analysis

### `_identities` Size (CRDT)

Each identity entry: ~150 bytes (entityId key + { page, blockId, type, summary } value).

| Scale | Entities | `_identities` size |
|-------|----------|-------------------|
| 1 user, 1 team | ~100 | ~15KB |
| 5 users, 3 teams | ~5,000 | ~750KB |
| 20 users, 10 teams | ~50,000 | ~7.5MB |

This is small enough to live in a single CRDT doc per scope.

### Orama Index Size (Without Embeddings)

Each Orama entity document: ~700 bytes (entityId, kind, docName, blockPath, content, metadata).

| Scale | Entities | Index RAM |
|-------|----------|-----------|
| 1 user, 1 team | ~100 | ~70KB |
| 5 users, 3 teams | ~5,000 | ~3.5MB |
| 20 users, 10 teams | ~50,000 | ~35MB |
| 100+ users | ~500,000 | ~350MB |

### If Embeddings Are Added Later

Each 1536-dim embedding adds ~6KB per entity. At 50K entities: ~300MB just for vectors.

**Recommendation:** Start without embeddings (keyword search only). Add `embedding: 'vector[1536]'` to schema when semantic search is needed. This is a schema field addition, not a rewrite.

---

## Use Cases This Feature Solves

| Use Case | Without Symbol Index | With Symbol Index |
|----------|---------------------|-------------------|
| "Where was the DB decision made?" | Read 47 docs manually | `l2_navigate({ action: "definition", entity: "db-choice" })` → instant |
| "What depends on this decision?" | Impossible without reading everything | `l2_navigate({ action: "references", entity: "db-choice" })` → 3 tasks, 2 agent notes |
| "What breaks if I change this?" | No way to know | `l2_navigate({ action: "impact", entity: "db-choice" })` → 5 tasks affected |
| "Show me all decisions" | `collab discover` → read each doc | `l2_navigate({ action: "outline", kind: "decision" })` → instant list |

---

## Open Questions

1. **Should the symbol spec be in code or configurable?** Recommend: code. The spec mirrors our Zod schemas, which are code. No need for runtime config.

2. **How to handle entity name collisions across goals?** E.g., `task-001` in goal-001 vs `task-001` in goal-002. Solution: prefix with goalId in Orama: `goal-001/task-001`. The `docName` field already disambiguates.

---

## Industry Comparison: How Knowledge Apps Build Symbol Indexes

### How 5 Major Apps Do It

| App | Stars | How they define symbols | How they index | How they find references |
|-----|-------|------------------------|---------------|------------------------|
| **Logseq** (42k) | `[[wikilinks]]` + `#tags` + page titles | **DataScript** (in-memory Datalog DB). Every block is a datom | Datalog query: `[:find ?b :where [?b :block/refs ?page]]` |
| **AFFiNE** (67k) | Block IDs + linked pages + database properties | **OctoBase** (Rust/SQLite FTS5). Blocks extracted from Y.js | SQLite JOIN on block reference fields |
| **Obsidian** | `[[wikilinks]]` + `#tags` + YAML frontmatter | **In-memory index** rebuilt on vault open. Parses every markdown file for links | Backlink panel: scan all files for `[[this page]]` |
| **Notion** | Pages + database rows + relation properties | **Server-side Postgres**. Relations are explicit database properties | Backlinks section on each page |
| **AppFlowy** (70k) | Block IDs + page references + database fields | **Rust backend** with CRDT storage | Cross-references via explicit relation fields |

### The Universal Pattern

Every app follows the same 3 steps:

```
1. DEFINE what's a symbol → grammar rules (wikilinks, block IDs, page titles)
2. INDEX on write → auto-populate index when data changes
3. COMPUTE backlinks → reverse lookup: "who references this entity?"
```

Our design follows the same pattern:
```
1. CRDT_SYMBOL_SPEC → Y.Map keys, id fields, doc names
2. Orama upsert on onChange → auto-index entities
3. Orama filter { references: containsAll } → backlinks
```

### What We Steal From Each

**From Logseq: Compound queries**

Logseq's Datalog lets agents compose complex queries. We achieve the same via Orama `where` filters — agents write their own queries like they write grep patterns:

```typescript
// Logseq: [:find ?t :where [?t :refs "db-choice"] [?t :kind "task"] [?t :status "ready"]]
// Ours: agent writes the filter directly
l2_search({ action: "query", where: { references: { containsAll: ["db-choice"] }, kind: "task", status: "ready" } })
```

Integration: Add `status`, `priority`, `assignedTo` to Orama schema (~10 lines in symbol spec extractors).

**From Obsidian: Auto-backlinks in definition response**

Every Obsidian page shows a "Backlinks" section. Our `definition` query should include backlinks automatically:

```typescript
l2_search({ action: "query", where: { entityId: "db-choice" } })
→ { entity: { ... }, backlinks: [{ docName: "...", kind: "depends-on" }, ...] }
```

Integration: When query matches exactly 1 entity by ID, run a second query for references. ~5 lines.

**From Notion: Typed relations**

Notion database relations are explicit: "Task → Decision" is a typed field. Our `extractRefs` should capture relation types:

```typescript
extractRefs: (key, val) => [
  ...val.dependencies?.map(dep => ({ targetSymbol: dep, kind: "depends-on" })),
  ...val.assignedRole ? [{ targetSymbol: `agent:${val.assignedRole}`, kind: "assigned-to" }] : [],
  ...val.goalId ? [{ targetSymbol: val.goalId, kind: "belongs-to" }] : [],
]
```

Integration: Enrich extractRefs in existing symbol spec. ~15 lines.

### Datalog vs Orama — Why We Choose Orama

| | Datalog (DataScript) | Orama | Winner for our agents |
|-|---------------------|-------|---------------------|
| Multi-hop traversal | ✅ Natural | ❌ Need sequential queries | Datalog |
| Keyword/fuzzy search | ❌ | ✅ BM25 + fuzzy | **Orama** |
| Vector/semantic | ❌ | ✅ Hybrid mode | **Orama** |
| LLM writes queries | ⚠️ LLMs know Datalog poorly | ✅ LLMs know JSON well | **Orama** |
| Filter + sort + paginate | ⚠️ Awkward | ✅ Native | **Orama** |

Orama wins for 99% of real agent queries. For the 1% multi-hop case, `toposort(edges)` or two sequential Orama queries handle it. DataScript (`npm install datascript`, MIT, 60K weekly) is a Phase N escape hatch.

---

## Graph Memory Services: What Mem0 and Zep/Graphiti Do

Two production services exist for AI agent memory with entity graphs:

### Mem0 (54.2k stars, Apache-2.0)

"Universal memory layer for AI agents." Key features:

- **Entity linking across memories** — stores "PostgreSQL" and later "PG connection pool", auto-links them because "PostgreSQL" = "PG"
- **Multi-signal retrieval** — semantic + BM25 keyword + entity matching scored in parallel
- **User/Session/Agent level memory** — maps directly to our team/goal/agent rooms
- **npm SDK** — `npm install mem0ai`

What Mem0 doesn't have: not CRDT, not real-time, not collaborative, no conflict resolution.

### Zep + Graphiti (4.5k stars, Apache-2.0)

"Context engineering platform" powered by **Graphiti temporal knowledge graph**:

- **Temporal validity** — every fact has `valid_at` and `invalid_at` dates
- "Used PostgreSQL" (valid Jan-Mar) → "Migrated to Fastify" (valid Mar-present)
- **Agents can ask "what was true at time T?"** — not just "what's true now"
- Automatically extracts relationships from conversations

What Zep doesn't have: not CRDT, not real-time, cloud-first (self-hosted deprecated).

### What We Steal and Integrate

| Pattern | Source | Effort | Integration |
|---------|--------|--------|-------------|
| **Entity linking** | Mem0 | ~20 lines | On `remember()`, search Orama for existing entities mentioned in content, add cross-references |
| **Temporal validity** | Zep/Graphiti | ~30 lines | Add `validFrom`/`invalidAt` fields to Orama schema. Consolidation marks old facts as invalid instead of deleting. Agents can query "what was true at step 5" |
| **Multi-signal scoring** | Mem0 | ~15 lines | Orama hybrid does semantic + BM25. Add entity-match boosting: if query matches an entityId, boost that result |

### Our Unique Advantage Over Both

| Capability | Mem0 | Zep/Graphiti | Our Design |
|-----------|------|-------------|-----------|
| CRDT real-time collaborative | ❌ | ❌ | ✅ |
| Multi-agent shared memory | ❌ | ❌ | ✅ |
| Agent writes own queries | ❌ (API only) | ❌ (API only) | ✅ (Orama `where` filters) |
| Schema-based entity extraction | ❌ (LLM-based, expensive) | ❌ (LLM-based) | ✅ (CRDT_SYMBOL_SPEC, zero LLM cost) |
| Self-hosted, no cloud dependency | ✅ | ⚠️ Deprecated | ✅ |

**Our entity extraction is free (schema-based).** Mem0 and Zep both use LLM calls to extract entities from text. We extract from known Y.Doc structure — zero LLM cost, 100% precision, instant.
