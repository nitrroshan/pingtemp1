# Config Revision + Rollback — Feature Architecture

**Status:** Architecture Draft  
**Date:** April 1, 2026  
**ID:** A9  
**Depends on:** Data Persistence (A6)  
**Feeds into:** Company Templates

---

## Overview

Version every config change so any bad change can be rolled back instantly. Configs include: team settings, agent definitions (YAML), planner parameters, execution settings, and skill assignments.

### Current State
- Team configs stored in MongoDB (`TeamConfigModel`, `AgentRoleModel`) — in-place updates, no history
- Agent definitions are YAML files in `packages/backend/agent/agents/` — no versioning beyond git
- `TeamService` does CRUD on teams/agents — `updateTeam()` overwrites, old state is lost
- No audit trail of who changed what, when

### Target State
- Every config mutation appends a revision record before overwriting
- Any revision can be restored with one API call
- Audit trail: who changed what, when, with optional reason

### Scope Boundary

| This Feature (Config Rollback) | NOT This Feature (Task/Execution Rollback) |
|---|---|
| Team settings, agent definitions, skills | Task status transitions |
| Planner parameters, execution settings | Agent outputs / artifacts |
| Human-initiated, infrequent changes | System-driven, continuous changes |
| "Undo a bad config" | "Undo a failed task's side effects" |

Task/execution rollback is a separate, harder problem — see **Task Rollback** section at the bottom.

---

## What Gets Versioned

| Entity | Storage | Revision Strategy |
|---|---|---|
| Team settings | MongoDB (`TeamConfigModel`) | Revision collection — snapshot before update |
| Agent definitions | MongoDB (`AgentRoleModel`) | Revision collection — snapshot before update |
| Agent YAML | Files in `agent/agents/` | Git tracks these; runtime copies versioned via revision collection |
| Planner parameters | CRDT doc or MongoDB | Same as above — snapshot before update |
| Skill assignments | MongoDB (`AgentSkill`) | Revision collection |

---

## Architecture Options

### Option A: Revision Collection (Append-Only Snapshots)

**Implementation:** Before every config update, copy the current state into a `config_revisions` collection. The main collection always has the latest. Rollback = copy a revision back to the main collection.

```
updateTeam("team-1", { maxConcurrency: 4 })
  → read current state from TeamConfigModel
  → append to config_revisions: { entityType: "team", entityId: "team-1", 
      revision: 3, data: { ...previousState }, changedBy: "user-1", reason: "..." }
  → update TeamConfigModel with new values
  
rollback("team-1", revision: 2)
  → read revision 2 from config_revisions
  → overwrite TeamConfigModel with revision data
  → append new revision (4) recording the rollback
```

```typescript
// Single collection for all config revisions
interface ConfigRevision {
  entityType: 'team' | 'agent' | 'skill_assignment' | 'planner';
  entityId: string;
  revision: number;        // Auto-incrementing per entity
  data: Record<string, any>; // Full snapshot of previous state
  changedBy: string;       // User or system ID
  reason?: string;         // Optional change description
  createdAt: Date;
}

// Index: { entityType, entityId, revision } — unique
// Index: { entityType, entityId, createdAt } — for time-based queries
```

**Pros:**
- Simple — one collection, one pattern for all entities
- Main collection stays clean (just current state)
- Works with existing Mongoose models — wrap `updateTeam()` / `addAgent()` with revision middleware
- Rollback is just a copy operation
- Audit trail built-in

**Cons:**
- Storage grows linearly with changes (mitigated by retention policy — keep last N revisions)
- Slightly slower writes (read-before-write for snapshot)

**Effort:** Low — Mongoose middleware or wrapper functions around existing CRUD

### Option B: Event Sourcing (Diffs Only)

**Implementation:** Store only the diff/patch for each change. Current state is derived by replaying events from a base snapshot.

**Pros:**
- Minimal storage — only deltas stored
- Can reconstruct state at any point in time

**Cons:**
- Complex — need diff/patch logic per entity type
- Slow reads for old revisions (must replay N events)
- Reconstruction bugs are hard to debug
- Overkill for configs that change infrequently

**Effort:** High — diff/patch per entity, replay logic, snapshot checkpoints

### Option C: MongoDB Document Versioning (versionKey)

**Implementation:** Use Mongoose's built-in `versionKey` (__v field) with a pre-save hook that copies to a shadow collection.

**Pros:**
- Uses built-in Mongoose feature
- Version conflicts detected automatically

**Cons:**
- `versionKey` only increments a counter — doesn't store old state
- Still need a shadow collection (same as Option A but with extra Mongoose coupling)
- More fragile — relies on Mongoose internals

**Effort:** Medium — same as A but more tightly coupled to Mongoose

## Recommendation

**Option A (Revision Collection)** — simplest, covers all entity types with one pattern, low effort, and the storage concern is negligible (configs change infrequently — maybe 10-50 revisions per team lifetime).

**Decision Required:** Please choose Option A, B, or C.

---

## API Endpoints

```
GET    /api/v2/teams/:teamId/revisions              → list revision history
GET    /api/v2/teams/:teamId/revisions/:revision     → get specific revision
POST   /api/v2/teams/:teamId/rollback/:revision      → rollback to revision
GET    /api/v2/agents/:agentId/revisions             → agent revision history
POST   /api/v2/agents/:agentId/rollback/:revision    → rollback agent config
```

## Incremental Delivery

| Version | What | Independently Useful? |
|---|---|---|
| **v1.0** | `ConfigRevisionModel` + middleware on `TeamService` CRUD | Yes — team/agent config history |
| **v1.1** | Rollback API + UI "revision history" panel | Yes — restore any past config |
| **v2.0** | CRDT doc snapshots for config docs (if configs move to CRDT) | Yes — config state recovery |

---

## Task Rollback (Separate Concern)

Rolling back a **task's execution effects** is fundamentally different from rolling back a config. This needs its own architecture.

### Why It's Hard

A config rollback is a copy operation — restore old JSON. A task rollback means undoing side effects:

| Side Effect | Reversible? | How |
|---|---|---|
| Git commits | Yes | `git revert` the commit(s) |
| Files written to workspace | Mostly | Delete or restore from git |
| CRDT doc edits | Yes | Yjs undo manager / restore from snapshot |
| External API calls | **No** | Can't un-send an email, un-deploy, un-POST |
| Output manifests | Yes | Delete manifest + artifacts |
| Dependent tasks that consumed output | **Cascading** | Must also rollback or re-run dependents |

### Architecture Sketch

Task rollback operates at three levels:

**Level 1 — Task State Reset** (easy)
- Reset task status back to `ready` or `pending`
- Clear `output`, `assignedTo`, `startedAt`, `completedAt`
- Re-queue for execution
- Use case: "This task produced bad output, re-run it"

**Level 2 — Workspace Rollback** (medium)
- Each task execution creates a git checkpoint before starting
- Rollback = `git revert` to the pre-task checkpoint
- CRDT docs: restore Yjs snapshot taken before task started
- Output manifests: delete artifacts written by this task
- Use case: "Undo everything this task did to the workspace"

**Level 3 — Cascade Rollback** (hard)
- If task B consumed task A's output, rolling back A invalidates B
- Orchestrator must identify all downstream dependents via the DAG
- Options: (a) rollback entire chain, (b) re-run dependents with new input, (c) mark dependents as stale
- Use case: "The foundation task was wrong, everything built on it needs to be redone"

### What the Planner Needs

The planner's `replan` tool already handles the "re-do" case — it can discard tasks and create new ones. Task rollback gives it the **undo** capability:

```
Planner detects task-3 output is wrong
  → rollback_task(task-3, level: 2)     // undo workspace changes
  → rollback_task(task-4, level: 1)     // reset dependent task
  → replan()                            // create corrected tasks
```

### Prerequisites
- Git checkpoint before each task execution (workspace feature)
- Yjs snapshots before each task execution (CRDT feature)
- Output manifest tracking per task (data-persistence feature)
- DAG dependency graph in MemoryManager (exists — `prerequisites` map)

### Incremental Delivery

| Version | What | Effort |
|---|---|---|
| **v1.0** | Level 1 — task state reset + re-queue | Low |
| **v1.1** | Level 2 — git checkpoint + workspace revert per task | Medium |
| **v2.0** | Level 3 — cascade detection + dependent rollback/re-run | High |
| **v2.1** | Planner `rollback_task` tool integration | Medium |
