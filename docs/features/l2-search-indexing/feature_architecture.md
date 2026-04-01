# L2 Search & Indexing — Feature Architecture

**Status:** Planning  
**Date:** March 29, 2026  
**Prior Art:** [L2_SEARCH_RESEARCH.md](../memory-system/L2_SEARCH_RESEARCH.md)

---

## Overview

Implement searching and indexing for L2 (team collaboration layer) — enabling agents to search across shared CRDT documents, plans, output manifests, and conversation history. L1 already has BM25 keyword search via MiniSearch. L2 has none.

### Current State

- **L1 search**: `WorkspaceSearchIndex.ts` — MiniSearch, BM25 + fuzzy, 30-line chunks, file watcher
- **L2 collaboration**: Hocuspocus CRDT server, PlanStore (JSON files), GroupChatManager, CollaborationSpace
- **L2 search**: None — agents can `discover`, `list`, `read`, `write` but cannot search
- **Embedding service**: `EmbeddingService.ts` exists (Azure OpenAI `text-embedding-3-small`)
- **IndexPersistence**: L1 MiniSearch snapshots to MongoDB for L2 rehydration (exists but unused)

### Target State

Per the research design (§12), implement a **tiered search system**:

1. **Tier 1**: Structured query (JSONPath) on live CRDT docs — no index needed
2. **Tier 2**: Keyword search (MiniSearch) indexing L2 documents — 2-second debounce on Hocuspocus `onChange`
3. **Tier 3**: Semantic search (embedding-based) — deferred to phase 2

---

## Architecture Options

### Option A: Hocuspocus Search Extension (Recommended)

**Implementation:** Build a Hocuspocus extension that hooks `onStoreDocument`/`afterLoadDocument`/`onChange` to maintain a second MiniSearch instance over L2 content. Expose HTTP endpoints on the Hocuspocus port.

```
Hocuspocus Server
├── CRDT Sync (existing)
├── MongoDB Persistence (existing) 
└── Search Extension (new)
    ├── MiniSearch index (in-memory)
    ├── onChange → debounce → re-index document
    ├── HTTP endpoints:
    │   ├── /search  — keyword search across all L2 docs
    │   ├── /query   — JSONPath on CRDT .toJSON()
    │   ├── /grep    — regex search in doc content
    │   ├── /ls      — list documents
    │   ├── /cat     — read document content
    │   ├── /stat    — document metadata
    │   └── /whatsnew — changelog since timestamp
    └── Agent tool: `l2_search` wrapping these endpoints
```

**Pros:**
- Same MiniSearch pattern as L1 — team already knows it
- No new dependencies
- In-memory index: 2-10ms search (10-30x faster than L1 disk)
- JSONPath queries unique to L2 (structured plan data)
- Natural integration point (Hocuspocus already manages docs)

**Cons:**
- Must handle index consistency with CRDT updates
- HTTP endpoints add surface area to Hocuspocus server
- No semantic search initially

**Effort:** Medium (2-3 weeks)

### Option B: Separate Search Microservice

**Implementation:** Standalone search service indexing L2 content via MongoDB change streams. Uses Orama (hybrid text+vector search).

**Pros:**
- Independent scaling
- Hybrid search from day one (Orama does text + vector)
- Doesn't complicate Hocuspocus

**Cons:**
- New service to deploy and maintain
- MongoDB change stream adds latency
- Over-engineering for current team size
- New dependency (Orama)

**Effort:** High (3-4 weeks)

### Option C: MongoDB Atlas Search

**Implementation:** Use MongoDB Atlas full-text search + vector search on L2 documents stored in MongoDB.

**Pros:**
- No in-memory index to manage
- Atlas handles full-text + vector natively
- Already using MongoDB

**Cons:**
- Requires Atlas (not local MongoDB) — dev environment constraint
- Higher latency than in-memory (10-50ms vs 2-10ms)
- Less control over tokenization/chunking
- Cost implications for Atlas search tier

**Effort:** Medium (2 weeks) if already on Atlas

## Recommendation

**Option A** — Hocuspocus Search Extension. Mirrors the proven L1 pattern, zero new dependencies, fastest search latency, and the research document already validated this design extensively.

**Decision Required:** Please choose Option A, B, or C.

---

## Search Capabilities (Option A)

| Capability | Implementation | Latency |
|---|---|---|
| Keyword search | MiniSearch BM25 + fuzzy + prefix | 2-10ms |
| JSONPath query | `jsonpath-plus` on `Y.Doc.toJSON()` | 2-10ms |
| Regex grep | In-memory regex on indexed content | 2-10ms |
| Document listing | In-memory doc registry | 2-5ms |
| Changelog | Timestamp-based diff on CRDT versions | 5-15ms |
| Semantic search | **Deferred** — Phase 2 with embedding service | TBD |

## Key Files

- `packages/backend/memory/L2/collaboration/HocuspocusServer.ts` — add search extension
- `packages/backend/memory/L2/search/L2SearchIndex.ts` — new MiniSearch wrapper for L2
- `packages/backend/memory/L2/search/L2SearchEndpoints.ts` — HTTP endpoints
- `packages/backend/memory/L2/tools/l2-search-tool.ts` — agent-facing search tool
