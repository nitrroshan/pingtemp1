# Workspace Semantic Search (L1) — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** Parked (v2) — BM25 + grep covers 95% of use cases  
**ID:** D3

---

## Branch
- `feature/workspace-semantic-search` (when unparked)

## Scope
Embedding-based semantic search for L1 workspaces. Brute-force cosine similarity over tree-sitter-chunked code/docs.

## When to Unpark
- Agents regularly work on **cloned external repos** with 1,000+ files
- Agents fail to find relevant code/docs using grep + keyword search
- Researcher agents search large document collections by concept

## Implementation Steps (If Built)

### Step 1: Create WorkspaceVectorIndex
**Files to create:**
- `packages/backend/memory/L1/search/WorkspaceVectorIndex.ts` — Index chunks with embeddings. Chunk by: tree-sitter functions (code), headings (markdown), fixed-size 500-char (fallback).

### Step 2: Integrate EmbeddingService
**Files to modify:**
- Use existing `EmbeddingService.ts` (Azure OpenAI `text-embedding-3-small`, 1536-dim). Embed each chunk, store vectors in-memory.

### Step 3: Implement Hybrid Search
- Combine BM25 keyword search (existing) + cosine similarity (new) with configurable `vectorWeight` (0-1).
- Default: 0.3 vectorWeight (bias toward keyword search — more predictable for code).

### Step 4: Incremental Re-indexing
- File watcher: only re-embed changed chunks on file save.
- Estimated cost: ~$0.05 to index a 500-file project.

### Step 5: Create Agent Tool
- `workspace_semantic_search(query)` — returns top-K relevant chunks by hybrid score.

## Complexity
Low-Medium — 1 week if unparked. Shares embedding infra with L3 Knowledge Base.
