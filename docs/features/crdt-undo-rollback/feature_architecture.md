# CRDT Undo & Rollback — Architecture

**Date:** April 23, 2026  
**Status:** Draft  
**Origin:** [CRDT Audit UNDERUTIL-4](../task-orchestration/markdown-tasks/crdt-audit.md#underutil-4-undomanager--not-used)

---

## Problem

Three gaps converge:

1. **Partial writes on failure.** When an agent crashes mid-task after writing 3 of 5 blocks to a shared doc, those 3 blocks remain permanently. The task is marked `failed` but the doc is never cleaned up.

2. **No agent-scoped undo.** Humans get Ctrl+Z in the editor (BlockNote's ProseMirror undo). Agents have nothing. If an agent writes garbage to a shared doc, there's no way to selectively revert just the agent's changes.

3. **No review-before-commit for CRDT writes.** Workspace changes go through git branches (reviewable, mergeable, revertable). CRDT writes go directly to the shared doc — no staging, no approval, no revert.

## What Y.js UndoManager Actually Does

`Y.UndoManager` is a per-scope, per-origin undo stack:

```typescript
const undoManager = new Y.UndoManager(ytype, {
  trackedOrigins: new Set([agentOrigin]),  // only track this agent's writes
  captureTimeout: 500,                     // merge edits within 500ms into one undo step
});

// Agent writes with an origin
doc.transact(() => {
  fragment.insertText("bad content");
}, agentOrigin);

// Later: undo just that agent's changes
undoManager.undo();  // removes "bad content", doesn't touch other writers' changes
```

**Key properties:**
- **Per-origin tracking** — only undoes changes tagged with specific origins. Other users'/agents' changes are preserved.
- **Scoped to shared types** — you create one per `Y.Map`, `Y.Array`, or `Y.XmlFragment`. Not global.
- **Stack-based** — undo/redo stack persists as long as the UndoManager instance lives. Not persisted to disk.
- **Merge window** — edits within `captureTimeout` ms are merged into one undo step.

**What it does NOT do:**
- Persist undo history across server restarts (stack is in-memory)
- Work across documents (each doc needs its own UndoManager)
- Handle undo of `Y.Array.push()` for append-only structures like discussions (it would delete the block entirely — discussions should stay append-only)

## Current State

| Area | What exists | Gap |
|------|------------|-----|
| **Human undo in editor** | BlockNote uses `y-prosemirror` undo plugin → Ctrl+Z works per-user | None — already working |
| **Agent writes** | `doc.getMap().set()` / `fragment.insertText()` — no transaction origin | No origin = can't distinguish agent writes from human writes |
| **Failed task cleanup** | Task marked `failed`, branch kept for debug, CRDT doc untouched | Partial writes persist |
| **Revert agent changes** | Nothing | No mechanism |
| **Workspace rollback** | `revertToCommit()` exists (git reset --hard) but no tool exposes it | API exists, not reachable |

## Where UndoManager Helps vs Doesn't

| Use Case | UndoManager? | Why |
|----------|-------------|-----|
| **Revert agent's doc edits** (shared doc `doc-api-spec`) | **Yes** | Agent writes with origin → UndoManager tracks → revert on failure or human request |
| **Revert agent's task data writes** (Y.Map task/plan) | **No** | TaskStore is source of truth — CRDT is a downstream mirror. Revert at TaskStore level, CRDT follows. |
| **Revert discussion posts** (Y.Array append-only) | **No** | Discussions are append-only by design. "Undo a post" breaks the thread — add a correction post instead. |
| **Revert agent's decision writes** (Y.Map decisions) | **Maybe** | Decisions have quorum — revoking a decision is a protocol question, not an undo question. |
| **Clean up on task failure** | **Yes** | If agent wrote partial content before crashing, UndoManager can revert all writes from that agent's task session. |
| **Human reviews agent edits** | **Yes** | Agent writes → human reviews in editor → accepts (keep) or rejects (undo). Same pattern as git PR but for CRDT. |

**Conclusion: UndoManager is useful for one specific surface — agent writes to shared working docs (`doc-{name}` Y.XmlFragment).** Not for task/plan/goal CRDT docs (single-writer, TaskStore controls). Not for discussions (append-only).

## Architecture Options

### Option A: Per-Agent UndoManager on Shared Docs

**Implementation:** When an agent starts writing to a shared doc, create an `UndoManager` scoped to that doc's `Y.XmlFragment`, tracking only that agent's origin. The backend holds the UndoManager instance for the duration of the task. On failure → auto-undo. On review-reject → manual undo.

```typescript
// In collab tool write-block action:
const origin = `agent:${agentRole}:${taskId}`;

// Create UndoManager scoped to this agent's writes
const um = new Y.UndoManager(fragment, {
  trackedOrigins: new Set([origin]),
});

// Agent writes with origin
doc.transact(() => {
  insertHeading(fragment, "API Endpoints", 2);
  insertParagraph(fragment, "POST /auth/register...");
}, origin);

// On task failure:
um.undo();  // removes all this agent's writes, preserves everyone else's

// On human review reject:
um.undo();  // same
```

**Pros:**
- Precise — only reverts the specific agent's changes, leaves other agents' and humans' edits intact
- Uses Y.js's native mechanism — no custom diff/patch logic
- Automatic cleanup on failure — no orphaned partial writes
- Enables "review before keep" pattern for agent CRDT edits

**Cons:**
- UndoManager is in-memory — if server crashes, undo stack is lost (but the doc state is preserved in CRDT binary)
- One UndoManager per agent per doc — lifecycle management needed (create on first write, dispose on task complete/fail)
- Only works for XmlFragment/Map/Text — not for Y.Array (discussions are append-only anyway)
- Agent writes must use `doc.transact(fn, origin)` — requires refactoring current write-block/write actions

**Effort:** Small — refactor collab tool write actions to use `transact(fn, origin)`, add UndoManager creation/disposal in task lifecycle.

### Option B: Snapshot-Based Rollback

**Implementation:** Before an agent starts writing to a shared doc, snapshot the full Y.Doc state. On failure or rejection, restore from snapshot.

```typescript
// Before agent writes:
const snapshot = Y.snapshot(doc);

// On failure:
Y.applySnapshot(doc, snapshot);
```

**Pros:**
- Simple conceptually — take snapshot, restore if needed
- Works for any Y.js shared type (Map, Array, XmlFragment)
- Survives server crashes (snapshot can be persisted)

**Cons:**
- **Blows away ALL changes since snapshot** — including concurrent edits from other agents and humans. This is the critical flaw.
- No per-agent scoping — can't revert just one agent's changes while keeping others
- Snapshot size grows with doc size — storing snapshots for every agent write is expensive
- Y.js snapshot/restore is lower-level — more complex error handling

**Effort:** Medium — snapshot management, storage, conflict handling.

### Option C: No UndoManager — Git-Style Review for CRDT

**Implementation:** Don't use UndoManager at all. Instead, treat CRDT writes like git commits — agent writes to a "draft" CRDT doc, human reviews, then merges to the shared doc.

```
Agent writes → doc-api-spec-draft-backend (private doc)
Human reviews → diff against doc-api-spec (main doc)
Human approves → merge draft into main doc
Human rejects → delete draft doc
```

**Pros:**
- Familiar git PR mental model
- Full isolation — agent can't corrupt the shared doc
- Review before publish

**Cons:**
- **Two copies of every doc** — draft + main. Doubles CRDT storage.
- No real-time co-editing during the draft phase — defeats the point of CRDT
- Merge logic for CRDT docs is complex — not a simple copy
- Adds latency between agent work and visible result
- Over-engineered for the common case where agent writes are fine

**Effort:** High — draft doc management, merge logic, review UI.

## Recommended: Option A (Per-Agent UndoManager)

**Why Option A wins:**
- **Precise scope** — only reverts one agent's changes, preserves everything else. This is exactly what Y.UndoManager was designed for.
- **Low effort** — requires adding `transact(fn, origin)` to existing write actions and creating UndoManager instances per agent per doc. No new storage, no new docs, no merge logic.
- **Matches the problem** — the three gaps (partial writes, agent-scoped undo, review-before-keep) are all solved by per-origin tracking.
- **Builds on existing infra** — Y.UndoManager ships with Y.js (already installed). BlockNote already uses it internally for human undo.

**Option B is dangerous** (destroys concurrent edits). **Option C is over-engineered** (two copies of every doc, no real-time co-editing).

## What Needs to Change

| Component | Change |
|-----------|--------|
| **Collab tool `write-block`** | Wrap writes in `doc.transact(fn, origin)` where origin = `agent:{role}:{taskId}` |
| **Collab tool `write`** | Same — wrap `map.set()` in `doc.transact(fn, origin)` |
| **CrdtTaskSync** | On `initCollabDocs()` for collaboration tasks: create UndoManager for each `doc-{name}` XmlFragment, scoped to the assigned agent's origin |
| **OrchestratorService** | On task failure: if task had CRDT doc writes, call `undoManager.undo()` for each tracked doc |
| **WorkerPool** | Store UndoManager refs per `{taskId, docName}` pair. Dispose on task complete (undo stack no longer needed) |
| **Frontend** | Add "Revert agent changes" button in task detail panel Docs tab (calls backend `POST /api/v2/tasks/:id/revert-doc-changes`) |

## Not In Scope

- **Discussion undo** — discussions are append-only by design. Add a correction post, don't delete.
- **Task/plan/goal undo** — TaskStore is single-writer. Revert at TaskStore level, CRDT follows via `syncStatus`.
- **Persistent undo history** — UndoManager stack is in-memory, dies with the task. This is fine — undo is for the active task session, not for historical review.
- **Cross-doc undo** — each doc has its own UndoManager. "Undo all changes across all docs for task X" would call `um.undo()` on each.

## Priority

**P3 — post-redesign.** The frontend redesign and Chat Agent layer are higher priority. This feature becomes valuable when:
1. Agents actively co-edit shared docs with humans (collaboration tasks)
2. Review mode exists (Chat Agent layer feature)
3. Task failure cleanup matters (production use, not dev)

Currently, agents rarely write to shared CRDT docs (most work goes to workspace git branches). This feature becomes critical when the collaboration workflow is active.
