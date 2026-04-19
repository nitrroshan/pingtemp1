# CRDT Utilization Audit — What's Built, What's Broken, What's Missing

**Date:** April 17, 2026  
**Scope:** Full codebase audit of Hocuspocus/Y.js/CRDT usage  
**Related:** [feature_architecture.md](./feature_architecture.md), [MASTER-ARCHITECTURE](../../MASTER-ARCHITECTURE.md)

---

## TL;DR

The CRDT infrastructure (Hocuspocus server, CollaborationSpace, collab tool, CrdtTaskSync, blob persistence, filesystem projection) is **solidly built and functional**. The problems are:

1. **Active bugs** in guard rails and state sync that undermine reliability
2. **Design patterns** that don't leverage CRDT's reactive nature — backend treats CRDT as a dumb key-value store instead of a real-time event source
3. **Major features designed but unbuilt** — per-role memory, agent delegation, L2 search, discussion orchestration — all of which depend on CRDT and have thorough architecture docs but zero code
4. **Type safety erosion** at the package boundary — `crdtTaskSync` is `any` everywhere it crosses from `@ping/collaboration` into `@ping/agent-manager`

---

## Part 1: Active Bugs

### BUG-1: Plan CRDT Never Updated After Archival (HIGH)

**Location:** `OrchestratorService.cleanupForNewGoal()` → `PlanStore.archivePlan()` + `updatePlanStatus("interrupted")`  
**Problem:** On cleanup/replan, `PlanStore` updates status to `"interrupted"` and archives to filesystem. The CRDT plan doc is **never updated**. It stays `status: "executing"` forever.  
**Impact:** Any agent reading `collab read plan` sees stale `"executing"` status after the plan was abandoned.  
**Root cause:** `persistPlan()` is called once during `approvePlan()` but no `syncPlanStatus()` method exists on CrdtTaskSync.

```
Timeline:
  approvePlan() → CRDT plan set to "executing" ✅
  ... tasks run ...
  cleanupForNewGoal() → PlanStore.archivePlan() ✅
                       → PlanStore.updatePlanStatus("interrupted") ✅
                       → CRDT plan doc? ❌ never touched
```

### BUG-2: Discussion maxTokens "Auto-Close" Doesn't Close (MEDIUM)

**Location:** `packages/collaboration/src/L2/tools/index.ts` — `discuss` action, `key="post"`  
**Problem:** When `totalTokensUsed >= maxTokens`, the tool returns `"Token limit reached. Discussion auto-closed."` but **never sets** `configMap.set("status", "closed")`. The next post attempt succeeds because the status check at L675 still reads `"active"`.  
**Impact:** Token limits are advisory, not enforced. Two agents can burn unlimited tokens despite the guard rail.

```typescript
// What happens now:
if (totalTokensUsed >= maxTokens) {
  return "Token limit reached. Discussion auto-closed."; // ← says "closed"
  // but configMap.set("status", "closed") is MISSING
}

// What should happen:
if (totalTokensUsed >= maxTokens) {
  configMap.set("status", "closed"); // ← actually close it
  return "Token limit reached. Discussion auto-closed.";
}
```

### BUG-3: `timeoutMinutes` Set But Never Enforced (MEDIUM)

**Location:** `CrdtTaskSync.initCollabDocs()` sets `config.timeoutMinutes = 15`. No code ever reads it.  
**Problem:** There is no timer, no cron, no `setTimeout`, no `onChange` check that compares `lastActivity` to `timeoutMinutes`. The guard rail exists as data but has zero enforcement.  
**Impact:** Stalled discussions never auto-escalate. An agent waiting for a response in a `blocks-me` collaboration task will wait forever.

### BUG-4: `relatedTasks` in getCrdtRefs Never Populated — ✅ FALSE POSITIVE

**Status:** Already fixed. `requestTaskTool.ts` line 143 sets `relatedTasks: [ctx.taskId]` when creating tasks.

---

## Part 2: Bad Design Patterns

### ANTIPATTERN-1: `crdtTaskSync: any` Across Package Boundary (HIGH)

**Scope:** 8+ files in `@ping/agent-manager` reference `crdtTaskSync` without importing the type from `@ping/collaboration`.

| File | Pattern |
|------|---------|
| `OrchestratorService.ts` | `CrdtProxy<T = any>` — generic defaults to `any` |
| `WorkerPool.ts` | `crdtTaskSync?: any` in `setTaskServices()` parameter |
| `submitResearch.ts` | `(octx as any).crdtTaskSync?.get?.()` — double `any` cast |
| `AgentManagerV2.ts` | `this.taskSync = l2Plugin.getCrdtTaskSync(goalId)` assigned to untyped field |
| `assembleLifecycleTools.ts` | Structural type `{ persistTask(t: any)... }` — partial, methods use `any` params |
| `requestTaskTool.ts` | `crdtTaskSync: any` |
| `bounceTaskTool.ts` | `crdtTaskSync: any` |

**Why it's bad:** Zero compile-time safety for 6 critical methods (`persistTask`, `syncStatus`, `updateIndex`, `persistPlan`, `getCrdtRefs`, `initCollabDocs`). If CrdtTaskSync changes a method signature, nothing breaks at build time — only at runtime.

**Fix:** Export an `ICrdtTaskSync` interface from `@ping/collaboration` and import it in `@ping/agent-manager`. Replace all `any` with the interface.

### ANTIPATTERN-2: Dual-Write Without Reconciliation (HIGH)

**Scope:** Plan data lives in both PlanStore (filesystem JSON) and CRDT (Y.Map).

| Operation | PlanStore | CRDT | Consistent? |
|-----------|-----------|------|-------------|
| Plan approved | `savePlan()` + `updateStatus("executing")` | `persistPlan()` with status "executing" | ✅ Yes |
| Plan completed | `updatePlanStatus("completed")` | ❌ No update | ❌ Drift |
| Plan archived | `archivePlan()` + `updatePlanStatus("interrupted")` | ❌ No update | ❌ Drift |
| Plan version bumped | `savePlan()` with new version | ❌ No update | ❌ Drift |

**Why it's bad:** Agents querying plans via `collab read plan` get stale data. The PlanStore has the truth, but agents use the CRDT copy. This undermines the whole "agents browse via collab tool" design.

**Fix options:**
1. **Single writer:** Make CRDT the sole plan store. PlanStore reads from CRDT (projection).
2. **Sync on every mutation:** Add `crdtTaskSync.syncPlanStatus(planId, newStatus)` and call it from every PlanStore mutation.
3. **Event-driven sync:** PlanStore emits events on mutation → CrdtTaskSync listens and syncs.

### ANTIPATTERN-3: Backend Never Uses `observe()` (MEDIUM)

**Scope:** All backend CRDT reads are pull-based (request → openDoc → toJSON → return). Zero `observe()` subscriptions exist in the backend.

**Why it's bad:** CRDT's core value proposition is **real-time reactive sync**. The backend treats Y.js like a key-value database — open doc, read data, close. This means:
- Agent statuses don't auto-broadcast when changed
- Discussion activity detection relies on Hocuspocus `onChange` hook (coarse-grained) instead of Y.Array `observe()` (block-level)
- Task status changes in CRDT (if any external system modifies them) go undetected
- No real-time plan status monitoring

**Where `observe()` would help:**
1. `agent-statuses` Y.Map → `observe()` → emit to Socket.IO `progress` channel → frontend sidebar updates
2. `discussion` Y.Array → `observe()` → detect new blocks with `@mentions` → route notifications to specific agents
3. `_index` Y.Map → `observe()` → detect task status changes → reconcile with TaskStore
4. `plan` Y.Map → `observe()` → detect plan status changes → reconcile with PlanStore

### ANTIPATTERN-4: Null-Guard Scatter Pattern (LOW)

**Scope:** `OrchestratorService.ts` — `this.crdtTaskSyncProxy?.get?.()` repeated 8+ times.

```typescript
// This pattern appears everywhere CRDT is accessed:
const crdtSync = this.crdtTaskSyncProxy?.get?.();
if (crdtSync) {
  await crdtSync.persistTask(task);
}
```

**Why it's bad:** Noisy, error-prone (easy to forget the guard), obscures intent. The `CrdtProxy<any>` wrapper already adds a layer of indirection — the double optional chain (`?.get?.()`) is a code smell.

**Fix:** Private helper method: `private getCrdtSync(): CrdtTaskSync | null` — single null check, used everywhere.

### ANTIPATTERN-5: Polling Alongside Y.js Events (LOW)

**Location:** `packages/frontend/components/CollaborativeEditor.tsx` — `setInterval(updateMapData, 2000)`  
**Problem:** The editor subscribes to `doc.on("update")` (correct) AND polls every 2 seconds (redundant). Y.js `update` events are comprehensive — they fire for every transaction, local or remote.  
**Impact:** Unnecessary re-renders every 2 seconds for every open editor. Minor performance waste.  
**Fix:** Remove the `setInterval`. Keep `doc.on("update")` and `provider.on("synced")`.

---

## Part 3: Underutilized CRDT Capabilities

### UNDERUTIL-1: `agent-statuses` — Ghost Document (HIGH)

**What it is:** A well-known CRDT doc (`WELL_KNOWN_DOCS.AGENT_STATUSES = "agent-statuses"`) documented in:
- `CollaborationSpace.ts` (constant)
- `KNOWN_CRDT_DOCS` (discovery metadata)
- Agent prompts (capabilities.xml, behaviors.xml — tell agents to write to it)
- WorkerPool.ts (section comment placeholder)

**What happens:** Nothing. No backend code writes to it. Agents are told to use it but have no automated system populating it. It's an empty doc.

**What should happen (per MASTER-ARCHITECTURE):**
```typescript
// WorkerPool should auto-update on task lifecycle events:
// On task dispatch:
agentStatuses.set(role, { status: "busy", task: taskId, since: now });
// On task complete:
agentStatuses.set(role, { status: "idle", lastTask: taskId, since: now });
// On discussion entry:
agentStatuses.set(role, { status: "discussing", with: [otherRole], doc: docName });
```

Frontend would subscribe via `ymap.observe()` → live agent cards in sidebar.

### UNDERUTIL-2: Y.Text — Defined, Never Used

`CollabDocument.getText(key)` accessor exists. No component or tool creates Y.Text documents. Could be useful for:
- Simple collaborative notes (lighter than BlockNote/XmlFragment)
- Agent scratchpads (replace ephemeral in-memory scratch with CRDT-backed text)
- Shared todo lists (plain text format)

### UNDERUTIL-3: Awareness Protocol — Frontend Only

Frontend `CollaborativeEditor.tsx` uses `provider.awareness` for cursor colors and user names. Backend `CollabDocument.getPresence()` returns `[]` (stub with TODO comment).

**What's missing:** Backend agents could set awareness state to indicate "I'm reading this doc" / "I'm editing section X". Frontend would show agent presence in editors alongside human presence. Currently agents are invisible in collaborative editing — humans see other humans' cursors but not which agent is looking at or writing the same doc.

### UNDERUTIL-4: UndoManager — Not Used

Y.js provides `Y.UndoManager` for undo/redo on any shared type. Not used anywhere. Could be useful for:
- Agent "rollback" — if an agent makes a bad edit to a shared doc, undo it
- User undo in collaborative editors (BlockNote may handle this internally, but CRDT-level undo would persist across sessions)

### UNDERUTIL-5: Sub-Documents — Not Used

Y.js supports nested `Y.Doc` instances within a parent doc. The current design uses flat documents with naming conventions (`task-003/task`, `task-003/discussion`). Sub-documents could:
- Enable lazy loading (only load discussion when agent enters it, not when reading task metadata)
- Reduce sync overhead (subscribe to task metadata without syncing megabytes of discussion history)
- Natural scoping (child docs garbage-collected with parent)

### UNDERUTIL-6: Hocuspocus `onChange` is Underspecified

The `onChange` hook in `HocuspocusServer.ts` does two things:
1. `projectToFilesystem()` — always
2. `emitDiscussionChange()` — only for docs ending in `/discussion`

**Missing hooks:**
- Task status changes → should notify OrchestratorService for reconciliation
- Plan status changes → should notify PlanStore
- Agent status writes → should broadcast via Socket.IO
- Decision recording → should update task completion state
- Document size monitoring → warn if a doc grows too large

---

## Part 4: Major Missing Features (Designed but Unbuilt)

These are features with thorough architecture docs and CRDT integration designs that have zero implementation. Listed by impact.

### MISSING-1: Per-Role CRDT Memory (HIGH IMPACT)

**Architecture:** MASTER-ARCHITECTURE describes `collab/memory/{roleId}/` namespace with:
- `identity` — agent's self-concept and learned preferences
- `notes` — persistent working notes
- `activity/{taskId}` — task-scoped activity logs
- `experiments/{taskId}` — tried approaches and results
- `profile` — accumulated expertise

**Current state:** Agents use ephemeral scratchpad (in-memory). Nothing persists across goals or sessions. CRDT-backed memory would give agents persistent identity and learning.

**Why it matters:** Without persistent memory, agents repeat mistakes, re-discover the same patterns, and can't build expertise over time. This is the single most impactful CRDT feature still missing.

### MISSING-2: `request_task` Tool — ✅ IMPLEMENTED

**Status:** Fully implemented in `packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts`. Self-assign guard removed (R9-1), sequential IDs (R6-5), task count from TaskStore (Fix #2). See `issues-v1.md` for review history.

### MISSING-3: L2 Search (SearchExtension) (HIGH IMPACT)

**Architecture:** v2.1 implementation plan specifies MiniSearch-based full-text search over CRDT docs with an `l2` tool providing `search`, `grep`, `ls`, `cat`, `query`, `find`, `whatsnew`, `stat` verbs. Estimated 3-4 days of work.

**Current state:** Agents must read entire CRDT docs to find information. No search, no grep, no incremental change detection ("what's new since I last looked").

**Why it matters:** As CRDT docs accumulate (tasks, plans, discussions, shared docs), agents waste context window on full-doc reads when they need a specific piece of information.

### MISSING-4: `record_decision` / `get_decisions` — ⚠️ PARTIAL

**Status:** `record_decision` works via `discuss decide` (writes to Y.Map("decisions")). But there's no dedicated `get_decisions` query action — agents must use `collab read {taskId}/decisions` which works but isn't discoverable.

### MISSING-5: Discussion Orchestration (MEDIUM IMPACT)

**Architecture:** GroupChatManager with turn management, moderation, voting, consensus detection. Plus the collaboration-toolkit's auto-mode discussion flow.

**Current state:** `GroupChatManager.startSession()` is a labeled `[STUB]`. The `discuss` action provides raw Y.Array append/read, but there's no turn management, no automated agent response triggering, no consensus detection, no auto-escalation.

---

## Part 5: Security Concerns

### SEC-1: Hocuspocus Authentication is a No-Op (HIGH)

```typescript
async onAuthenticate({ token }) {
  return { user: token || "anonymous" };  // accepts anything
}
```

Any WebSocket client can connect to any CRDT document. No token validation, no JWT verification, no role-based access control. If port 1234 is network-exposed, all CRDT data is readable and writable by anyone.

**Risk level:** Low in single-machine dev, **critical** in any networked/production deployment.

**Fix:** Validate tokens against the existing auth system (UserManager + JWT). Add per-document ACLs (e.g., agents can only write to their own task docs, not other agents' tasks).

### SEC-2: No Document-Level Authorization

Even with valid authentication, there's no authorization check. An agent for team-A could read/write team-B's CRDT documents if it knows the doc name. The `CollaborationSpace` scopes by `{teamId}/{goalId}/` but the Hocuspocus server doesn't enforce this — any authenticated client can open any doc path.

---

## Part 6: Frontend CRDT Issues

### FE-1: No Disconnect/Reconnect Handling

`useDiscussion.ts` and `CollaborativeEditor.tsx` both:
- Set a connection timeout (8s for discussion, similar for editor)
- Never update `status` state after initial connection succeeds
- Don't listen for `"disconnect"` or `"close"` events from HocuspocusProvider
- If the Hocuspocus server crashes or network drops, UI shows "connected" with stale data

**Fix:** Listen for provider `status` events. Transition state to `"reconnecting"` or `"disconnected"`. Show reconnection indicator in UI.

### FE-2: No Error Boundary for CRDT Components

CRDT components (`CollaborativeEditor`, `DiscussionThread`) don't have error boundaries. A Y.js deserialization error or provider crash would bubble up and potentially crash the entire React app.

---

## Part 7: Recommendations — Priority Order

### P0: Fix Active Bugs
1. **BUG-2:** Add `configMap.set("status", "closed")` when maxTokens exceeded
2. **BUG-1:** Add `CrdtTaskSync.syncPlanStatus()` method, call from all PlanStore mutations
3. **BUG-3:** Implement `timeoutMinutes` enforcement — either a background timer per active discussion, or a check-on-access pattern

### P1: Fix Design Patterns
4. **ANTIPATTERN-1:** Export `ICrdtTaskSync` interface from `@ping/collaboration`, replace all `any`
5. **ANTIPATTERN-2:** Unify plan storage — either CRDT-primary or event-driven sync from PlanStore → CRDT
6. **ANTIPATTERN-3:** Add at least one `observe()` pattern — start with `agent-statuses` auto-broadcast

### P2: Quick Wins for CRDT Utilization
7. **UNDERUTIL-1:** Auto-populate `agent-statuses` from WorkerPool task lifecycle events
8. **ANTIPATTERN-5:** Remove the 2s polling interval in CollaborativeEditor
9. **UNDERUTIL-6:** Extend `onChange` hook with task/plan status change detection

### P3: Unblock Major Features
10. **MISSING-2:** Implement `request_task` tool (enables agent autonomy)
11. **MISSING-3:** Implement L2 SearchExtension (3-4 day estimate, designed)
12. **MISSING-1:** Start per-role CRDT memory with simple `notes` namespace

### P4: Harden for Production
13. **SEC-1:** Implement real Hocuspocus authentication (JWT validation)
14. **SEC-2:** Add document-level authorization (team-scoped access control)
15. **FE-1:** Add disconnect/reconnect handling in frontend CRDT hooks

---

## Appendix: What's Working Well

Not everything is broken. Credit where due:

| What | Why It's Good |
|------|---------------|
| **CrdtTaskSync bridge** | Clean separation — TaskStore is runtime engine, CRDT is persistence. Single-writer eliminates CRDT's last-write-wins weakness. Two-pass loading handles dependency state correctly. |
| **Collab tool progressive discovery** | `discover` → `list` → `read` → `write` flow is well-designed. Agents can explore without knowing doc names upfront. |
| **Filesystem projection** | Auto-generated `.md` and `.json` files from CRDT are a genuine value-add. Human-readable artifacts for free. YAML frontmatter projection for task/plan/goal docs is especially nice. |
| **Blob storage abstraction** | `BlobStorageProvider` interface cleanly separates dev (FsBlobStorage) from prod (S3/Azure). Ready for deployment without refactoring. |
| **Embedded/Standalone dual mode** | `ICollabProvider` interface with `CollabServer` (embedded) and `RemoteCollabClient` (remote) is clean. Correct abstraction boundary for future scale-out. |
| **Discussion guard rails design** | `maxRounds`, `maxTokens`, `timeoutMinutes`, `maxParticipants` — the right concepts are in place. Implementation has bugs (see Part 1) but the design is sound. |
| **CollaborationSpace scoping** | `{teamId}/{goalId}/` prefix provides natural document isolation per goal. `listDocs()` enables task-scoped queries. Clean hierarchy. |
