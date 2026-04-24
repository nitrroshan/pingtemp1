# CRDT Utilization Audit — What's Built, What's Broken, What's Missing

**Date:** April 17, 2026  
**Updated:** April 22, 2026  
**Scope:** Full codebase audit of Hocuspocus/Y.js/CRDT usage  
**Related:** [feature_architecture.md](./feature_architecture.md), [MASTER-ARCHITECTURE](../../MASTER-ARCHITECTURE.md)

---

## Audit Score: 7 fixed, 2 partially fixed, 5 still open

| Issue | Status |
|-------|--------|
| BUG-1 Plan CRDT never updated | ✅ Fixed |
| BUG-2 maxTokens no close | ✅ Fixed |
| BUG-3 timeoutMinutes unenforced | ✅ Fixed |
| BUG-4 relatedTasks empty | ✅ Fixed |
| AP-1 crdtTaskSync: any | 🟡 Partial — no shared `ICrdtTaskSync` interface, `submitResearch` still `any` |
| AP-2 Dual-write plans | ✅ Fixed |
| AP-3 No backend observe() | ❌ Open |
| AP-5 Polling in editor | ✅ Fixed |
| UU-1 agent-statuses ghost doc | ❌ Open |
| MISSING-2 request_task tool | ✅ Fixed |
| MISSING-4 record/get decisions | 🟡 Partial — works via `discuss "decide"`, no standalone tool |
| SEC-1 Hocuspocus auth | ❌ Open |
| FE-1 No disconnect handling | ❌ Open |
| FE-2 No error boundary | ❌ Open |

---

## TL;DR

The CRDT infrastructure (Hocuspocus server, CollaborationSpace, collab tool, CrdtTaskSync, blob persistence, filesystem projection) is **solidly built and functional**. All 4 active bugs from the original audit have been fixed. The remaining problems are:

1. **Design patterns** that don't leverage CRDT's reactive nature — backend treats CRDT as a dumb key-value store instead of a real-time event source (zero `observe()` subscriptions)
2. **Major features designed but unbuilt** — L2 search, discussion orchestration — have thorough architecture docs but zero code. Per-role memory was originally CRDT-planned but revised to file-based (see Part 7).
3. **Partial type safety** at the package boundary — no shared `ICrdtTaskSync` interface, `submitResearch.ts` still uses double `any` cast
4. **Security** — Hocuspocus authentication is still a no-op
5. **Frontend resilience** — no disconnect handling, no error boundaries for CRDT components

---

## Part 1: Active Bugs

> **All 4 bugs fixed as of April 22, 2026.**

### ~~BUG-1: Plan CRDT Never Updated After Archival~~ ✅ FIXED

`syncPlanStatus()` added to CrdtTaskSync and called at all plan lifecycle points: completed, interrupted, archived. Comments reference "BUG-1 FIX" explicitly.

### ~~BUG-2: Discussion maxTokens "Auto-Close" Doesn't Close~~ ✅ FIXED

`configMap.set("status", "closed")` now called when `totalTokensUsed >= maxTokens`. Comment references "BUG-2 FIX."

### ~~BUG-3: `timeoutMinutes` Set But Never Enforced~~ ✅ FIXED

Check-on-access pattern implemented in the `discuss/post` handler. When an agent tries to post and `lastActivity` exceeds `timeoutMinutes`, status is set to `"escalated"`. No background timer — timeout is only detected on next interaction attempt.

### ~~BUG-4: `relatedTasks` in getCrdtRefs Never Populated~~ ✅ FIXED

Populated via multiple paths: planner schema (`AgentPlanSchema.ts`), `requestTaskTool` (sets `relatedTasks: [ctx.taskId]`), and `CrdtTaskSync.persistTask()`.

---

## Part 2: Bad Design Patterns

### ANTIPATTERN-1: `crdtTaskSync: any` Across Package Boundary — 🟡 PARTIALLY FIXED

**Original:** 8+ files used raw `any`.  
**Current:** `OrchestratorService` uses `CrdtProxy` typed interface. `WorkerPool` uses inline structural type `{ persistTask(t: any)... }` for the private field — better than bare `any`, but method params remain `any`.

**Still open:**
- `WorkerPool.setTaskServices()` constructor param still accepts `crdtTaskSync?: any`
- `submitResearch.ts` still uses `(octx as any).crdtTaskSync?.get?.()` — double `any` cast
- **No shared `ICrdtTaskSync` interface** exported from `@ping/collaboration` — this is the root cause

**Fix needed:** Export `ICrdtTaskSync` from `@ping/collaboration`, import in `@ping/agent-manager`, replace remaining `any`.

### ~~ANTIPATTERN-2: Dual-Write Without Reconciliation~~ ✅ FIXED

Plan status changes now sync to CRDT via `syncPlanStatus()` at all lifecycle points (completed, interrupted, archived). PlanStore remains source of truth, CRDT kept in sync.

### ANTIPATTERN-3: Backend Never Uses `observe()` — ❌ STILL OPEN (but scope reduced)

**Original recommendation:** Add `observe()` for agent-statuses, discussion Y.Array, _index Y.Map, and plan Y.Map.

**Revised after architecture analysis:** Only `agent-statuses` actually benefits from `observe()`. The other two are solving non-existent problems.

#### Why `_index` and `plan` observe() are UNNECESSARY

TaskStore and PlanStore follow a **single-writer pattern** — the OrchestratorService is the ONLY thing that writes task status and plan status. It writes to the in-memory store first, then mirrors to CRDT via CrdtTaskSync. The CRDT is a **downstream persistence copy**, not an independent data source.

Observing CRDT for task/plan changes to "reconcile with TaskStore" means watching for changes that *the backend itself caused*. It's a feedback loop that detects nothing new.

**"But what about external systems modifying CRDT?"**
- In the current architecture: nothing external writes to task/plan CRDT docs.
- In the target architecture (Chat Agent layer): Chat Agents route through OrchestratorService, which writes to TaskStore → CRDT. Same single-writer path.
- In team stacking: child Ping teams have their **own** TaskStore and CRDT. The parent doesn't see or modify child's CRDT docs. It gets Channel B events via MCP SSE.
- In standalone CRDT mode (`COLLAB_MODE=external`): multiple backend instances sharing one Hocuspocus server is **not the planned architecture**. Each team has its own OrchestratorService.

**Conclusion:** Drop `_index` and `plan` observe() from recommendations. Single-writer means the writer already knows.

#### Why `agent-statuses` observe() IS useful

`agent-statuses` is different — it has **multiple writers** (each agent/role writes its own status) and **multiple readers** (frontend sidebar, Planner for availability checks, Chat Agents for coordination).

**Current architecture:** WorkerPool knows agent statuses internally but doesn't publish them anywhere. Frontend has no live view of which agents are busy/idle/discussing.

**Target architecture (Chat Agent layer):** This becomes critical:

| Writer | What they write | When |
|--------|----------------|------|
| ChatAgent (persistent, per-role) | `{ status: "idle" \| "chatting" \| "supervising", activeTasks: [...] }` | On task dispatch, task complete, user chat start/end |
| WorkerPool (on behalf of workers) | `{ status: "busy", task: taskId, progress: "Building auth..." }` | On task dispatch, progress reports, task complete |
| External workers via MCP | `{ status: "working", note: "3/5 tests passing" }` | Via `report_status` MCP tool → ChatAgent writes to CRDT |

| Reader | What they read | How |
|--------|---------------|-----|
| Frontend sidebar | Live role cards showing busy/idle/discussing | `ymap.observe()` via HocuspocusProvider → React state |
| Planner | Role availability for task assignment | `collab read agent-statuses` (on-demand, not observe) |
| Other Chat Agents | Peer status for collaboration requests | `collab read agent-statuses` (on-demand) |

**The observe() pattern here:**
```
WorkerPool/ChatAgent writes → agent-statuses Y.Map
  → Hocuspocus onChange fires
  → Backend observe() callback (or onChange hook) detects changed role
  → Emit to Socket.IO `progress` channel: { type: "agent-status", role, status }
  → Frontend sidebar updates live
```

This is the **one place** where backend observe() adds value — because the frontend needs real-time updates, and the writers (multiple agents) don't directly emit Socket.IO events.

#### Discussion Y.Array observe() — defer to Chat Agent layer

The fourth suggested observe() (discussion Y.Array → detect @mentions → route notifications) is **partially useful** but belongs in the Chat Agent feature, not as a standalone backend pattern. When Chat Agents exist, they'll subscribe to discussions for their role. Until then, the existing Hocuspocus `onChange` hook + `emitDiscussionChange()` covers the basic case.

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

### ~~ANTIPATTERN-5: Polling Alongside Y.js Events~~ ✅ FIXED

Polling interval removed from `CollaborativeEditor.tsx`. Now uses event-driven `doc.on("update")` and `provider.on("synced")` only.

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

### UNDERUTIL-2: Y.Text — Defined, Never Used — NO ACTION NEEDED

`CollabDocument.getText(key)` accessor exists. Y.Text provides character-level collaborative plain text (like two people typing in the same Notepad simultaneously).

**No use case in Ping's architecture:**
- Agent scratchpads → ephemeral files, not CRDT (decided in Part 7)
- Agent memory → file-based, single writer (decided in Part 7)
- Collaborative code editing → workers use git branches, not CRDT
- Todo lists → TaskStore + CrdtTaskSync (Y.Map) handles structured task tracking

**"What about collaborative editing during discussions?"**

This is a real use case — already designed and handled by **Y.XmlFragment (BlockNote), not Y.Text**. The [feature_architecture.md](./feature_architecture.md) defines collaboration tasks with two concurrent CRDT structures:

| Structure | Y.js Type | Purpose | Example |
|-----------|-----------|---------|---------|
| Discussion thread | `Y.Array("discussion")` | Append-only chat blocks between agents | "We need PKCE for SPAs" → "SDK supports it" → "Agreed, use S256" |
| Shared working doc | `Y.XmlFragment("content")` in `doc-{name}` | Mutable co-edited document with rich formatting | Two agents co-editing an API spec while discussing it |

```
Collaboration task: "Align API spec with frontend requirements"
├── task-007/discussion      ← Y.Array — agents discuss (append-only blocks)
├── task-007/decisions       ← Y.Map — formal decisions with quorum
└── task-007/doc-api-spec    ← Y.XmlFragment — agents + humans co-edit the spec
```

Agents discuss in the thread, then co-edit the actual document. The discussion is the conversation about the work; the shared doc is the work itself. Both are CRDT, both sync in real-time, both support concurrent edits.

**Why Y.XmlFragment beats Y.Text for this:** Y.XmlFragment gives you headings, bullets, code blocks, tables — all the structure agents need when co-editing specs or documents. Y.Text is just raw characters. BlockNote renders Y.XmlFragment as a rich editor in the frontend. There's no frontend component that renders Y.Text.

The accessor exists because `CollabDocument` wraps all Y.js shared types for completeness. Leave as-is.

### UNDERUTIL-3: Awareness Protocol — Frontend Only — PLANNED (P3), NOT BUILT

Frontend `CollaborativeEditor.tsx` uses BlockNote's built-in awareness plugin (cursor colors). Backend `CollabDocument.getPresence()` returns `[]` (stub: `// TODO: wire to Hocuspocus awareness states in Phase 3`).

**This was explicitly planned in 5 feature docs:**

| Feature Doc | What it says | Detail Level |
|-------------|-------------|-------------|
| **agent-collab-docs** | P3 priority: "Wire `getPresence()` to Hocuspocus awareness for agent cursors" | Reference |
| **agent-collab-docs/research.md** | Code example: `awareness.setLocalStateField('user', { name, color, type: 'agent', activity })` | Implementation sketch |
| **frontend-phase4-knowledge** | Step 5: "Fix L2 CRDT Editor + Agent Cursors" — exit criteria: "agents + humans see each other's cursors" | Exit criteria |
| **frontend-phase4-knowledge/ux-research.md** | Decision 6: Chose **real cursors** (option A) over ghost indicators. "Yjs Awareness + BlockNote — no extra library needed." | UX decision |
| **memory-system v1.1** | Phase 3 plan with `PresenceBar` component code using `provider.awareness.getStates()` + `awareness.on('change', update)` | Full implementation plan |

**Why it wasn't built:** Consistently tagged P3 (lowest priority) in every feature. Frontend Phase 4 Step 5 was never reached.

**What needs to happen:**
1. Backend: agents call `awareness.setLocalStateField("user", { name, color, type: "agent", role })` when reading/writing CRDT docs
2. Frontend: BlockNote already renders cursors natively — just needs the awareness data. Add a `PresenceBar` component showing who's editing.
3. The plan is fully designed — it's a P3 implementation task, not a design gap.

**When it matters:** Becomes important when humans and agents co-edit shared docs during collaboration tasks (UNDERUTIL-2's `doc-{name}` Y.XmlFragment). Without awareness, humans can't see that an agent is also editing the same document.

### UNDERUTIL-4: UndoManager — Not Used → [Separate Feature](../../crdt-undo-rollback/feature_architecture.md)

Y.js `Y.UndoManager` provides per-origin, per-shared-type undo/redo. Not used anywhere in the codebase. Three gaps it would address:
1. **Partial writes on failure** — agent crashes mid-task, 3 of 5 blocks persist in shared doc
2. **No agent-scoped undo** — can't revert just one agent's changes while keeping others
3. **No review-before-keep for CRDT writes** — workspace has git PRs, CRDT has nothing

**Recommendation:** Per-agent UndoManager on shared working docs (`doc-{name}` Y.XmlFragment). Requires refactoring write actions to use `doc.transact(fn, origin)`. Priority P3 — becomes valuable when collaboration tasks are actively used.

Full analysis: [crdt-undo-rollback/feature_architecture.md](../../crdt-undo-rollback/feature_architecture.md)

### UNDERUTIL-5: Sub-Documents — Not Used — AND Document UX Is Broken

Y.js supports nested `Y.Doc` instances within a parent doc. The current design uses flat documents with naming conventions (`task-003/task`, `task-003/discussion`).

**Sub-documents are a performance optimization that doesn't address the real problem.** The real problem is that the frontend document experience is fundamentally broken.

#### Current Document UX — 10 Problems

The current Collaborate view (`CollabFileTree` — an inline function in `App.tsx`, not even a standalone component) is a flat list of raw doc names:

```
Current Collaborate view:
┌──────────────────────────┬───────────────────────────────────────┐
│ 📄 agent-statuses         │                                       │
│ 📄 chat-outcomes          │        (BlockNote editor)              │
│ 📄 doc-shared             │                                       │
│ 📄 task-001/task          │        Editing: doc-shared             │
│ 📄 task-001/discussion    │                                       │
│ 📄 task-002/task          │                                       │
│ 📄 plan                   │                                       │
│ 📄 goal                   │                                       │
│ 📄 _index                 │                                       │
│                           │                                       │
│ [____________] [+]        │                                       │
└──────────────────────────┴───────────────────────────────────────┘
```

| # | Problem | Detail |
|---|---------|--------|
| 1 | **Flat list, no hierarchy** | System docs (plan, goal, _index), task docs (task-001/task, task-001/discussion), and user docs (doc-shared) all mixed in one flat list |
| 2 | **No metadata** | Just names — no description, type, owner, last-modified, size. Backend API returns `string[]` |
| 3 | **No doc type icons** | Discussion docs, rich text docs, Y.Map structured data, and system docs all show `📄` |
| 4 | **No scoping to task/goal** | All team docs shown regardless of which task/goal they belong to |
| 5 | **No URL persistence** | Selected doc is component state, not in URL. Refresh loses selection. Default hardcoded to `"doc-shared"` |
| 6 | **Polling-only discovery** | 10-second `setInterval` polling REST endpoint — no push when agents create docs |
| 7 | **No search/filter** | Can't search within the doc list |
| 8 | **Component inline in App.tsx** | `CollabFileTree` is a ~70-line inline function, not extractable or reusable |
| 9 | **Disconnect from agent experience** | Agents have rich progressive discovery (`discover crdt` → categories, descriptions, drill-down). Frontend has none of this. |
| 10 | **One provider per switch** | Changing docs destroys and recreates HocuspocusProvider — full reconnect on every click |

#### The Frontend Redesign Already Fixes Most of This

The [frontend-redesign-goal-first.md](../../frontend-redesign-goal-first.md) eliminates the standalone `/collaborate` route entirely. Documents move inside the **task detail panel Docs tab**:

```
Task T-2: API Contract                    ▶   ✕
──────────────────────────────────────────────────
Overview │ Discussion │ Docs │ Logs
──────────────────────────────────────────────────

THIS TASK
┌──────────────────────────────────────────────┐
│ 📝 API Spec              BlockNote  · 2 editing│
│ 📊 Decisions (3)         agreed               │
│ 💬 Discussion            12 blocks            │
└──────────────────────────────────────────────┘

GOAL CONTEXT                        read-only 🔒
┌──────────────────────────────────────────────┐
│ 🎯 Goal                  active              │
│ 📋 Plan v1               executing            │
│ 🏠 Agent Statuses        live                 │
└──────────────────────────────────────────────┘
```

**What the redesign fixes:**
- ✅ **Scoped to task** — Docs tab shows docs for the selected task first, then team-wide docs below
- ✅ **No separate route** — docs live inside the task detail panel, always in context
- ✅ **Tabs separate concerns** — Overview/Discussion/Docs/Logs don't compete for space

**What the redesign doesn't address yet (needs design):**

| Gap | What's needed |
|-----|--------------|
| **Doc type icons** | Different icons per doc type: 📝 Document (Y.XmlFragment), 💬 Discussion (Y.Array), 📊 Decisions (Y.Map), 📋 System (task/plan/goal) |
| **Metadata per doc** | Last modified, editor count (from awareness), block/entry count. Backend needs to return more than `string[]` |
| **Doc creation UX** | How does a human create a new shared doc during a task? Current: type a name + click "+". Better: "New shared doc" button in Docs tab with name prompt |
| **Cross-task doc browsing** | ✅ Addressed — `AllDocsOverlay` (full-screen overlay triggered from Docs tab `[Browse all docs]`, Cmd+K, or ⌘⇧D). Groups docs by task, searchable, filterable by type. Team-scoped — shows current team's docs only. |
| **Doc in overlay vs inline** | The redesign says "click → opens `CollaborativeEditor` overlay" — but overlay vs slide-panel vs full-screen-replace needs visual design work |

#### Should We Use Y.js Sub-Documents?

**No — the hierarchy problem is a UI problem, not a data problem.** The CRDT doc naming convention already provides hierarchy:

```
team-1/goal-1/task-003/task         ← task metadata
team-1/goal-1/task-003/discussion   ← discussion thread
team-1/goal-1/task-003/doc-api-spec ← shared working doc
team-1/goal-1/plan                  ← plan (goal-level)
team-1/goal-1/goal                  ← goal (goal-level)
```

The frontend just needs to **parse this hierarchy** (split on `/`, group by task) instead of displaying raw strings. Sub-documents would add:
- Implementation complexity (nested Y.Doc lifecycle management, sub-doc persistence in Hocuspocus)
- Provider management overhead (one provider per sub-doc, or nested awareness)
- Migration effort (convert existing flat docs to nested structure)

For **zero UX benefit** that can't be achieved by simply grouping the flat doc list by path prefix.

**The lazy loading argument is premature.** Current doc sizes are small (a few KB per task doc, maybe 10-50KB for long discussions). Sub-documents solve a performance problem that doesn't exist yet. If discussion docs ever grow to megabytes, sub-documents can be introduced then — as a performance optimization, not a UX fix.

#### Recommended Doc UX for the Redesign

**Docs tab inside task detail panel** (primary — scoped to task):

```
┌──────────────────────────────────────┐
│ Overview │ Discussion │ Docs │ Logs  │
├──────────────────────────────────────┤
│                                      │
│ THIS TASK                            │
│ ┌──────────────────────────────────┐ │
│ │ 📝 API Spec        2 editing now │ │  ← Y.XmlFragment → CollaborativeEditor overlay
│ │ 📊 Decisions (3)   all agreed    │ │  ← Y.Map → DecisionPanel inline
│ └──────────────────────────────────┘ │
│                                      │
│ GOAL CONTEXT             🔒 [show ▾]│  ← collapsed, read-only
│ ┌──────────────────────────────────┐ │
│ │ 🎯 Goal            active       │ │  ← read-only view
│ │ 📋 Plan v1         executing    │ │  ← read-only view
│ │ 🏠 Agent Statuses  live         │ │  ← read-only view
│ └──────────────────────────────────┘ │
│                                      │
│ [+ New shared doc]                   │
└──────────────────────────────────────┘
```

**Cmd+K for cross-task doc access** (secondary — for power users):

```
┌─────────────────────────────────────┐
│ 🔍 api spec                         │
├─────────────────────────────────────┤
│ DOCS                                │
│  📝 T-2 / doc-api-spec    2 editing │
│  📝 T-5 / doc-test-plan   idle      │
│                                     │
│ TASKS                               │
│  T-2  API Contract         ▶ 3m    │
└─────────────────────────────────────┘
```

**Doc metadata — stored in `_meta` Y.Map inside each doc (self-describing):**

Three approaches were considered:

| Approach | Verdict |
|----------|--------|
| Parse doc names client-side (`doc-*` → Document, `*/discussion` → Thread) | **Fragile.** Convention = implicit contract. Frontend parser and backend naming must agree without enforcement. |
| Separate `DocInfo` listing API | **Redundant.** Metadata would drift from actual doc content — two sources of truth. |
| **`_meta` Y.Map inside each doc** | **Correct.** Self-describing. Source of truth lives with the data. Already partially exists in some docs. |

**How it works:** Every CRDT doc carries a `_meta` Y.Map with its own type info. Written once when the doc is created:

```typescript
// On doc creation (CrdtTaskSync, CollaborationSpace, collab tool):
const meta = doc.getMap("_meta");
meta.set("type", "xmlfragment");      // "xmlfragment" | "discussion" | "decisions" | "task" | "plan" | "goal"
meta.set("createdBy", "system");       // "system" | "agent:backend-dev" | "user"
meta.set("createdAt", new Date().toISOString());
```

**Listing endpoint:** Reads `_meta` from each doc (already persisted as `.bin` on disk — no WebSocket needed). For 10-30 docs, this is milliseconds.

```typescript
// GET /api/collab/:teamId/docs
const docNames = await collabServer.getDocNames();
const docs = await Promise.all(docNames.map(async (name) => {
  const doc = await space.openDoc(name);
  const meta = doc.getMap("_meta").toJSON();
  return { name, ...meta };
}));
// → [{ name: "task-003/doc-api-spec", type: "xmlfragment", createdBy: "system", createdAt: "..." }]
```

**What already exists:** Some docs already write `_meta` (via `KNOWN_CRDT_DOCS` lookup in the collab tool). This just makes it universal — every doc gets `_meta` at creation time.

#### Summary

| Question | Answer |
|----------|--------|
| Should we use Y.js sub-documents? | **No.** UI hierarchy via path parsing, not data restructuring. |
| Is the current doc UX broken? | **Yes.** Flat list, no metadata, no scoping, no type awareness. |
| Does the redesign fix it? | **Mostly.** Task-scoped Docs tab fixes scoping and context. Still needs type icons, metadata, and backend API enrichment. |
| What's the implementation priority? | **Part of frontend redesign.** The Docs tab is already planned. Add `DocInfo` API + type icons + Cmd+K doc search during redesign implementation. |

### UNDERUTIL-6: Hocuspocus `onChange` — Adequate for Current Architecture

The `onChange` hook in `HocuspocusServer.ts` does two things:
1. `projectToFilesystem()` — always
2. `emitDiscussionChange()` — only for docs ending in `/discussion`

**Previously suggested:** Add hooks for task status, plan status, agent status, decision recording, document size monitoring.

**Revised:** Task and plan status changes don't need `onChange` detection — the OrchestratorService is the single writer and already knows when it changed them. Adding `onChange` hooks to detect "changes the backend itself caused" is circular. The only genuinely useful addition is:
- **Agent status writes → broadcast via Socket.IO** — because multiple writers (agents) update this doc, and the frontend needs live updates. This should use `observe()` on the embedded server's Y.Map (see AP-3 revised), not `onChange` (which fires on any doc change and requires docName parsing).

---

## Part 4: Major Missing Features (Designed but Unbuilt)

These are features with thorough architecture docs and CRDT integration designs that have zero implementation. Listed by impact.

### ~~MISSING-1: Per-Role CRDT Memory~~ → REVISED: File-Based Memory (see Part 7)

**Original plan (MASTER-ARCHITECTURE):** CRDT-backed `collab/memory/{roleId}/` with identity, notes, activity, experiments, profile.

**Revised decision (Part 7):** File-based memory at `.ping/memory/{role}.md` — one file per agent, private, git-tracked. Industry consensus (Claude Code, Copilot, Cursor all use files). CRDT is wrong for static knowledge that's written rarely by a single agent. See Part 7 for full analysis.

### ~~MISSING-2: `request_task` Tool — Agent-Initiated Tasks~~ ✅ FIXED

Full implementation in `requestTaskTool.ts` (200+ lines) with: input schema validation (Zod), guard rails (max 5 tasks/agent, priority ceiling, role validation), TaskStore creation, DAG cycle detection, CRDT persistence, `blocks-me` reverse dependency, and orchestrator notification callback.

### MISSING-3: L2 Search (SearchExtension) (HIGH IMPACT)

**Architecture:** v2.1 implementation plan specifies MiniSearch-based full-text search over CRDT docs with an `l2` tool providing `search`, `grep`, `ls`, `cat`, `query`, `find`, `whatsnew`, `stat` verbs. Estimated 3-4 days of work.

**Current state:** Agents must read entire CRDT docs to find information. No search, no grep, no incremental change detection ("what's new since I last looked").

**Why it matters:** As CRDT docs accumulate (tasks, plans, discussions, shared docs), agents waste context window on full-doc reads when they need a specific piece of information.

### MISSING-4: `record_decision` / `get_decisions` — 🟡 PARTIALLY FIXED

**Architecture:** Standalone collab tool actions for formal decision recording with quorum checking.

**Current state:** Works as a `discuss` sub-operation (`collab discuss "decide"` records decisions with quorum verification to `Y.Map("decisions")`). No standalone `record-decision` or `get-decisions` tool action — decisions are nested inside the `discuss` flow. Functional but less discoverable than a dedicated action.

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

## Part 7: MISSING-1 Deep Dive — Per-Role CRDT Memory vs File-Based Memory

**Date:** April 22, 2026 — Research into whether CRDT-backed per-role memory is the right model, or whether file-based memory (like Copilot/Claude Code/Cursor) is better.

### How the Industry Does Agent Memory

| System | Memory Model | Storage | Scope | Who Writes |
|--------|-------------|---------|-------|-----------|
| **Claude Code** | `CLAUDE.md` (human-written) + auto memory `MEMORY.md` (agent-written) | **Filesystem** — `~/.claude/projects/<project>/memory/` | Per-project (git repo), per-user | Human writes CLAUDE.md, Claude writes MEMORY.md |
| **GitHub Copilot** | `copilot-instructions.md` + `.instructions.md` files + `AGENTS.md` | **Filesystem** — `.github/` in repo | Per-repo (git-tracked, shared) | Human writes, agent reads only |
| **Cursor** | `.cursor/rules/*.mdc` + User Rules + Team Rules | **Filesystem** — `.cursor/rules/` in repo + dashboard | Per-project + per-team + per-user | Human writes, agent reads only |
| **VS Code Copilot (this session)** | `/memories/` (user + session + repo scopes) | **VS Code storage** — not in repo | Per-user, per-session, per-repo | Agent writes, human can edit |

**Key observation:** Every production system uses **plain files** for memory. None use CRDT, databases, or real-time sync. Memory is treated as **static context** loaded at session start, not as live collaborative state.

### Why They Use Files, Not CRDT

| Reason | Explanation |
|--------|-------------|
| **Single writer** | In Copilot/Cursor/Claude Code, one agent works at a time. There's no concurrent write problem — the thing CRDT solves. |
| **Human editability** | Plain `.md` files can be opened, read, edited, and committed with zero tooling. CRDT binary state requires Hocuspocus to decode. |
| **Git-trackable** | Team knowledge (`CLAUDE.md`, `.cursor/rules/`) is version-controlled. The team reviews changes in PRs. CRDT state isn't diffable in git. |
| **Survives infra changes** | Markdown files work if you change your CRDT server, database, or hosting. They're portable. |
| **Debuggable** | "Why did the agent do X?" → open the memory file and read it. CRDT requires connecting to Hocuspocus to inspect state. |

### But Ping Is Different From Copilot/Claude Code

The above systems are **single-agent, single-human**. Ping is **multi-agent, multi-human**:

| Dimension | Copilot/Claude/Cursor | Ping |
|-----------|----------------------|------|
| **Agents per session** | 1 | 3-10+ (workers + planner + orchestrator) |
| **Concurrent writes** | Never — 1 agent at a time | Always — multiple workers execute in parallel |
| **Workspace model** | 1 repo, full access | 1 repo per team, branch-per-task clones |
| **Memory readers** | Same agent that wrote it | Any agent in the team (cross-role context) |
| **Human interaction** | Direct chat | Async — human may review agent work hours later |

**This matters because:** The file-based approach works when there's one writer. When 5 agents on a team are simultaneously working on tasks, and one discovers something the others should know, a file write → read approach has race conditions. CRDT handles this natively.

### The Real Question: What Needs CRDT vs What Needs Files?

Not all memory is created equal. Different types of agent memory have different access patterns:

| Memory Type | Write Pattern | Read Pattern | Concurrency | Best Storage |
|-------------|--------------|--------------|-------------|-------------|
| **Role identity** (who am I, my capabilities) | Written once at role creation, rarely updated | Every task start | None | **File** — `.ping/roles/{roleId}/identity.md` |
| **Coding standards** (project conventions) | Written by human, rarely updated | Every task start | None | **File** — `CLAUDE.md` / `.github/copilot-instructions.md` pattern |
| **Task activity log** (what I did on task-003) | Written by worker during task execution | Post-mortem, cross-task context | Low (1 writer per task) | **File** — already exists as workspace artifacts |
| **Learned patterns** (tool tips, debugging insights) | Written by agent after discovering something | Future tasks by same/similar role | Medium (multiple agents learn in parallel) | **Either** — file works if writes are rare |
| **Live status** (what I'm doing right now) | Written continuously during execution | Real-time by planner, frontend, other agents | **High** | **CRDT** — multiple agents update simultaneously |
| **Discussion state** (agent-to-agent collab) | Multiple agents write concurrently | Real-time by participants | **High** | **CRDT** — already built and working |
| **Shared working docs** (co-edited specs) | Multiple agents + humans write concurrently | Real-time | **High** | **CRDT** — already built (BlockNote) |

### Recommendation: Hybrid — Files for Static Memory, CRDT for Live State

**Don't put static knowledge in CRDT. Don't put live state in files.**

#### Tier 1: File-Based Memory (Claude Code / Copilot Model)

For knowledge that's written rarely and read at task start — use the **industry-proven file-based pattern**:

```
.ping/memory/
├── team.md                         ← Shared team knowledge (like CLAUDE.md)
├── backend-dev.md                  ← Backend's own notes, patterns, tips
├── frontend-dev.md                 ← "This project uses React 19 with strict mode..."
├── architect.md                    ← "When designing APIs in this codebase, always..."
└── researcher.md                   ← Researcher's learned patterns
```

**Why private, not shared:**
- In Claude Code, each user has their own `~/.claude/projects/<project>/memory/MEMORY.md` — no user reads another user's memory
- An architect's API design tips are noise for a frontend-dev. Loading all roles' memories wastes context tokens on irrelevant info.
- Cross-role knowledge that's truly important gets promoted to `team.md` (the shared layer)
- One agent's bad insight doesn't contaminate others
- Each role's memory stays scoped and small — better LLM adherence (Claude Code recommends < 200 lines)

**Two layers, clear separation:**
| Layer | Scope | Who writes | Who reads | Equivalent |
|-------|-------|-----------|-----------|-----------|
| `team.md` | Whole team | Humans + promoted agent learnings | All agents | `CLAUDE.md` |
| `{role}.md` | One agent only | That agent | Only that agent | `~/.claude/projects/.../memory/MEMORY.md` |

**Cross-role knowledge flow:** If researcher discovers "MongoDB needs `.lean()` for performance" and it's useful for the whole team, it gets promoted to `team.md` — not dumped into a shared `learnings/` folder. The promotion is explicit: agent writes to scratchpad → on task completion, orchestrator/human decides whether finding goes to role memory (private) or team knowledge (shared).

#### Tier 2: CRDT for Live State (Keep What's Already Working)

CRDT remains the right choice for what it's already doing:

| Already in CRDT | Keep? | Why |
|-----------------|-------|-----|
| Task metadata (CrdtTaskSync) | ✅ | Multiple agents read task state concurrently |
| Plan state | ✅ | Planner + orchestrator + agents all need current plan |
| Goal state | ✅ | Shared read context |
| Discussions (Y.Array) | ✅ | Multi-writer, real-time, concurrent-safe |
| Shared docs (Y.XmlFragment) | ✅ | Multi-writer co-editing |
| Agent statuses | ✅ | Real-time, multiple writers, needs `observe()` |
| Discussion decisions | ✅ | Multi-writer quorum tracking |

| NOT in CRDT (keep as files) | Why |
|------------------------------|-----|
| Agent memory (`{role}.md`) | **Private** — one file per agent, single writer, human-editable, git-trackable. Other agents don't read it. |
| Team knowledge (`team.md`) | Written by humans, rarely changes, needs PR review. Read by all agents. |
| Task activity logs | Single writer (the executing agent), post-mortem value |

#### What About `agent-statuses` CRDT Doc? (UNDERUTIL-1)

This is the **one case where CRDT is clearly right** for "memory-like" data — because it's **live state**, not **static knowledge**. Multiple agents update their status simultaneously, and the frontend needs real-time updates.

**Recommendation:** Implement UNDERUTIL-1 (auto-populate `agent-statuses` from WorkerPool) — but understand this is **live status**, not **memory**. It's the equivalent of Slack presence indicators, not learned knowledge.

### What Changes From the Original MISSING-1 Plan

| Original Plan (MASTER-ARCHITECTURE) | Revised Recommendation |
|------|------|
| `collab/memory/{roleId}/identity` → CRDT | `.ping/memory/{roleId}.md` → **File** (one file per agent) |
| `collab/memory/{roleId}/notes` → CRDT | `.ping/memory/{roleId}.md` (section) → **File** |
| `collab/memory/{roleId}/activity/{taskId}` → CRDT | Already exists as workspace artifacts → **File** |
| `collab/memory/{roleId}/experiments/{taskId}` → CRDT | `.scratch/` during task, promote on completion → **File** |
| `collab/memory/{roleId}/profile` → CRDT | `.ping/memory/{roleId}.md` (section) → **File** |
| Shared `learnings/` folder | **Don't build.** Cross-role knowledge promoted to `team.md` instead. |
| `memory_write` / `memory_read` tools (25 planned) | **Don't build.** Use existing `workspace_write_file` / `workspace_read_file` + convention. Same as how Copilot uses `CLAUDE.md` — no special tools, just files. |

**The ~25 planned memory tools are unnecessary.** Claude Code doesn't have `memory_write` — Claude just uses its file tools to read/write `MEMORY.md`. Same approach works here: agents use workspace tools to read/write `.ping/memory/roles/{role}.md`. The convention (file location + format) is the API, not a custom tool.

### Scratchpad → Memory Promotion Flow

```
During task execution:
  Agent writes observations to .scratch/notes.json          (ephemeral)
  Agent writes experiments to .scratch/files/experiment.md   (ephemeral)

On task completion (automatic or via promote_to_workspace):
  Role-specific findings → .ping/memory/{role}.md               (private, persistent)
  Cross-role findings    → .ping/memory/team.md                  (shared, needs review)
  Task deliverables      → artifacts/ directory                  (persistent, git-tracked)
  .scratch/              → discarded with the task branch        (ephemeral)

On next task start (context injection):
  Agent context ← .ping/memory/{role}.md                     (own memory only)
  Agent context ← .ping/memory/team.md                        (shared team knowledge)
  Agent context ← CRDT task/plan/goal docs                    (on-demand via collab tool)
  Agent context ← other roles' memory? NO — private.
```

### Summary

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Per-role memory storage | **One file per agent** (`.ping/memory/{role}.md`) | Same as Claude Code's per-user `MEMORY.md`. Private — only that agent reads it. |
| Team knowledge storage | **Shared file** (`.ping/memory/team.md`) | Same as `CLAUDE.md` pattern. Human-maintained, PR-reviewed. Read by all agents. |
| Cross-role learnings | **Promote to `team.md`** | No shared `learnings/` folder. If it's important for everyone, it goes in `team.md`. |
| Live agent status | **CRDT** (existing `agent-statuses` doc) | Multi-writer, real-time — CRDT's sweet spot. |
| Task/plan/goal state | **CRDT** (existing CrdtTaskSync) | Already built, working, correct for concurrent access. |
| Discussions & shared docs | **CRDT** (existing Y.Array, Y.XmlFragment) | Already built, working, correct for co-editing. |
| Memory tools | **Don't build separate tools** | Use existing workspace file tools + file convention. |
| Scratchpad → memory promotion | **Extend `promote_to_workspace`** | Already exists. Add `.ping/memory/` as a promotion target. |

**Bottom line:** CRDT is the right tool for live collaborative state (which Ping already uses it for). It's the wrong tool for static agent memory. Follow the industry — use files.

---

## Part 8: Recommendations — What's Left (Priority Order)

### P0: Fix Remaining Design Patterns
1. **AP-1:** Export `ICrdtTaskSync` interface from `@ping/collaboration`, replace remaining `any` in `submitResearch.ts` and `WorkerPool.setTaskServices()`

### P1: CRDT Utilization Quick Wins
2. **UU-1:** Auto-populate `agent-statuses` from WorkerPool task lifecycle events — this is the biggest CRDT underutilization
3. **AP-3:** Add backend `observe()` on `agent-statuses` Y.Map → emit to Socket.IO for live frontend sidebar (the only observe() pattern that's actually needed — `_index` and `plan` observe are unnecessary due to single-writer pattern)

### P2: Agent Memory (File-Based, Private Per Role)
5. Create `.ping/memory/` with `team.md` + `{role}.md` per agent (flat, no subdirectories)
6. Pre-load only `team.md` + own role's `MEMORY.md` into agent context at task dispatch
7. Extend `promote_to_workspace` to support `.ping/memory/` as a promotion target (role-private or team-shared)

### P3: Unblock Major Features
8. **MISSING-3:** Implement L2 SearchExtension (3-4 day estimate, fully designed in v2.1 doc)
9. **MISSING-5:** Discussion orchestration — turn management, auto-escalation beyond check-on-access

### P4: Harden for Production
10. **SEC-1:** Implement real Hocuspocus authentication (JWT validation)
11. **SEC-2:** Add document-level authorization (team-scoped access control)
12. **FE-1:** Add disconnect/reconnect handling in frontend CRDT hooks
13. **FE-2:** Add error boundaries for CRDT components (`CollaborativeEditor`, `DiscussionThread`)

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
