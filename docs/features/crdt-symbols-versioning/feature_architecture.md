# F6: Symbol Index + Versioning — Architecture

**Date:** May 2, 2026  
**Status:** Architected  
**Priority:** P3 — Navigation + History  
**Depends on:** Feature 3 (Orama search)  
**Feature List:** [CRDT-FEATURE-LIST.md](../CRDT-FEATURE-LIST.md) → Feature 6  
**Previous docs:** [crdt-symbol-index](../crdt-symbol-index/), [crdt-diff-versioning](../crdt-diff-versioning/), [crdt-undo-rollback](../crdt-undo-rollback/)

---

## Problem

Entities (tasks, decisions, agents) aren't navigable — agents list all docs and scan. No history — who changed what, when, and what was the previous value.

## Goal

Entities become navigable like code symbols (go-to-definition, find-references). History shows human-readable diffs. Temporal validity tracks when facts were true.

## Architecture

### Symbol Index (from crdt-symbol-index)

- **CRDT_SYMBOL_SPEC** — declarative grammar defining what counts as a symbol in CRDT
- **Two-tier entity model** — Tier 1 (structural landmarks, navigable) + Tier 2 (searchable content)
- **doc:block addressing** — `{docName}:{keyPath}` for precise location
- **Orama integration** — definition = entityId filter, references = references array filter

### Versioning (from crdt-diff-versioning)

- **jsondiffpatch** — human-readable diffs (added/removed/changed with paths)
- **deep-object-diff** — efficient change detection for onChange hooks
- **Snapshot storage** — `Y.encodeStateAsUpdate()` at key moments (plan approved, task completed)

### Undo/Rollback (from crdt-undo-rollback)

- **y-utility** — multi-doc undo manager
- **toposort** — DAG ordering for dependency-aware rollback

### Temporal Validity (Graphiti/Zep pattern)

Each memory record carries `validFrom`/`invalidAt`:
```
"Used Express" (validFrom: Jan, invalidAt: Mar)
"Use Fastify"  (validFrom: Mar, invalidAt: null)
```

Agents can ask "what was true at step 5?"

### Agent Tools

```typescript
l2_navigate({ action: "definition", symbol: "task-003" })     → doc + block
l2_navigate({ action: "references", symbol: "PostgreSQL" })   → all mentions

l2_snapshots({ action: "list", doc: "plan" })                 → version list
l2_snapshots({ action: "restore", doc: "plan", version: 3 })  → rollback
```

## Implementation Location

```
packages/collab-service/src/extensions/
  SymbolIndexExtension.ts       — entity extraction + Orama schema
  VersioningExtension.ts        — snapshot creation + diff API
packages/collaboration/src/L2/tools/
  l2-navigate.ts                — definition/references tool
  l2-snapshots.ts               — version list/restore tool
```

## Detailed Architecture

See the original feature docs for full details:
- [crdt-symbol-index/feature_architecture.md](../crdt-symbol-index/feature_architecture.md) (338 lines)
- [crdt-diff-versioning/feature_architecture.md](../crdt-diff-versioning/feature_architecture.md) (235 lines)
- [crdt-undo-rollback/feature_architecture.md](../crdt-undo-rollback/feature_architecture.md) (199 lines)

## Effort

~400 lines total
