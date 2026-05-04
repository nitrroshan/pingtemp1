# F4: Memory Consolidation — Architecture

**Date:** May 2, 2026  
**Status:** Architected  
**Priority:** P2 — Quality improvement for long-running teams  
**Depends on:** Feature 1 (MemoryScope), Feature 3 (Orama for keyword recall)  
**Feature List:** [CRDT-FEATURE-LIST.md](../CRDT-FEATURE-LIST.md) → Feature 4  
**Research:** [crdt-team-memory/research.md](../crdt-team-memory/research.md) (consolidation section)

---

## Problem

After 50 goals, team-memory has 50× duplicate facts. "Use PostgreSQL" stored 50 times. Recall returns noise. No dedup, no merge, no supersede.

## Goal

On every `remember()`, check for similar existing records. LLM decides: keep, update, delete, or insert new. Recall uses composite scoring (semantic + recency + importance).

## Architecture

### Consolidation Pipeline (on save)

```
remember("We decided to use PostgreSQL")
  │
  ├── Cosine similarity > 0.98 with existing record
  │     → SKIP (exact duplicate, no LLM call)
  │
  ├── Cosine similarity 0.85-0.98 with existing record
  │     → LLM decides: keep | update | delete | insert_new
  │
  └── No similar records
        → INSERT directly
```

### Composite Scoring (on recall)

```
score = semantic_weight * similarity + recency_weight * decay + importance_weight * importance
```

Default weights: `semantic: 0.5, recency: 0.3, importance: 0.2`

### Async Saves (CrewAI pattern)

```typescript
remember(content)  → queues save, returns immediately
recall(query)      → drains pending writes first (read barrier), then searches
```

### Batch Dedup

`rememberMany([...])` drops near-duplicates within same batch (cosine > 0.98) without LLM calls.

## Implementation Location

```
packages/collaboration/src/L2/memory/
  MemoryConsolidation.ts        — dedup/merge/supersede pipeline
  CompositeScorer.ts            — weighted scoring for recall
```

## Effort

~150 lines consolidation + ~50 lines scoring
