# Task Context & CRDT — Implementation Planning

> **Feature:** [feature_architecture.md](feature_architecture.md)  
> **Branch:** `feature/task-context-and-crdt-v1`  
> **Base:** `dev`

---

## Version 1.0 — Document-Centric Task Context (MVP)

### Scope

Fix the core context loss between tasks. When Task A completes, Task B gets `DocumentRef[]` (URIs to actual documents) instead of lossy summary strings.

**What's in:** Steps 1-8 (DocumentRef types, complete_task upgrade, enrichment, prompt injection, double-context fix, feature flag)  
**What's out:** CRDT fixes, planner schema, resolver registry, document registry, review workflow, L2 search, frontend changes

Note: CRDT fixes (FIX-1, FIX-2) and CRDT-F2 (decisions) are in a **separate v1.0-crdt track** below — they share the same branch but are independently testable and have no feature flag dependency.

### Feature Gate

`FF_ENABLE_DOCUMENT_CONTEXT=true` (env: `FF_ENABLE_DOCUMENT_CONTEXT`)

Set to `false` → system behaves exactly as current production. Zero risk.

---

### Step 1: DocumentRef types + ICrdtTaskSync interface

**Create** `packages/agent-manager/src/memory/types/DocumentRef.ts`

```typescript
export interface DocumentRef {
  uri: string;            // workspace:path, crdt:docName, https://url, data:...
  name: string;           // "competitor-analysis", "api-spec"
  description?: string;   // One-line description
  hint?: string;          // "Read sections 2-4 for pricing tiers"
}

export interface ExpectedDoc {
  name: string;
  type?: string;          // "code" | "document" | "decision" | "research" | "test"
  format?: string;        // "typescript" | "markdown" | "json"
  suggestedUri?: string;  // "workspace:src/api/pricing.ts"
  description: string;
}

export interface TaskRisk {
  description: string;
  severity: 'low' | 'medium' | 'high';
  mitigation: string;
}
```

**Create** `packages/collaboration/src/L2/collaboration/types/ICrdtTaskSync.ts`

```typescript
import type { CollaborationSpace } from '../CollaborationSpace.js';

/** Minimal task shape needed by CRDT sync — avoids circular dep on full Task type */
export interface TaskLike {
  id: string;
  description: string;
  assigned_role: string;
  status: string;
  priority?: number;
  prerequisites: Map<string, boolean>;
  dependants: string[];
  context?: Record<string, any>;
  output?: Record<string, any>;
  outputDocs?: Array<{ uri: string; name: string; description?: string }>;
}

export interface TaskOutput {
  summary: string;
  deliverables?: string[];
  producedDocs?: Array<{ uri: string; name: string; description?: string }>;
  decisions?: string[];
  nextSteps?: string[];
}

export interface CollabDocsConfig {
  agenda?: string[];
  participants?: string[];
  maxRounds?: number;
  maxTokens?: number;
  timeoutMinutes?: number;
}

export interface ICrdtTaskSync {
  persistTask(task: TaskLike): Promise<void>;
  syncStatus(taskId: string, status: string, output?: TaskOutput): Promise<void>;
  getCrdtRefs(taskId: string, task: TaskLike): CrdtRefs;
  updateIndex(tasks: TaskLike[]): Promise<void>;
  initCollabDocs(taskId: string, config: CollabDocsConfig): Promise<void>;
  syncPlanStatus(status: string, metadata?: { planId?: string; goalId?: string }): Promise<void>;
  updateAgentStatus(role: string, status: 'busy' | 'idle', taskId?: string): Promise<void>;
  readonly space: CollaborationSpace;
}

export interface CrdtRefs {
  task: string;
  plan: string;
  goal: string;
  dependencies: string[];
  dependants: string[];
  relatedTasks: string[];
}
```

**Why typed:** The original `ICrdtTaskSync` had `any` in 7 method params — it would fix nothing.
Now every param is typed. `TaskLike` is a minimal shape (not the full `Task`) to avoid circular imports between `@ping/agent-manager` and `@ping/collaboration`.

**Modify** `packages/agent-manager/src/memory/types/index.ts` — export new types

**Entry criteria:** None  
**Exit criteria:** Types compile, exported from barrel  
**Effort:** 1 hour

---

### Step 2: Extend Task type

**Modify** `packages/agent-manager/src/memory/types/Task.types.ts`

Add optional fields (no breaking changes):

```typescript
// ADD to Task interface:
inputDocs?: DocumentRef[];
contextDocs?: DocumentRef[];
outputDocs?: DocumentRef[];
expectedOutputDocs?: ExpectedDoc[];
risks?: TaskRisk[];
acceptanceCriteria?: string[];
```

**Entry criteria:** Step 1 done  
**Exit criteria:** `bun run typecheck` passes in agent-manager  
**Effort:** 30 min

---

### Step 3: Upgrade complete_task tool schema

**Modify** `packages/agent-manager/src/agent/internal/tools/completeTaskTool.ts`

Add 3 optional fields to `CompleteTaskSchema`:

- `producedDocs: z.array(z.object({ uri, name, description? })).optional()`
- `decisions: z.array(z.string()).optional()`
- `risksEncountered: z.array(z.string()).optional()`

Keep existing `deliverables` and `nextSteps`. Agent can use either old or new schema.

**Entry criteria:** Step 1 done  
**Exit criteria:** Agent can call `complete_task({ summary, producedDocs: [{uri, name}] })` and it's accepted  
**Effort:** 30 min

---

### Step 4: Capture producedDocs in onWorkerDone

**Modify** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — `onWorkerDone()` (~L822)

Pass `producedDocs`, `decisions`, `risksEncountered` through to `taskStore.completeTask()`.

**Create** `packages/agent-manager/src/memory/utils/toDocumentRefs.ts` (SRP — extraction logic is reusable)

```typescript
import type { DocumentRef } from '../types/DocumentRef.js';
import { basename } from 'path';

/** Convert agent output to DocumentRef[]. Handles both new and legacy formats. */
export function toDocumentRefs(
  producedDocs?: Array<{ uri: string; name: string; description?: string }>,
  deliverables?: string[],
): DocumentRef[] {
  if (producedDocs?.length) return producedDocs;
  if (deliverables?.length) {
    return deliverables.map(d => ({
      uri: d.startsWith('http') ? d : `workspace:${d}`,
      name: basename(d) || d,
    }));
  }
  return [];
}
```

Then in `onWorkerDone`:
```typescript
const docs = toDocumentRefs(data.producedDocs, data.deliverables);
if (docs.length) { task.outputDocs = docs; }
```

**Entry criteria:** Steps 2-3 done  
**Exit criteria:** After agent completes, `task.outputDocs` is populated. Works with both old `deliverables` and new `producedDocs`.  
**Effort:** 1 hour

---

### Step 5: Upgrade enrichDependantContext

**Modify** `packages/agent-manager/src/orchestrator/TaskStore.ts` — `enrichDependantContext()` (~L328)

Keep ALL existing V1 code (upstreamOutputs, upstreamArtifacts, upstreamNotes). Add after:

```typescript
// V2: push upstream outputDocs into dependant's inputDocs
if (upstream.outputDocs?.length) {
  if (!dependant.inputDocs) dependant.inputDocs = [];
  dependant.inputDocs.push(...upstream.outputDocs);
}
// V2: capture upstream decisions
if (upstream.output?.decisions?.length) {
  if (!Array.isArray(ctx.upstreamDecisions)) ctx.upstreamDecisions = [];
  ctx.upstreamDecisions.push(...upstream.output.decisions.map(
    (d: string) => `[${upstream.assigned_role}] ${d}`
  ));
}
```

**Entry criteria:** Step 4 done  
**Exit criteria:** When T-001 completes with `outputDocs`, T-002 (dependent) has those in `inputDocs`  
**Effort:** 1 hour

---

### Step 6: Inject inputDocs into agent prompt (dispatchTask)

**Modify** `packages/agent-manager/src/orchestrator/OrchestratorService.ts` — `dispatchTask()` (~L919)

After existing `enrichedDescription` assembly, add gated block.

**Create** `packages/agent-manager/src/orchestrator/utils/formatDocSection.ts` (SRP — prompt formatting is reusable)

**Format choice rationale:**
- Codebase uses **XML** for structured prompt sections (capabilities.xml, rules.xml, tool-descriptions)
- Codebase uses **Markdown** for human-readable content (task descriptions, skill docs)
- Anthropic recommends: "XML tags help parse complex prompts unambiguously"
- OpenAI recommends: "XML tags delineate where content begins and ends"
- **Decision:** Use XML for structured data (documents, risks) within the task prompt. Agents already parse XML in their system prompts.

```typescript
import type { DocumentRef, ExpectedDoc, TaskRisk } from '../../memory/types/DocumentRef.js';

const SCHEME_TOOL: Record<string, string> = {
  workspace: 'workspace_read_file',
  crdt: 'collab read',
  memory: 'memory read',
  https: 'fetch URL',
  http: 'fetch URL',
  data: 'inline',
};

export function toolForScheme(uri: string): string {
  const scheme = uri.split(':')[0];
  return SCHEME_TOOL[scheme] || scheme;
}

export function formatInputDocs(docs: DocumentRef[]): string {
  const items = docs.map((doc, i) => {
    const path = doc.uri.split(':').slice(1).join(':');
    let xml = `  <document index="${i + 1}" name="${doc.name}" uri="${doc.uri}">`;
    xml += `\n    <access tool="${toolForScheme(doc.uri)}" path="${path}" />`;
    if (doc.hint) xml += `\n    <hint>${doc.hint}</hint>`;
    if (doc.description) xml += `\n    <description>${doc.description}</description>`;
    xml += `\n  </document>`;
    return xml;
  }).join('\n');

  return `\n\n<input_documents count="${docs.length}" instruction="Read these documents before starting your work.">\n${items}\n</input_documents>`;
}

export function formatExpectedDocs(docs: ExpectedDoc[]): string {
  const items = docs.map((doc, i) => {
    let xml = `  <expected_document index="${i + 1}" name="${doc.name}"`;
    if (doc.type) xml += ` type="${doc.type}"`;
    if (doc.format) xml += ` format="${doc.format}"`;
    xml += `>`;
    if (doc.suggestedUri) xml += `\n    <suggested_uri>${doc.suggestedUri}</suggested_uri>`;
    xml += `\n    <description>${doc.description}</description>`;
    xml += `\n  </expected_document>`;
    return xml;
  }).join('\n');

  return `\n\n<expected_output_documents count="${docs.length}" instruction="Produce these documents. Report each via complete_task({ producedDocs: [{ uri, name }] }).">\n${items}\n</expected_output_documents>`;
}

export function formatRisks(risks: TaskRisk[]): string {
  const items = risks.map(r =>
    `  <risk severity="${r.severity}">\n    <description>${r.description}</description>\n    <mitigation>${r.mitigation}</mitigation>\n  </risk>`
  ).join('\n');

  return `\n\n<known_risks>\n${items}\n</known_risks>`;
}

export function formatUpstreamDecisions(decisions: string[]): string {
  const items = decisions.map(d => `  <decision>${d}</decision>`).join('\n');
  return `\n\n<upstream_decisions instruction="Decisions made by upstream tasks. Honor these unless you have strong reason not to.">\n${items}\n</upstream_decisions>`;
}
```

**Why XML, not markdown:**
- The agent's system prompt is already XML (`<capability>`, `<rule>`, etc.)
- XML tags are unambiguous boundaries — agent won't confuse document metadata with task instructions
- `<document index="1" name="..." uri="...">` is machine-parseable AND human-readable
- Markdown `## Input Documents` with `- **name**: \`uri\`` is ambiguous — is the agent supposed to act on it or just read it?
- XML attributes (`name`, `uri`, `tool`) can be extracted programmatically if we ever add auto-resolution

Then in `dispatchTask`:
```typescript
if (this.flags.enableDocumentContext) {
  if (task.inputDocs?.length) enrichedDescription += formatInputDocs(task.inputDocs);
  if (task.expectedOutputDocs?.length) enrichedDescription += formatExpectedDocs(task.expectedOutputDocs);
  if (task.risks?.length) enrichedDescription += formatRisks(task.risks);
}
```

**OCP:** Adding a new URI scheme just means adding one entry to `SCHEME_TOOL`. No if/else chain.

**Entry criteria:** Step 5 done  
**Exit criteria:** Agent sees "## Input Documents" in its prompt with URI and tool hint for each  
**Effort:** 1-2 hours

---

### Step 7: Fix double-context in buildMessageWithContext

**Modify** `packages/agent-manager/src/services/WorkerPool.ts` — `buildMessageWithContext()` (~L533)

The double-context bug: `dispatchTask()` enriches the description AND `buildMessageWithContext()` appends the same data again from `previousOutputs`. Fix by tracking whether enrichment already happened.

**Modify** `TaskWithContext` type — add `contextInjected?: boolean` field.

In `dispatchTask()`, set `contextInjected: true` on the `TaskWithContext` passed to `runTask()`.

In `buildMessageWithContext()`:
```typescript
private buildMessageWithContext(task: TaskWithContext): string {
  let msg = task.description;
  // Skip V1 context append if dispatchTask already injected structured context
  if (task.contextInjected) return msg;
  // ... existing V1 append logic unchanged
}
```

**Why not string matching:** `msg.includes("## Input Documents")` is fragile — breaks if header text changes. A boolean flag is explicit and reliable.

**Entry criteria:** Step 6 done  
**Exit criteria:** Agent no longer sees duplicate upstream context in its prompt  
**Effort:** 30 min

---

### Step 8: Add feature flag

**Modify** `packages/backend/config/featureFlags.ts`

Add `enableDocumentContext: boolean` to `FeatureFlags` interface, `FF_ENABLE_DOCUMENT_CONTEXT` to env map, default `false`.

**Entry criteria:** None  
**Exit criteria:** `FF_ENABLE_DOCUMENT_CONTEXT=true` in `.env` activates document context  
**Effort:** 15 min

---

## v1.0-crdt — CRDT Type Safety + Ghost Doc Fixes (parallel track)

### Scope

Fix CRDT infrastructure issues. No feature flag — these are bug fixes, not new behavior. Can merge independently of document context work.

### Step C1: ICrdtTaskSync interface (shared with v1.0 Step 1)

The `ICrdtTaskSync` interface from Step 1 is used here. If v1.0 Step 1 is already merged, skip this.

### Step C2: FIX-1 — Populate agent-statuses CRDT doc

**Modify** `packages/collaboration/src/L2/collaboration/CrdtTaskSync.ts`

Implement `updateAgentStatus()` method:

```typescript
async updateAgentStatus(role: string, status: 'busy' | 'idle', taskId?: string): Promise<void> {
  const doc = await this._space.openDoc('agent-statuses');
  const statuses = doc.getMap('agent-statuses');
  statuses.set(role, { status, task: taskId || null, since: Date.now() });
}
```

**Modify** `packages/agent-manager/src/services/WorkerPool.ts` — `runTask()`

Call `crdtTaskSync?.updateAgentStatus(roleKey, 'busy', taskId)` before execute, `'idle'` in finally block.

**Entry criteria:** Step 1 (ICrdtTaskSync interface)  
**Exit criteria:** `agent-statuses` CRDT doc populated when agents work. `collab read agent-statuses` returns data.  
**Effort:** 1 hour

---

### Step C3: FIX-2 — Replace crdtTaskSync `any` types

**Modify** 6 files — replace `any` with `ICrdtTaskSync`:

| File | Change |
|------|--------|
| `WorkerPool.ts` constructor | `crdtTaskSync?: ICrdtTaskSync` |
| `OrchestratorService.ts` CrdtProxy | `CrdtProxy<ICrdtTaskSync>` |
| `requestTaskTool.ts` context | `crdtTaskSync?: ICrdtTaskSync` |
| `bounceTaskTool.ts` context | `crdtTaskSync?: ICrdtTaskSync` |
| `submitResearch.ts` | Remove `(octx as any)` cast |
| `collaboration/types/index.ts` | Export `ICrdtTaskSync` |

**Entry criteria:** Step 1 (ICrdtTaskSync interface)  
**Exit criteria:** Zero `any` casts for crdtTaskSync. `bun run typecheck` passes.  
**Effort:** 1 hour

---

### Step C4: CRDT-F2 — record-decision / get-decisions collab actions

**Modify** `packages/collaboration/src/L2/tools/index.ts`

Add to action enum: `"record-decision"`, `"get-decisions"`

`record-decision` handler: writes to `decisions` Y.Map with `{ decision, rationale, madeBy, taskId, timestamp }`.

`get-decisions` handler: reads all from `decisions` Y.Map, returns JSON.

**Entry criteria:** None  
**Exit criteria:** Agent calls `collab({ action: "record-decision", key: "pricing-model", value: { decision: "tiered" } })` and it persists. `get-decisions` returns it.  
**Effort:** 2-3 hours

### v1.0-crdt Testing

- `updateAgentStatus` populates CRDT doc, `collab read agent-statuses` returns data
- Zero `any` casts for crdtTaskSync across all 6 files
- `bun run typecheck` passes for agent-manager AND collaboration packages
- `record-decision` persists, `get-decisions` retrieves

---

### v1.0 Testing Strategy

**Unit tests:**
- `DocumentRef` type validation (URI scheme parsing)
- `toDocumentRefs()` converts both `producedDocs` and legacy `deliverables`
- `CompleteTaskSchema` accepts both old (`deliverables`) and new (`producedDocs`) formats
- `enrichDependantContext` propagates `outputDocs` → `inputDocs` on dependant
- `formatInputDocs` / `formatExpectedDocs` / `formatRisks` produce correct XML with attributes
- `toolForScheme` maps URI schemes to tool names
- `dispatchTask` injects `<input_documents>` XML section when flag on, skips when off
- `buildMessageWithContext` returns description only when `contextInjected === true`

**Integration test:**
- Full cycle: T-001 completes with `producedDocs` → T-002 dispatches with `inputDocs` from T-001 → T-002 agent sees URIs in prompt

**Manual test:**
1. `FF_ENABLE_DOCUMENT_CONTEXT=false` → run a plan → verify identical to current behavior
2. `FF_ENABLE_DOCUMENT_CONTEXT=true` → run same plan → verify agent sees "Input Documents" section → verify complete_task with producedDocs works → verify downstream gets inputDocs

---

### Rollback

Set `FF_ENABLE_DOCUMENT_CONTEXT=false`. All V2 code paths are skipped. V1 `enrichDependantContext` runs unchanged. No data migration. No schema breaking changes.

---

## Version 1.1 — Planner Structured I/O + Security Fixes

### Scope

Planner generates `inputDocs[]` and `expectedOutputDocs[]` per task. CRDT security hardened. Agent-statuses pushed to frontend live.

**Depends on:** v1.0 deployed and stable  
**Flag:** `FF_ENABLE_DOCUMENT_REGISTRY=true`

### Steps

- [ ] Step 1: Upgrade `submitPlan.ts` schema — add optional `inputDocs`, `expectedOutputDocs`, `risks`, `acceptanceCriteria` to task schema
- [ ] Step 2: `approvePlan()` stores structured fields on Task — map plan fields to `task.inputDocs`, `task.expectedOutputDocs`, `task.risks`
- [ ] Step 3: FIX-4 — Hocuspocus JWT auth — validate tokens in `onAuthenticate`, reject anonymous in production
- [ ] Step 4: FIX-5 — Document-level ACL — enforce `{teamId}/` namespace in `onLoadDocument` hook
- [ ] Step 5: FIX-3 — `AgentStatusObserver.ts` — dedicated observer class, wired to Socket.IO `agent-status` event
- [ ] Step 6: `SocketServerV2.ts` — emit `agent-status` event to frontend room on observer callback

### Testing

- Planner generates plan with `inputDocs` and `expectedOutputDocs` fields
- Task created with structured fields from plan
- Hocuspocus rejects unauthenticated connections in production mode
- Cross-team doc access blocked
- Frontend receives live `agent-status` events

---

## Version 1.2 — Agent Message Redesign

### Scope

Agents get a clean structured message instead of concatenated wall of text.

**Depends on:** v1.1 deployed  
**Flag:** None (uses v1.0 + v1.1 flags)

### Steps

- [ ] Step 1: `buildDocumentCentricMessage()` in WorkerPool — structured message with Input Documents, Expected Outputs, Upstream Decisions, Known Risks sections
- [ ] Step 2: `requestTaskTool.ts` — add `contextDocs: DocumentRef[]` to schema
- [ ] Step 3: Update task-lifecycle skill prompt — instruct agents to read inputDocs first, produce expectedOutputDocs, report via producedDocs

### Testing

- Agent receives structured message when inputDocs present
- Agent receives legacy message when no inputDocs (backward compat)
- request_task with contextDocs creates task with inputDocs

---

## Version 2.0 — Registry, Resolver, CRDT Persistence

### Scope

DocumentResolverRegistry as runtime service. Document registry CRDT doc per goal. Full CRDT task doc persistence with structured fields.

**Depends on:** v1.2 deployed, pattern validated  
**Flag:** `FF_ENABLE_DOCUMENT_REGISTRY=true`

### Steps

- [ ] Step 1: `DocumentResolverRegistry.ts` + resolvers (Workspace, CRDT, HTTP, Inline)
- [ ] Step 2: `DocumentRegistryCrdt.ts` — CRDT doc `{teamId}/{goalId}/documents` tracking all docs
- [ ] Step 3: `CrdtTaskSync.persistTask()` — write inputDocs, outputDocs, expectedOutputDocs, risks to CRDT
- [ ] Step 4: `getCrdtRefs()` extended with doc arrays
- [ ] Step 5: Register producedDocs in registry on task completion
- [ ] Step 6: Register user-provided docs in registry on plan approval

---

## Version 3.0 — Review-Before-Publish

### Scope

CRDT review document per task. Human approval before artifacts merge. Y.UndoManager for rollback. Frontend review UI.

**Depends on:** v2.0 deployed  
**Flag:** `FF_ENABLE_DOCUMENT_REVIEW=true`

### Steps

- [ ] Step 1: Review CRDT doc type `{teamId}/{goalId}/review/{taskId}`
- [ ] Step 2: Review step between onWorkerDone and taskStore.completeTask
- [ ] Step 3: `UndoTracker.ts` — per-agent Y.UndoManager for shared docs
- [ ] Step 4: Auto-approve config per team/role/task-type
- [ ] Step 5: Frontend review UI (diff view, comments, approve/reject)
- [ ] Step 6: FIX-6 — Frontend disconnect/reconnect handling + error boundaries

---

## Parallel Track: L2 Search & Indexing

Can start after v1.0, runs independently.

- [ ] Step 1: `CrdtSearchIndex.ts` — MiniSearch over Y.Map/Y.Array content
- [ ] Step 2: `collab search` action — full-text search across CRDT docs
- [ ] Step 3: Auto-index on doc open/change via onChange hook
- [ ] Step 4: `collab whatsnew` action — changes since last check
