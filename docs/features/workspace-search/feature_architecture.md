# Workspace Semantic Search (L1) — Feature Architecture

**Status:** Parked (v2)  
**Date:** April 1, 2026  
**ID:** D3  
**Extracted from:** [Memory System (done)](../done/memory-system/feature_architecture.md) — semantic search in L1 was deferred to v2

---

## Overview

Add embedding-based semantic search to L1 workspaces so agents can find code/docs by meaning, not just exact keywords.

**Parked because:** Ping's agents already have grep, BM25 keyword search, tree-sitter symbol index, and repo map — these cover 95% of use cases. Semantic search adds ~5% for "find by concept" queries on large unfamiliar codebases.

---

## Research Summary: How the Industry Does It

### Cursor (the gold standard for this)

- Custom embedding model built specifically for code (NOT a general-purpose model)
- Background indexes entire codebase on project open
- Their research: **semantic search + grep = 12.5% higher accuracy** vs grep alone
- Improvement is largest on codebases with **1,000+ files**
- Agent automatically picks grep (specific queries) or semantic (conceptual queries)

### GitHub Copilot

- Uses VS Code's semantic search infrastructure
- Embedding-based search provided by the IDE, not the agent

### Claude Code

- **No semantic search.** Uses grep (ripgrep) + glob + read_file only.
- Works well for coding tasks without embeddings.

### Aider

- **No semantic search.** Uses tree-sitter repo map + grep.
- Repo map provides ~10-50x context compression vs reading files.
- Very effective without embeddings.

### Key Finding

The tools Ping already has (grep, BM25, symbol index, repo map) match what Claude Code and Aider use — and they're the two most effective coding agents. Cursor's semantic search helps most on **1,000+ file codebases with conceptual queries**, which isn't Ping's primary use case (task-focused agents with provided context).

---

## When To Revisit

Semantic search becomes valuable when:
- Agents regularly work on **cloned external repos** with 1,000+ files
- Agents fail to find relevant code/docs using grep + keyword search
- Researcher agents search large document collections by concept

---

## If Built: The Simplest Approach

No custom model needed. Use existing `EmbeddingService` + brute-force cosine:

```typescript
class WorkspaceVectorIndex {
  // Chunk by: tree-sitter functions (code), headings (markdown), fixed-size (fallback)
  // Embed via: existing EmbeddingService (text-embedding-3-small, 1536-dim)
  // Search via: brute-force cosine similarity (fine for <5000 chunks)
  // Hybrid: combine with existing BM25 → configurable vectorWeight 0-1
  // Re-index: only changed chunks on file save (incremental)
  // Cost: ~$0.05 to index a 500-file project
}
```

Shares embedding infra with L3 Knowledge Base. Both use the same model + same pattern.

**Effort if built:** 1 week

---

## Also Missing from L1 (Separate Features)

From [PERSISTENCE_STRATEGY.md](../done/memory-system/PERSISTENCE_STRATEGY.md):

| Missing | What | Status |
|---|---|---|
| **TaskCheckpointer** | SQLite crash recovery for MemoryManager + RoleTaskQueue | Fully designed, not built |
| **LangGraph SqliteSaver** | Conversation recovery mid-task | Fully designed, not built |
| **MarkdownMemoryEngine** | Clawdbot-inspired long-term agent memory (daily logs + MEMORY.md + hybrid search) | Fully designed, not built |
