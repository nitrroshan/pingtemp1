# CRDT & Agent Memory — Feature List

**Last Updated:** April 30, 2026  
**Master Research:** [crdt-team-memory/research.md](crdt-team-memory/research.md) (2552 lines)  
**Infrastructure Package:** `packages/collab-service/` (Hocuspocus CRDT server)

---

## Status Legend

| Status | Meaning |
|--------|---------|
| ✅ Done | Code implemented, builds pass, tests exist |
| 🔧 Partial | Infrastructure done, intelligence not built |
| 📐 Architected | Architecture doc exists, zero code |
| 🔬 Research | Research complete, no architecture doc yet |

---

## Infrastructure Layer

| # | Feature | Status | Directory | What Exists | What's Missing |
|---|---------|--------|-----------|-------------|----------------|
| I1 | **Collab-Service Extraction** | ✅ Done | [crdt-memory-service](crdt-memory-service/) | Standalone `packages/collab-service/` with CollabServer, BlobStorage, standalone entry, Dockerfile, docker-compose, health check, 4 tests. `packages/collaboration/` re-exports from it. | Nothing — Phase 1-3 complete |
| I2 | **COLLAB_MODE External Wiring** | ✅ Done | (config system) | `COLLAB_MODE=external` env var, `RemoteCollabClient`, production docker-compose wiring, `start.sh` option 10 | Nothing — already existed in config + registry |

## Search & Navigation

| # | Feature | Status | Directory | What Exists | What's Missing |
|---|---------|--------|-----------|-------------|----------------|
| S1 | **CRDT Search** (Orama) | 📐 Architected | [crdt-search](crdt-search/) | 413-line architecture doc. Orama as unified index. `onChange` hook → index. BM25 + vector + field filters. Agent-composable `where` queries. | All code. Orama dep, SearchExtension on Hocuspocus, `l2_search` tool, tests |
| S2 | **CRDT Symbol Index** | 📐 Architected | [crdt-symbol-index](crdt-symbol-index/) | 338-line architecture. CRDT_SYMBOL_SPEC, two-tier entity model, `doc:block` addressing. Definition/references via Orama filter. | All code. Depends on S1 (Orama). Entity extraction, SYMBOL_SPEC schema, auto-generation from Zod |

## Versioning & History

| # | Feature | Status | Directory | What Exists | What's Missing |
|---|---------|--------|-----------|-------------|----------------|
| V1 | **CRDT Diff/Versioning** | 📐 Architected | [crdt-diff-versioning](crdt-diff-versioning/) | 235-line architecture. jsondiffpatch for human-readable diffs, deep-object-diff for change detection, snapshot-based versioning. | All code. Snapshot storage, diff API, Graphiti temporal validity pattern |
| V2 | **CRDT Undo/Rollback** | 📐 Architected | [crdt-undo-rollback](crdt-undo-rollback/) | 199-line architecture. y-utility for multi-doc undo, toposort for DAG ordering. | All code. UndoManager integration, rollback API |

## Agent Memory

| # | Feature | Status | Directory | What Exists | What's Missing |
|---|---------|--------|-----------|-------------|----------------|
| M1 | **CRDT Team Memory** | 📐 Architected | [crdt-team-memory](crdt-team-memory/) | 182-line architecture + 2552-line research. MemoryScope (personal/shared/goal), MemoryConsolidation, async saves. Mem0/Zep comparison. | All code. MemoryScope class, consolidation pipeline, personal space tools |
| M2 | **CRDT Memory Service** (Rooms/Auth/ACL) | 🔧 Partial | [crdt-memory-service](crdt-memory-service/) | 449-line architecture + 243-line implementation plan. Room architecture (`{orgId}/team-memory`, `{orgId}/agent:{role}`), auth, multi-tenant. Collab-service package extracted (I1). | Rooms, auth, ACL, multi-tenant Hocuspocus config, per-agent room isolation |

## Collaboration

| # | Feature | Status | Directory | What Exists | What's Missing |
|---|---------|--------|-----------|-------------|----------------|
| C1 | **Collaboration Toolkit** | 🔧 Partial | [collaboration-toolkit](collaboration-toolkit/) | 965-line architecture. Existing code: CollaborationSpace, PlanStore, CrdtTaskSync, CrdtGoalStore, GroupChatManager, RemoteCollabClient, collab tools. | L2 search tools, output manifest improvements, discovery patterns |
| C2 | **Inter-Agent Collaboration** | 📐 Architected | [inter-agent-collaboration](inter-agent-collaboration/) | 370-line architecture + 1010-line implementation plan + discussion-redesign + collaboration-audit. @mention routing, decision tracking, structured discussion. | Discussion redesign code, @mention delivery via Socket.IO |

## Frontend / Goal Management

| # | Feature | Status | Directory | What Exists | What's Missing |
|---|---------|--------|-----------|-------------|----------------|
| F1 | **Server-Generated GoalId** | ✅ Done | [server-goalid](server-goalid/) | Backend nonce echo, frontend `sendToManagerAsync` with nonce correlation, `remapChatKey` for optimistic rendering. Discord Pattern 2. | Nothing — implemented |
| F2 | **Infinite Loop Fix** | ✅ Done | [frontend-state-refactor](frontend-state-refactor/) | `activeGoalId` as explicit state in uiStore (not derived from plans). Breaks `plans→memo→effect→plans` cycle. | App.tsx hook extraction (separate refactor, documented in bugs/) |
| F3 | **Stabilization Sprint** | 📐 Architected | [stabilization-sprint](stabilization-sprint/) | 154-line architecture. Pre-deploy hardening checklist. | All items |

## Knowledge

| # | Feature | Status | Directory | What Exists | What's Missing |
|---|---------|--------|-----------|-------------|----------------|
| K1 | **Knowledge Base** (L3) | 📐 Architected | [knowledge-base](knowledge-base/) | 343-line architecture + 88-line plan. MongoDB vector store, RAG pipeline, knowledge promotion. `packages/knowledge/` exists with KnowledgePlugin. | RAG retrieval integration, vector embeddings, promotion flow |

---

## Dependency Graph

```
I1 Collab-Service ──────────────────────────────────────── ✅ DONE
  │
  ├── S1 CRDT Search (Orama) ◄── P0 NEXT
  │     │
  │     └── S2 Symbol Index ◄── depends on S1
  │
  ├── M2 Rooms/Auth/ACL
  │     │
  │     └── M1 Team Memory (personal spaces) ◄── depends on M2
  │
  ├── V1 Diff/Versioning
  │     │
  │     └── V2 Undo/Rollback ◄── depends on V1
  │
  └── C2 Inter-Agent Collaboration (discussion redesign)

F1 Server GoalId ────────────────────────────────────────── ✅ DONE
F2 Infinite Loop Fix ───────────────────────────────────── ✅ DONE
```

## Priority Order (Recommended)

1. **S1 CRDT Search** — P0. Unblocks everything. Agents can't navigate CRDT without it.
2. **M2 Rooms/Auth** — P1. Multi-tenant prerequisite. Personal agent spaces.
3. **S2 Symbol Index** — P1. Makes search structured (definition/references).
4. **M1 Team Memory** — P2. MemoryScope, consolidation. Depends on M2.
5. **V1 Diff/Versioning** — P2. History, snapshots. Independent track.
6. **C2 Collaboration** — P2. Discussion redesign. Partially independent.
7. **V2 Undo/Rollback** — P3. Depends on V1.

## Package Mapping

| Feature | Target Package |
|---------|---------------|
| S1 Search, S2 Symbols, V1 Diff, V2 Undo | `packages/collab-service/` (server-side extensions) |
| M1 Team Memory, M2 Rooms | `packages/collab-service/` (server) + `packages/collaboration/` (client tools) |
| C2 Collaboration | `packages/collaboration/` (tools, GroupChat) + `packages/backend/` (Socket.IO routing) |
| K1 Knowledge | `packages/knowledge/` |

## Research Packages Selected (from research.md)

| Package | Purpose | License | Size |
|---------|---------|---------|------|
| `@orama/orama` | Unified search index (BM25 + vector + filters) | Apache-2.0 | 10.3k stars |
| `micromatch` | Glob patterns for doc name filtering | MIT | — |
| `jsonpath-plus` | Structured queries on Y.Map JSON | MIT | — |
| `jsondiffpatch` | Human-readable diffs for versioning | MIT | — |
| `deep-object-diff` | Change detection for onChange hooks | MIT | — |
| `toposort` | DAG ordering for task dependencies | MIT | — |
| `y-utility` | Multi-doc undo manager | MIT | — |
| `@hocuspocus/transformer` | Content extraction from Y.Doc | MIT | — |
| `traverse` | AST walking for entity extraction | MIT | — |
