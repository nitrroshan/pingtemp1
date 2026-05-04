# Task Context & CRDT — Feature Architecture

**Status:** Research / Design  
**Date:** April 24, 2026  
**ID:** A12  
**Depends on:** Data Persistence (D1), Collaboration Toolkit, Task Orchestration (A6)  
**Related:** [git-task-context](../git-task-context/feature_architecture.md), [data-persistence](../data-persistence/feature_architecture.md), [crdt-undo-rollback](../crdt-undo-rollback/feature_architecture.md), [parallel-plans](../parallel-plans/feature_architecture.md), [plan-viewer](../plan-viewer/feature_architecture.md), [agent-collab-docs](../agent-collab-docs/feature_architecture.md)

---

## Problem Statement

Tasks fail or produce low-quality results because they lack proper context from preceding tasks. The current system has **seven specific gaps**:

| # | Gap | Impact |
|---|-----|--------|
| 1 | **Loose task descriptions** | Planner generates free-text descriptions. No structured inputs/outputs/risks — agents interpret vaguely. |
| 2 | **Upstream context is summary-only** | `enrichDependantContext()` passes `output.summary` — a compressed lossy string. Deliverables, file paths, decisions, and reasoning are lost. |
| 3 | **No artifact manifest** | Tasks produce files, but there's no structured record of what was produced, where, and what format. Downstream tasks can't reliably consume upstream outputs. |
| 4 | **No review-before-publish** | Agent writes go live immediately. No staging/review step where a human or reviewer can inspect artifacts before they become "official". |
| 5 | **Context built once, goes stale** | `TaskWithContext` is built at dispatch time. If upstream tasks are retried/updated, downstream doesn't see refreshed context. |
| 6 | **No CRDT plan document** | Plans exist as JSON in PlanStore. No live CRDT document where agents can read the plan, see other tasks' statuses, and understand the big picture while working. |
| 7 | **Failed upstream → opaque error** | When a prerequisite fails, downstream gets `status: "failed"` but no error details, failure reason, or partial outputs. |

---

## Design Review (April 24, 2026)

SOLID/LLD audit of this document. Issues found and resolutions applied:

| # | Issue | Principle | Resolution |
|---|-------|-----------|------------|
| 1 | **DocumentResolverRegistry is over-engineered for Phase 1** — agents already have `workspace_read_file`, `collab read`. Resolver duplicates existing tool layer. | YAGNI | **Defer resolver to Phase 4+.** Phase 1-3: agents use existing tools. URI scheme in prompt tells agent which tool to use. |
| 2 | **DocumentMeta + DocumentRegistry CRDT is premature** — 10-field metadata type designed before we know what metadata matters. | YAGNI | **Phase 1-2: docs live on the task** (inputDocs/outputDocs). Phase 3+: add registry only when we need cross-task discovery. |
| 3 | **StructuredTask is a divergent type** — separate from the real `Task` in code, will drift. | DRY | **Extend existing Task** with optional fields (implementation plan already does this — architecture section updated to match). |
| 4 | **Too many planner-time doc types** — `ExpectedDoc`, `PlannedDocRef`, `TaskDependency.requiredDocs` overlap. | ISP, Simplicity | **Simplify to 2 arrays:** `inputDocs` (what to read) + `expectedOutputDocs` (what to produce). System auto-resolves upstream docs on completion. |
| 5 | **FIX-1 leaks CRDT internals into WorkerPool** — directly manipulates Y.Map via `space.openDoc()`. | DIP | **Add `updateAgentStatus()` to ICrdtTaskSync.** WorkerPool calls the method, CrdtTaskSync encapsulates Y.Map. |
| 6 | **FIX-3 puts observe() in OrchestratorService** — already 1200+ lines. | SRP | **Use `AgentStatusObserver.ts`** — small class, single purpose. |
| 7 | **CRDT-F1 (L2 Search) bundled into Phase 2** — 3-4 days of work makes Phase 2 too heavy. | SRP, Focus | **Move to separate Phase 2b** or defer. Phase 2 stays focused on planner schema. |
| 8 | **Architecture mixes design with code diffs** — serves different audiences, changes at different rates. | SRP | **TODO:** Split into `feature_architecture.md` (design) + `feature_implementation_planning.md` (code plan) when we start coding. |

### Design Principles Applied

**Keep it simple:**
- Phase 1 adds 4 fields to `Task` and 3 fields to `complete_task`. That's it.
- No new runtime services. No new CRDT docs. No new tool abstractions.
- Agents use EXISTING tools (`workspace_read_file`, `collab read`) — just with better pointers.

**Build from the edges inward:**
1. First fix the OUTPUT (complete_task produces `DocumentRef[]` instead of `string[]`)
2. Then fix the INPUT (agent receives `inputDocs[]` with URIs instead of summary strings)
3. Then fix the PLANNER (generates structured I/O per task)
4. Then add infrastructure (registry, resolver, search) — only when the above proves the pattern works

**Feature gates are kill switches, not gradual rollouts:**
- `FF_ENABLE_DOCUMENT_CONTEXT=false` → system behaves exactly as today. Zero risk.
- Each flag guards a complete, testable behavior change — not partial code paths.

---

## What We Want

### Core Concept: Documents Are the Universal Exchange Format

**Everything that moves between tasks is a document.** Not strings, not summaries, not file paths — documents. A document is a reference to a piece of content with instructions on how to access it.

Documents can live in:
- **Workspace git repo** — code, configs, specs (access: `workspace_read_file`)
- **CRDT collaboration space** — plans, decisions, shared notes (access: `collab read`)
- **Agent memory** — personal notes, experiments (access: `memory read`)
- **External URLs** — reference material, APIs, specs (access: fetch/download)

When Task A completes and Task B depends on it, the system doesn't pass a summary string — it passes **document references** that Task B can read directly. The agent decides what to read, how deep to go, and what's relevant.

### Structured Plan Document (CRDT)

A live CRDT document per goal that all agents can read. Contains the plan, all tasks with structured metadata, and real-time status updates.

```
CRDT: {teamId}/{goalId}/plan
├── planId, goal, status, version
├── documents[]   ← ALL documents flowing through this plan
│   ├── inputs from user (specs, requirements, reference material)
│   ├── produced by tasks (code, reports, configs)
│   └── shared context (decisions, meeting notes, research)
├── tasks[] — each task has:
│   ├── id, title, description (detailed markdown)
│   ├── assignedRole, priority, complexity, type
│   ├── inputDocs[]     ← documents this task NEEDS (with access instructions)
│   ├── outputDocs[]    ← documents this task PRODUCES (populated on completion)
│   ├── contextDocs[]   ← reference documents (not consumed, just context)
│   ├── expectedOutput  ← structured: what format, what docs to produce
│   ├── risks[]         ← known risks, fallback strategies
│   ├── acceptanceCriteria[] ← how to verify task is done correctly
│   ├── dependencies[]  ← task IDs + which specific docs are needed from each
│   └── status, output, error
└── timeline, totalTasks, completedTasks
```

### The Document Reference — Universal Exchange Type

#### SOLID Analysis of the Design

The document system follows these principles:

| Principle | How |
|---|---|
| **SRP** | `DocumentRef` = identity only. `DocumentResolver` = access. `DocumentMeta` = metadata. Three concerns, three types. |
| **OCP** | Add new document stores by adding new `DocumentResolver` implementations. Zero changes to `DocumentRef` or existing resolvers. |
| **ISP** | Tasks use `DocumentRef` (4 fields). Registry uses `DocumentMeta`. Agents never see resolver internals. |
| **DIP** | `DocumentRef` has no dependency on tools or storage. Resolvers depend on the `DocumentRef` abstraction, not the other way around. |
| **LSP** | Every `DocumentRef` is a URI — no special cases. Inline content uses `data:` URI scheme (same as browsers). |

#### Layer 1: DocumentRef (Value Object)

A document reference is just an address with a name. It's a **value object** — immutable, comparable by `uri`. This is the ONLY type that flows between tasks.

```typescript
/**
 * Value Object — the universal exchange type between tasks.
 * Contains only identity (uri) and human context (name, hint).
 * Does NOT contain: access logic, metadata, provenance, or content.
 *
 * URI scheme convention (RFC 3986 inspired):
 *   workspace:src/api/pricing.ts          — git repo file
 *   workspace:src/api/pricing.ts#L10-L50  — specific lines (fragment)
 *   workspace:src/?branch=task-T-001      — branch qualifier
 *   crdt:decisions/pricing                — CRDT collab doc
 *   crdt:T-001/task                       — CRDT task doc
 *   memory:researcher/lessons             — agent memory doc
 *   memory:researcher/activity/T-001      — task-scoped memory
 *   https://api.example.com/docs          — external URL
 *   data:text/plain;pricing=tiered        — inline content (RFC 2397)
 */
interface DocumentRef {
  uri: string;            // The address. Scheme encodes the store type.
  name: string;           // Human-readable: "competitor-analysis", "api-spec"
  description?: string;   // What this document is about (one line)
  hint?: string;          // "Read sections 2-4 for pricing tiers"
}
```

**That's it.** 4 fields. The URI encodes WHERE it lives. The name tells you WHAT it is. The hint tells the agent HOW to read it (which parts matter). No access methods, no metadata, no provenance.

**Why no `type`, `format`, `mimeType`?** These are metadata — they belong in `DocumentMeta`, not in the reference. When you give someone a URL, you don't include the file size. You just give them the URL.

**Why no `readMethod`?** That's a resolver concern. `DocumentRef` doesn't know about tools. A `DocumentResolverRegistry` maps URI schemes to resolvers. Adding a new store type = registering a new resolver. No `DocumentRef` changes.

#### Layer 2: DocumentResolver (Strategy Pattern)

Resolution is a service-layer concern. Each store type has a resolver. The registry picks the right one by URI scheme.

```typescript
/**
 * Strategy interface — one implementation per URI scheme.
 * Injected into agents as a service, not embedded in the document.
 */
interface DocumentResolver {
  readonly scheme: string;                    // "workspace", "crdt", "memory", "https", "data"
  read(ref: DocumentRef): Promise<string>;    // Returns content
  write?(ref: DocumentRef, content: string): Promise<void>;
  exists?(ref: DocumentRef): Promise<boolean>;
}

/**
 * Registry — resolves any DocumentRef by dispatching to the right resolver.
 * Open for extension: register new resolvers without changing existing code.
 */
class DocumentResolverRegistry {
  private resolvers = new Map<string, DocumentResolver>();

  register(resolver: DocumentResolver): void {
    this.resolvers.set(resolver.scheme, resolver);
  }

  async read(ref: DocumentRef): Promise<string> {
    const scheme = ref.uri.split(':')[0];
    const resolver = this.resolvers.get(scheme);
    if (!resolver) throw new Error(`No resolver for scheme: ${scheme}`);
    return resolver.read(ref);
  }
}
```

**Concrete resolvers (one per store):**

```typescript
class WorkspaceResolver implements DocumentResolver {
  scheme = 'workspace';
  async read(ref: DocumentRef): Promise<string> {
    const path = ref.uri.slice('workspace:'.length);
    // Parse query params: ?branch=task-T-001
    // Parse fragment: #L10-L50
    return this.workspace.readFile(path, { branch });
  }
}

class CrdtResolver implements DocumentResolver {
  scheme = 'crdt';
  async read(ref: DocumentRef): Promise<string> {
    const docName = ref.uri.slice('crdt:'.length);
    return this.collabSpace.read(docName);
  }
}

class MemoryResolver implements DocumentResolver {
  scheme = 'memory';
  async read(ref: DocumentRef): Promise<string> {
    const memoryPath = ref.uri.slice('memory:'.length);
    // "researcher/lessons" → roleId=researcher, path=lessons
    return this.memoryStore.read(roleId, path);
  }
}

class HttpResolver implements DocumentResolver {
  scheme = 'https';
  async read(ref: DocumentRef): Promise<string> {
    return fetch(ref.uri).then(r => r.text());
  }
}

class InlineResolver implements DocumentResolver {
  scheme = 'data';
  async read(ref: DocumentRef): Promise<string> {
    // Parse data: URI (RFC 2397): data:text/plain;base64,...
    return decodeDataUri(ref.uri);
  }
}
```

**Adding a new store type (e.g., S3):**
```typescript
// OCP: zero changes to DocumentRef, existing resolvers, or tasks
class S3Resolver implements DocumentResolver {
  scheme = 's3';
  async read(ref: DocumentRef) {
    // s3:bucket-name/path/to/file.json
    return this.s3Client.get(bucket, key);
  }
}
registry.register(new S3Resolver(s3Client));
```

#### Layer 3: DocumentMeta (Metadata — Separate from Reference)

Metadata is tracked in the document registry, NOT in the reference. It's populated after documents are created/discovered.

```typescript
/**
 * Metadata about a document. Stored in the DocumentRegistry.
 * NOT carried with the DocumentRef — looked up when needed.
 */
interface DocumentMeta {
  uri: string;              // Links back to the DocumentRef
  type?: string;            // "code", "document", "decision", "research", "test", "config"
  format?: string;          // "typescript", "markdown", "json", "csv"
  size?: number;
  hash?: string;            // Content hash for change detection
  summary?: string;         // Brief content summary (for quick context)

  // Provenance
  producedBy?: string;      // taskId that created this document
  producedByRole?: string;  // role that created it
  createdAt?: number;
  updatedAt?: number;
}
```

#### Why Three Layers?

```
┌─────────────────────────────────────────────────┐
│  Layer 1: DocumentRef (Value Object)            │
│  ─────────────────────────────────────          │
│  { uri, name, description?, hint? }             │
│                                                 │
│  WHO USES IT: Tasks, Planner, Agents, Frontend  │
│  CROSSES: Every boundary. Serializable. Tiny.   │
└─────────────────────┬───────────────────────────┘
                      │ uri (scheme:path)
                      ▼
┌─────────────────────────────────────────────────┐
│  Layer 2: DocumentResolver (Strategy)           │
│  ─────────────────────────────────────          │
│  WorkspaceResolver, CrdtResolver, etc.          │
│                                                 │
│  WHO USES IT: Agent runtime (injected service)  │
│  CROSSES: Nothing. Lives in the service layer.  │
└─────────────────────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────┐
│  Layer 3: DocumentMeta (Metadata)               │
│  ─────────────────────────────────────          │
│  { type, format, size, hash, provenance }       │
│                                                 │
│  WHO USES IT: Registry, Frontend plan viewer    │
│  CROSSES: Only read by metadata consumers.      │
└─────────────────────────────────────────────────┘
```

**Analogy:** A URL (`https://example.com/report.pdf`) doesn't carry its file size, MIME type, or who uploaded it. That metadata lives on the server. You just need the URL to fetch it.

### How Documents Flow

```
User submits goal with reference docs:
  { uri: "https://...", name: "PRD" }
  { uri: "workspace:src/", name: "Existing codebase" }
      │
      ▼
Planner reads docs, creates plan with tasks:
  Task T-001 (Research):
    inputDocs: [
      { uri: "https://...", name: "PRD" }
    ]
    expectedOutputDocs: [
      { name: "competitor-analysis", type: "research", format: "markdown",
        path: "research/competitors.md", description: "..." }
    ]
      │
      ▼ T-001 completes, produces:
      │   { uri: "workspace:research/competitors.md", name: "competitor-analysis" }
      │   { uri: "crdt:decisions/pricing", name: "pricing-decision" }
      │
      ▼
  Task T-002 (Build API):
    inputDocs: [
      { uri: "workspace:research/competitors.md", name: "competitor-analysis",
        hint: "Sections 2-4 have pricing tiers" },
      { uri: "crdt:decisions/pricing", name: "pricing-decision" },
      { uri: "https://...", name: "PRD" }
    ]
    → Agent calls resolverRegistry.read(ref) for each doc
    → Resolver picks WorkspaceResolver / CrdtResolver / HttpResolver by scheme
    → Agent has FULL context, not a summary
```

### Task Type Extensions (additive, not a new type)

Extends the existing `Task` interface in [Task.types.ts](../../packages/agent-manager/src/memory/types/Task.types.ts). All new fields are optional — zero breaking changes.

```typescript
// EXISTING Task interface — ADD these optional fields:
interface Task {
  // ...all existing fields stay...

  // DOCUMENT-CENTRIC I/O — only DocumentRef (value objects)
  inputDocs?: DocumentRef[];          // Docs this task MUST read (populated by enrichment)
  contextDocs?: DocumentRef[];        // Docs for background (optional reading)
  outputDocs?: DocumentRef[];         // Docs this task produced (populated on completion)
  expectedOutputDocs?: ExpectedDoc[]; // What docs the planner expects this task to produce

  // Task metadata (populated by planner)
  risks?: TaskRisk[];
  acceptanceCriteria?: string[];

  // Review state (Phase 5)
  reviewStatus?: 'pending' | 'approved' | 'rejected' | 'needs-changes';
  reviewNotes?: string;
}
```

Note: `dependencies` stays as the existing `prerequisites: Map<string, boolean>`. `dependants` stays as `dependants: string[]`. No new dependency type — the system auto-resolves which docs flow when upstream completes.

// What the planner EXPECTS the task to produce (before it runs)
interface ExpectedDoc {
  name: string;                // e.g., "api-spec"
  type?: string;               // "code", "document", "decision", etc.
  format?: string;             // "markdown", "typescript", etc.
  suggestedUri?: string;       // "workspace:src/api/pricing.ts" (hint, agent decides)
  description: string;         // What this document should contain
}

interface TaskRisk {
  description: string;
  severity: 'low' | 'medium' | 'high';
  mitigation: string;
}

// Structured output from a completed task
interface TaskOutput {
  summary: string;
  producedDocs: DocumentRef[];      // Actual documents produced (tiny value objects)
  decisions: string[];              // Key decisions made
  nextSteps: string[];              // Recommendations for downstream
  risksEncountered: string[];       // Which risks materialized
}
```

Note: No `TaskDependency` type. The existing `prerequisites: Map<string, boolean>` handles DAG dependencies. When upstream task T-001 completes with `outputDocs`, the system auto-pushes those into downstream T-002's `inputDocs`. The planner doesn't pre-specify which exact doc names flow — it just says "T-002 depends on T-001".

### Document Registry (Per-Goal)

The registry tracks ALL documents in a goal. It stores `DocumentMeta` (metadata), indexed by `uri`. Agents discover documents via `collab read "documents"`. Frontend reads it for the lineage view.

```typescript
// CRDT: {teamId}/{goalId}/documents
// Stored as Y.Map — agents and frontend can read it live
interface DocumentRegistry {
  // Core index: uri → DocumentMeta (includes type, format, provenance)
  documents: Map<string, DocumentMeta>;

  // Lookup indexes (derived from documents map)
  byTask: Map<string, string[]>;         // taskId → uris produced
  byType: Map<string, string[]>;         // type → uris
  byScheme: Map<string, string[]>;       // "workspace"|"crdt"|... → uris
}
```

```
Agent: "What documents are available?"
  → collab read "documents" → sees 15 docs across workspace, CRDT, external
  → Picks 3 relevant URIs → calls resolverRegistry.read(ref)
  → Has complete context without scanning the filesystem
```

---

## Architecture Options

### Option A: CRDT-First Plan Document

**Implementation:** Create a structured CRDT plan document per goal. The planner writes to it, agents read from it, task completion updates it. All context flows through the CRDT doc.

**Flow:**
```
Planner generates plan
  → Write structured tasks to CRDT: {teamId}/{goalId}/plan
  → Each task gets inputDocs[], expectedOutputDocs[], risks[]
  → Dependencies explicitly state which DOCUMENTS are needed from each upstream task
  → Document registry created: {teamId}/{goalId}/documents

Task dispatched:
  → Agent reads plan doc via collab tool (sees full plan, other tasks' status)
  → Agent reads upstream documents via their access.readMethod
  → Documents are always live (CRDT = real-time, workspace = latest branch)

Task completes:
  → Agent registers producedDocs[] in document registry
  → System populates downstream tasks' inputDocs[] with DocumentRefs
  → Documents flow as references with access instructions, not summaries

Review (optional):
  → producedDocs written to CRDT review doc: {teamId}/{goalId}/review/{taskId}
  → Human/reviewer reads each doc via its access method
  → Approve → merge documents to main workspace
  → Reject → agent gets rejection notes, retries
```

**Pros:**
- Agents always have live context — documents are read directly, not summarized
- Document registry lets agents discover ALL documents across the plan
- Documents flow with access instructions — agents know HOW to read them
- Review workflow inspects actual documents, not just diffs
- Aligns with data-persistence decision (CRDT as source of truth)

**Cons:**
- Planner LLM must generate structured tasks (more complex prompt)
- CRDT docs grow over time (need cleanup strategy)
- Requires planner prompt changes + frontend updates

**Effort:** 2-3 weeks

### Option B: Post-Processing Enrichment

**Implementation:** Keep current loose plan format. Add a post-processing step after plan generation that enriches tasks with structured I/O contracts using a secondary LLM call.

**Flow:**
```
Planner generates plan (current format)
  → Post-processor LLM enriches each task:
    - Infers inputDocs from dependencies
    - Generates expectedOutputDocs from description
    - Identifies risks
    - Creates acceptance criteria
  → Enriched tasks stored in TaskStore (existing in-memory)
  → Context passed same as today (enrichDependantContext)
```

**Pros:**
- Minimal planner changes — post-processing is additive
- Easier to ship incrementally
- Doesn't require CRDT plan doc

**Cons:**
- Extra LLM call per plan (cost + latency)
- Inferred document references may be wrong (LLM guessing)
- Still loses real-time updates (not CRDT-based)
- Doesn't solve the review-before-publish problem
- Doesn't give agents a live browsable plan
- Documents don't flow — still summary strings between tasks

**Effort:** 1 week

### Option C: Hybrid — Planner Generates Structured + CRDT as Live View

**Implementation:** Upgrade planner prompt to generate structured tasks with I/O contracts. Write to CRDT doc for live access. Add review step via CRDT review docs.

**Flow:**
```
Planner generates structured plan (upgraded prompt)
  → Writes to CRDT plan doc with full task metadata
  → Each task has inputDocs[], expectedOutputDocs[], risks[]
  → Document registry created for the goal
  → Frontend shows structured plan with document flow + approval UI

Task dispatched:
  → PlannedDocRefs resolved to full DocumentRefs with access instructions
  → Agent reads upstream documents directly via access.readMethod
  → Agent has full context: documents to read, documents to produce

Task completes:
  → Agent calls complete_task with producedDocs[] (DocumentRef[])
  → Documents registered in goal's document registry
  → System enriches downstream tasks: inputDocs[] populated with real DocumentRefs

Review step (configurable per task type):
  → producedDocs written to CRDT review doc
  → Review doc links to actual documents (workspace files, CRDT docs)
  → Human reads documents via their access methods, approves/rejects
  → On approve: documents merge to workspace main branch
  → On reject: task re-queued with rejection feedback + document refs for what to fix
```

**Pros:**
- Best of both worlds: structured from planner + live via CRDT
- Documents flow as first-class objects between tasks — not summaries, not paths
- Document registry lets agents discover everything available
- Review workflow inspects actual documents, not just raw diffs
- Frontend gets rich data for plan viewer (document lineage per task)
- Aligns with all existing architecture decisions (CRDT-first, data-persistence)

**Cons:**
- Requires planner prompt engineering (but this is a one-time investment)
- More complex than Option B (but delivers more value)
- Requires frontend updates for structured plan display and review UI

**Effort:** 2-3 weeks

---

## Recommendation

**Option C (Hybrid)** because:

1. **DocumentRef is a value object** — 4 fields: `uri`, `name`, `description?`, `hint?`. No access logic, no metadata, no provenance. Like a URL — just an address with a label.

2. **URI scheme = store type (RFC 3986)** — `workspace:`, `crdt:`, `memory:`, `https:`, `data:`. No separate `store` field. The scheme IS the store. Adding a new store = adding a new URI scheme + resolver.

3. **Resolver pattern for access (Strategy + OCP)** — `DocumentResolverRegistry` maps schemes to resolvers. Documents don't know how they're read. Adding S3, GCS, or any new store = register a new resolver. Zero changes to DocumentRef or existing code.

4. **Metadata lives in the registry, not the reference** — `DocumentMeta` (type, format, size, hash, provenance) is stored in the per-goal document registry CRDT doc. Not carried in every DocumentRef. Like HTTP: the URL doesn't carry Content-Length.

5. **CRDT plan doc is the living plan** — Not a snapshot. Agents read it during execution for up-to-date status of other tasks.

6. **Documents are first-class** — Every task declares what documents it reads and produces. The document registry indexes everything across all stores. Frontend shows the lineage.

7. **Review is optional and configurable** — Low-risk tasks auto-approve. High-risk tasks require human review.

8. **MetaGPT validation** — MetaGPT's `Task` uses `dependent_task_ids`, `instruction`, `result`. Our model adds document-centric I/O with cross-store resolution, validated by the industry pattern of task DAGs with explicit dependencies.

**Decision Required:** Please choose Option A, B, or C.

---

## CRDT Review Document

### The Problem

Today, agent outputs go live immediately. There's no staging/review step. If an agent produces incorrect code or a flawed document, it's already in the workspace.

### Proposed Model: Review-Before-Publish

Each task that produces workspace artifacts gets a **CRDT review document** before merging to main.

```
CRDT: {teamId}/{goalId}/review/{taskId}
├── taskId, taskTitle, assignedRole
├── status: 'pending' | 'approved' | 'rejected' | 'needs-changes'
├── proposedDocs[]               ← DocumentRefs the agent wants to publish
│   ├── DocumentRef (with location, access, description)
│   ├── diff from main (for workspace files)
│   └── changeType (new, modified, deleted)
├── agentReasoning               ← why the agent made these choices
├── reviewComments[]             ← human/reviewer feedback
│   ├── author, timestamp, comment, resolved
│   ├── docRef (which document the comment is about)
│   └── lineRef? (for code-level comments)
├── approvedAt, approvedBy
└── rejectionHistory[]           ← previous rejections and feedback
```

### Review Flow

```
Agent completes task
  → producedDocs[] registered in document registry
  → Review doc created in CRDT with proposedDocs[] (DocumentRefs)
  → Frontend shows review UI (reads each doc via access.readMethod, shows diffs)

Human reviews:
  → Reads documents directly (workspace files, CRDT docs, etc.)
  → Approve → merge workspace docs to main, mark task complete
  → Reject → add rejection notes to review doc (with docRef pointing to the issue)
    → Task re-queued with rejection context + document refs for what to fix
    → Agent sees: "Your pricing-api doc was rejected because..."
  → Needs changes → specific comments added per document
    → Agent receives targeted feedback per document, revises

Auto-approve (configurable):
  → Low-risk tasks (type: "work", complexity: "low") auto-approve
  → High-risk tasks (type: "review", complexity: "high") require human review
  → Configurable per team/role/task-type
```

### Connection to CRDT Undo & Rollback

The [crdt-undo-rollback](../crdt-undo-rollback/feature_architecture.md) feature adds `Y.UndoManager` per agent. Combined with review docs:

- Agent writes document to shared CRDT doc → tracked by UndoManager (origin: `agent:{role}:{taskId}`)
- Review rejects → UndoManager reverts the agent's writes to the shared doc
- Review approves → UndoManager stack cleared (writes are permanent)
- Workspace documents: review rejects → task branch not merged, agent gets feedback with DocumentRefs

This gives clean rollback without manual file-by-file reversal.

---

## Complete Context Movement Audit

Every place in the system where information moves between components. For each flow: what moves, what format, and whether it should be a `DocumentRef`.

### The 13 Context Flows

```
 ┌──────────┐        ┌───────────┐        ┌───────────┐        ┌───────────┐
 │   User   │───①───▶│  Planner  │───②───▶│ TaskStore │───③───▶│   Agent   │
 └──────────┘        └─────┬─────┘        └─────┬─────┘        └──┬──┬──┬──┘
                           │                    │                  │  │  │
                           │              ⑩ enrich               ④│ ⑤│ ⑥│
                           │                    │                  │  │  │
                     ┌─────▼─────┐        ┌─────▼─────┐     ┌────▼┐ │  │
                     │   CRDT    │◀──⑧───│   Agent   │─⑦──▶│ WS  │ │  │
                     │  (collab) │───⑨───▶│  (tools)  │◀────│(git)│ │  │
                     └─────┬─────┘        └───────────┘     └─────┘ │  │
                           │                                        │  │
                     ┌─────▼─────┐                            ┌────▼┐ │
                     │ Frontend  │◀───────────⑪───────────────│Sock │ │
                     └───────────┘                            └─────┘ │
                                                                      │
                     ┌───────────┐        ┌───────────┐         ┌────▼┐
                     │  Skills   │───⑫───▶│  Agent    │◀──⑬────│Error│
                     │ (SKILL.md)│        │ (prompts) │         └─────┘
                     └───────────┘        └───────────┘
```

### Flow ① User → Planner (Goal Submission)

**Code:** [SocketServerV2.ts#L691](../../packages/backend/api/SocketServerV2.ts) → [OrchestratorService.ts#L179](../../packages/agent-manager/src/orchestrator/OrchestratorService.ts)

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| User goal text | `content: string` in `MessagePayload` | **No** — natural language, not a document |
| Repo URLs in message | Embedded in `content` string | **Yes** — `{ uri: "https://github.com/...", name: "target-repo" }` |
| File references | Embedded in `content` string | **Yes** — `{ uri: "workspace:src/", name: "existing-codebase" }` |
| PRD / spec links | Embedded in `content` string | **Yes** — `{ uri: "https://docs.google.com/...", name: "PRD" }` |

**Gap:** User context documents (repos, specs, URLs) are buried in the message string. The planner must parse natural language to find them. There's no structured way to attach reference documents to a goal.

**Fix:** Add `attachedDocs?: DocumentRef[]` to `MessagePayload`. Frontend provides a "Attach references" UI. Planner receives them as structured inputs.

```typescript
// CURRENT
interface MessagePayload { teamId: string; agentId: string; content: string; }

// PROPOSED
interface MessagePayload {
  teamId: string; agentId: string; content: string;
  attachedDocs?: DocumentRef[];  // User-provided reference documents
}
```

---

### Flow ② Planner → Tasks (Plan Creation)

**Code:** [submitPlan.ts#L18](../../packages/agent-manager/src/orchestrator/tools/submitPlan.ts) → [OrchestratorService.ts#L243](../../packages/agent-manager/src/orchestrator/OrchestratorService.ts)

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| Task description | `description: string` | **No** — instructions, not a document |
| Expected output | `expectedOutput: string` | **→ ExpectedDoc[]** with name, type, suggestedUri |
| Context files | `context.files: string[]` | **→ DocumentRef[]** with uri scheme |
| Context artifacts | `context.artifacts: string[]` | **→ DocumentRef[]** with uri scheme |
| Cross-plan refs | `references: string[]` (e.g., "plan-001/task-003") | **→ DocumentRef[]** pointing to prior task outputs |
| Related tasks | `context.relatedTasks: string[]` | Keep as task IDs (not documents) |
| Notes | `context.notes: string` | **No** — planner instructions, not a document |

**Gap:** The `submit_plan` schema uses bare strings for files, artifacts, and references. The planner doesn't specify what FORMAT, TYPE, or WHERE these documents should be accessed from.

**Fix:** Upgrade `submit_plan` schema with `inputDocs: PlannedDocRef[]` and `expectedOutputDocs: ExpectedDoc[]`.

---

### Flow ③ Task → Agent (Dispatch Context)

**Code:** [OrchestratorService.ts#L919](../../packages/agent-manager/src/orchestrator/OrchestratorService.ts) → [WorkerPool.ts#L209](../../packages/agent-manager/src/services/WorkerPool.ts)

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| Upstream summaries | `upstreamOutputs: [{ taskId, role, status, summary }]` | **→ DocumentRef[]** pointing to upstream output docs |
| Upstream artifacts | `upstreamArtifacts: string[]` (bare paths) | **→ DocumentRef[]** with `workspace:path` URIs |
| Upstream notes | `upstreamNotes: string[]` ("From researcher: ...") | Keep as strings (ephemeral advice) |
| CRDT refs | `crdtRefs: { task, plan, goal, dependencies }` | **→ DocumentRef[]** with `crdt:` URIs |
| Expected output | `expectedOutput: string` | **→ ExpectedDoc[]** |
| Team roster | `teamRoles: string[]` | Keep (not a document) |
| Cross-plan outputs | Resolved from `references[]` → `priorOutputs: string[]` | **→ DocumentRef[]** with `crdt:` or `workspace:` URIs |

**Gap:** This is the biggest loss point. Everything is string-concatenated into `enrichedDescription`. CRDT refs are text instructions ("use collab read T-001/task"), not typed document references the agent can programmatically read.

**Fix:** Build `TaskWithContext.context` with typed `inputDocs: DocumentRef[]`, `contextDocs: DocumentRef[]`. Agent message lists documents with URIs instead of prose instructions.

---

### Flow ④ Agent → Agent (Cross-Role Communication)

**Code:** [requestTaskTool.ts#L19](../../packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts), collab discuss

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| Task delegation (request_task) | `{ title, description, targetRole, context: { reason, files, artifacts } }` | `files` and `artifacts` **→ DocumentRef[]** |
| Discussion posts (collab discuss post) | `{ content: string, mentions: string[] }` | **No** — ephemeral discussion, not a document |
| Discussion decisions (collab discuss decide) | `{ key, decision, agreedBy }` | Decisions **→ DocumentRef** in CRDT (`crdt:decisions/{key}`) |
| Bounce task | `{ reason: string }` | **No** — ephemeral |

**Gap:** When an agent creates a task for another role via `request_task`, `context.files` and `context.artifacts` are bare strings. The receiving agent doesn't know what store they're in or how to read them.

**Fix:** `request_task` schema gets `contextDocs: DocumentRef[]` instead of `files` + `artifacts`.

---

### Flow ⑤ Agent → Workspace (Writing Artifacts)

**Code:** [workspace-tools.ts](../../packages/workspace/src/L1/workspace/) (31 tools)

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| File content | `workspace_write_file({ path, content })` | **No change** — agent writes directly. But produced files should be REPORTED as DocumentRefs in complete_task |
| Commit | `workspace_commit({ message })` | **No change** |
| Publish | `workspace_publish({ goalId })` | **No change** — but triggers `DocumentRegistry` update |

**Gap:** Agent writes files but there's no automatic registration of produced documents. The `complete_task` tool only captures `deliverables: string[]` (bare paths). 

**Fix:** `complete_task` schema gets `producedDocs: DocumentRef[]`. Workspace publish hook auto-registers produced files in DocumentRegistry with `DocumentMeta`.

---

### Flow ⑥ Workspace → Agent (Reading Context)

**Code:** [workspace-tools.ts](../../packages/workspace/src/L1/workspace/) — `workspace_read_file`, `workspace_list_files`, `workspace_grep`, `workspace_glob`, `get_repo_map`

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| File content | `workspace_read_file(path) → string` | **No change** — on-demand tool call |
| File listing | `workspace_list_files() → string[]` | **No change** |
| Search results | `workspace_grep(pattern) → matches[]` | **No change** |

**No gap here.** Workspace read tools are on-demand and work well. The issue is that agents don't know WHICH files to read — that's solved by passing `inputDocs: DocumentRef[]` at dispatch time (Flow ③ fix).

---

### Flow ⑦ Agent → CRDT (Writing Shared State)

**Code:** [collab tool](../../packages/collaboration/src/L2/tools/index.ts) — `write`, `write-block`, `discuss post`, `discuss decide`

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| Shared doc writes | `collab({ action: "write", docName, key, value })` | Produced CRDT docs **should be registered** as DocumentRefs in DocumentRegistry |
| Discussion posts | `collab({ action: "discuss", key: "post", value: { content, mentions } })` | **No** — ephemeral |
| Decision records | `collab({ action: "discuss", key: "decide", value: { decision, agreedBy } })` | **Yes** — decisions should be registered as `crdt:decisions/{key}` DocumentRefs |

**Gap:** When an agent writes to a CRDT doc, it's not registered anywhere. Downstream agents don't know it exists unless they manually call `collab discover`.

**Fix:** `collab write` hook auto-registers new CRDT docs in DocumentRegistry. Decisions auto-registered as `{ uri: "crdt:{taskId}/decisions/{key}", name: "decision-{key}" }`.

---

### Flow ⑧ CRDT → Agent (Reading Shared State)

**Code:** [collab tool](../../packages/collaboration/src/L2/tools/index.ts) — `discover`, `list`, `read`, `read-block`

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| Doc discovery | `collab({ action: "discover" }) → text listing` | **No change** — but DocumentRegistry (new) provides a richer index |
| Doc content | `collab({ action: "read", docName }) → content` | **No change** — maps to `CrdtResolver.read()` in new system |

**No gap here.** CRDT read works via the collab tool. DocumentResolver just formalizes it behind a uniform interface.

---

### Flow ⑨ System → Frontend (Real-time State)

**Code:** [SocketServerV2.ts#L626](../../packages/backend/api/SocketServerV2.ts) — `state`, `stream`, `progress` events

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| Plan/task state | `StateResponse: { plan: PlanTask[], sessionState }` | **Add** `documentRegistry` snapshot to state events |
| Stream parts | `StreamPayload: { part: StreamPart, taskId, agentId }` | **No change** — token-level streaming |
| Task updates | `{ taskId, status, role, timestamp }` | **Add** `producedDocs: DocumentRef[]` when task completes |

**Gap:** Frontend has no visibility into what documents each task consumed/produced. Plan viewer shows tasks and status, but not the document flow.

**Fix:** `StateResponse` includes document registry data. Frontend plan viewer reads it to show lineage.

---

### Flow ⑩ Task Completion → Dependent Enrichment

**Code:** [TaskStore.ts#L328](../../packages/agent-manager/src/orchestrator/TaskStore.ts) — `enrichDependantContext()`

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| Upstream summary | `{ taskId, role, status, summary: output.summary }` | **→ DocumentRef** to full output doc (`crdt:{taskId}/output`) |
| Upstream deliverables | `output.deliverables: string[]` (bare paths) | **→ DocumentRef[]** with `workspace:` URIs |
| Upstream nextSteps | `"From {role}: {step}"` | Keep as strings (ephemeral advice) |
| Upstream decisions | **NOT PASSED** | **Add** `output.decisions: string[]` → downstream context |
| Error details | `output.summary` includes error text | **Add** structured error info when `status === "failed"` |

**Gap:** This is the #1 context loss point. Only `summary` (a string) flows to dependants. Full output, deliverables with metadata, decisions, and error details are all lost.

**Fix:** `enrichDependantContext` pushes `DocumentRef[]` from upstream `output.producedDocs` into `dependant.inputDocs[]`.

---

### Flow ⑪ Skills → Agent (Knowledge Injection)

**Code:** [SkillPlugin.ts#L65](../../packages/backend/agentManager/plugins/SkillPlugin.ts)

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| Skill instructions | SKILL.md content → system prompt string | **No change** — skills are prompt engineering, not documents |

**No gap.** Skills are system prompt fragments, not inter-task context.

---

### Flow ⑫ Identity/Memory → Agent

**Code:** [WorkerPool.ts#L350](../../packages/agent-manager/src/services/WorkerPool.ts) — `writeIdentityFile()`

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| Agent identity | `.ping/identity.json` written to workspace | Could be `{ uri: "workspace:.ping/identity.json", name: "identity" }` but not needed — agent reads it via workspace tools |
| Agent memory | Not implemented yet (planned in git-task-context A8) | **→ DocumentRef** with `memory:` URI when A8 ships |

**Minor gap.** Identity is a workspace file the agent can read. Memory is future (A8).

---

### Flow ⑬ Error/Failure → Context

**Code:** [OrchestratorService.ts#L919](../../packages/agent-manager/src/orchestrator/OrchestratorService.ts) — `classifyError()`, retry logic

| What moves | Current format | Should be DocumentRef? |
|---|---|---|
| Error classification | `{ errorCategory, message, retriable }` | **No** — system internal |
| Failure reason to dependants | `output.summary` with error text (lossy) | **Add** structured `{ error, errorCategory, partialOutput?, partialDocs? }` |
| Blocked status | `report_status({ status: "blocked", summary })` | **No change** |

**Gap:** When a task fails, downstream dependants only see `status: "failed"` and whatever was in the summary. No structured error info, no partial outputs, no partial documents.

**Fix:** `enrichDependantContext` for failed upstream includes `{ failedTask: taskId, error, partialDocs: DocumentRef[] }`.

---

### Summary: What's a Document vs What's Not

| Context Type | Is a Document? | Why / Why Not |
|---|---|---|
| **User goal text** | No | Natural language instruction, not a referenceable resource |
| **User-attached refs (repos, URLs, specs)** | **Yes** | Referenceable resources with a URI |
| **Task description** | No | Instructions for the agent, not a produced artifact |
| **Planner notes** | No | Ephemeral planner-to-agent advice |
| **Upstream task summaries** | **Replace with DocumentRef** | Point to the full output doc, not a lossy summary |
| **Upstream deliverables (file paths)** | **Yes → DocumentRef** | `workspace:path` URI |
| **Upstream nextSteps** | No | Ephemeral advice strings |
| **Upstream decisions** | **Yes → DocumentRef** | Important context that should persist as `crdt:decisions/{key}` |
| **CRDT docs (plans, goals, tasks)** | **Yes → DocumentRef** | `crdt:plan`, `crdt:goal`, `crdt:{taskId}/task` |
| **Discussion posts** | No | Ephemeral messages in a discussion thread |
| **Discussion decisions** | **Yes → DocumentRef** | Recorded in CRDT, referenceable |
| **Workspace files** | **Yes → DocumentRef** | `workspace:path` URI |
| **Error details** | Partially | Structured error + partial docs should be DocumentRef |
| **Skills (SKILL.md)** | No | Prompt engineering, not inter-task context |
| **Identity** | No | Agent config, not a produced artifact |
| **Stream parts** | No | Token-level frontend rendering, never stored |
| **Team roster** | No | Configuration, not a document |

---

## Event Flow Analysis: Current System vs Proposed

### The 11-Stage Pipeline (Current Code)

Based on codebase analysis of [OrchestratorService.ts](../../packages/agent-manager/src/orchestrator/OrchestratorService.ts), [TaskStore.ts](../../packages/agent-manager/src/orchestrator/TaskStore.ts), [WorkerPool.ts](../../packages/agent-manager/src/services/WorkerPool.ts), and lifecycle tools.

```
STAGE 1: User Message
  _handleMessage() → stores message → fires planner callback
  │
STAGE 2: Planner Generates Plan
  Planner LLM calls create_plan tool → returns PlanTask[] with:
    { id, title, description, assignedRole, priority, dependencies[], expectedOutput }
  ⚠️ GAP: description is free text, no structured I/O
  ⚠️ GAP: expectedOutput is a string, not document refs
  │
STAGE 3: approvePlan() → TaskStore.create()
  For each PlanTask: creates Task with context from plan
  Persists to CRDT via crdtTaskSync.persistTask()
  Builds prerequisite DAG from dependencies[]
  ⚠️ GAP: context is Record<string, any> — untyped bag
  │
STAGE 4: Task Ready Detection
  TaskStore checks: all prerequisites complete? → status = "ready"
  Fires onTaskReady callback
  │
STAGE 5: OrchestratorService.dispatchTask() ← MAIN CONTEXT ASSEMBLY
  │
  ├─ Reads task.context (pre-enriched by Stage 10):
  │   upstreamOutputs: [{ taskId, role, status, summary }]  ← SUMMARY ONLY
  │   upstreamArtifacts: string[]  ← bare file paths, no metadata
  │   upstreamNotes: string[]  ← "From {role}: {nextStep}"
  │
  ├─ Gets CRDT refs via getCrdtRefs():
  │   { task: "T-001/task", plan: "plan", goal: "goal",
  │     dependencies: ["T-000/task"], dependants: ["T-002/task"] }
  │
  ├─ Enriches description (string concatenation):
  │   Original description
  │   + "## Completed Upstream Work" (summaries only)
  │   + "Files/artifacts from upstream: path1, path2"
  │   + "Notes: - From researcher: ..."
  │   + "Expected output: ..."
  │   + "## Context Sources (use collab read to access)"
  │   + "## Your Team" (roster)
  │   ⚠️ GAP: Everything mashed into one giant string
  │   ⚠️ GAP: Agent must parse structured data from free text
  │   ⚠️ GAP: No document URIs, just file path strings
  │
  ├─ Builds TaskWithContext:
  │   { id, description: enrichedDescription, assigned_role, priority,
  │     context: { previousOutputs, artifacts, crdtRefs },
  │     createdAt, status: "in_progress" }
  │   ⚠️ GAP: context.previousOutputs is Object.values(context) — FLATTENED
  │
  └─ Calls workerPool.runTask(taskWithContext)
  │
STAGE 6: WorkerPool.runTask()
  │
  ├─ buildMessageWithContext(task):
  │   description (already enriched)
  │   + "## Context from previous tasks:" + JSON.stringify(prev.output)
  │   + "## Deliverables from Upstream Tasks" + artifact paths
  │   ⚠️ GAP: DOUBLE context — dispatchTask already added upstream info,
  │          buildMessageWithContext adds it AGAIN from previousOutputs
  │   ⚠️ GAP: previousOutputs are Object.values(context) — unstructured
  │
  ├─ Creates AiSdkAgent + injects tools:
  │   Lifecycle: complete_task, report_status, request_task, bounce_task
  │   Plugins: workspace tools, collab tools, git tools
  │   Skills: task-lifecycle skill, plugin skills
  │
  ├─ Writes identity file: .ping/identity.json
  │
  └─ agent.execute({ message: finalMessage, threadId: taskId })
  │
STAGE 7: Agent Executes
  Agent sees: ONE GIANT STRING with everything concatenated
  Agent has tools: workspace_read_file, collab read, complete_task, etc.
  Agent works: reads files, writes code, makes decisions
  │
STAGE 8: Agent Calls complete_task
  Schema: { summary: string, deliverables?: string[], nextSteps?: string[] }
  ⚠️ GAP: deliverables is string[] — bare paths, no DocumentRef
  ⚠️ GAP: No decisions[], no risksEncountered[]
  ⚠️ GAP: No produced document metadata (type, format, description)
  │
STAGE 9: onWorkerDone()
  Receives: { taskId, role, summary, deliverables?, nextSteps?, timestamp }
  Calls pluginRegistry.onTaskComplete() → workspace publish + merge
  Calls taskStore.completeTask(taskId, output)
  Syncs CRDT: crdtSync.syncStatus(taskId, "completed", output)
  │
STAGE 10: TaskStore.completeTask()
  Stores output on task: task.output = { summary, deliverables, nextSteps }
  │
  └─ For each dependant task: enrichDependantContext(dependant, upstream):
      dependant.context.upstreamOutputs.push({
        taskId, role, status, summary: output.summary  ← LOSSY
      })
      dependant.context.upstreamArtifacts.push(...output.deliverables)  ← bare paths
      dependant.context.upstreamNotes.push("From {role}: {step}")
      ⚠️ GAP: Only summary flows — not the full output
      ⚠️ GAP: deliverables are file paths — no type/description
      ⚠️ GAP: Decisions lost — downstream doesn't know WHY
  │
STAGE 11: Dependent Task Becomes Ready → loops to Stage 5
```

### What the Agent Actually Receives (Current)

When Stage 7 fires and the agent starts working, here's EXACTLY what it has:

| Source | Format | Content | Problem |
|--------|--------|---------|---------|
| **Task description** | Free text | "Build the pricing API..." | Vague, no structured I/O |
| **Upstream summaries** | Concatenated strings | "### T-001 (researcher)\nAnalyzed 5 competitors..." | Lossy — only summary, not the actual analysis |
| **Upstream artifacts** | Comma-separated paths | "research/competitors.md, data/pricing.csv" | Bare paths — no type, no description, no hint what to read |
| **Upstream notes** | Bullet list | "- From researcher: Try batch API" | Useful but unstructured |
| **Expected output** | Free text | "REST API with pricing endpoints" | Vague — no file paths, no format spec |
| **CRDT refs** | Collab read instructions | "Your task: collab read T-001/task" | Good but manual — agent must know to call collab |
| **Team roster** | List of role names | "researcher, frontend-dev, devops" | Good |
| **Tools** | Tool definitions | workspace_read_file, collab, etc. | Good — agent CAN read files, just doesn't know WHICH |

**The core problem:** The agent gets summaries and paths, but not **documents**. It must guess what files are relevant, call workspace_list_files to discover, and parse unstructured text to understand what was done.

### Proposed Event Flow (with DocumentRef)

```
STAGE 2': Planner Generates Structured Plan
  Planner LLM calls create_plan → returns StructuredPlanTask[]:
    { id, title, description, assignedRole,
      inputDocs: PlannedDocRef[],
      expectedOutputDocs: ExpectedDoc[],
      risks: TaskRisk[], acceptanceCriteria: string[] }
  ✅ FIX: Planner specifies exact document requirements per task

STAGE 3': approvePlan() → Create Tasks + CRDT Plan Doc
  For each task: create with typed inputDocs/expectedOutputDocs
  Persist to CRDT plan doc: {teamId}/{goalId}/plan
  Create document registry: {teamId}/{goalId}/documents
  Register user-provided docs (PRD, etc.) in registry
  ✅ FIX: Plan doc is live CRDT — agents read during execution

STAGE 5': dispatchTask() — Document-Centric Assembly
  │
  ├─ Resolve PlannedDocRef → DocumentRef:
  │   For each inputDoc with sourceTaskId:
  │     Look up upstream task's outputDocs in registry
  │     Create DocumentRef: { uri, name, hint }
  │   ✅ FIX: Agent gets URIs with access instructions, not bare paths
  │
  ├─ Build TaskWithContext:
  │   { id, description, assigned_role,
  │     context: {
  │       inputDocs: DocumentRef[],     ← "read these with resolver"
  │       contextDocs: DocumentRef[],   ← "background reading"
  │       expectedOutputDocs: ExpectedDoc[],
  │       risks: TaskRisk[],
  │       planUri: "crdt:plan",         ← live plan access
  │       registryUri: "crdt:documents" ← discover all docs
  │     } }
  │   ✅ FIX: Context is typed, structured, actionable
  │
  └─ Pass to WorkerPool with DocumentResolverRegistry

STAGE 6': WorkerPool.runTask() — Inject Resolver
  buildMessageWithContext uses DocumentRef:
    "## Input Documents (read before starting):"
    "1. competitor-analysis (workspace:research/competitors.md)"
    "   Hint: Sections 2-4 have pricing tiers"
    "2. pricing-decision (crdt:decisions/pricing)"
    ""
    "## Expected Output Documents:"
    "1. pricing-api — typescript at workspace:src/api/pricing.ts"
    "   Description: REST API with CRUD for pricing tiers"
  ✅ FIX: Agent knows EXACTLY what to read and what to produce
  
  Inject DocumentResolverRegistry as a tool (or via collab):
    Agent calls: resolve("workspace:research/competitors.md") → content
    ✅ FIX: Uniform access — agent doesn't care about storage backend

STAGE 8': complete_task — Document-Centric Output
  Schema: {
    summary: string,
    producedDocs: DocumentRef[],     ← { uri, name, description }
    decisions: string[],
    nextSteps: string[],
    risksEncountered: string[]
  }
  ✅ FIX: Output includes typed document references
  ✅ FIX: Decisions captured — downstream knows WHY

STAGE 10': enrichDependantContext — Document Flow
  For each dependant:
    dependant.inputDocs.push(...upstream.outputDocs)  ← full DocumentRef[]
    dependant.context.upstreamDecisions = upstream.decisions
  Register producedDocs in DocumentRegistry
  ✅ FIX: Downstream gets document refs, not summary strings
  ✅ FIX: Decisions flow — downstream knows upstream reasoning
```

### Gap Summary: What Changes at Each Stage

| Stage | Current | Proposed | Change |
|-------|---------|----------|--------|
| **2** (Plan) | Free text description + string expectedOutput | `inputDocs: PlannedDocRef[]`, `expectedOutputDocs: ExpectedDoc[]`, `risks[]` | Planner prompt + create_plan schema |
| **3** (Create) | Untyped `context: Record<string, any>` | Typed `inputDocs`, `outputDocs`, `contextDocs` on Task | Task.types.ts |
| **3** (CRDT) | persistTask writes basic fields | persistTask writes structured doc refs + create DocumentRegistry | CrdtTaskSync |
| **5** (Dispatch) | String concatenation of summaries | Resolve `PlannedDocRef` → `DocumentRef`, structured context | OrchestratorService |
| **6** (Message) | Wall of text with JSON dumps | Structured document list with URIs + hints | WorkerPool |
| **6** (Tools) | Agent has tools but doesn't know what to read | `DocumentResolverRegistry` injected, inputDocs pre-listed | WorkerPool |
| **8** (Complete) | `{ summary, deliverables?: string[] }` | `{ summary, producedDocs: DocumentRef[], decisions[] }` | complete_task schema |
| **10** (Enrich) | `upstreamOutputs.push({ summary })` | `dependant.inputDocs.push(...upstream.outputDocs)` | TaskStore |
| **Socket** | `state` event with status only | `state` event includes document registry changes | SocketServerV2 |

### Tool Changes Required

```typescript
// CURRENT complete_task schema
z.object({
  summary: z.string(),
  deliverables: z.array(z.string()).optional(),   // ["src/api/pricing.ts"]
  nextSteps: z.array(z.string()).optional(),
})

// PROPOSED complete_task schema
z.object({
  summary: z.string(),
  producedDocs: z.array(z.object({
    uri: z.string(),          // "workspace:src/api/pricing.ts"
    name: z.string(),         // "pricing-api"
    description: z.string().optional(),
  })).optional(),
  decisions: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
  risksEncountered: z.array(z.string()).optional(),
})

// CURRENT report_status schema — stays the same (no changes needed)
// It already has: status, summary, progress
```

### Agent System Prompt Changes

```markdown
## CURRENT task-lifecycle skill
- Call complete_task when done with summary and deliverables
- Call report_status to update progress

## PROPOSED task-lifecycle skill
- Read your inputDocs FIRST — they contain upstream work
  Your input documents are listed at the top of your task description
  Read them using their URI scheme:
    workspace:path → workspace_read_file(path)
    crdt:docName → collab({ action: "read", docName })

- Produce your expectedOutputDocs — the planner specified what you should create
  When done, call complete_task with producedDocs (URI + name for each)

- Browse all available documents: collab({ action: "read", docName: "documents" })
  This shows the document registry — every document in the plan across all stores
```

---

## Frontend: Document Lineage View

The plan viewer (F4) can show document flow between tasks:

```
PLAN: "Build Pricing Page"
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

T-001: Research Competitors        ✅ Done
  Input Docs:
    📋 PRD (external URL)
  Produced Docs:
    📄 research/competitors.md        [workspace]
    📊 research/pricing-matrix.csv    [workspace]
    📝 decisions/pricing              [crdt]
          │
          ▼ flows to T-002, T-003
          │
T-002: Design API                  ✅ Done
  Input Docs:
    📊 research/pricing-matrix.csv    (from T-001, workspace)
    📝 decisions/pricing              (from T-001, crdt)
    📋 PRD                            (user-provided, external)
  Produced Docs:
    📄 docs/api-spec.md               [workspace]
    💻 src/api/pricing.ts             [workspace]
    🧪 src/api/pricing.test.ts        [workspace]
    📝 decisions/api-design           [crdt]
          │
          ▼ flows to T-004
          │
T-003: Design Frontend             🔄 In Progress
  Input Docs:
    📄 research/competitors.md        (from T-001, workspace)
    📋 PRD                            (user-provided, external)
  Context Docs:
    📝 decisions/pricing              (from T-001, crdt — for reference)
  Expected Output Docs:
    💻 src/components/PricingPage.tsx  [workspace]
    🎨 src/styles/pricing.css         [workspace]
          │
T-004: Integration Tests           ⏳ Waiting
  Needs from T-002:
    💻 src/api/pricing.ts             (workspace:src/api/pricing.ts)
    📝 decisions/api-design           (crdt:decisions/api-design)
  Needs from T-003:
    💻 src/components/PricingPage.tsx  (workspace:src/components/PricingPage.tsx)
  Risks:
    ⚠️  T-003 might change component API
    ⚠️  Need mock data for pricing tiers

DOCUMENT REGISTRY: 12 docs total
  [workspace] 8 files  │  [crdt] 3 docs  │  [external] 1 URL
```

### Frontend Interactions
- Click any document → opens preview (workspace files inline, CRDT docs via collab, external opens link)
- Click document flow arrow → shows which task produced it and who consumes it
- Filter by store: show only workspace / crdt / external docs
- Document registry sidebar: browse all documents in the plan

---

## Planner Prompt Changes

The planner needs to generate structured tasks with document-centric I/O. The `create_plan` tool schema changes:

```typescript
// Current PlanTask (loose)
interface PlanTask {
  id: string;
  title: string;
  description: string;
  assignedRole: string;
  priority: number;
  dependencies: string[];
  expectedOutput: string;  // free text
}

// New StructuredPlanTask
interface StructuredPlanTask {
  id: string;
  title: string;
  description: string;       // Detailed: what to do, approach, constraints
  assignedRole: string;
  priority: TaskPriority;
  complexity: 'low' | 'medium' | 'high';
  type: 'work' | 'review' | 'collaboration';

  // Document-centric dependencies
  dependencies: TaskDependency[];  // NOT just IDs — specify which DOCS are needed

  // Documents this task needs as input (planner specifies at plan time)
  inputDocs: PlannedDocRef[];

  // Documents this task is expected to produce
  expectedOutputDocs: ExpectedDoc[];

  // Reference/context documents (optional reading)
  contextDocs: PlannedDocRef[];

  risks: TaskRisk[];
  acceptanceCriteria: string[];
  requiresReview: boolean;
}

// Lightweight doc ref the planner creates at plan time
// (resolved to full DocumentRef at dispatch — just add uri)
interface PlannedDocRef {
  name: string;                // "competitor-analysis"
  description: string;         // What this doc is
  sourceTaskId?: string;       // Which task produces it (for upstream docs)
  suggestedUri?: string;       // "workspace:research/competitors.md" (hint)
  required: boolean;           // Must this doc exist before task starts?
  hint?: string;               // "Focus on sections about pricing"
}

interface TaskDependency {
  taskId: string;
  what: string;               // "pricing data from competitor analysis"
  requiredDocs: string[];     // Document names needed from this task
}
```

### Example: What the Planner Generates

```json
{
  "planId": "plan-001",
  "goal": "Build a pricing comparison page",
  "tasks": [
    {
      "id": "T-001",
      "title": "Research Competitors",
      "description": "Analyze top 5 competitors' pricing models...",
      "assignedRole": "researcher",
      "dependencies": [],
      "inputDocs": [
        { "name": "PRD", "description": "Product requirements",
          "suggestedUri": "https://...", "required": true }
      ],
      "expectedOutputDocs": [
        { "name": "competitor-analysis", "type": "research",
          "format": "markdown", "suggestedUri": "workspace:research/competitors.md",
          "description": "Detailed analysis of 5 competitors' pricing" },
        { "name": "pricing-decision", "type": "decision",
          "description": "Recommended pricing model based on research" }
      ],
      "contextDocs": []
    },
    {
      "id": "T-002",
      "title": "Build Pricing API",
      "description": "Implement REST API endpoints for pricing...",
      "assignedRole": "backend-dev",
      "dependencies": [
        { "taskId": "T-001", "what": "competitor pricing data",
          "requiredDocs": ["competitor-analysis", "pricing-decision"] }
      ],
      "inputDocs": [
        { "name": "competitor-analysis", "sourceTaskId": "T-001",
          "required": true, "hint": "Use pricing tiers from section 3" },
        { "name": "pricing-decision", "sourceTaskId": "T-001",
          "required": true }
      ],
      "expectedOutputDocs": [
        { "name": "pricing-api", "type": "code", "format": "typescript",
          "suggestedUri": "workspace:src/api/pricing.ts",
          "description": "REST API with CRUD for pricing tiers" },
        { "name": "pricing-tests", "type": "test", "format": "typescript",
          "suggestedUri": "workspace:src/api/pricing.test.ts",
          "description": "Unit tests with edge cases" }
      ],
      "contextDocs": [
        { "name": "PRD", "sourceTaskId": null,
          "required": false, "hint": "Reference for business rules" }
      ]
    }
  ]
}
```

### Resolution Flow: PlannedDocRef → DocumentRef

When a task is dispatched, `PlannedDocRef` (planner's intent) is resolved to `DocumentRef` (concrete URI):

```typescript
// OrchestratorService.dispatchTask()
function resolveInputDocs(
  task: StructuredTask,
  registry: DocumentRegistry
): DocumentRef[] {
  return task.inputDocs.map(planned => {
    // If sourceTaskId specified, look up the upstream task's produced doc
    if (planned.sourceTaskId) {
      const upstreamDocs = registry.byTask.get(planned.sourceTaskId) || [];
      const meta = upstreamDocs
        .map(uri => registry.documents.get(uri))
        .find(m => m && planned.name === docNameFromUri(m.uri));

      if (meta) {
        return { uri: meta.uri, name: planned.name, hint: planned.hint };
      }
    }
    // Fallback: use suggestedUri if available
    if (planned.suggestedUri) {
      return { uri: planned.suggestedUri, name: planned.name, hint: planned.hint };
    }
    // External or unresolved
    throw new Error(`Cannot resolve doc: ${planned.name}`);
  });
}
```

---

## Implementation Plan

### Feature Gate: `FF_DOCUMENT_CONTEXT`

Uses the existing feature flag system in [featureFlags.ts](../../packages/backend/config/featureFlags.ts). Each phase adds a flag. Old code path preserved behind `!flag`.

```typescript
// packages/backend/config/featureFlags.ts — ADD:
export interface FeatureFlags {
  // ...existing flags...
  enableDocumentContext: boolean;       // Phase 1: DocumentRef types + complete_task schema
  enableDocumentRegistry: boolean;      // Phase 2: CRDT registry + resolver
  enableDocumentReview: boolean;        // Phase 3: Review-before-publish
}

// packages/backend/config/featureFlags.ts — ADD to FF_ENV_MAP:
FF_ENABLE_DOCUMENT_CONTEXT: "enableDocumentContext",
FF_ENABLE_DOCUMENT_REGISTRY: "enableDocumentRegistry",
FF_ENABLE_DOCUMENT_REVIEW: "enableDocumentReview",
```

**Kill switch pattern** — every changed method checks the flag:
```typescript
// Example: TaskStore.enrichDependantContext()
private enrichDependantContext(dependant: Task, upstream: Task): void {
  if (this.flags.enableDocumentContext) {
    this.enrichDependantContextV2(dependant, upstream); // New: DocumentRef flow
  } else {
    this.enrichDependantContextV1(dependant, upstream); // Old: summary strings
  }
}
```

---

### Phase 1: Types + complete_task + enrichment (3-4 days)

**Goal:** Agents produce and receive `DocumentRef[]` instead of bare strings. Zero planner changes. Zero CRDT changes. Old agents still work.

**Flag:** `FF_ENABLE_DOCUMENT_CONTEXT=true`

#### Step 1.1: Add DocumentRef types

**File:** `packages/agent-manager/src/memory/types/DocumentRef.ts` (NEW)

```typescript
/**
 * Value Object — the universal exchange type between tasks.
 * URI scheme convention:
 *   workspace:src/api/pricing.ts
 *   crdt:decisions/pricing
 *   memory:researcher/lessons
 *   https://api.example.com/docs
 *   data:text/plain;content
 */
export interface DocumentRef {
  uri: string;
  name: string;
  description?: string;
  hint?: string;
}

export interface DocumentMeta {
  uri: string;
  type?: string;       // "code" | "document" | "decision" | "research" | "test" | "config"
  format?: string;     // "typescript" | "markdown" | "json"
  size?: number;
  hash?: string;
  summary?: string;
  producedBy?: string;
  producedByRole?: string;
  createdAt?: number;
  updatedAt?: number;
}

export interface ExpectedDoc {
  name: string;
  type?: string;
  format?: string;
  suggestedUri?: string;
  description: string;
}

export interface TaskRisk {
  description: string;
  severity: 'low' | 'medium' | 'high';
  mitigation: string;
}
```

**File:** `packages/agent-manager/src/memory/types/index.ts` — export new types

#### Step 1.2: Extend Task type (backward compatible)

**File:** [packages/agent-manager/src/memory/types/Task.types.ts](../../packages/agent-manager/src/memory/types/Task.types.ts)

```typescript
// ADD these optional fields to Task interface (no breaking changes):
export interface Task {
  // ...existing fields...

  // Document-centric I/O (Phase 1 — optional, populated when FF_ENABLE_DOCUMENT_CONTEXT)
  inputDocs?: DocumentRef[];
  contextDocs?: DocumentRef[];
  outputDocs?: DocumentRef[];
  expectedOutputDocs?: ExpectedDoc[];
  risks?: TaskRisk[];
  acceptanceCriteria?: string[];
}
```

**No existing field removed.** `context?: Record<string, any>` stays. New fields are additive.

#### Step 1.3: Upgrade complete_task schema

**File:** [packages/agent-manager/src/agent/internal/tools/completeTaskTool.ts](../../packages/agent-manager/src/agent/internal/tools/completeTaskTool.ts)

```typescript
// CURRENT:
export const CompleteTaskSchema = z.object({
  summary: z.string(),
  deliverables: z.array(z.string()).optional(),
  nextSteps: z.array(z.string()).optional(),
});

// NEW (backward compatible — all new fields optional):
export const CompleteTaskSchema = z.object({
  summary: z.string().describe("Summary of what was accomplished"),
  deliverables: z.array(z.string()).optional().describe("List of file paths produced"),
  nextSteps: z.array(z.string()).optional().describe("Recommended next steps"),
  // NEW fields (Phase 1):
  producedDocs: z.array(z.object({
    uri: z.string().describe("Document URI: workspace:path, crdt:docName, https://url"),
    name: z.string().describe("Human-readable name"),
    description: z.string().optional().describe("What this document contains"),
  })).optional().describe("Documents produced by this task (preferred over deliverables)"),
  decisions: z.array(z.string()).optional().describe("Key decisions made during this task"),
  risksEncountered: z.array(z.string()).optional().describe("Risks that materialized"),
});
```

**Backward compatible:** `deliverables` still works. `producedDocs` is preferred but optional. Agent can use either.

#### Step 1.4: Upgrade onWorkerDone to capture producedDocs

**File:** [packages/agent-manager/src/orchestrator/OrchestratorService.ts](../../packages/agent-manager/src/orchestrator/OrchestratorService.ts) — `onWorkerDone()` (~L822)

```typescript
// ADD to onWorkerDone — extract producedDocs from output:
this.taskStore.completeTask(data.taskId, {
  summary: data.summary,
  deliverables: data.deliverables,
  nextSteps: data.nextSteps,
  // NEW:
  producedDocs: data.producedDocs || [],
  decisions: data.decisions || [],
  risksEncountered: data.risksEncountered || [],
  completedBy: "agent",
  timestamp: data.timestamp,
});

// ALSO: store producedDocs on Task.outputDocs
if (this.flags.enableDocumentContext && data.producedDocs?.length) {
  const task = this.taskStore.get(data.taskId);
  if (task) {
    task.outputDocs = data.producedDocs;
  }
}
```

#### Step 1.5: Upgrade enrichDependantContext to pass DocumentRef[]

**File:** [packages/agent-manager/src/orchestrator/TaskStore.ts](../../packages/agent-manager/src/orchestrator/TaskStore.ts) — `enrichDependantContext()` (~L328)

```typescript
private enrichDependantContext(dependant: Task, upstream: Task): void {
  const ctx = (typeof dependant.context === "object" ? dependant.context : {}) as Record<string, any>;

  // ─── EXISTING (V1) — keep for backward compat ───
  if (!Array.isArray(ctx.upstreamOutputs)) ctx.upstreamOutputs = [];
  if (!Array.isArray(ctx.upstreamArtifacts)) ctx.upstreamArtifacts = [];
  if (!Array.isArray(ctx.upstreamNotes)) ctx.upstreamNotes = [];

  if (upstream.output) {
    ctx.upstreamOutputs.push({
      taskId: upstream.id, role: upstream.assigned_role,
      status: upstream.status, summary: upstream.output.summary || "",
    });
    if (Array.isArray(upstream.output.deliverables)) {
      ctx.upstreamArtifacts.push(...upstream.output.deliverables);
    }
    if (Array.isArray(upstream.output.nextSteps)) {
      for (const step of upstream.output.nextSteps) {
        ctx.upstreamNotes.push(`From ${upstream.assigned_role}: ${step}`);
      }
    }
  }
  dependant.context = ctx;

  // ─── NEW (V2) — DocumentRef flow (Phase 1) ───
  // Push upstream outputDocs into dependant's inputDocs
  if (upstream.outputDocs?.length) {
    if (!dependant.inputDocs) dependant.inputDocs = [];
    dependant.inputDocs.push(...upstream.outputDocs);
  }
  // Also capture upstream decisions
  if (upstream.output?.decisions?.length) {
    if (!Array.isArray(ctx.upstreamDecisions)) ctx.upstreamDecisions = [];
    ctx.upstreamDecisions.push(...upstream.output.decisions.map(
      (d: string) => `[${upstream.assigned_role}] ${d}`
    ));
  }
}
```

#### Step 1.6: Upgrade dispatchTask to use inputDocs

**File:** [packages/agent-manager/src/orchestrator/OrchestratorService.ts](../../packages/agent-manager/src/orchestrator/OrchestratorService.ts) — `dispatchTask()` (~L919)

```typescript
// AFTER existing enrichedDescription assembly, ADD (gated):
if (this.flags.enableDocumentContext && task.inputDocs?.length) {
  enrichedDescription += `\n\n## Input Documents (read these before starting)`;
  for (const doc of task.inputDocs) {
    const scheme = doc.uri.split(':')[0];
    const accessHint = scheme === 'workspace' ? 'workspace_read_file'
      : scheme === 'crdt' ? 'collab read'
      : scheme === 'https' ? 'fetch URL'
      : 'read';
    enrichedDescription += `\n- **${doc.name}**: \`${doc.uri}\` (${accessHint})`;
    if (doc.hint) enrichedDescription += `\n  _Hint: ${doc.hint}_`;
    if (doc.description) enrichedDescription += `\n  ${doc.description}`;
  }
}

if (this.flags.enableDocumentContext && task.expectedOutputDocs?.length) {
  enrichedDescription += `\n\n## Expected Output Documents`;
  for (const doc of task.expectedOutputDocs) {
    enrichedDescription += `\n- **${doc.name}** (${doc.type || 'document'}, ${doc.format || 'any'})`;
    if (doc.suggestedUri) enrichedDescription += ` → \`${doc.suggestedUri}\``;
    enrichedDescription += `\n  ${doc.description}`;
  }
  enrichedDescription += `\n\nWhen done, call complete_task with producedDocs listing each document's URI and name.`;
}

if (this.flags.enableDocumentContext && task.risks?.length) {
  enrichedDescription += `\n\n## Known Risks`;
  for (const risk of task.risks) {
    enrichedDescription += `\n- ⚠️ **${risk.description}** (${risk.severity})`;
    enrichedDescription += `\n  Mitigation: ${risk.mitigation}`;
  }
}
```

#### Step 1.7: Fix double-context in buildMessageWithContext

**File:** [packages/agent-manager/src/services/WorkerPool.ts](../../packages/agent-manager/src/services/WorkerPool.ts) — `buildMessageWithContext()` (~L533)

```typescript
private buildMessageWithContext(task: TaskWithContext): string {
  let msg = task.description;

  // V1: Only append previousOutputs if the description doesn't already contain upstream work
  // (dispatchTask already injects "## Completed Upstream Work")
  if (task.context.previousOutputs.length > 0 &&
      !msg.includes("## Completed Upstream Work") &&
      !msg.includes("## Input Documents")) {
    msg += "\n\n## Context from previous tasks:\n";
    for (const prev of task.context.previousOutputs) {
      msg += `\n### Task ${prev.taskId}:\n`;
      msg += JSON.stringify(prev.output, null, 2) + "\n";
    }
  }

  // V1: Only append artifacts if not already injected
  if (task.context.artifacts.length > 0 && !msg.includes("## Input Documents")) {
    msg += `\n\n## Deliverables from Upstream Tasks\n`;
    msg += task.context.artifacts.join("\n");
  }

  return msg;
}
```

#### Phase 1 — Files Changed

| File | Change | Risk |
|---|---|---|
| `memory/types/DocumentRef.ts` | **NEW** — types only | None |
| `memory/types/Task.types.ts` | Add optional fields | None (additive) |
| `memory/types/index.ts` | Export new types | None |
| `tools/completeTaskTool.ts` | Add optional schema fields | None (backward compat) |
| `orchestrator/OrchestratorService.ts` | `onWorkerDone` + `dispatchTask` gated additions | Gated by flag |
| `orchestrator/TaskStore.ts` | `enrichDependantContext` adds V2 block | Gated by flag |
| `services/WorkerPool.ts` | Fix double-context in `buildMessageWithContext` | Low risk (guard check) |
| `config/featureFlags.ts` | Add `enableDocumentContext` flag | None |

**Test:** Run existing plan → verify V1 path unchanged. Set `FF_ENABLE_DOCUMENT_CONTEXT=true` → verify agents see "Input Documents" section and can call `complete_task` with `producedDocs`.

---

### Phase 2: Planner Generates Structured Tasks + Document Registry (3-4 days)

**Goal:** Planner produces `inputDocs`, `expectedOutputDocs`, `risks` per task. Document registry tracks all docs in a goal.

**Flag:** `FF_ENABLE_DOCUMENT_REGISTRY=true` (requires Phase 1 flag)

#### Step 2.1: Upgrade submit_plan schema

**File:** [packages/agent-manager/src/orchestrator/tools/submitPlan.ts](../../packages/agent-manager/src/orchestrator/tools/submitPlan.ts)

```typescript
// ADD to task schema inside SubmitPlanSchema (all new fields optional):
const PlannedDocRefSchema = z.object({
  name: z.string().describe("Document name: 'competitor-analysis', 'api-spec'"),
  description: z.string().optional().describe("What this document is"),
  sourceTaskId: z.string().optional().describe("Which task produces it"),
  suggestedUri: z.string().optional().describe("Suggested URI: workspace:path, crdt:docName"),
  required: z.boolean().default(true),
  hint: z.string().optional().describe("Reading hint: 'Focus on section 3'"),
});

const ExpectedDocSchema = z.object({
  name: z.string(),
  type: z.string().optional().describe("code, document, decision, research, test, config"),
  format: z.string().optional().describe("typescript, markdown, json"),
  suggestedUri: z.string().optional(),
  description: z.string(),
});

const TaskRiskSchema = z.object({
  description: z.string(),
  severity: z.enum(["low", "medium", "high"]).default("medium"),
  mitigation: z.string(),
});

// ADD to the task object inside SubmitPlanSchema.tasks[]:
inputDocs: z.array(PlannedDocRefSchema).optional()
  .describe("Documents this task needs as input"),
expectedOutputDocs: z.array(ExpectedDocSchema).optional()
  .describe("Documents this task should produce"),
contextDocs: z.array(PlannedDocRefSchema).optional()
  .describe("Background/reference documents (optional reading)"),
risks: z.array(TaskRiskSchema).optional()
  .describe("Known risks for this task"),
acceptanceCriteria: z.array(z.string()).optional()
  .describe("How to verify this task is done correctly"),
```

#### Step 2.2: approvePlan stores structured fields on Task

**File:** [packages/agent-manager/src/orchestrator/OrchestratorService.ts](../../packages/agent-manager/src/orchestrator/OrchestratorService.ts) — `approvePlan()` (~L243)

```typescript
// INSIDE the for-loop creating tasks, ADD:
if (this.flags.enableDocumentRegistry) {
  const planTask = task as any;
  newTask.inputDocs = planTask.inputDocs?.map((d: any) => ({
    uri: d.suggestedUri || '',
    name: d.name,
    description: d.description,
    hint: d.hint,
  })) || [];
  newTask.expectedOutputDocs = planTask.expectedOutputDocs || [];
  newTask.contextDocs = planTask.contextDocs?.map((d: any) => ({
    uri: d.suggestedUri || '',
    name: d.name,
    description: d.description,
    hint: d.hint,
  })) || [];
  newTask.risks = planTask.risks || [];
  newTask.acceptanceCriteria = planTask.acceptanceCriteria || [];
}
```

#### Step 2.3: DocumentResolverRegistry

**File:** `packages/agent-manager/src/document/DocumentResolverRegistry.ts` (NEW)

```typescript
import type { DocumentRef } from '../memory/types/DocumentRef.js';

export interface DocumentResolver {
  readonly scheme: string;
  read(ref: DocumentRef): Promise<string>;
  exists?(ref: DocumentRef): Promise<boolean>;
}

export class DocumentResolverRegistry {
  private resolvers = new Map<string, DocumentResolver>();

  register(resolver: DocumentResolver): void {
    this.resolvers.set(resolver.scheme, resolver);
  }

  getScheme(uri: string): string {
    const colonIndex = uri.indexOf(':');
    return colonIndex > 0 ? uri.slice(0, colonIndex) : 'workspace';
  }

  async read(ref: DocumentRef): Promise<string> {
    const scheme = this.getScheme(ref.uri);
    const resolver = this.resolvers.get(scheme);
    if (!resolver) throw new Error(`No resolver for scheme: ${scheme}`);
    return resolver.read(ref);
  }

  has(scheme: string): boolean {
    return this.resolvers.has(scheme);
  }
}
```

**Concrete resolvers** (in same directory):
- `WorkspaceResolver.ts` — calls `AgentWorkspace.readFile(path)` 
- `CrdtResolver.ts` — calls `CollaborationSpace.read(docName)`
- `HttpResolver.ts` — calls `fetch(uri).then(r => r.text())`
- `InlineResolver.ts` — parses `data:` URI

#### Step 2.4: Document Registry (CRDT doc)

**File:** `packages/collaboration/src/L2/collaboration/DocumentRegistry.ts` (NEW)

```typescript
import type { DocumentMeta } from '@ping/agent-manager/memory/types/DocumentRef.js';

export class DocumentRegistryCrdt {
  constructor(private space: CollaborationSpace) {}

  async register(meta: DocumentMeta): Promise<void> {
    const doc = await this.space.openDoc('documents');
    const map = doc.getMap('documents');
    map.set(meta.uri, meta);
    // Update indexes
    const byTask = doc.getMap('byTask');
    if (meta.producedBy) {
      const existing = (byTask.get(meta.producedBy) as string[]) || [];
      byTask.set(meta.producedBy, [...existing, meta.uri]);
    }
  }

  async getAll(): Promise<Map<string, DocumentMeta>> {
    const doc = await this.space.openDoc('documents');
    return doc.getMap('documents') as any;
  }

  async getByTask(taskId: string): Promise<string[]> {
    const doc = await this.space.openDoc('documents');
    const byTask = doc.getMap('byTask');
    return (byTask.get(taskId) as string[]) || [];
  }
}
```

#### Step 2.5: Register producedDocs on task completion

**File:** [packages/agent-manager/src/orchestrator/OrchestratorService.ts](../../packages/agent-manager/src/orchestrator/OrchestratorService.ts) — `onWorkerDone()` (~L897)

```typescript
// AFTER CRDT syncStatus, ADD:
if (this.flags.enableDocumentRegistry && data.producedDocs?.length) {
  const registry = this.getDocumentRegistry(); // lazy-init
  for (const doc of data.producedDocs) {
    await registry.register({
      uri: doc.uri,
      type: this.inferDocType(doc.uri),
      producedBy: data.taskId,
      producedByRole: data.role,
      createdAt: Date.now(),
      summary: doc.description,
    });
  }
}
```

#### Step 2.6: Auto-register deliverables as DocumentRefs (fallback)

When agent uses old `deliverables: string[]` instead of `producedDocs`, auto-convert:

```typescript
// In onWorkerDone, AFTER the producedDocs block:
if (this.flags.enableDocumentContext && !data.producedDocs?.length && data.deliverables?.length) {
  // Auto-convert old-style deliverables to DocumentRefs
  const autoRefs: DocumentRef[] = data.deliverables.map(d => ({
    uri: d.startsWith('http') ? d : `workspace:${d}`,
    name: d.split('/').pop() || d,
  }));
  const task = this.taskStore.get(data.taskId);
  if (task) task.outputDocs = autoRefs;
}
```

#### Phase 2 — Files Changed

| File | Change | Risk |
|---|---|---|
| `tools/submitPlan.ts` | Add optional schema fields | None (optional) |
| `orchestrator/OrchestratorService.ts` | `approvePlan` + `onWorkerDone` additions | Gated |
| `document/DocumentResolverRegistry.ts` | **NEW** — resolver framework | None (new code) |
| `document/resolvers/*.ts` | **NEW** — 4 resolvers | None (new code) |
| `collaboration/DocumentRegistry.ts` | **NEW** — CRDT registry | None (new code) |
| `config/featureFlags.ts` | Add `enableDocumentRegistry` flag | None |

**Test:** Submit plan with `inputDocs` and `expectedOutputDocs`. Verify tasks get structured fields. Complete task with `producedDocs`. Verify downstream task sees `inputDocs[]` populated from upstream.

---

### Phase 3: Agent Message Redesign + Resolver Injection (2-3 days)

**Goal:** Agents get a clean structured message instead of concatenated wall of text. DocumentResolverRegistry injected as a tool or via collab.

**Flag:** Same flags — this is the payoff phase that uses Phase 1+2 infrastructure.

#### Step 3.1: Redesign buildMessageWithContext

**File:** [packages/agent-manager/src/services/WorkerPool.ts](../../packages/agent-manager/src/services/WorkerPool.ts)

```typescript
private buildMessageWithContext(task: TaskWithContext): string {
  // V2: document-centric message
  if (task.inputDocs?.length || task.expectedOutputDocs?.length) {
    return this.buildDocumentCentricMessage(task);
  }
  // V1: legacy string concatenation (existing code)
  return this.buildLegacyMessage(task);
}

private buildDocumentCentricMessage(task: TaskWithContext): string {
  let msg = task.description;

  // Input documents — what to read
  if (task.inputDocs?.length) {
    msg += `\n\n## Input Documents\nRead these before starting your work:\n`;
    for (const doc of task.inputDocs) {
      const scheme = doc.uri.split(':')[0];
      const path = doc.uri.slice(scheme.length + 1);
      msg += `\n### ${doc.name}`;
      msg += `\n- **URI:** \`${doc.uri}\``;
      msg += `\n- **Read via:** ${this.accessInstruction(scheme, path)}`;
      if (doc.hint) msg += `\n- **Hint:** ${doc.hint}`;
      if (doc.description) msg += `\n- ${doc.description}`;
    }
  }

  // Expected outputs — what to produce
  if (task.expectedOutputDocs?.length) {
    msg += `\n\n## Expected Output Documents\nProduce these and report via complete_task:\n`;
    for (const doc of task.expectedOutputDocs) {
      msg += `\n- **${doc.name}** (${doc.type || 'document'}, ${doc.format || 'any format'})`;
      if (doc.suggestedUri) msg += ` → \`${doc.suggestedUri}\``;
      msg += `\n  ${doc.description}`;
    }
    msg += `\n\nCall \`complete_task({ producedDocs: [{ uri: "workspace:path", name: "..." }], summary: "..." })\` when done.`;
  }

  // Upstream decisions
  if (task.context?.upstreamDecisions?.length) {
    msg += `\n\n## Upstream Decisions\n`;
    for (const d of task.context.upstreamDecisions) msg += `\n- ${d}`;
  }

  // Risks
  if (task.risks?.length) {
    msg += `\n\n## Known Risks\n`;
    for (const r of task.risks) {
      msg += `\n- ⚠️ **${r.description}** (${r.severity}) — Mitigation: ${r.mitigation}`;
    }
  }

  return msg;
}

private accessInstruction(scheme: string, path: string): string {
  switch (scheme) {
    case 'workspace': return `\`workspace_read_file({ path: "${path}" })\``;
    case 'crdt': return `\`collab({ action: "read", docName: "${path}" })\``;
    case 'https': case 'http': return `Fetch from URL`;
    default: return `Read using ${scheme} resolver`;
  }
}

private buildLegacyMessage(task: TaskWithContext): string {
  // ... existing buildMessageWithContext code (V1) ...
}
```

#### Step 3.2: Update request_task to use DocumentRef

**File:** [packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts](../../packages/agent-manager/src/agent/internal/tools/requestTaskTool.ts)

```typescript
// ADD to RequestTaskSchema.context:
contextDocs: z.array(z.object({
  uri: z.string(),
  name: z.string(),
  description: z.string().optional(),
  hint: z.string().optional(),
})).optional().describe("Documents relevant to this task (workspace:path, crdt:docName)"),

// In tool execution, when creating the new task:
if (input.context?.contextDocs) {
  newTask.inputDocs = input.context.contextDocs;
}
```

#### Phase 3 — Files Changed

| File | Change | Risk |
|---|---|---|
| `services/WorkerPool.ts` | New `buildDocumentCentricMessage` + refactored dispatch | Gated by inputDocs presence |
| `tools/requestTaskTool.ts` | Add `contextDocs` schema field | None (optional) |

---

### Phase 4: CRDT Plan Doc + CrdtTaskSync Upgrade (2-3 days)

**Goal:** Plan doc and task docs in CRDT contain full structured metadata. Agents read live plan via collab.

**Flag:** `FF_ENABLE_DOCUMENT_REGISTRY=true`

#### Step 4.1: Upgrade CrdtTaskSync.persistTask

**File:** [packages/collaboration/src/L2/collaboration/CrdtTaskSync.ts](../../packages/collaboration/src/L2/collaboration/CrdtTaskSync.ts)

```typescript
// ADD to persistTask(), AFTER existing fields:
if (task.inputDocs) map.set("inputDocs", task.inputDocs);
if (task.outputDocs) map.set("outputDocs", task.outputDocs);
if (task.expectedOutputDocs) map.set("expectedOutputDocs", task.expectedOutputDocs);
if (task.risks) map.set("risks", task.risks);
if (task.acceptanceCriteria) map.set("acceptanceCriteria", task.acceptanceCriteria);
```

#### Step 4.2: Upgrade getCrdtRefs to return DocumentRefs

```typescript
// EXTEND getCrdtRefs() return value:
getCrdtRefs(taskId: string, task: TaskLike): Record<string, any> {
  const base = {
    task: `${taskId}/task`,
    plan: "plan",
    goal: "goal",
    dependencies: Array.from(task.prerequisites.keys()).map(d => `${d}/task`),
    dependants: (task.dependants || []).map(d => `${d}/task`),
    relatedTasks: (task.context as any)?.relatedTasks || [],
  };

  // V2: include inputDocs/outputDocs if available
  if (task.inputDocs) base.inputDocs = task.inputDocs;
  if (task.outputDocs) base.outputDocs = task.outputDocs;
  if (task.expectedOutputDocs) base.expectedOutputDocs = task.expectedOutputDocs;

  return base;
}
```

#### Step 4.3: Persist document registry on plan approval

```typescript
// In approvePlan(), AFTER task creation loop:
if (this.flags.enableDocumentRegistry) {
  // Register user-provided docs from goal context
  const registry = this.getDocumentRegistry();
  for (const task of planToApprove.tasks) {
    for (const doc of (task as any).inputDocs || []) {
      if (doc.suggestedUri && !doc.sourceTaskId) {
        // User-provided or external doc — register immediately
        await registry.register({
          uri: doc.suggestedUri,
          summary: doc.description,
          createdAt: Date.now(),
        });
      }
    }
  }
}
```

#### Phase 4 — Files Changed

| File | Change | Risk |
|---|---|---|
| `collaboration/CrdtTaskSync.ts` | Persist new fields + extend getCrdtRefs | Low (additive) |
| `orchestrator/OrchestratorService.ts` | Register docs on plan approval | Gated |

---

### Phase 5: Review-Before-Publish + Frontend (1-2 weeks)

**Goal:** CRDT review doc per task. Human approval in frontend. Auto-approve for low-risk.

**Flag:** `FF_ENABLE_DOCUMENT_REVIEW=true`

This phase depends on frontend work and the [crdt-undo-rollback](../crdt-undo-rollback/feature_architecture.md) feature. Defer to separate implementation planning.

#### Key changes:
- CRDT review doc: `{teamId}/{goalId}/review/{taskId}`
- Review step between `onWorkerDone` and `taskStore.completeTask`
- Frontend review UI: document previews via resolver, approve/reject buttons
- Auto-approve config per team/role/task-type
- Frontend document lineage view in plan viewer (F4)

---

### Summary: Phase → Flag → Files

```
Phase 1 (3-4 days)                    Phase 2 (3-4 days)
FF_ENABLE_DOCUMENT_CONTEXT            FF_ENABLE_DOCUMENT_REGISTRY
├─ DocumentRef.ts (NEW)               ├─ submitPlan.ts (schema)
├─ Task.types.ts (additive)           ├─ OrchestratorService.ts (approvePlan)
├─ completeTaskTool.ts (schema)       ├─ DocumentResolverRegistry.ts (NEW)
├─ OrchestratorService.ts (gated)     ├─ resolvers/ (NEW: 4 files)
├─ TaskStore.ts (V2 block)            ├─ DocumentRegistry.ts (NEW)
├─ WorkerPool.ts (fix double)         └─ OrchestratorService.ts (registry)
└─ featureFlags.ts (flag)

Phase 3 (2-3 days)                    Phase 4 (2-3 days)
(no new flag — uses P1+P2)            FF_ENABLE_DOCUMENT_REGISTRY
├─ WorkerPool.ts (redesign)           ├─ CrdtTaskSync.ts (persist)
└─ requestTaskTool.ts (contextDocs)   └─ OrchestratorService.ts (registry)

Phase 5 (1-2 weeks)                   TOTAL: ~3-4 weeks
FF_ENABLE_DOCUMENT_REVIEW             16 files changed, 6 new files
├─ Review CRDT doc (NEW)              All behind feature flags
├─ Frontend review UI                 Old code path 100% preserved
└─ crdt-undo-rollback integration
```

### Rollback Strategy

Each phase is independently reversible by setting its flag to `false`:

| Flag | Set to `false` | Effect |
|---|---|---|
| `FF_ENABLE_DOCUMENT_CONTEXT` | Agents use V1 `deliverables: string[]` path, no inputDocs injection | Zero data loss — V1 enrichment continues |
| `FF_ENABLE_DOCUMENT_REGISTRY` | Planner uses old schema, no document registry | New schema fields ignored (optional) |
| `FF_ENABLE_DOCUMENT_REVIEW` | Tasks auto-complete without review step | No review overhead |

**Kill switch:** Set ALL flags to `false` → system behaves exactly as current production. No data migration needed. No schema breaking changes.

---

## CRDT Fixes & Improvements (Bundled)

The CRDT audit (April 22, 2026) found **6 critical open issues**, **2 partial fixes**, and **5 designed-but-unbuilt features**. These are bundled into the implementation phases above since they touch the same files and share the same infrastructure.

### Open Issues — Fix During Implementation

#### FIX-1: `agent-statuses` Ghost Document (UU-1) — Phase 1

The `agent-statuses` CRDT doc is defined in `CollaborationSpace`, referenced in agent prompts, listed in `KNOWN_CRDT_DOCS` — but **never written to** by any backend code.

**Fix:** Add `updateAgentStatus()` to `ICrdtTaskSync` (DIP — WorkerPool doesn't touch Y.Map directly).

**File:** `ICrdtTaskSync.ts` — add method:
```typescript
updateAgentStatus(role: string, status: 'busy' | 'idle', taskId?: string): Promise<void>;
```

**File:** `CrdtTaskSync.ts` — implement:
```typescript
async updateAgentStatus(role: string, status: 'busy' | 'idle', taskId?: string): Promise<void> {
  const doc = await this._space.openDoc('agent-statuses');
  const statuses = doc.getMap('agent-statuses');
  statuses.set(role, { status, task: taskId, since: Date.now() });
}
```

**File:** `WorkerPool.ts` — call it:
```typescript
// BEFORE execute: 
await this.crdtTaskSync?.updateAgentStatus(roleKey, 'busy', taskId);
// AFTER execute (finally block):
await this.crdtTaskSync?.updateAgentStatus(roleKey, 'idle');
```

**Effort:** 30 min. Clean DIP — WorkerPool never sees Y.Map.

---

#### FIX-2: `crdtTaskSync: any` Type Safety (AP-1) — Phase 1

6 files use `crdtTaskSync` as bare `any`. Root cause: no shared interface exported from `@ping/collaboration`.

**File:** `packages/collaboration/src/L2/collaboration/types/ICrdtTaskSync.ts` (NEW)

```typescript
import type { Task } from '@ping/agent-manager';

export interface ICrdtTaskSync {
  persistTask(task: Task): Promise<void>;
  syncStatus(taskId: string, status: string, output?: any): Promise<void>;
  getCrdtRefs(taskId: string, task: Task): Record<string, any>;
  updateIndex(tasks: Task[]): Promise<void>;
  initCollabDocs(taskId: string, config: any): Promise<void>;
  syncPlanStatus(status: string, metadata?: any): Promise<void>;
  readonly space: CollaborationSpace;
}
```

**Files to update (replace `any` with `ICrdtTaskSync`):**

| File | Location | Change |
|------|----------|--------|
| `WorkerPool.ts` | Constructor param L124 | `crdtTaskSync?: ICrdtTaskSync` |
| `OrchestratorService.ts` | `CrdtProxy<T>` generic L43 | `CrdtProxy<ICrdtTaskSync>` |
| `requestTaskTool.ts` | Context param L59 | `crdtTaskSync?: ICrdtTaskSync` |
| `bounceTaskTool.ts` | Context param L32 | `crdtTaskSync?: ICrdtTaskSync` |
| `submitResearch.ts` | Double cast L97 | Remove `(octx as any)` cast |

**Effort:** 1 hour. Do alongside Phase 1 type work.

---

#### FIX-3: Backend `observe()` for agent-statuses (AP-3) — Phase 2

After FIX-1 populates `agent-statuses`, add a backend observer to push changes to frontend via Socket.IO.

**File:** `packages/agent-manager/src/orchestrator/AgentStatusObserver.ts` (NEW — SRP: dedicated class, not inside OrchestratorService)

```typescript
/**
 * Single-purpose observer. Watches agent-statuses CRDT doc,
 * emits changes via callback. OrchestratorService wires callback → Socket.IO.
 */
export class AgentStatusObserver {
  private cleanup?: () => void;

  async start(
    space: CollaborationSpace,
    onChange: (role: string, status: any) => void,
  ): Promise<void> {
    const doc = await space.openDoc('agent-statuses');
    const statuses = doc.getMap('agent-statuses');

    const handler = (event: Y.YMapEvent<any>) => {
      for (const [key, change] of event.changes.keys) {
        if (change.action === 'update' || change.action === 'add') {
          onChange(key, statuses.get(key));
        }
      }
    };
    statuses.observe(handler);
    this.cleanup = () => statuses.unobserve(handler);
  }

  stop(): void { this.cleanup?.(); }
}
```

**Wiring:** OrchestratorService creates `AgentStatusObserver`, passes callback → `this.callbacks.onAgentStatusChange` → SocketServerV2 emits `agent-status` event.

**Effort:** 2-3 hours. Clean SRP.

---

#### FIX-4: Hocuspocus Authentication (SEC-1) — Phase 2

Current `onAuthenticate` accepts anything. Fix with JWT validation.

**File:** [HocuspocusServer.ts](../../packages/collaboration/src/L2/collaboration/HocuspocusServer.ts)

```typescript
// CURRENT (no-op):
async onAuthenticate({ token }) {
  return { user: token || "anonymous" };
}

// FIX:
async onAuthenticate({ token, documentName }) {
  if (!token || token === "anonymous") {
    // Allow anonymous only in dev mode
    if (process.env.NODE_ENV === 'production') {
      throw new Error('Authentication required');
    }
    return { user: 'anonymous', role: 'dev' };
  }
  // Validate JWT (same tokens as HTTP API)
  const decoded = await this.verifyToken(token);
  return { user: decoded.userId, role: decoded.role, teamId: decoded.teamId };
}
```

**Effort:** 2 hours. Reuse existing JWT infrastructure from HttpServer.

---

#### FIX-5: Document-Level Authorization (SEC-2) — Phase 2

Prevent cross-team CRDT doc access. CollaborationSpace already uses `{teamId}/{goalId}/` namespacing — enforce it.

**File:** [HocuspocusServer.ts](../../packages/collaboration/src/L2/collaboration/HocuspocusServer.ts)

```typescript
// ADD onLoadDocument hook:
async onLoadDocument({ documentName, context }) {
  // Extract teamId from document path: "{teamId}/{goalId}/..."
  const docTeamId = documentName.split('/')[0];
  if (context.teamId && context.teamId !== docTeamId) {
    throw new Error(`Access denied: team ${context.teamId} cannot access ${docTeamId} docs`);
  }
}
```

**Effort:** 1 hour. Part of SEC-1 work.

---

#### FIX-6: Frontend CRDT Resilience (FE-1, FE-2) — Phase 5 (with frontend work)

| Fix | What | Effort |
|-----|------|--------|
| **FE-1:** Disconnect/reconnect | Listen to HocuspocusProvider `status` events, show reconnecting UI | 2 hours |
| **FE-2:** Error boundaries | Wrap CollaborativeEditor + DiscussionThread in React error boundary | 1 hour |

Bundle with Phase 5 frontend review UI work.

---

### Designed Features — Bundle With Phases

#### CRDT-F1: L2 Search & Indexing (MISSING-3) — Separate Phase (after Phase 2)

MiniSearch full-text + JSONPath queries over CRDT docs. Agents call `collab({ action: "search", query: "pricing tier" })` instead of reading entire docs.

**Not bundled with Phase 2** — this is 3-4 days of standalone work with its own tests. Phase 2 stays focused on planner schema + document flow.

**File:** `packages/collaboration/src/L2/tools/searchIndex.ts` (NEW)

```typescript
import MiniSearch from 'minisearch';

export class CrdtSearchIndex {
  private index = new MiniSearch({
    fields: ['content', 'title', 'type'],
    storeFields: ['docName', 'key', 'type', 'snippet'],
  });

  async indexDoc(docName: string, content: Record<string, any>): Promise<void> {
    // Flatten Y.Map/Y.Array to indexable documents
    for (const [key, value] of Object.entries(content)) {
      this.index.add({
        id: `${docName}/${key}`,
        docName, key,
        content: typeof value === 'string' ? value : JSON.stringify(value),
        type: typeof value,
      });
    }
  }

  search(query: string): SearchResult[] {
    return this.index.search(query, { prefix: true, fuzzy: 0.2 });
  }
}
```

**Add to collab tool:**
```typescript
// NEW action in collab tool:
if (action === "search") {
  const results = await searchIndex.search(key || "");
  return results.map(r => `${r.docName}/${r.key}: ${r.snippet}`).join("\n");
}
```

**Effort:** 3-4 days. Bundle with Phase 2 (same collab tool, same CRDT infrastructure).

---

#### CRDT-F2: `record_decision` / `get_decisions` Actions (MISSING-4) — Phase 1

Standalone collab tool actions for decisions. Currently buried inside `discuss` action.

**File:** [packages/collaboration/src/L2/tools/index.ts](../../packages/collaboration/src/L2/tools/index.ts)

```typescript
// ADD to collab tool action enum:
action: z.enum([
  "discover", "list", "read", "write", "write-block", "read-block",
  "discuss",
  "record-decision",    // NEW: standalone decision recording
  "get-decisions",      // NEW: retrieve all decisions for this goal
])

// ADD handler:
if (action === "record-decision") {
  const decisionsDoc = await space.openDoc("decisions");
  const decisions = decisionsDoc.getMap("decisions");
  decisions.set(key!, {
    decision: value.decision,
    rationale: value.rationale,
    madeBy: agentRole,
    taskId: taskId || "unknown",
    timestamp: new Date().toISOString(),
  });
  // Auto-register as DocumentRef in registry
  return `Decision "${key}" recorded.`;
}

if (action === "get-decisions") {
  const decisionsDoc = await space.openDoc("decisions");
  const decisions = decisionsDoc.getMap("decisions");
  const all = Object.fromEntries(decisions.entries());
  return JSON.stringify(all, null, 2);
}
```

**Effort:** 2-3 hours. Decisions become first-class `crdt:decisions/{key}` DocumentRefs.

---

#### CRDT-F3: UndoManager for Shared Docs (UNDERUTIL-4) — Phase 5

Per-agent Y.UndoManager on shared docs. Agent writes tracked by origin, reverted on review rejection.

**File:** `packages/collaboration/src/L2/collaboration/UndoTracker.ts` (NEW)

```typescript
import * as Y from 'yjs';

export class UndoTracker {
  private managers = new Map<string, Y.UndoManager>();

  /**
   * Create an UndoManager scoped to a specific agent + task.
   * Origin format: "agent:{role}:{taskId}"
   */
  create(doc: Y.Doc, scope: Y.AbstractType<any>, origin: string): Y.UndoManager {
    const manager = new Y.UndoManager(scope, {
      trackedOrigins: new Set([origin]),
    });
    this.managers.set(origin, manager);
    return manager;
  }

  /**
   * Undo all changes by a specific agent on a specific task.
   * Called when review rejects the task's changes.
   */
  undoAll(origin: string): number {
    const manager = this.managers.get(origin);
    if (!manager) return 0;
    let count = 0;
    while (manager.canUndo()) {
      manager.undo();
      count++;
    }
    this.managers.delete(origin);
    return count;
  }

  dispose(origin: string): void {
    const manager = this.managers.get(origin);
    manager?.destroy();
    this.managers.delete(origin);
  }
}
```

**Integration:** collab tool wraps writes in `doc.transact(fn, origin)` where `origin = "agent:{role}:{taskId}"`. Review rejection calls `undoTracker.undoAll(origin)`.

**Effort:** 1-2 days. Bundle with Phase 5 (review-before-publish).

---

### Updated Phase Summary (with CRDT fixes, post-review)

```
Phase 1 (4-5 days)                        FF_ENABLE_DOCUMENT_CONTEXT
├─ DocumentRef.ts (NEW types)
├─ ICrdtTaskSync.ts (NEW interface)       ← FIX-2: type safety
├─ Task.types.ts (additive fields)
├─ completeTaskTool.ts (producedDocs)
├─ OrchestratorService.ts (dispatchTask)
├─ TaskStore.ts (enrichV2 + decisions)
├─ WorkerPool.ts (fix double)
├─ CrdtTaskSync.ts (updateAgentStatus)    ← FIX-1: via interface method (DIP)
├─ collab tool (record-decision action)   ← CRDT-F2: decisions
├─ featureFlags.ts (flag)
└─ 6 files: replace crdtTaskSync any      ← FIX-2: type safety

Phase 2 (4-5 days)                        FF_ENABLE_DOCUMENT_REGISTRY
├─ submitPlan.ts (structured schema)
├─ OrchestratorService.ts (approvePlan stores docs on Task)
├─ HocuspocusServer.ts (auth + ACL)       ← FIX-4 + FIX-5: security
├─ AgentStatusObserver.ts (NEW, SRP)      ← FIX-3: observe() → Socket.IO
└─ SocketServerV2.ts (agent-status event) ← FIX-3: frontend push

Phase 2b (3-4 days, can run in parallel)  (no flag — additive)
├─ CrdtSearchIndex.ts (NEW)              ← CRDT-F1: L2 search
└─ collab tool (search action)

Phase 3 (2-3 days)                        (no new flag)
├─ WorkerPool.ts (document-centric msg)
└─ requestTaskTool.ts (contextDocs)

Phase 4 (2-3 days)                        FF_ENABLE_DOCUMENT_REGISTRY
├─ CrdtTaskSync.ts (persist structured)
├─ DocumentResolverRegistry.ts (NEW)      ← deferred from Phase 1
├─ resolvers/ (NEW: 4 files)
├─ DocumentRegistry.ts (NEW CRDT doc)
└─ OrchestratorService.ts (plan registry)

Phase 5 (1-2 weeks)                       FF_ENABLE_DOCUMENT_REVIEW
├─ Review CRDT doc (NEW)
├─ UndoTracker.ts (NEW)                  ← CRDT-F3: undo on reject
├─ Frontend review UI
├─ Frontend disconnect/error             ← FIX-6: resilience
└─ crdt-undo-rollback integration
```

**Key changes from review:**
- Resolver + Registry deferred to Phase 4 (agents use existing tools in Phase 1-3)
- L2 Search moved to Phase 2b (separate, can run in parallel)
- FIX-1 uses `ICrdtTaskSync.updateAgentStatus()` method, not direct Y.Map manipulation
- FIX-3 uses dedicated `AgentStatusObserver` class, not inline in OrchestratorService
- `StructuredTask` removed — we extend the existing `Task` interface
- `TaskDependency` removed — system auto-resolves doc flow on completion
- `PlannedDocRef` simplified — planner uses `inputDocs` + `expectedOutputDocs` only

### CRDT Items NOT Included (Deferred)

| Item | Why Deferred |
|---|---|
| **GroupChatManager / Discussion Orchestration (MISSING-5)** | Needs Chat Agent Layer (A10) — separate feature with own timeline |
| **Awareness Protocol / Agent Cursors (UNDERUTIL-3)** | P3 priority, needs frontend Phase 4 Step 5 — cosmetic |
| **CRDT Filesystem Projection** | Research phase — needs prototype to validate approach |
| **L2 as Deployed Service (D3)** | Infrastructure feature, not task context related |

---

## Related Features & Dependencies

```
                    ┌──────────────────────────┐
                    │   Task Context & CRDT    │ ← THIS FEATURE (A12)
                    │   (structured tasks,     │
                    │    artifacts, review)     │
                    └──────┬──────┬──────┬─────┘
                           │      │      │
              ┌────────────┘      │      └────────────┐
              ▼                   ▼                    ▼
    ┌─────────────────┐  ┌───────────────┐   ┌────────────────────┐
    │ Data Persistence │  │ CRDT Undo &   │   │ Git Task Context   │
    │ (D1)             │  │ Rollback      │   │ (A8)               │
    │ CRDT as source   │  │ Per-agent     │   │ Workspace repos,   │
    │ of truth,        │  │ undo stacks,  │   │ memory repos,      │
    │ MongoDB index    │  │ rollback on   │   │ branch-per-task    │
    └─────────────────┘  │ reject        │   └────────────────────┘
                          └───────────────┘
              ┌────────────┐        ┌──────────────────┐
              │ Plan Viewer │        │ Parallel Plans   │
              │ (F4)        │        │ (A11)            │
              │ Shows       │        │ Multi-goal       │
              │ document    │        │ needs per-goal   │
              │ lineage in  │        │ structured plan  │
              │ frontend    │        │ docs             │
              └────────────┘        └──────────────────┘
```

| Feature | Relationship | Dependency Direction |
|---------|-------------|---------------------|
| **Data Persistence (D1)** | Provides CRDT-as-source-of-truth infrastructure | D1 → A12 (D1 is prerequisite) |
| **CRDT Undo & Rollback** | Review-reject triggers undo of agent writes | A12 ↔ mutual (review feeds undo) |
| **Git Task Context (A8)** | Branch-per-task model provides workspace isolation for review | A8 → A12 (A8 enables review of git artifacts) |
| **Plan Viewer (F4)** | Displays structured plan, document lineage, review status | A12 → F4 (A12 provides data, F4 displays) |
| **Parallel Plans (A11)** | Each goal needs its own structured plan doc | A12 → A11 (A12 patterns used per goal) |
| **Collaboration Toolkit** | `collab` tool already reads CRDT docs — just enriched data | Already built, enhanced by A12 |

---

## Key Design Decisions

1. **Structured from the planner** — Don't infer structure after the fact. The planner generates structured tasks with document references because it understands the relationships. Post-processing is lossy.

2. **CRDT plan doc is the living plan** — Not a snapshot. Agents read it during execution for up-to-date status of other tasks. This is how agents "know the big picture."

3. **Documents are first-class** — Every task explicitly declares what documents it reads and produces. Documents are tiny value objects (uri + name + hint). Metadata lives in the registry. Resolvers handle access. SOLID through and through.

4. **Review is optional and configurable** — Not every task needs human review. Low-risk, simple tasks auto-approve. High-risk tasks (code, architecture decisions) require human review.

5. **Document registry per goal** — All documents (from any store) indexed in one CRDT doc. Agents discover documents without knowing where they live. Frontend shows the full document map.

6. **MetaGPT inspiration** — MetaGPT's `Task` has `dependent_task_ids`, `instruction`, `result`, `is_success`, and uses a `Plan` class with topological sorting. Our model goes further with document-centric I/O and cross-store resolution, but validates that task DAGs with explicit dependencies are the industry standard.
