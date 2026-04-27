# CRDT Diff & Versioning — Architecture

**Date:** April 27, 2026  
**Status:** Research complete, ready for implementation planning  
**Priority:** P2 — Enhances agent awareness of changes  
**Research:** [crdt-team-memory/research.md](../crdt-team-memory/research.md)  
**Depends on:** `crdt-search` (Orama for changelog queries)

---

## Problem

Agents can't answer "what changed since I last checked?" for CRDT docs. When an agent resumes a task, it has no way to see if other agents updated the plan, added decisions, or modified tasks it depends on. In files, `git log` and `git diff` solve this. CRDT has nothing.

## Architecture

Three packages provide diff, change detection, and dependency ordering — eliminating all custom code for these capabilities.

### Packages

| Package | License | Stars / Downloads | What it does |
|---------|---------|-------------------|-------------|
| **jsondiffpatch** | MIT | 5.3k / 10.6M wk | Deep diff `doc.toJSON()` snapshots → human-readable delta, visual HTML, reverse/unpatch, JSON Patch RFC 6902 |
| **deep-object-diff** | MIT | 597 deps / 14M wk | `diff(a, b)` → only changed paths. Lightweight "what changed" check |
| **toposort** | MIT | 567 deps / 10.6M wk | Topological sort on task dependency DAGs → execution order, cycle detection |

### Capabilities

#### 1. Human-Readable Diff (`jsondiffpatch`)

```typescript
import * as jsondiffpatch from 'jsondiffpatch';

const oldSnapshot = previousDoc.toJSON();
const newSnapshot = currentDoc.toJSON();
const delta = jsondiffpatch.diff(oldSnapshot, newSnapshot);

// Visual HTML diff
const html = htmlFormatter.format(delta, oldSnapshot);
// → "<div>status: 'ready' → 'completed'</div>"

// Reverse: undo the changes
jsondiffpatch.unpatch(newSnapshot, delta); // → back to old state

// JSON Patch format (RFC 6902)
const patches = jsonpatchFormatter.format(delta);
// → [{ op: "replace", path: "/task/status", value: "completed" }]
```

#### 2. Change Detection (`deep-object-diff`)

```typescript
import { diff } from 'deep-object-diff';

const changes = diff(oldSnapshot, newSnapshot);
// → { "task": { "status": "completed", "output": "Built 12 tables" } }
// Only changed paths — fast check for "did anything change?"
```

#### 3. Dependency Ordering (`toposort`)

```typescript
import toposort from 'toposort';

const edges = tasks.flatMap(t => t.dependencies.map(dep => [dep, t.id]));
const executionOrder = toposort(edges).reverse();
// → ["task-1", "task-3", "task-7"]
// Throws if circular dependency detected!
```

### Changelog (whatsnew)

Track timestamps on `onChange` → agents query "what changed since timestamp":

```typescript
// In CrdtSearchExtension onChange hook:
changeLog.set(documentName, { updatedAt: Date.now(), changedBy: agentRole });

// Agent queries:
l2_search({ action: "whatsnew", since: "2026-04-27T10:00:00Z" })
// → [{ docName: "goal-001/task-003/task", changedAt: "...", changedBy: "backend-dev" }]
```

### Snapshot & Rollback

Y.js has built-in snapshot capabilities:

```typescript
// Save checkpoint before risky change
const snapshot = Y.snapshot(doc);

// Later: rollback if needed
const restoredDoc = Y.createDocFromSnapshot(doc, snapshot);
```

Expose via agent tool:

```typescript
tool({
  name: "l2_version",
  description: "Snapshot, diff, and rollback CRDT docs.",
  inputSchema: z.object({
    action: z.enum(["snapshot", "diff", "rollback", "whatsnew"]),
    docName: z.string().optional(),
    since: z.string().optional(),
  }),
});
```

### Implementation Location

```
packages/collaboration/src/L2/
  search/
    CrdtSearchExtension.ts     — EXTEND: add changelog tracking to onChange
  versioning/                   ← NEW
    CrdtDiff.ts                — jsondiffpatch + deep-object-diff wrappers (~30 lines)
    CrdtSnapshot.ts            — Y.snapshot/rollback wrappers (~30 lines)
    DependencyGraph.ts         — toposort wrapper for task DAGs (~20 lines)
  tools/
    l2-version.ts              — NEW: agent versioning tool (~50 lines)
```

### Effort

~130 lines total. All heavy lifting done by packages (jsondiffpatch, deep-object-diff, toposort, Y.js snapshots).

---

## Additional Capabilities from y-utility

| Package | What it provides |
|---------|-----------------|
| **y-utility** `YMultiDocUndoManager` | Undo/redo across multiple Y.Docs. Agent edits task + plan in one logical action → undo reverts both |
| **y-utility** `YKeyValue` | Efficient key-value store on Y.Array (better than Y.Map for frequently updated alternating keys) |

```typescript
import { YMultiDocUndoManager } from 'y-utility/y-multidoc-undomanager';

const um = new YMultiDocUndoManager([taskMap, planMap]);

// Agent edits both docs
taskMap.set("status", "completed");
planMap.set("progress", "75%");

// Undo reverts BOTH
um.undo(); // taskMap.status back to "in_progress", planMap.progress back to "50%"
```

---

## Copy/Clone Doc

Y.js supports binary state transfer — clone any doc in ~2 lines:

```typescript
// Clone a CRDT doc
const update = Y.encodeStateAsUpdate(sourceDoc);
const cloneDoc = new Y.Doc();
Y.applyUpdate(cloneDoc, update);
```

Add as `copy` action to `l2_version` tool. ~20 lines.

---

## Use Cases This Feature Solves

| Use Case | Without This Feature | With This Feature |
|----------|---------------------|-------------------|
| "What changed while I was away?" | Read every doc, compare manually | `l2_version({ action: "whatsnew", since: "1 hour ago" })` → changed docs + fields |
| "Show me what changed in this task" | Impossible | `l2_version({ action: "diff", docName: "goal-001/task-003/task" })` → field-level delta |
| "Save checkpoint before risky change" | Can't | `l2_version({ action: "snapshot", docName: "..." })` → Y.snapshot saved |
| "Revert — that change was wrong" | Can't (CRDT writes are permanent) | `l2_version({ action: "rollback", docName: "..." })` → restore from snapshot |
| "What's the critical path?" | Read all tasks, manually trace deps | `toposort(edges)` → execution order, throws on cycles |
| "Undo my last batch of changes" | Can't | `YMultiDocUndoManager.undo()` → reverts across docs |

---

## Open Questions

1. **Snapshot storage.** Where to persist snapshots? Options: in-memory (lost on restart), Y.js binary in Hocuspocus storage (persists), separate MongoDB collection (queryable). Recommend: Hocuspocus storage — same persistence as docs.

2. **Changelog granularity.** Track at doc level ("this doc changed") or field level ("task.status changed from ready to completed")? Doc level is cheap (~30 lines). Field level needs `deepDiff` on every onChange (~50 lines + more CPU). Recommend: doc level first, add field level if agents need it.

---

## Industry Pattern: Temporal Knowledge (from Zep/Graphiti)

Zep's **Graphiti** framework adds temporal validity to every fact — `valid_at` and `invalid_at` dates. Instead of deleting superseded facts, it marks them invalid. This preserves history:

```
"API uses Express"     valid_at: Jan 1   invalid_at: Mar 15
"API uses Fastify"     valid_at: Mar 15  invalid_at: null (current)
```

Agent asks "what API framework do we use?" → gets "Fastify" (current valid).
Agent asks "what was true on Feb 1?" → gets "Express" (was valid then).

### Integration with Our Consolidation

Instead of `MemoryConsolidation` deleting old records:

```typescript
// BEFORE: delete old, insert new
if (decision.action === "delete") {
  await this.storage.delete(decision.targetId);
}

// AFTER (Graphiti pattern): mark old as invalid, insert new
if (decision.action === "delete") {
  await orama.update(index, decision.targetId, {
    invalidAt: Date.now(),  // no longer current
  });
}
```

Add `validFrom` and `invalidAt` to Orama schema (~10 lines). Default queries filter `invalidAt: null` (current facts only). Audit queries include all.

### Agent Query Patterns

```typescript
// "What's true now?" (default — only current facts)
l2_search({ action: "query", where: { invalidAt: null } })

// "What was true on Feb 1?" (historical)
l2_search({ action: "query", where: { validFrom: { lte: feb1 }, invalidAt: { gte: feb1 } } })

// "Show me the history of the API framework decision"
l2_search({ action: "query", where: { entityId: "api-framework" }, includeInvalid: true })
// → [{ content: "Express", validFrom: Jan1, invalidAt: Mar15 },
//    { content: "Fastify", validFrom: Mar15, invalidAt: null }]
```

**Effort:** ~30 lines (schema fields + consolidation change). Gives agents free history traversal without losing any data.
