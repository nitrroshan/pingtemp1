# CRDT-First Architecture — Feature Architecture

**Date:** May 3, 2026
**Status:** Architecture approved, ready for implementation
**Priority:** P0 — Workers cannot get task context without this
**Depends on:** Collaboration Toolkit (existing), Data Persistence v3.0 (done)
**Related:** [task-context-and-crdt](../task-context-and-crdt/feature_architecture.md), [crdt-scoped-memory](../crdt-scoped-memory/feature_architecture.md), [crdt-symbol-index](../crdt-symbol-index/feature_architecture.md)

---

## Problem

v3.1 persistence cleanup deleted all CRDT writes from GoalManager. Workers call `collab read {taskId}/task` and get empty documents. The collaboration layer is dead.

Beyond the immediate break: agents produce structured JSON that goes straight to databases, bypassing human review. No readable artifacts, no chance to review before execution.

## Core Principle

**Document-first, index-second.** Agents write readable DOCUMENTS to CRDT. System derives structured INDEXES for MongoDB.

```
Agent writes document to CRDT → User reviews → User approves
  → System derives index → MongoDB (tracking)
  → Workers read documents from CRDT (full context)
  → Server restart → Hocuspocus reloads CRDT from S3 blob storage
```

CRDT = working layer. MongoDB = durable archive.

Key patterns adopted from industry:
- **CrewAI `extract_memories()`** — document → structured facts (our document→index pattern)
- **LangGraph `interrupt()`** — pause for human review (our plan approval gate)
- **Notion document-as-database** — document structure IS the schema (plan doc → task index)

---

## Document Structure

### The Standard Page

Every CRDT document (page) uses the same internal layout. Two required slots, three optional:

```
Y.Doc (Hocuspocus room = page path)
│
├── Y.Map("meta")              — REQUIRED. Structured fields.
│   ├── id: string
│   ├── type: string           — "plan" | "task" | "report" | "research" | ...
│   ├── createdBy: string
│   ├── createdAt: number
│   └── ... type-specific fields
│
├── Y.XmlFragment("content")   — OPTIONAL. Rich text body (BlockNote).
│   │                            Rule: if a human reads it → add content.
│   │                            Contains multiple blocks:
│   ├── Block { id: "a1b2", type: "heading",        content: "..." }
│   ├── Block { id: "c3d4", type: "paragraph",      content: "..." }
│   ├── Block { id: "e5f6", type: "bulletListItem",  content: "..." }
│   ├── Block { id: "g7h8", type: "codeBlock",      content: "..." }
│   └── ... (each block has a stable UUID, managed by BlockNote)
│
├── Y.Text("source")           — OPTIONAL. Plain text / code.
│                                Rule: if it has code for LSP → add source.
│                                (Future — code currently lives in workspace files)
│
├── Y.Map("refs")              — OPTIONAL. DocumentRef cross-references.
│                                { inputs: DocumentRef[], outputs: DocumentRef[] }
│
└── Y.Map("symbols")           — OPTIONAL. Named entities in this page.
                                 { "decision:db-choice": { blockId, kind, summary } }
                                 (Future — Phase 6, see crdt-symbol-index)
```

**Why:** Consistent access pattern. `collab read` always reads `meta` + `content`. No `resolveDataMap()` introspection. No `KNOWN_MAP_NAMES`. Always `doc.getMap("meta")`.

### Phase 1 Documents (What We Build Now)

| Document | Path | `meta` fields | `content`? | `refs`? |
|----------|------|--------------|-----------|--------|
| **Plan doc** | `{goalId}/plan-doc` | goal, approach, status, taskSummaries[] | ✅ rationale, risks | ✅ research inputs |
| **Plan index** | `{goalId}/plan-index` | goalId, version, tasks[] | ❌ | ❌ |
| **Task** | `{goalId}/{taskId}/task` | id, title, assignedRole, status, priority, deps[] | ✅ description | ✅ inputDocs[], expectedOutputDocs[] |
| **Completion report** | `{goalId}/{taskId}/report` | taskId, role, producedDocs[], decisions[] | ✅ findings | ✅ producedDocs[] |
| **Goal metadata** | `{goalId}/goal` | id, title, teamId, status | ✅ user intent | ❌ |
| **Task index** | `{goalId}/_index` | byRole, byStatus, totalTasks | ❌ | ❌ |

Discussion docs are an **exception** — they use `Y.Array("discussion")` + `Y.Map("config")` + `Y.Map("decisions")`. Append-only message streams, not authored pages.

### Future Documents (Phase 3+)

Documented in their respective feature docs:
- **Research findings** — [crdt-scoped-memory](../crdt-scoped-memory/feature_architecture.md)
- **Team decisions/conventions/knowledge** — [crdt-team-memory](../crdt-team-memory/feature_architecture.md)
- **Agent scratchpad/context/history** — [crdt-scoped-memory](../crdt-scoped-memory/feature_architecture.md)
- **`_pages` registry, `_identities` map** — [crdt-symbol-index](../crdt-symbol-index/feature_architecture.md)

### What Changes From Current Code

| Current | New |
|---------|-----|
| `Y.Map("task")` with `body: string` | `Y.Map("meta")` + `Y.XmlFragment("content")` |
| `Y.Map("plan")` with `body: string` | `Y.Map("meta")` + `Y.XmlFragment("content")` |
| `Y.Map("goal")` with `body: string` | `Y.Map("meta")` + `Y.XmlFragment("content")` |
| `Y.Map("default")._meta` | Merged into `Y.Map("meta")` |
| Custom docs: `Y.Map("{docName}")` | `Y.Map("meta")` + `Y.XmlFragment("content")` |
| `resolveDataMap()` introspection | Always `doc.getMap("meta")` |
| `KNOWN_MAP_NAMES` | Deleted |

---

## Architecture

### Data Flow

```
┌──────────────────────────────────────────────────────────┐
│  CRDT (Hocuspocus) — WORKING LAYER                       │
│                                                           │
│  System-created (on lifecycle events):                    │
│    {goalId}/plan-doc         Plan document (rich text)    │
│    {goalId}/{taskId}/task    Task context + status        │
│    {goalId}/{taskId}/report  Completion report            │
│                                                           │
│  Agent-created (on demand, any name):                     │
│    {goalId}/research/pricing   Research findings          │
│    {goalId}/api-spec           API specification          │
│    {goalId}/{anything}         Agents create freely       │
│                                                           │
│  All pages use standard pattern: meta + content           │
│  Agents READ/WRITE via markdown ↔ BlockNote               │
│  Users REVIEW via BlockNote rich text editor              │
└───────────────────────┬──────────────────────────────────┘
                        │ plan approve only
                        │ (plan-doc → task records)
                        ▼
┌──────────────────────────────────────────────────────────┐
│  MongoDB — TRACKING LAYER                                 │
│                                                           │
│  tasks collection      ← derived from plan-doc on approve │
│  goals collection      ← written directly by backend      │
│  messages collection   ← written directly by backend      │
│                                                           │
│  Only tasks are derived from CRDT.                        │
│  Everything else is written independently by the backend. │
└──────────────────────────────────────────────────────────┘
```

### BlockNote Integration (Server-Side)

Agents write **markdown**. Backend converts to BlockNote blocks and writes to `Y.XmlFragment`. Frontend renders blocks natively. No raw XML manipulation.

```
Agent → markdown → ServerBlockNoteEditor → Block[] → Y.XmlFragment("content")
                                                          ↕ (Hocuspocus sync)
Frontend ← BlockNote editor ← Y.XmlFragment("content") (real-time)

Agent reads:
Y.XmlFragment → yXmlFragmentToBlocks() → blocksToMarkdownLossy() → markdown
```

**Key APIs** (from `@blocknote/server-util` + `@blocknote/core/yjs`):

| Function | Direction | Use |
|----------|-----------|-----|
| `tryParseMarkdownToBlocks(md)` | markdown → Block[] | Agent writes content |
| `blocksToMarkdownLossy(blocks)` | Block[] → markdown | Agent reads content |
| `blocksToYXmlFragment(editor, blocks, fragment)` | Block[] → Y.XmlFragment | Write to CRDT |
| `yXmlFragmentToBlocks(editor, fragment)` | Y.XmlFragment → Block[] | Read from CRDT |
| `ServerBlockNoteEditor.create()` | — | Backend editor (no DOM needed) |

**Block structure** — each block has a stable UUID:
```typescript
{ id: "e5a83835-...", type: "paragraph", props: {}, content: InlineContent[], children: Block[] }
```

**Markdown conversion is lossy** — both directions. The `Y.XmlFragment` IS the lossless format. `JSON.stringify(editor.document)` for lossless JSON export when needed.

### State Transitions

| Transition | CRDT Write | MongoDB Write |
|---|---|---|
| Plan proposed | `plan-doc` + per-task docs + plan JSON (for sidebar cards) | — |
| Plan reviewed | User/planner edits plan-doc, task docs created | — |
| Plan approved | All docs finalized | `tasks` collection derived from plan-doc |
| Task dispatched | `task` meta.status → in_progress | `tasks.status` |
| Task completed | `task` meta.status + `report` doc created | `tasks.status` + `producedDocs` |
| Task failed | `task` meta.status + error | `tasks.status` |
| Server restart | — (Hocuspocus reloads from S3) | — (backend rehydrates in-memory state) |

### What Gets Eliminated

| Current | Fate |
|---|---|
| `PlanStore` (JSON disk files) | CRDT plan doc + MongoDB index |
| `GoalContext.pendingPlan` | CRDT `plan-doc` with status: "draft" |
| `resolveDataMap()` | Always `doc.getMap("meta")` |
| `KNOWN_MAP_NAMES` | Deleted |
| `FileTaskStore` | Already gone (v3.1) |

### `collab` Tool API

Agents interact with CRDT pages via markdown. BlockNote conversion is transparent.

```
collab read {doc}           → meta (JSON) + content (markdown via blocksToMarkdownLossy)
collab read {doc} --meta    → meta only (JSON)
collab read {doc} --content → content only (markdown)
collab write {doc} key=val  → writes to Y.Map("meta")
collab write-block {doc}    → markdown → tryParseMarkdownToBlocks → Y.XmlFragment("content")
```

Internally `collab write-block` uses `ServerBlockNoteEditor` to convert agent markdown to BlockNote blocks, then writes to the Y.XmlFragment. Agents never see Block[] or XML — only markdown.

---

## Plan Session Flow

```
1. User submits goal
2. Planner analyzes → writes plan as markdown
3. Backend converts markdown → BlockNote blocks → Y.XmlFragment("content")
   - Also writes structured task breakdown to Y.Map("meta").taskSummaries
4. Frontend renders plan document (real-time from CRDT via BlockNote)
5. User reviews, can comment or request changes
6. User approves
7. System reads plan-index from CRDT → creates task docs + MongoDB records
8. Per-task CRDT docs populated with context (meta + content)
9. Workers dispatched → read context via `collab read` (CRDT → markdown)
```

---

## Phased Delivery

| Phase | What | Scope |
|---|---|---|
| **v1.0** | Restore CRDT writes + standardize doc structure | Plan doc, task context, completion report, MongoDB safety |
| **v2.0** | Research docs + rich completion reports | Research agents write findings, reports with code samples |
| **v3.0** | Decision index + rehydration | Cross-task decisions, MongoDB→CRDT startup recovery |

---

## Integration Points

- **GoalManager** — plan proposed/approved/completed → write CRDT
- **OrchestratorService** — dispatch reads context from CRDT
- **CollaborationPlugin** — provides CRDT access to workers (already works)
- **CrdtTaskSync** — `persistTask()`, `persistPlan()`, `syncStatus()` — write `meta` + `content`
- **SocketServerV2** — plan events still broadcast via Socket.IO for frontend state
- **HttpServer sessionRoutes** — reads CRDT + MongoDB overlay
- **Frontend** — BlockNote binds to `Y.XmlFragment("content")` for plan/report viewing

---

## Design Review: PR 2 CRDT Integration (May 3, 2026)

Post-implementation review of the CRDT restore (PR 2). Evaluated against established patterns: CQRS (Fowler), Repository Pattern (Cosmic Python), Dual-Write Problem (Confluent), SOLID principles.

### What Works

1. **Lazy CrdtProxy pattern** — CRDT is goal-scoped, resolved only when `approvePlan` sets goalId. Proxy's `get()` returns null when no goal is active; every call site checks `if (crdtSync)`.
2. **Error isolation** — Every CRDT write is wrapped in try/catch with `log.warn`. CRDT failures never block task execution. TaskStore remains the runtime source of truth.
3. **Consistent map naming** — `Y.Map("meta")` everywhere with a `type` discriminator. Eliminated the old `resolveDataMap()` introspection heuristic (~60 lines deleted).
4. **Agent status tracking** — `updateAgentStatus` in WorkerPool's try/finally ensures agents always get marked idle even on failure.

### Issues Found

#### 1. Dual-Write Problem (Critical — architectural)

Three uncoordinated writes: TaskStore (in-memory) → MongoDB → CRDT. No atomicity guarantee between them. If CRDT write fails after MongoDB succeeds, agents read stale data. No retry queue, no outbox, no reconciliation — just `log.warn`.

**Industry solution:** Transactional Outbox pattern or Listen-to-Yourself pattern (Confluent). Write to ONE authoritative store, derive the others.

**Our gap:** GoalManager fires two independent writes (MongoDB + CRDT) with no coordination protocol.

#### 2. Repository / DIP Violation (Structural)

GoalManager directly resolves `crdtTaskSyncProxy?.get?.()` in 7 scattered call sites and knows about the lazy proxy pattern, goal resolution, and CRDT-specific error handling. This is infrastructure logic in the domain.

**Industry solution:** Repository Pattern (Cosmic Python, DDD). Domain calls `port.onTaskCreated(tasks)`; adapter routes to MongoDB (critical) + CRDT (secondary).

#### 3. SRP Violation

GoalManager owns: goal lifecycle + CRDT persistence (7 sites) + MongoDB persistence (7 sites) + plan status + frontend notifications + agent lifecycle. Too many responsibilities.

#### 4. CQRS Natural Fit (Not Exploited)

Our system is naturally CQRS:
- **Write model:** TaskStore (in-memory state machine) — fast, consistent, single-writer
- **Read model:** CRDT (agents read task context) + MongoDB (frontend queries history)

But we do synchronous dual-writes at every state transition instead of event-driven projection. Agents don't need real-time task status — they read context before starting, not during.

#### 5. Bug: `type` Overwrite in `persistTask`

`CrdtTaskSync.persistTask()` sets `map.set("type", "task")` (page-level discriminator), then overwrites it with `map.set("type", ctx.type || "work")` (task-type field). These are semantically different. Fix: rename second to `map.set("taskType", ...)`.

### Recommended Refactoring: Persistence Port/Adapter

Extract before PR 3 to give a clean surface for DocumentRef and BlockNote changes.

```
GoalManager (Domain)
  │
  ├── TaskStore (in-memory write model — unchanged)
  │
  └── calls IPersistencePort.onTaskCreated(tasks)
                    │
                    ▼
         PersistenceAdapter (implements IPersistencePort)
          ├── MongoTaskService (await — critical path)
          └── CrdtTaskSync (best-effort with retry — secondary)
```

**Interface:**
```typescript
interface IPersistencePort {
  onTasksCreated(goalId: string, tasks: TaskLike[]): Promise<void>;
  onTaskStatusChanged(taskId: string, status: string, output?: unknown): Promise<void>;
  onPlanPersisted(plan: any, goalId: string): Promise<void>;
  onPlanStatusChanged(status: string): Promise<void>;
  onGoalPersisted(goalId: string, title: string, message: string): Promise<void>;
  onGoalStatusChanged(status: string): Promise<void>;
  onTasksCleared(goalId: string): Promise<void>;
}
```

**Benefits:**
- GoalManager drops from 7 CRDT call sites + 7 MongoDB call sites → 7 port calls
- Adding Redis/S3/new persistence = new adapter, zero domain changes
- Adapter can implement retry/outbox for CRDT writes
- Testable: fake port for unit tests (Repository Pattern benefit)

**Not doing now:** This is a pre-PR-3 prep step. Current PR 2 code works and is safe — just not well-structured for the changes coming in PR 3-4.

---

## Redesign: Domain Events + Persistence Port (Research-Backed)

Based on research from three established sources:
- **Cosmic Python Ch.8** — Domain Events + Message Bus + UoW (Option 3: UoW publishes events)
- **Khalil Stemmler** — Domain Events in TypeScript DDD (AggregateRoot pattern)
- **Confluent** — Transactional Outbox for dual-write coordination

### Architecture Options

#### Option A: Persistence Port (Simple Adapter)

GoalManager calls `IPersistencePort` methods directly. Adapter fans out to MongoDB + CRDT.

```
GoalManager → port.onTaskCreated(tasks) → adapter → MongoDB + CRDT
```

**Pros:** Simple, easy to understand, minimal refactoring
**Cons:** Still synchronous dual-write. Adapter swallows CRDT failures. No event history. Adding new side-effects (e.g. notify analytics) means modifying the adapter.
**Effort:** Small — extract 14 call sites into 7 port calls

#### Option B: Domain Events + Message Bus (Cosmic Python Option 3)

GoalManager emits domain events. TaskStore (our "UoW") collects them. After commit, a message bus dispatches to handlers. Each handler is independent.

```
GoalManager → taskStore.completeTask(...)     // domain operation
           → taskStore.events.push(TaskCompleted{...})  // event recorded
           ...
           → taskStore.commit()               // state committed
           → bus.handle(taskStore.events)     // dispatch to handlers
               ├── MongoHandler.onTaskCompleted(event)
               ├── CrdtHandler.onTaskCompleted(event)
               └── FrontendHandler.onTaskCompleted(event)
```

**Pros:**
- True SRP: GoalManager only manages goals, handlers manage side-effects
- Open/Closed: adding a new handler (analytics, audit) = new subscriber, zero changes to GoalManager
- Events dispatched only after successful state transition (no orphaned side-effects)
- CRDT handler can fail independently without affecting MongoDB handler
- Testable: message bus can be faked, handlers tested in isolation
- Matches Cosmic Python "Option 3" exactly — battle-tested pattern

**Cons:**
- More moving parts (event classes, bus, handler registration)
- Event dispatch is synchronous (same as current code — but explicit)
- Need to define ~6 event types

**Effort:** Medium — define events, bus, handlers, wire into TaskStore

#### Option C: Transactional Outbox (Confluent Pattern)

Write events to MongoDB `outbox` collection in the same transaction as state changes. Separate process reads outbox and writes to CRDT.

**Pros:** Guarantees consistency between MongoDB and CRDT
**Cons:** Requires MongoDB transactions (replica set), adds latency, over-engineered for our scale
**Effort:** Large — needs separate outbox processor, transaction support

### Recommended: Option B — Domain Events + Message Bus

Option B is the right balance. Here's the concrete design.

### Domain Events

```typescript
// packages/agent-manager/src/orchestrator/events/GoalEvents.ts

interface GoalEvent {
  type: string;
  goalId: string;
  teamId: string;
  timestamp: number;
}

interface TasksCreated extends GoalEvent {
  type: "tasks_created";
  tasks: TaskLike[];
  planId: string;
  plan: any;  // plan overview for CRDT
}

interface TaskStatusChanged extends GoalEvent {
  type: "task_status_changed";
  taskId: string;
  status: string;
  output?: unknown;
}

interface PlanStatusChanged extends GoalEvent {
  type: "plan_status_changed";
  status: string;  // "executing" | "completed" | "archived" | "interrupted"
}

interface GoalStatusChanged extends GoalEvent {
  type: "goal_status_changed";
  status: string;
  title?: string;
  message?: string;
}

interface TasksCleared extends GoalEvent {
  type: "tasks_cleared";
}

type AnyGoalEvent =
  | TasksCreated
  | TaskStatusChanged
  | PlanStatusChanged
  | GoalStatusChanged
  | TasksCleared;
```

### Message Bus

```typescript
// packages/agent-manager/src/orchestrator/events/GoalEventBus.ts

type GoalEventHandler = (event: AnyGoalEvent) => Promise<void>;

class GoalEventBus {
  private handlers = new Map<string, GoalEventHandler[]>();

  subscribe(eventType: string, handler: GoalEventHandler): void {
    const existing = this.handlers.get(eventType) || [];
    existing.push(handler);
    this.handlers.set(eventType, existing);
  }

  async publish(events: AnyGoalEvent[]): Promise<void> {
    for (const event of events) {
      const handlers = this.handlers.get(event.type) || [];
      // Run handlers concurrently per event, but events sequentially (order matters)
      await Promise.allSettled(
        handlers.map(h => h(event))
      );
    }
  }
}
```

Key design decision: `Promise.allSettled` not `Promise.all`. A CRDT handler failure must not block MongoDB. Each handler is independent — exactly what the dual-write review said we need.

### Handlers

```typescript
// MongoGoalEventHandler — critical path, errors logged
class MongoGoalEventHandler {
  constructor(private taskPersistence: ITaskPersistence) {}

  async onTasksCreated(event: TasksCreated): Promise<void> {
    await this.taskPersistence.saveTasks(event.goalId, event.teamId, ...);
  }
  async onTaskStatusChanged(event: TaskStatusChanged): Promise<void> {
    await this.taskPersistence.updateTaskStatus(event.taskId, event.goalId, event.status, event.output);
  }
  async onTasksCleared(event: TasksCleared): Promise<void> {
    await this.taskPersistence.clearTasksByGoal(event.goalId);
  }
}

// CrdtGoalEventHandler — secondary, best-effort with retry
class CrdtGoalEventHandler {
  constructor(private crdtProxy: CrdtProxy) {}

  async onTasksCreated(event: TasksCreated): Promise<void> {
    const sync = this.crdtProxy.get?.();
    if (!sync) return;
    // Parallel persist — all tasks are independent docs
    await Promise.allSettled(
      event.tasks.map(t => sync.persistTask(t))
    );
    await sync.persistPlan(event.plan, event.goalId);
    await sync.updateIndex(event.tasks);
  }
  async onTaskStatusChanged(event: TaskStatusChanged): Promise<void> {
    const sync = this.crdtProxy.get?.();
    if (!sync) return;
    await sync.syncStatus(event.taskId, event.status, event.output);
  }
  // ... same pattern for plan/goal status
}
```

### GoalManager After Refactoring

```typescript
// Before (current — 14 scattered persistence calls):
await this.persistTasks(goalId, tasks);        // MongoDB
const crdtSync = this.crdtTaskSyncProxy?.get?.();
if (crdtSync) { for (const t of tasks) await crdtSync.persistTask(t); }
if (crdtSync) { await crdtSync.persistPlan(plan, goalId); }
if (crdtSync) { await crdtSync.updateIndex(tasks); }

// After (1 event, bus handles rest):
this.eventBus.publish([{
  type: "tasks_created",
  goalId, teamId: this.teamId,
  tasks: allTasks, planId, plan: planToApprove,
  timestamp: Date.now(),
}]);
```

GoalManager goes from 14 persistence call sites → 7 `eventBus.publish()` calls. Each call emits a single event. The bus fans out to MongoDB handler, CRDT handler, and any future handlers.

### Wiring (Composition Root)

```typescript
// In AgentManagerV2.initializeOrchestrator():
const eventBus = new GoalEventBus();

// MongoDB handler — critical
const mongoHandler = new MongoGoalEventHandler(taskPersistence);
eventBus.subscribe("tasks_created", e => mongoHandler.onTasksCreated(e));
eventBus.subscribe("task_status_changed", e => mongoHandler.onTaskStatusChanged(e));
eventBus.subscribe("tasks_cleared", e => mongoHandler.onTasksCleared(e));

// CRDT handler — best-effort
const crdtHandler = new CrdtGoalEventHandler(crdtProxy);
eventBus.subscribe("tasks_created", e => crdtHandler.onTasksCreated(e));
eventBus.subscribe("task_status_changed", e => crdtHandler.onTaskStatusChanged(e));
eventBus.subscribe("plan_status_changed", e => crdtHandler.onPlanStatusChanged(e));
eventBus.subscribe("goal_status_changed", e => crdtHandler.onGoalStatusChanged(e));

// Pass bus to GoalManager
this.goalManager = new GoalManager({ ...config, eventBus });
```

### SOLID Compliance

| Principle | Before | After |
|-----------|--------|-------|
| **S** (SRP) | GoalManager: goals + MongoDB + CRDT + notifications | GoalManager: goals only. Handlers: one per persistence target. |
| **O** (Open/Closed) | Add persistence target = edit GoalManager 7 times | Add persistence target = new handler + subscribe |
| **L** (Liskov) | N/A | N/A |
| **I** (Interface Seg) | CrdtProxy exposes `get()`, `resolveForGoal()` to GoalManager | GoalManager sees only `eventBus.publish()` |
| **D** (DIP) | GoalManager → CrdtProxy (concrete) | GoalManager → GoalEventBus (abstraction) |

### Migration Path

1. **Define events + bus** — new files, no changes to GoalManager yet
2. **Create handlers** — wrap existing MongoDB/CRDT calls
3. **Wire in composition root** — subscribe handlers to bus
4. **Replace GoalManager calls** — one gap at a time, replace 14 persistence calls with 7 event publishes
5. **Delete CrdtProxy from GoalManager** — it no longer needs it
6. **Fix `type` overwrite bug** in CrdtTaskSync.persistTask while touching that code

Each step is independently testable and deployable.

---

## Analysis: Single Source of Truth

### Decision: MongoDB Is The Source of Truth — TaskStore Collapses Into It

**MongoDB is the only durable, authoritative store.** The in-memory `TaskStore` (`Map<string, Task>`) is the root cause of the dual-write problem — it's a separate copy of the same data that must be synchronized with MongoDB on every state change. Collapse them.

Design principles:
- If MongoDB is lost, the system **fails hard** — no silent CRDT fallback recovery
- CRDT is a read-optimized projection for agents — not authoritative, not a fallback
- The dual-write problem between TaskStore↔MongoDB **disappears** because they're the same thing
- Only one projection remains: MongoDB → CRDT (best-effort)

### Architecture: Two Layers, Not Three

```
┌─────────────────────────────────────────────────────┐
│  MongoDB (SOURCE OF TRUTH)                          │
│  + TaskService (thin service layer over MongoDB)    │
│  ──────────────────────────────────────────────────  │
│  Stores: tasks, goals, chat, auth, plans, metrics   │
│  State machine: validates transitions in service    │
│  Queries: getByGoal, isAllComplete, getDependants   │
│  Writes: atomic findOneAndUpdate per transition     │
│  On loss: SYSTEM FAILS — no fallback               │
│  Who uses: GoalManager, OrchestratorService,        │
│            WorkerPool, Frontend HTTP, Recovery       │
└────────────────────┬────────────────────────────────┘
                     │ projection (best-effort)
                     ▼
┌─────────────────────────────────────────────────────┐
│  CRDT / Hocuspocus (collaborative view)             │
│  Role: READ-OPTIMIZED PROJECTION for agents         │
│  Lifetime: Durable (S3 blob) but NOT authoritative  │
│  On loss: Rebuild from MongoDB, agents degrade      │
│  Stores: task docs, plan doc, agent status, index   │
│  Who reads: Agents (collab tool), BlockNote UI      │
└─────────────────────────────────────────────────────┘

In-memory (runtime only, NOT a store):
  - RoleTaskQueue: dispatch mechanism, fed by MongoDB queries
  - GoalContext: active planner/chatAgent refs, ephemeral
```

### What TaskStore Is Today vs. What It Becomes

**Today** — TaskStore is a `Map<string, Task>` (in-memory cache) with:
1. State machine validation (pending→ready→in_progress→completed)
2. Dependency cascade (task A completes → unblock dependants)
3. RoleTaskQueue integration (queue ready tasks for dispatch)
4. Goal-scoped queries (getByGoal, isAllCompleteForGoal)

**After** — TaskService is a thin service layer over MongoDB:

```typescript
// TaskService — replaces TaskStore
// No Map<string, Task>. MongoDB IS the store.
class TaskService {
  constructor(private mongo: MongoTaskService) {}

  // State machine validation + atomic write
  async updateStatus(taskId: string, goalId: string, newStatus: TaskStatus, output?: any): Promise<Task> {
    const task = await this.mongo.getTask(taskId, goalId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (!VALID_TRANSITIONS[task.status].includes(newStatus)) {
      throw new Error(`Invalid transition: ${task.status} → ${newStatus}`);
    }
    return await this.mongo.findOneAndUpdate(
      { taskId, goalId },
      { $set: { status: newStatus, output, updatedAt: new Date() } },
      { returnDocument: 'after' }
    );
  }

  // Dependency cascade — runs after completion
  async cascadeDependencies(taskId: string, goalId: string): Promise<Task[]> {
    // Find tasks whose prerequisites include this taskId
    const dependants = await this.mongo.find({
      goalId,
      [`prerequisites.${taskId}`]: false,  // unmet dependency
      status: { $in: ['pending'] }
    });

    const nowReady: Task[] = [];
    for (const dep of dependants) {
      // Mark this prerequisite as met
      await this.mongo.findOneAndUpdate(
        { taskId: dep.taskId, goalId },
        { $set: { [`prerequisites.${taskId}`]: true } }
      );
      // Check if ALL prerequisites are now met
      const updated = await this.mongo.getTask(dep.taskId, goalId);
      if (this.allPrerequisitesMet(updated)) {
        await this.updateStatus(dep.taskId, goalId, 'ready');
        nowReady.push(updated);
      }
    }
    return nowReady;
  }

  // Goal-scoped queries — direct MongoDB
  async getByGoal(goalId: string): Promise<Task[]> {
    return this.mongo.find({ goalId });
  }

  async isAllCompleteForGoal(goalId: string): Promise<boolean> {
    const incomplete = await this.mongo.count({
      goalId,
      status: { $nin: ['completed', 'failed', 'discarded'] }
    });
    return incomplete === 0;
  }
}
```

### Why This Works For Our Scale

| Concern | In-memory Map | MongoDB | Winner |
|---------|--------------|---------|--------|
| Tasks per goal | 5-20 | 5-20 | Same |
| State transition frequency | Once per agent run (~minutes) | 5ms per write | MongoDB is fine |
| Dependency cascade | Microseconds in-memory | ~10ms (2-3 queries) | MongoDB is fine — agent runs take 30+ seconds |
| Concurrent completions | Race conditions (single-threaded) | Atomic `findOneAndUpdate` | **MongoDB is better** |
| Crash recovery | Rebuilt from MongoDB anyway | Already there | MongoDB wins |
| Dual-write bug surface | 14 call sites | 0 (it's the same store) | **MongoDB wins** |

The bottleneck is LLM API latency (seconds to minutes), not task state operations (milliseconds). An in-memory cache adds zero user-visible performance benefit but creates the entire dual-write problem.

### What Stays In-Memory (Runtime Only)

```typescript
// These are runtime dispatch mechanisms, NOT data stores
RoleTaskQueue      — dispatches ready tasks to workers
                     Fed by: TaskService.getReadyTasks(goalId) query
                     Cleared on: restart (rebuilt from MongoDB ready tasks)

GoalContext        — holds planner/chatAgent instances (not serializable)
                     Fed by: GoalManager creates on demand
                     Cleared on: restart (agents recreated)

WorkerPool.workers — active AiSdkAgent instances
                     Fed by: dispatch creates on demand
                     Cleared on: restart (workers recreated from ready tasks)
```

### Write Path (Final)

```
GoalManager state change (e.g. task completed)
  │
  ├── 1. await TaskService.updateStatus()     ← MongoDB (source of truth)
  │       └── atomic findOneAndUpdate
  │       └── failure → throw, do NOT proceed
  │
  ├── 2. await TaskService.cascadeDependencies() ← MongoDB (unblock dependants)
  │       └── returns newly-ready tasks
  │       └── feed ready tasks to RoleTaskQueue
  │
  ├── 3. CRDT projection (best-effort)        ← only after MongoDB succeeded
  │       └── failure → log.warn, queue for retry
  │
  └── 4. Socket.IO notification               ← fire-and-forget
```

**No dual-write.** MongoDB is written once. CRDT is derived. TaskStore Map is gone.

### Recovery Path (Final)

```
Server restart
  │
  └── TaskService.getByTeam(teamId)   ← MongoDB ONLY
        ├── Hydrate GoalContexts from goal statuses
        ├── Feed ready tasks to RoleTaskQueue
        └── if MongoDB unreachable → FAIL (do not start)
```

No `loadActivePlan()`. No CRDT fallback. No PlanStore JSON files. MongoDB or fail.

### What Each Store Owns (No Overlap on Status)

| Data | MongoDB (truth) | CRDT (projection) |
|------|-----------------|-------------------|
| Task status | ✅ **Authoritative** | Copy (may lag) |
| Task description/body | ✅ Stored | ✅ Rich copy for agents (BlockNote) |
| Dependencies | ✅ Stored | ✅ Copy for agent context |
| Plan overview | ✅ Stored | ✅ Copy for agent browsing |
| Goal status | ✅ Stored | ✅ Copy |
| Agent busy/idle | ❌ | ✅ Exclusive (runtime only) |
| Task index (byRole/byStatus) | ❌ (queryable directly) | ✅ Convenience for agents |
| Chat history | ✅ Exclusive | ❌ |
| User/auth | ✅ Exclusive | ❌ |
| Completion report (rich) | Summary in output field | ✅ Full BlockNote doc (future) |

### Domain Events Still Apply

The event bus from the redesign section routes through MongoDB-first:

```typescript
async publish(events: AnyGoalEvent[]): Promise<void> {
  for (const event of events) {
    // Step 1: MongoDB — MUST succeed (TaskService handles this)
    // Already done before event is published — event is a "fact"

    // Step 2: CRDT projection — best-effort
    const crdtHandlers = this.handlers.get(`crdt:${event.type}`) || [];
    await Promise.allSettled(crdtHandlers.map(h => h(event)));

    // Step 3: Notifications — fire-and-forget
    const notifyHandlers = this.handlers.get(`notify:${event.type}`) || [];
    notifyHandlers.forEach(h => h(event).catch(() => {}));
  }
}
```

Events are published **after** MongoDB write succeeds. They represent facts that already happened. CRDT and notification handlers derive from those facts.

### Migration Path (TaskStore → TaskService)

1. **Create TaskService** — thin wrapper over MongoTaskService with state machine validation
2. **Move state machine logic** — `VALID_TRANSITIONS`, `completeTask()`, `updateStatus()` from TaskStore to TaskService
3. **Move dependency cascade** — `resolvePrerequisites()` logic to TaskService.cascadeDependencies()
4. **Update GoalManager** — replace `this.taskStore.create()` → `await this.taskService.create()`
5. **Update OrchestratorService** — replace `this.taskStore.get()` → `await this.taskService.get()`
6. **Keep RoleTaskQueue** — but feed it from TaskService query results, not Map iteration
7. **Delete TaskStore.ts** — the Map is gone
8. **Delete `loadActivePlan()` and `loadFromDatabase()`** — recovery is just `taskService.getByTeam()`
9. **Remove CRDT fallback** from recovery path

---

## CRDT Integration Design: Two Sources of Truth By Data Type

CRDT is NOT just a "projection of MongoDB." It has its own authority — over **content**. The system splits authority by data type:

```
MongoDB = source of truth for STRUCTURED DATA (status, deps, metadata)
CRDT    = source of truth for RICH CONTENT (documents, reports, discussions)
MongoDB stores DocumentRefs → pointing to CRDT content
```

### Why This Split?

| Data characteristic | MongoDB | CRDT | Winner |
|---------------------|---------|------|--------|
| Status (pending/completed/failed) | Queryable, indexed, recoverable | No indexes, no queries | **MongoDB** |
| Dependencies (DAG) | Atomic cascade via findOneAndUpdate | Can't do conditional updates | **MongoDB** |
| Rich text (plan doc, completion report) | Store as blob? Lose editing. | Real-time collab, BlockNote, multi-writer | **CRDT** |
| Discussion threads | Append-only array in a doc? Clunky. | Y.Array with merge semantics | **CRDT** |
| Agent-written documents | Not agent-readable at runtime | `collab read` tool already works | **CRDT** |

**The key insight: agents READ from CRDT. Agents WRITE to CRDT. MongoDB doesn't serve agents at all — it serves the system (recovery, queries, frontend HTTP).**

### Data Ownership Map

```
┌─────────────────────────────────────────────────────────────────┐
│                    MongoDB (structured data)                     │
│                                                                 │
│  tasks collection:                                              │
│    taskId, goalId, teamId, status, assignedRole, priority,      │
│    dependencies[], planId, createdAt, updatedAt                 │
│    output: { summary, producedDocs: DocumentRef[] }             │
│    ^^^^^^ summary string + refs, NOT the full report            │
│                                                                 │
│  goals collection:                                              │
│    goalId, teamId, userId, status, repoUrl, repoBranch          │
│                                                                 │
│  messages collection:                                           │
│    goalId, role, content, timestamp (chat history)               │
│                                                                 │
│  users/sessions (auth)                                          │
└─────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────┐
│                    CRDT / Hocuspocus (rich content)              │
│                                                                 │
│  {taskId}/task:                                                 │
│    Y.Map("meta")  — id, type, assignedRole, status (COPY)      │
│    Y.XmlFragment("content") — task description as BlockNote     │
│    Status in meta is a COPY from MongoDB, may lag.              │
│                                                                 │
│  {taskId}/report:                                               │
│    Y.Map("meta")  — type: "report", taskId, completedBy        │
│    Y.XmlFragment("content") — agent completion report           │
│    THIS IS THE SOURCE OF TRUTH for report content.              │
│    MongoDB only stores: output.producedDocs: [{uri: "crdt:..."}]│
│                                                                 │
│  plan:                                                          │
│    Y.Map("meta")  — planId, goal, status (COPY), taskCount     │
│    Y.XmlFragment("content") — plan prose for human review       │
│    THIS IS THE SOURCE OF TRUTH for plan document.               │
│                                                                 │
│  goal:                                                          │
│    Y.Map("meta")  — id, title, status (COPY)                   │
│    Y.XmlFragment("content") — goal description                  │
│                                                                 │
│  {taskId}/discussion:                                           │
│    Y.Array("discussion") — append-only discussion blocks        │
│    Y.Map("decisions") — decisions extracted from discussion     │
│    THIS IS THE SOURCE OF TRUTH for discussions.                 │
│                                                                 │
│  agent-statuses:                                                │
│    Y.Map("meta") — { role: { status, task, since } }            │
│    Ephemeral. Not in MongoDB at all.                            │
│                                                                 │
│  _index:                                                        │
│    Y.Map("meta") — byRole, byStatus groupings                  │
│    Convenience for agent browsing. Derived from MongoDB.        │
└─────────────────────────────────────────────────────────────────┘
```

### Write Flows By Data Type

#### Flow A: Structured Data (MongoDB → CRDT projection)

Status, dependencies, metadata. MongoDB is truth. CRDT gets a copy.

```
GoalManager: task completed
  │
  ├── 1. TaskService.updateStatus(taskId, "completed")
  │      └── MongoDB findOneAndUpdate (atomic, must succeed)
  │
  ├── 2. Publish event: TaskStatusChanged
  │
  └── 3. CrdtProjectionHandler receives event
         └── crdtSync.syncStatus(taskId, "completed")  // best-effort copy
         └── crdtSync.updateIndex(tasks)               // convenience index
```

**If CRDT projection fails:** Agent reads stale status from CRDT. Not critical — agent behavior is driven by the task it's already executing, not by polling status. MongoDB has the truth for recovery and frontend.

#### Flow B: Rich Content (Agent → CRDT directly, MongoDB gets a ref)

Reports, documents, discussions. CRDT is truth. MongoDB gets a DocumentRef.

```
Agent completes task:
  │
  ├── 1. Agent calls complete_task tool
  │      └── { summary, producedDocs: [{uri: "crdt:{taskId}/report", name: "report"}] }
  │
  ├── 2. Agent writes completion report to CRDT (via collab write-block)
  │      └── CRDT {taskId}/report Y.XmlFragment("content") ← rich text
  │      └── THIS IS THE SOURCE OF TRUTH for the report
  │
  ├── 3. GoalManager.onWorkerDone() processes completion
  │      └── TaskService.updateStatus(taskId, "completed", { summary, producedDocs })
  │      └── MongoDB stores: output.producedDocs = [{uri: "crdt:...", name: "report"}]
  │      └── MongoDB does NOT store the report content — just the reference
  │
  └── 4. Downstream agents read context
         └── collab read {taskId}/report → gets the rich content from CRDT
         └── MongoDB told them WHICH docs to read (via inputDocs from upstream producedDocs)
```

**If CRDT content is lost:** The report is gone. MongoDB only has the summary string and the DocumentRef URI. This is a data loss scenario. Mitigated by Hocuspocus S3 blob persistence.

#### Flow C: System-Created Documents (MongoDB → CRDT on approval)

Plan docs, task context docs. Created by the system after MongoDB write.

```
Plan approved:
  │
  ├── 1. TaskService.createTasks(goalId, tasks)
  │      └── MongoDB bulk insert (atomic, must succeed)
  │
  ├── 2. Publish event: TasksCreated
  │
  └── 3. CrdtProjectionHandler receives event
         ├── For each task: create CRDT doc
         │    └── Y.Map("meta") ← structured fields from MongoDB
         │    └── Y.XmlFragment("content") ← description as BlockNote blocks
         │
         ├── Create plan CRDT doc
         │    └── Y.Map("meta") ← plan overview
         │    └── Y.XmlFragment("content") ← plan prose
         │
         └── Update _index
```

**Here MongoDB data is projected INTO CRDT content.** The CRDT doc is richer than what MongoDB stores (it has BlockNote blocks), but it's derived from MongoDB data at creation time. After creation, the CRDT doc can be edited by users (e.g., editing task description in BlockNote before execution).

### CRDT Rebuild Strategy (When CRDT Data Is Lost)

Since CRDT stores content that MongoDB doesn't have (reports, discussions), full CRDT loss = partial data loss. But **structural data is safe** (tasks, status, deps are in MongoDB).

```
CRDT recovery (if Hocuspocus S3 data lost):
  │
  ├── Task docs: REBUILD from MongoDB
  │    └── TaskService.getByGoal(goalId) → create CRDT docs with descriptions
  │    └── Content is basic text (no BlockNote editing history), but functional
  │
  ├── Plan doc: REBUILD from MongoDB
  │    └── GoalService.getGoal(goalId) → create plan overview doc
  │
  ├── Reports: LOST
  │    └── MongoDB has output.summary string — that's all that survives
  │    └── Downstream agents lose rich context, fall back to summary
  │
  ├── Discussions: LOST
  │    └── No MongoDB backup of discussion content
  │
  └── Agent statuses: LOST (ephemeral — doesn't matter)
```

This is acceptable. S3 blob storage is highly durable. Full CRDT loss is a disaster-level event. In that case, the system degrades (agents get summaries instead of full reports) but doesn't crash.

### Agent Read Path (Unchanged)

Agents always read from CRDT. They never query MongoDB directly.

```
Agent dispatched for task:
  │
  ├── getCrdtRefs(taskId) → { task: "{taskId}/task", plan: "plan", ... }
  │
  ├── Agent system prompt includes:
  │    "Use collab read to access your task context, plan, and upstream outputs."
  │
  ├── Agent calls: collab({ action: "read", docName: "{taskId}/task" })
  │    └── Returns task description, acceptance criteria, context from CRDT
  │
  ├── Agent calls: collab({ action: "read", docName: "{upstreamId}/report" })
  │    └── Returns upstream agent's completion report from CRDT
  │
  └── Agent calls: collab({ action: "read", docName: "plan" })
       └── Returns plan overview from CRDT
```

**Agents never need MongoDB.** All their context is in CRDT. If CRDT is stale (status lag from projection), the agent still has the right task description and upstream outputs — status lag doesn't affect execution quality.

### The Complete Data Flow

```
User submits goal
  └── MongoDB: create goal record
       └── CRDT: create goal doc (projection)

Planner creates plan
  └── CRDT: write plan-doc with Y.XmlFragment (plan is CRDT-first content)
  └── MongoDB: nothing yet (plan is draft)

User approves plan
  └── MongoDB: create task records (source of truth for tasks)
       └── CRDT: create task docs (projection + enrich with BlockNote)
       └── CRDT: update plan-doc status → "executing"

Worker executes task
  └── Agent READS from CRDT: task doc, plan, upstream reports
  └── Agent WRITES to CRDT: completion report, research notes, discussions
  └── Agent calls complete_task: { summary, producedDocs: [DocumentRef] }

GoalManager.onWorkerDone()
  └── MongoDB: updateStatus("completed", { summary, producedDocs })
       └── CRDT: syncStatus("completed") — projection of status
       └── CRDT: updateIndex() — convenience projection

Downstream task dispatched
  └── TaskService enriches: upstream producedDocs → downstream inputDocs
  └── Agent reads inputDocs from CRDT (rich reports, not MongoDB summaries)

All tasks complete
  └── MongoDB: goal status → "completed"
       └── CRDT: plan status → "completed", goal status → "completed"

Server restart
  └── MongoDB: recover task statuses, dependencies, goal state
  └── CRDT: already persisted in S3 — docs available immediately
  └── NO rebuild needed unless S3 data lost
```

### Summary: Two Truths, One System

| | MongoDB | CRDT |
|---|---|---|
| **Authority over** | Status, deps, metadata, lifecycle | Content, documents, discussions |
| **Written by** | System (TaskService, GoalManager) | System (projection) + Agents (direct) |
| **Read by** | Recovery, frontend HTTP, admin | Agents (collab tool), BlockNote UI |
| **Failure impact** | System fails (no fallback) | Agents degrade (summaries instead of reports) |
| **Recovery** | N/A — it IS the recovery source | Rebuild structural docs from MongoDB; rich content from S3 |
| **Technology** | Mongoose + findOneAndUpdate | Hocuspocus + Y.js + S3 blob |

This is not "MongoDB is the only source of truth." It's: **MongoDB is truth for structured data. CRDT is truth for rich content. They reference each other via DocumentRef URIs.** Neither fully replaces the other.

---

## Low-Level Design: SOLID Implementation

### Class Diagram

```
┌──────────────────────────────────────────────────────────────┐
│                     DOMAIN LAYER                             │
│                                                              │
│  GoalManager                                                 │
│    depends on: ITaskService, IGoalPersistence, GoalEventBus  │
│    does NOT know: MongoDB, CRDT, Mongoose, Hocuspocus        │
│                                                              │
│  GoalEventBus                                                │
│    publish(events) → fan out to registered handlers          │
│                                                              │
│  GoalEvent types (data objects, no behavior)                 │
│    TasksCreated, TaskStatusChanged, TaskCompleted, etc.      │
└────────────────────────┬─────────────────────────────────────┘
                         │ depends on interfaces (DIP)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                     INTERFACE LAYER                          │
│                                                              │
│  ITaskService          — task CRUD + state machine + cascade │
│  IGoalPersistence      — goal CRUD                           │
│  ICrdtContentService   — CRDT doc creation + status sync     │
│  IEventHandler         — event subscription                  │
└────────────────────────┬─────────────────────────────────────┘
                         │ implemented by (OCP)
                         ▼
┌──────────────────────────────────────────────────────────────┐
│                   INFRASTRUCTURE LAYER                        │
│                                                              │
│  MongoTaskService        implements ITaskService              │
│    findOneAndUpdate with status filter (optimistic conc.)    │
│    Dependency cascade via queries                            │
│                                                              │
│  CrdtProjectionHandler   implements IEventHandler            │
│    Subscribes to GoalEventBus                                │
│    Projects MongoDB state → CRDT docs (best-effort)          │
│                                                              │
│  HocuspocusCrdtService   implements ICrdtContentService      │
│    Wraps CrdtTaskSync + CrdtGoalStore                        │
│                                                              │
│  SocketNotificationHandler  implements IEventHandler         │
│    Subscribes to GoalEventBus → Socket.IO events             │
└──────────────────────────────────────────────────────────────┘
```

### SOLID Mapping

| Principle | How |
|-----------|-----|
| **S** | GoalManager: goal lifecycle. MongoTaskService: task state machine. CrdtProjectionHandler: CRDT sync. SocketNotificationHandler: notifications. Each class = one reason to change. |
| **O** | New handler (analytics, audit) = new class + `bus.onProjection(...)`. Zero changes to GoalManager or MongoTaskService. |
| **L** | `FakeTaskService implements ITaskService` for tests. Swap freely. |
| **I** | `ITaskService` (tasks), `IGoalPersistence` (goals), `ICrdtContentService` (content). Small, focused. |
| **D** | GoalManager → `ITaskService` (interface). Never imports `MongoTaskService` directly. |

### Interfaces

```typescript
// ITaskService — source of truth for task state (MongoDB)
interface ITaskService {
  create(task: Omit<Task, "createdAt">): Promise<Task>;
  createMany(goalId: string, teamId: string, tasks: any[]): Promise<Task[]>;
  get(taskId: string, goalId: string): Promise<Task | null>;
  getByGoal(goalId: string): Promise<Task[]>;
  getByTeam(teamId: string): Promise<Task[]>;
  clearByGoal(goalId: string): Promise<number>;

  // Atomic state transition — rejects if status already changed
  updateStatus(taskId: string, goalId: string, newStatus: TaskStatus, output?: unknown): Promise<Task>;

  // Complete + cascade dependencies → returns newly-ready tasks
  completeTask(taskId: string, goalId: string, output: any): Promise<{ task: Task; newlyReady: Task[] }>;

  isAllCompleteForGoal(goalId: string): Promise<boolean>;
  getReadyTasks(goalId: string): Promise<Task[]>;
}

// IGoalPersistence — goal lifecycle in MongoDB
interface IGoalPersistence {
  saveGoal(goal: { goalId: string; teamId: string; userId: string; goal: string }): Promise<void>;
  updateGoalStatus(goalId: string, status: string): Promise<void>;
}

// ICrdtContentService — CRDT doc operations
interface ICrdtContentService {
  createTaskDoc(task: { id: string; description: string; assignedRole: string }): Promise<void>;
  createPlanDoc(plan: any, goalId: string): Promise<void>;
  syncTaskStatus(taskId: string, status: string, output?: any): Promise<void>;
  syncPlanStatus(status: string): Promise<void>;
  syncGoalStatus(status: string): Promise<void>;
  updateIndex(tasks: Array<{ id: string; assigned_role: string; status: string }>): Promise<void>;
  updateAgentStatus(role: string, status: "busy" | "idle", taskId?: string): Promise<void>;
  resolveForGoal(goalId: string): void;
  isAvailable(): boolean;
}
```

### Domain Events

```typescript
// 6 event types — simple data, no behavior
interface GoalEvent { type: string; goalId: string; teamId: string; timestamp: number; }

interface TasksCreated extends GoalEvent { type: "tasks_created"; tasks: Task[]; planId: string; plan: any; }
interface TaskStatusChanged extends GoalEvent { type: "task_status_changed"; taskId: string; newStatus: string; output?: unknown; }
interface TaskCompleted extends GoalEvent { type: "task_completed"; taskId: string; output: any; newlyReady: Task[]; }
interface PlanStatusChanged extends GoalEvent { type: "plan_status_changed"; status: string; }
interface GoalStatusChanged extends GoalEvent { type: "goal_status_changed"; status: string; }
interface TasksCleared extends GoalEvent { type: "tasks_cleared"; }

type AnyGoalEvent = TasksCreated | TaskStatusChanged | TaskCompleted | PlanStatusChanged | GoalStatusChanged | TasksCleared;
```

### GoalEventBus

```typescript
class GoalEventBus {
  private projectionHandlers = new Map<string, EventHandler[]>();   // best-effort
  private notificationHandlers = new Map<string, EventHandler[]>(); // fire-and-forget

  onProjection(eventType: string, handler: EventHandler): void;
  onNotification(eventType: string, handler: EventHandler): void;

  async publish(events: AnyGoalEvent[]): Promise<void> {
    for (const event of events) {
      // Tier 1: Projections — Promise.allSettled (CRDT failures logged, not thrown)
      const projections = this.projectionHandlers.get(event.type) || [];
      await Promise.allSettled(projections.map(h => h(event)));

      // Tier 2: Notifications — fire-and-forget (Socket.IO)
      const notifications = this.notificationHandlers.get(event.type) || [];
      notifications.forEach(h => h(event).catch(() => {}));
    }
  }
}
```

### MongoTaskService (key method)

```typescript
class MongoTaskService implements ITaskService {
  // Atomic state transition with optimistic concurrency
  async updateStatus(taskId, goalId, newStatus, output?): Promise<Task> {
    // Validate transition
    const current = await this.model.findOne({ taskId, goalId }).lean();
    if (!VALID_TRANSITIONS[current.status]?.includes(newStatus))
      throw new Error(`Invalid: ${current.status} → ${newStatus}`);

    // Atomic: only updates if status hasn't changed since we read it
    const updated = await this.model.findOneAndUpdate(
      { taskId, goalId, status: current.status },
      { $set: { status: newStatus, output, updatedAt: new Date() } },
      { new: true }
    ).lean();

    if (!updated) throw new Error(`Concurrent change: ${taskId}`);
    return this.toTask(updated);
  }

  // Complete + cascade
  async completeTask(taskId, goalId, output): Promise<{ task: Task; newlyReady: Task[] }> {
    const task = await this.updateStatus(taskId, goalId, "completed", output);
    const newlyReady = await this.cascadeDependencies(taskId, goalId);
    return { task, newlyReady };
  }

  // Cascade: mark prerequisite met → check if all met → transition to ready
  private async cascadeDependencies(taskId, goalId): Promise<Task[]> {
    const dependants = await this.model.find({
      goalId, [`prerequisites.${taskId}`]: false, status: "pending",
    }).lean();

    const ready: Task[] = [];
    for (const dep of dependants) {
      await this.model.updateOne(
        { taskId: dep.taskId, goalId },
        { $set: { [`prerequisites.${taskId}`]: true } }
      );
      const updated = await this.model.findOne({ taskId: dep.taskId, goalId }).lean();
      if (this.allMet(updated.prerequisites)) {
        await this.model.updateOne(
          { taskId: dep.taskId, goalId, status: "pending" },
          { $set: { status: "ready" } }
        );
        ready.push(this.toTask({ ...updated, status: "ready" }));
      }
    }
    return ready;
  }
}
```

### GoalManager After (clean domain logic)

```typescript
// BEFORE: 14 persistence calls, knows MongoDB + CRDT
async approvePlan(goalId, plan) {
  // ...
  this.persistClearGoalTasks(goalId);          // MongoDB
  this.persistTasks(goalId, tasks);            // MongoDB
  const crdtSync = this.crdtTaskSyncProxy?.get?.();
  if (crdtSync) { for (t of tasks) await crdtSync.persistTask(t); }  // CRDT ×N
  if (crdtSync) { await crdtSync.persistPlan(plan, goalId); }        // CRDT
  if (crdtSync) { await crdtSync.updateIndex(tasks); }               // CRDT
  const goalStore = this.crdtGoalStoreProxy?.get?.();
  if (goalStore) { await goalStore.saveGoal(...); }                   // CRDT

// AFTER: 3 lines, knows nothing about persistence
async approvePlan(goalId, plan) {
  // ...
  await this.taskService.clearByGoal(goalId);
  const tasks = await this.taskService.createMany(goalId, this.teamId, taskData);
  await this.eventBus.publish([{
    type: "tasks_created", goalId, teamId: this.teamId,
    tasks, planId, plan, timestamp: Date.now(),
  }]);
}
```

### Composition Root Wiring

```typescript
// AgentManagerV2.initializeOrchestrator()
const taskService = new MongoTaskService(TaskModel);
const crdtService = new HocuspocusCrdtService(collabPlugin);
const eventBus = new GoalEventBus();

new CrdtProjectionHandler(crdtService).register(eventBus);
new SocketNotificationHandler(callbacks).register(eventBus);

this.goalManager = new GoalManager({
  taskService,   // ITaskService — was TaskStore + ITaskPersistence
  eventBus,      // GoalEventBus — was CrdtProxy + callbacks
  // crdtTaskSync: GONE
  // crdtGoalStore: GONE
  // taskPersistence: GONE
});
```

### File Structure

```
packages/agent-manager/src/orchestrator/
  interfaces/
    ITaskService.ts               NEW
    IGoalPersistence.ts           NEW
    ICrdtContentService.ts        NEW
  events/
    GoalEvents.ts                 NEW (6 event types)
    GoalEventBus.ts               NEW
  handlers/
    CrdtProjectionHandler.ts      NEW
    SocketNotificationHandler.ts  NEW
  services/
    MongoTaskService.ts           NEW (implements ITaskService)
  GoalManager.ts                  MODIFIED (uses interfaces + events)
  OrchestratorService.ts          MODIFIED (uses ITaskService)
  TaskStore.ts                    DELETED
  DependencyResolver.ts           SIMPLIFIED (cascade moved to MongoTaskService)
```

### Testing

```typescript
// FakeTaskService — in-memory Map for unit tests (Liskov)
class FakeTaskService implements ITaskService {
  private tasks = new Map<string, Task>();
  async create(task) { this.tasks.set(task.id, task); return task; }
  async get(id) { return this.tasks.get(id) ?? null; }
  // ... all methods backed by Map
}

// FakeEventBus — records events for assertions
class FakeEventBus extends GoalEventBus {
  published: AnyGoalEvent[] = [];
  async publish(events) { this.published.push(...events); }
}

// Test
it("approvePlan creates tasks and publishes event", async () => {
  const ts = new FakeTaskService();
  const bus = new FakeEventBus();
  const gm = new GoalManager({ taskService: ts, eventBus: bus });
  await gm.approvePlan(goalId, plan);
  expect(bus.published[0].type).toBe("tasks_created");
});
```
