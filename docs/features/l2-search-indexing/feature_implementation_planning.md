# L2 Search & Indexing — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 4 (Agent Workspace & Persistence)  
**Approach:** Option A — Hocuspocus Search Extension

---

## Branch
- `feature/l2-search-indexing`

## Scope
Tier 1 (JSONPath query on live CRDT) + Tier 2 (MiniSearch keyword search over L2 documents). Semantic search deferred to phase 2.

## Implementation Steps

### Step 1: Create L2SearchIndex
**Files to create:**
- `packages/backend/memory/L2/search/L2SearchIndex.ts` — MiniSearch instance for L2 content. Same pattern as L1's `WorkspaceSearchIndex.ts`. Index fields: document name, content, metadata. BM25 + fuzzy + prefix search.

**Exit criteria:** L2SearchIndex can add/update/remove documents, search returns ranked results

### Step 2: Create Hocuspocus Search Extension
**Files to create:**
- `packages/backend/memory/L2/search/SearchExtension.ts` — Hocuspocus extension that hooks `onStoreDocument`/`onChange`. On document change: debounce (2s) → extract text from Y.Doc → re-index in MiniSearch.

**Files to modify:**
- `packages/backend/memory/L2/collaboration/HocuspocusServer.ts` — Register SearchExtension

**Exit criteria:** CRDT doc changes automatically re-index in MiniSearch after 2s debounce

### Step 3: Create HTTP Search Endpoints
**Files to create:**
- `packages/backend/memory/L2/search/L2SearchEndpoints.ts` — Express routes on Hocuspocus port:
  - `GET /search?q=keyword` — keyword search across all L2 docs
  - `GET /query?path=$.tasks[?(@.status=='ready')]` — JSONPath on CRDT doc
  - `GET /grep?pattern=regex` — regex search in doc content
  - `GET /ls` — list all documents
  - `GET /cat/:docName` — read document content
  - `GET /stat/:docName` — document metadata
  - `GET /whatsnew?since=timestamp` — changelog since timestamp

**Exit criteria:** All endpoints return correct results

### Step 4: Create Agent Search Tool
**Files to create:**
- `packages/backend/memory/L2/tools/l2-search-tool.ts` — AI SDK `tool()` wrapping the search endpoints: `l2_search(query)`, `l2_query(jsonpath)`, `l2_grep(pattern)`, `l2_whatsnew(since)`

**Exit criteria:** Agents can search L2 shared state using tool calls

### Step 5: Implement JSONPath Queries
**Files to modify:**
- `packages/backend/memory/L2/search/L2SearchEndpoints.ts` — Use `jsonpath-plus` to query CRDT `doc.toJSON()` for structured data (plans, tasks, outputs)

**Dependencies:** `jsonpath-plus` npm package  
**Exit criteria:** JSONPath queries return correct results from live CRDT state

### Step 6: Implement Changelog (whatsnew)
**Files to modify:**
- `packages/backend/memory/L2/search/SearchExtension.ts` — Track CRDT version timestamps per document change
- `packages/backend/memory/L2/search/L2SearchEndpoints.ts` — `/whatsnew?since=` returns diffs

**Exit criteria:** Agents can query "what changed since last check"

## Testing Strategy
- Unit test: MiniSearch indexing and search accuracy
- Integration test: CRDT doc change → debounce → re-index → searchable
- Test: JSONPath query on task status fields
- Test: whatsnew returns correct changelog

## Complexity
Medium — 2-3 weeks. Mirrors proven L1 pattern.
