# CRDT Team Memory — Architecture

**Date:** April 27, 2026  
**Status:** Research complete, ready for implementation planning  
**Priority:** P2 — Valuable when agents run multiple goals in sequence  
**Research:** [research.md](research.md) (2500+ line master research document)  
**Depends on:** `crdt-search`, `crdt-symbol-index`, `crdt-memory-service`

---

## Problem

Knowledge dies with each goal. "We decided to use PostgreSQL" is lost when the next goal starts. Agents can't accumulate conventions, learn from mistakes, or remember past decisions. Each goal starts from zero.

## Scope

This feature covers **persistent team memory** — the MemoryScope, MemoryConsolidation, and agent tools for cross-goal knowledge. It does NOT cover:

- Search/grep/glob → see [crdt-search](../crdt-search/feature_architecture.md)
- Entity indexing / symbol navigation → see [crdt-symbol-index](../crdt-symbol-index/feature_architecture.md)
- Diff / changelog / versioning → see [crdt-diff-versioning](../crdt-diff-versioning/feature_architecture.md)
- Multi-tenant service / rooms / auth → see [crdt-memory-service](../crdt-memory-service/feature_architecture.md)

## Architecture

### Room Structure (from crdt-memory-service)

```
{orgId}/team-memory                — This feature's domain
  └─ Y.Map("decisions")             Decision log (cross-goal)
  └─ Y.Map("conventions")           Team coding conventions
  └─ Y.Map("knowledge")             Accumulated domain knowledge
  └─ Y.Map("lessons-learned")       Past mistakes, what worked

{orgId}/agent:{role}               — Agent personal space
  └─ Y.Map("scratchpad")            Working notes
  └─ Y.Map("context")               Accumulated task context
  └─ Y.Map("task-history")          Completed task summaries
```

### MemoryScope

Agent-facing API for storing and retrieving memories. Agents never write raw Y.Map entries — they call `remember()` and `recall()`:

```typescript
const teamMemory = new MemoryScope(client, "team-memory");

// Remember — optionally LLM-inferred scope
await teamMemory.remember("We decided to use PostgreSQL for user database.");

// Recall — BM25 keyword search (Phase 0) or hybrid (Phase 2+)
const matches = await teamMemory.recall("What database did we choose?", { limit: 5 });
```

### MemoryConsolidation

Garbage collector for semantic memory. On every `remember()`, checks if content duplicates, updates, or contradicts existing records:

- **Cosine > 0.98**: exact duplicate → skip (no LLM)
- **Cosine 0.85-0.98**: LLM decides → keep / update / delete / insert_new
- **No similar records**: insert directly

Prevents unbounded growth across goals. After 50 goals, memory is clean — not a junk pile of duplicates.

### Agent Tools

```typescript
// Team knowledge
tool({ name: "team_memory", inputSchema: z.object({
  action: z.enum(["remember", "recall", "list_decisions", "list_conventions", "tree"]),
  content: z.string().optional(),
  query: z.string().optional(),
  scope: z.string().optional(),
})});

// Personal notes
tool({ name: "personal_notes", inputSchema: z.object({
  action: z.enum(["write", "read", "append", "list", "recall"]),
  key: z.string().optional(),
  value: z.any().optional(),
  query: z.string().optional(),
})});
```

### Implementation Location

```
packages/collaboration/src/L2/
  memory/                          ← NEW
    MemoryScope.ts                 — remember(), recall(), tree()
    MemoryConsolidation.ts         — dedup, merge, supersede on save
  tools/
    team-memory.ts                 — NEW: team memory tool
    personal-notes.ts              — NEW: personal notes tool
```

### Effort

~300 lines (MemoryScope ~150, MemoryConsolidation ~100, tools ~50). Consolidation requires embedding service (existing `EmbeddingService.ts`) and LLM calls (existing model providers).

---

## Async Saves & Read Barrier (CrewAI Pattern)

`remember()` should be non-blocking — agent continues working while consolidation runs in background:

```typescript
// remember() queues the save and returns immediately
await teamMemory.remember("Use PostgreSQL");  // → queued, returns fast

// recall() drains pending writes before searching (read barrier)
const results = await teamMemory.recall("database?");  // → waits for queue, then searches
```

This prevents consolidation LLM calls (~500ms each) from blocking agent execution.

---

## What CRDT Memory Can Do That Files Can't

| Capability | Files | CRDT Memory |
|-----------|-------|-------------|
| **Cross-goal persistence** | ❌ Files die with workspace branch | ✅ Team memory room survives across goals |
| **Semantic consolidation** | ❌ Duplicate facts accumulate | ✅ LLM dedup/merge/supersede on save |
| **Scoped access** | ❌ All files visible to all agents | ✅ Agent personal rooms, team shared rooms |
| **Structured recall** | ❌ Grep text files | ✅ Filter by scope, kind, agent, goal |
| **Real-time shared memory** | ❌ Git merge conflicts | ✅ CRDT auto-merge, multiple agents write simultaneously |

---

## Open Questions

1. **Consolidation cost.** Every `remember()` potentially triggers an LLM call (~$0.001 for gpt-4o-mini). At 100 memories/goal × 50 goals = 5,000 calls = ~$5. Acceptable. At enterprise scale: batch dedup (cosine > 0.98) catches 70% without LLM.

2. **Cross-team agent memory.** Should `backend-dev` in Team A share personal memory when assigned to Team B? Recommend: no — personal memory is `orgId`-scoped. Different teams may have contradictory conventions.

3. **Chat Agent integration (Phase 6).** When Chat Agents arrive, agent personal rooms become Chat Agent persistent context. The `personal_notes` tool evolves into Chat Agent memory. Room design is forward-compatible.

4. **Vector storage for semantic recall.** Options: embed in Orama (simple, in-memory), MongoDB Atlas Vector Search (persistent, scalable), LanceDB (local file-based). Recommend: Orama without vectors initially (keyword recall). Add vectors when knowledge base grows large enough to need "find similar."

---

## Industry Comparison: Graph Memory Services

### Mem0 (54.2k stars, Apache-2.0)

The leading open-source AI agent memory service. Key patterns relevant to our design:

- **Entity linking** — when agent stores "Use PostgreSQL" then later "PG connection pool settings", Mem0 auto-links them. Our integration: on `remember()`, search Orama for entities mentioned in content, add cross-references (~20 lines)
- **Multi-signal retrieval** — semantic + BM25 + entity matching fused. Our integration: Orama hybrid does semantic + BM25 already. Add entity-match boosting (~15 lines)
- **extract_memories()** — breaks task output into atomic facts before storing. Our integration: add `rememberFromTaskOutput()` to MemoryScope that uses LLM to split output into discrete facts (~30 lines)

### Zep / Graphiti (4.5k stars, Apache-2.0)

Temporal knowledge graph — every fact has `valid_at`/`invalid_at` dates. Key pattern:

- **Temporal validity** — "Used Express" (valid Jan-Mar) → "Use Fastify" (valid Mar-present). Old facts aren't deleted, they're marked invalid. Agents can ask "what was true at step 5?"
- Our integration: add `validFrom`/`invalidAt` fields to Orama schema. Consolidation marks old records invalid instead of deleting. Agents get history preservation for free (~30 lines)

### Why We Don't Use Mem0 or Zep Directly

Neither supports CRDT or real-time multi-agent collaboration. Our unique advantages:

| | Mem0 | Zep | Our Design |
|-|------|-----|-----------|
| Real-time collaborative | ❌ | ❌ | ✅ CRDT auto-merge |
| Multi-agent shared memory | ❌ | ❌ | ✅ Team rooms |
| Entity extraction cost | LLM per call | LLM per call | **Free** (schema-based CRDT_SYMBOL_SPEC) |
| Agent writes own queries | ❌ API only | ❌ API only | ✅ Orama `where` filters |
| Self-hosted | ✅ | ⚠️ Deprecated | ✅ Embedded + service modes |

---

## Related Features

| Feature | Priority | Dependency | What it provides |
|---------|----------|-----------|-----------------|
| [crdt-search](../crdt-search/feature_architecture.md) | **P0** | None | Keyword search, grep, glob, JSONPath — makes CRDT usable |
| [crdt-symbol-index](../crdt-symbol-index/feature_architecture.md) | **P1** | crdt-search | Go-to-definition, find-references, entity navigation |
| [crdt-diff-versioning](../crdt-diff-versioning/feature_architecture.md) | **P2** | crdt-search | What-changed, snapshots, rollback, dependency ordering |
| [crdt-memory-service](../crdt-memory-service/feature_architecture.md) | **P2** | crdt-search | Rooms, auth, ACL, multi-tenant, agent identity |
| **crdt-team-memory** (this) | **P2** | crdt-memory-service | Persistent memory, consolidation, agent personal space |
