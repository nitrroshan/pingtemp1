# Data Persistence — Feature Architecture

**Status:** New · **Phase:** 1-3 (incremental)

---

## Core Principle: Docs First, Database as Index

Agents work with files, not databases. Every L1/L2 tool an agent has — `read_file`, `write_file`, `grep`, `keyword_search`, `collab` — operates on documents. If we put data in MongoDB, agents need custom query tools to access it. If data lives in shared docs (CRDT), agents access it with tools they already have.

**The inversion:** Shared CRDT docs are the source of truth. MongoDB is a materialized index for fast aggregate queries. If the index is lost, rebuild it from the docs. Agents never talk to a database.

```
Agent writes task output ──→ collab write (CRDT doc)
                                │
                                ├──→ onChange projection → .ping/collaboration/ (filesystem)
                                │                          └→ agents read via read_file/grep
                                │
                                └──→ onChange sync → MongoDB index (derived)
                                                     └→ dashboard/planner aggregate queries
```

---

## Architectural Decision

| Option | Approach | Verdict |
|---|---|---|
| **A** | MongoDB primary — agents read/write via DB query tools | Agents can't naturally browse DB records. Every data access needs a custom tool. |
| **B** | **CRDT docs primary — MongoDB as derived index** | **Chosen.** Agents use existing `collab` + `read_file` tools. Humans edit same docs via BlockNote. DB handles aggregation only. |
| **C** | Files only — no database | Can't do "find all failed tasks across 50 goals" without scanning every file. |
| **D** | Event Sourcing + CQRS — immutable event stream, derived projections | Rejected — see below. |

**Why B:** The `collab` tool already gives agents `discover → list → read → write → read-block → write-block` over CRDT docs. `projectToFilesystem` already mirrors CRDT state to `.ping/collaboration/` as JSON/markdown files. Agents and humans share the same data through the same documents. MongoDB adds what files can't do: indexing, aggregation, cross-document queries.

### Why not Event Sourcing / CQRS? (Option D)

Event Sourcing has two pain points: (1) you must **replay events to reconstruct current state** — heavy projection infrastructure, and (2) **projections lag behind writes** — if the orchestrator queries "what tasks are ready?" from a stale projection, it gets wrong answers.

Docs-primary avoids both:

| CQRS Problem | Why It Doesn't Apply Here |
|---|---|
| **Projection lag** (eventual consistency) | Hot-path consumers (orchestrator, workers) read directly from the CRDT doc — zero lag. Only the MongoDB index lags, and it's only used for aggregate/historical queries where millisecond lag is irrelevant. |
| **Reconstructing current state from events** | Current state IS the CRDT doc. No reconstruction, no replay. The doc is always live and consistent. |
| **Heavy projection infrastructure** | The "projection" is a simple `onChange` hook that mirrors doc fields to MongoDB. One sync function, not a projection framework. |

**The event log still exists** — `execution_events` is an append-only MongoDB collection for the planner's episodic memory. But it's supplementary history, not the source of truth. If the event log is lost, only historical queries break — current state is unaffected because it lives in the CRDT docs.

---

## What Lives Where

| Data | Primary (Source of Truth) | Index (Derived) | Agent Access |
|---|---|---|---|
| **Tasks** | CRDT doc: `{teamId}/{goalId}/tasks` | MongoDB `tasks` index | `collab read` / `read_file .ping/collaboration/tasks.json` |
| **Plans** | CRDT doc: `{teamId}/{goalId}/plan` | MongoDB `plans` index | `collab read` / `read_file .ping/collaboration/plan.json` |
| **Output manifests** | CRDT doc: `{teamId}/{goalId}/outputs/{taskId}` | MongoDB `output_manifests` index | `collab read` / `read_file` |
| **Goals** | CRDT doc: `{teamId}/goals` | MongoDB `goals` index | `collab read` |
| **Agent statuses** | CRDT doc: `agent-statuses` (already exists) | — | `collab read` |
| **Chat outcomes** | CRDT doc: `chat-outcomes` (already exists) | — | `collab read` |
| **Execution events** | MongoDB `execution_events` (append-only) | — | Planner tools only |
| **Team learnings** | MongoDB `team_learnings` | — | Planner tools only |
| **Token usage** | MongoDB `usage` | — | Dashboard only |
| **Agent YAML** | Files in repo | — | — |
| **Workspace files** | Git repos | — | L1 tools |
| **CRDT binary state** | Hocuspocus Database extension (`data/collab/yjs/`) | — | — |

**Key distinction:** Execution events and team learnings live in MongoDB only — they're system-level analytics that agents don't read as documents. Everything an agent reads or writes goes through CRDT docs.

---

## How CRDT Docs Replace In-Memory State

### Tasks Doc: `{teamId}/{goalId}/tasks`

A single CRDT doc per goal, containing all tasks as a Y.Map. Replaces `MemoryManager` in-memory Maps.

```typescript
// Yjs structure inside the CRDT doc
const tasksMap = doc.getMap('tasks');  // keyed by taskId

// Each task entry (Y.Map nested inside)
{
  taskId: string,
  planId: string,
  title: string,
  description: string,
  assignedRole: string,          // lowercase
  priority: number,              // 1-5
  complexity: 'low' | 'medium' | 'high',
  status: 'pending' | 'ready' | 'in_progress' | 'completed' | 'failed',

  dependencies: string[],        // taskIds
  onDependencyFail: 'skip' | 'fail' | 'replan',
  dependants: string[],

  context: {
    files: string[],
    artifacts: string[],
    notes: string,               // Planner research injected here
    relatedTasks: string[],
  },

  output: any,                   // Raw worker output
  error: string,
  durationMs: number,

  workspaceId: string,
  branchName: string,
  branchStatus: 'not_created' | 'active' | 'merged' | 'merge_requested' | 'discarded',

  startedAt: string,             // ISO date
  completedAt: string,
  createdAt: string,
}
```

**How it works:** Orchestrator writes task state via `collab write`. Workers read their task via `collab read`. Status updates are CRDT mutations — conflict-free, real-time. The `onChange` hook projects to `.ping/collaboration/tasks.json` AND syncs to MongoDB.

### Plan Doc: `{teamId}/{goalId}/plan`

A single CRDT doc per plan. Replaces `PlanStore` JSON files.

```typescript
// Yjs structure
const planMap = doc.getMap('plan');

{
  planId: string,
  goalId: string,
  teamId: string,
  goal: string,
  tasks: string[],               // taskIds
  phases: [{ id: string, name: string, tasks: string[], order: number }],
  estimatedDuration: string,
  successCriteria: string[],

  version: number,
  parentPlanId: string,          // If replanned
  status: 'pending' | 'approved' | 'executing' | 'completed' | 'failed' | 'interrupted',
  taskCount: number,

  // Planner learning
  researchNotes: string,         // What planner learned during research
  strategyRationale: string,     // Why this approach
  failureAnalysis: string,       // Post-mortem if failed

  createdAt: string,
  approvedAt: string,
  completedAt: string,
}
```

### Output Manifest Doc: `{teamId}/{goalId}/outputs/{taskId}`

One CRDT doc per task output. Replaces `.ping/outputs/{taskId}.json` files.

```typescript
const manifestMap = doc.getMap('manifest');

{
  taskId: string,
  goalId: string,
  role: string,
  agentId: string,
  activitySummary: string,       // LLM-friendly summary
  outputs: [{
    path: string,
    category: 'code' | 'document' | 'config' | 'data' | 'test' | 'image' | 'other',
    sizeBytes: number,
    contentHash: string,
  }],
  metrics: {
    filesCreated: number,
    commits: number,
    duration: number,
  },
  publishedAt: string,
}
```

### Goals Doc: `{teamId}/goals`

One CRDT doc per team tracking all goals.

```typescript
const goalsMap = doc.getMap('goals');  // keyed by goalId

{
  goalId: string,
  description: string,
  status: 'planning' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled',
  planId: string,
  taskCount: number,
  submittedAt: string,
  completedAt: string,
  durationMs: number,
}
```

---

## MongoDB Index Schemas

These are **derived** from CRDT docs via `onChange` sync. Not the source of truth — can be rebuilt from docs at any time.

### Sync Mechanism

```typescript
// In HocuspocusServer onChange hook (already exists)
async onChange({ document, documentName }) {
  // Existing: project to filesystem
  await projectToFilesystem(documentName, document, repoPath);

  // NEW: sync to MongoDB index
  await syncToIndex(documentName, document);
}
```

`syncToIndex` parses the doc name (`{teamId}/{goalId}/{docType}`) and upserts into the corresponding MongoDB collection. The index schema mirrors the CRDT doc structure — flat fields for querying.

### Index Schemas (Phase 1)

```typescript
// Tasks index — derived from CRDT tasks docs
const TaskIndex = new Schema({
  taskId:       { type: String, required: true, unique: true },
  planId:       String,
  goalId:       String,
  teamId:       String,
  title:        String,
  assignedRole: String,
  status:       String,
  durationMs:   Number,
  error:        String,
  createdAt:    Date,
  completedAt:  Date,
});
TaskIndex.index({ teamId: 1, status: 1 });
TaskIndex.index({ goalId: 1 });
TaskIndex.index({ assignedRole: 1, status: 1 });

// Plans index — derived from CRDT plan docs
const PlanIndex = new Schema({
  planId:   { type: String, required: true, unique: true },
  goalId:   String,
  teamId:   String,
  goal:     String,
  status:   String,
  version:  Number,
  taskCount: Number,
  researchNotes:     String,
  strategyRationale: String,
  failureAnalysis:   String,
  createdAt:   Date,
  completedAt: Date,
});
PlanIndex.index({ teamId: 1, status: 1 });
PlanIndex.index({ goal: 'text' });

// Output manifests index — derived from CRDT manifest docs  
const ManifestIndex = new Schema({
  taskId:          { type: String, required: true, unique: true },
  goalId:          String,
  teamId:          String,
  role:            String,
  activitySummary: String,
  outputCategories: [String],     // Flattened from outputs[].category
  outputCount:     Number,
  publishedAt:     Date,
});
ManifestIndex.index({ goalId: 1 });
ManifestIndex.index({ role: 1 });

// Goals index — derived from CRDT goals docs
const GoalIndex = new Schema({
  goalId:      { type: String, required: true, unique: true },
  teamId:      String,
  description: String,
  status:      String,
  planId:      String,
  taskCount:   Number,
  submittedAt: Date,
  completedAt: Date,
  durationMs:  Number,
});
GoalIndex.index({ teamId: 1, status: 1 });
```

Index schemas are **lean** — just the fields needed for queries. Full data lives in the CRDT doc.

### Execution Events (Phase 1)

Append-only. This is the one collection that's MongoDB-primary — events are system-level, not something agents read as documents.

```typescript
const ExecutionEventSchema = new Schema({
  eventId:    { type: String, required: true, unique: true },
  entityType: { type: String, enum: ['goal', 'plan', 'task', 'manifest', 'artifact', 'collaboration'] },
  entityId:   String,
  teamId:     String,
  goalId:     String,
  event:      String,
  data:       Schema.Types.Mixed,
  actor:      String,
  timestamp:  { type: Date, default: Date.now },
});
ExecutionEventSchema.index({ teamId: 1, timestamp: -1 });
ExecutionEventSchema.index({ goalId: 1, timestamp: 1 });
ExecutionEventSchema.index({ entityType: 1, event: 1 });
```

**Event sources:** (1) Existing EventEmitter events — `task:update`, `plan:update`, `execution:complete`. (2) New events from [agentic-streaming](../agentic-streaming/feature_architecture.md) — `task-started/completed/failed`, `artifact-state`, `collab-turn/outcome`, tool calls via AI SDK stream protocol.

### Team Learnings (Phase 2)

Also MongoDB-primary — background-extracted patterns, not agent-facing documents.

```typescript
const TeamLearningSchema = new Schema({
  learningId: { type: String, required: true, unique: true },
  teamId:     String,
  goalId:     String,
  category:   { type: String, enum: ['pattern', 'failure', 'performance', 'dependency'] },
  summary:    String,
  detail:     String,
  confidence: Number,
  sourceEvents:     [String],
  reinforceCount:   { type: Number, default: 1 },
  lastReinforcedAt: Date,
  createdAt:  { type: Date, default: Date.now },
});
TeamLearningSchema.index({ teamId: 1, category: 1 });
TeamLearningSchema.index({ teamId: 1, confidence: -1 });
```

### Token Usage (Phase 2)

See [cost-tracking feature](../cost-tracking/feature_architecture.md).

---

## Why This Works

### Agents read docs, not databases

| Operation | With DB-primary | With Docs-primary |
|---|---|---|
| Worker reads task context | Custom DB query tool needed | `collab read tasks` or `read_file .ping/collaboration/tasks.json` |
| Planner reads past plan | Custom DB query tool needed | `collab discover → list → read` |
| Agent browses outputs | Custom DB query tool needed | `collab discover outputs` |
| Human edits task | Dashboard → API → DB | BlockNote editor → CRDT doc (real-time, same data) |

Zero new tools. The `collab` tool and filesystem projection already handle all agent data access.

### Humans and agents share the same data

CRDT docs are editable by both agents (via `collab` tool) and humans (via BlockNote editor over WebSocket). A human can open the plan doc, edit a task description, and the agent sees it immediately. No sync layer, no API — it's the same document.

### The database does what files can't

Files/CRDT docs can't efficiently answer: "find all failed tasks across 50 goals", "average duration by role", "plans with similar goals". The MongoDB index handles these aggregate queries. The planner's research tools query the index, get pointers back to docs, then read the full content via `collab`.

### Rebuild safety

If MongoDB dies, no data is lost. CRDT docs (persisted via Hocuspocus Database extension to `data/collab/yjs/`) are the source of truth. Run a rebuild script: iterate all CRDT docs → re-sync to MongoDB. The index is derived, disposable, rebuildable.

---

## Agent Memory Model

Persisted data maps to three memory types (per CoALA framework):

| Memory | Source | Example |
|---|---|---|
| **Episodic** — what happened | `execution_events` (MongoDB) | "Last API plan: tests failed twice → add test-first constraint" |
| **Semantic** — facts about the team | CRDT docs (manifests, plans) + `team_learnings` | "Backend role averages 3 artifacts/task. PostgreSQL chosen for tenant isolation." |
| **Procedural** — how to do things | CRDT docs (successful plans) + agent YAML | "API pattern: schema → endpoints → tests → docs. 80% success rate." |

### Learning Pipeline

**Hot path** (during execution): State changes → CRDT doc mutation → onChange syncs to MongoDB index + appends to `execution_events`.

**Background path** (after goal completes):
1. Read `execution_events` for the goal
2. LLM summarizes: what worked, failed, was slow
3. Extract patterns → upsert into `team_learnings` (increment `confidence` if pattern exists)

### Knowledge Feedback Loop

Each goal execution makes the planner smarter for the next one:

1. **Planner research** → findings stored in plan doc's `researchNotes`
2. **Task creation** → research excerpts injected into task doc's `context.notes`
3. **Worker execution** → reads task doc + discovers output manifest docs for dependencies
4. **Task completion** → output manifest doc created, event appended
5. **Next goal** → planner reads past plan/task/manifest docs + queries MongoDB index for aggregates

---

## Migration Strategy

### Phase 1: CRDT Docs + Index + Event Log
1. Create CRDT doc conventions (naming: `{teamId}/{goalId}/{docType}`)
2. Migrate `MemoryManager` in-memory Maps → CRDT task docs + MongoDB index
3. Migrate `PlanStore` JSON files → CRDT plan docs + MongoDB index
4. Migrate output manifest files → CRDT manifest docs + MongoDB index
5. Add goals doc per team
6. Add `syncToIndex` in HocuspocusServer `onChange` hook
7. Add `execution_events` — append on every state transition
8. Backward compat: keep file-based PlanStore as fallback for one release

### Phase 2: Usage + Learnings
9. `UsageSchema` from cost-tracking feature
10. `TeamLearningSchema` + post-goal extraction pipeline

### Phase 3: Rebuild + Backup
11. Index rebuild script: iterate CRDT docs → re-populate MongoDB
12. `mongodump`/`mongorestore` for index backup (non-critical — rebuildable)
13. Hocuspocus `data/collab/yjs/` backup (critical — source of truth)

---

## Data Retention

| Data | Retention | Rationale |
|---|---|---|
| CRDT docs (plans, tasks, manifests, goals) | Indefinite | Source of truth, small per-goal |
| MongoDB index collections | Rebuildable — retain 90 days, then drop old entries | Derived, can be rebuilt from docs |
| `execution_events` | 90 days active, then archive | Highest volume |
| `team_learnings` | Indefinite | Small, high-value for planner |
| `usage` | Indefinite | Billing needs full history |
| `data/collab/yjs/` binary files | Indefinite (back up!) | CRDT binary state = the real data |

Archive: move old `execution_events` to `execution_events_archive`. Old CRDT docs stay as-is — small, valuable, don't purge.
