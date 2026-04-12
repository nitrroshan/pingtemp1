# Markdown-Based Tasks — Implementation Planning

**Architecture:** [feature_architecture.md](feature_architecture.md)  
**Parent:** [Task Orchestration](../feature_architecture.md)  
**Branch:** `feature/markdown-tasks`

---

## Storage Decision: CRDT (not filesystem)

Tasks, Plans, and Goals are **coordination state** — not deliverables. Per the MASTER-ARCHITECTURE, workspace repo = deliverables (code, docs), CRDT = coordination + team knowledge. Putting task files in `.ping/` inside the workspace conflicts with worker cloning (each worker clone gets stale copies) and mixes concerns.

**Chosen approach:** CRDT Y.Map documents (one per task/plan/goal) via existing Hocuspocus infrastructure. TaskStore remains the in-memory runtime engine (state machine, DAG, dispatch). CRDT provides durable persistence + agent access via `collab` tool + auto-projection to readable files via `projectToFilesystem`.

**What this changes from the original design:**
- `TaskSyncer` → `CrdtTaskSync` (writes to CRDT Y.Map, not `.md` files)
- `PlanSyncer` → existing PlanStore + CRDT plan docs
- `GoalSyncer` → `CrdtGoalStore` (new — goals in CRDT)
- Agents access tasks via `collab` tool, not `workspace_read_file`
- No `.ping/tasks/`, `.ping/plans/`, `.ping/goals/` directories — data lives in Hocuspocus
- `projectToFilesystem` auto-creates `.ping/collaboration/tasks/*.json` as read-only projections

---

## Version Strategy

| Version | Scope | Dependency |
|---------|-------|------------|
| **v1.0** | Core CRDT task persistence + goal/plan lifecycle (backend only) | None — foundational |
| **v1.1** | Agent-initiated tasks + collaboration protocol | v1.0 complete |
| **v2.0** | Frontend discussion UI + user participation | v1.1 complete |

---

## v1.0 — Core CRDT Task Pipeline (MVP)

**What:** Tasks, plans, and goals are persisted as CRDT documents via Hocuspocus. TaskStore remains the in-memory runtime engine — CRDT is the persistence layer underneath. The existing orchestration flow works identically, but tasks are now durable, agent-browseable, and crash-recoverable.

**Branch:** `feature/markdown-tasks-v1.0`

### Steps

#### Step 1: CrdtTaskSync — Persist & Load Tasks via CRDT
**Files:** Create `packages/collaboration/src/L2/collaboration/CrdtTaskSync.ts`  
**Depends on:** CollaborationSpace (exists), Task.types.ts (exists), ITaskStore (exists in plugin/types.ts)

The bridge between TaskStore (in-memory) and CRDT (persistence). Implements `ITaskStore` so it can be injected via `IPluginStorage.taskStore`.

**Methods:**
- `persistTask(task: Task)` — write Task data to CRDT Y.Map doc `tasks/task-{id}`
- `syncStatus(taskId, newStatus, output?)` — update status field in existing CRDT task doc
- `loadAllTasks()` — list all `tasks/task-*` docs from CollaborationSpace, parse each Y.Map → Task object
- `persistGoal(goalId, title, body)` — write Goal data to CRDT doc `goals/goal-{id}`
- `persistPlan(storedPlan)` — write Plan overview to CRDT doc `plans/plan-{id}` (complements existing PlanStore JSON files)

**CRDT doc structure per task (`{taskId}/task` within CollaborationSpace):**
```
Y.Map("task") = {
  id: "task-003",
  title: "Design REST API endpoints",
  assignedRole: "architect",
  status: "pending",
  priority: 2,
  complexity: "medium",
  type: "work",
  dependencies: ["task-001", "task-002"],
  createdBy: "planner",
  planId: "plan-001",
  expectedOutput: "API specification document",
  body: "## Context\nThe product requires...\n\n## Acceptance Criteria\n- [ ] All CRUD endpoints...",
  output: null,               // set on completion
  completedAt: null,           // set on completion
  createdAt: "2026-04-13T10:00:00Z"
}
```

**Full Hocuspocus doc path:** `{teamId}/{goalId}/{taskId}/task`  
**Example:** `team-1/build-app/task-003/task`

Related docs for the same task live alongside:
- `{teamId}/{goalId}/{taskId}/discussion` — task discussion
- `{teamId}/{goalId}/{taskId}/decisions` — task decisions
- `{teamId}/{goalId}/{taskId}/doc-{name}` — shared working docs
```

**Mapping to Task interface:**
- `assignedRole` → `task.assigned_role` (lowercased)
- `dependencies[]` → `task.prerequisites: Map<string, boolean>` (all false initially)
- `body` → `task.description` (rich markdown description)
- `title + priority + complexity + expectedOutput` → `task.context`

**Acceptance criteria:**
- `persistTask(task)` creates a CRDT doc at `{taskId}/task` that `projectToFilesystem` auto-projects to `.ping/collaboration/{taskId}/task.md` (YAML frontmatter + markdown body)
- `syncStatus(taskId, "completed", output)` updates the CRDT doc without recreating it
- `loadAllTasks()` returns valid Task objects matching TaskStore's interface
- Round-trip: persist → load produces identical Task (modulo serialization)
- Implements `ITaskStore` interface (addTask, getTask, updateStatus, getReadyTasks)

#### Step 2: CrdtGoalStore — Goal Lifecycle in CRDT
**Files:** Create `packages/collaboration/src/L2/collaboration/CrdtGoalStore.ts`  
**Depends on:** Step 1 (shared CRDT patterns)

- When user submits a goal: write CRDT doc `goals/goal-{id}` with goal data
- Goal.md-equivalent fields: `id, title, teamId, status, submittedBy, planId, createdAt, body`
- On goal completion: update `status` + `completedAt` in CRDT doc
- Inject Goal data as context into planner system prompt

**CRDT doc structure (`goal` within CollaborationSpace):**
```
Y.Map("goal") = {
  id: "goal-001",
  title: "Build a marketing campaign for product X",
  teamId: "marketing-team",
  status: "planning",
  submittedBy: "user",
  planId: "plan-001",
  createdAt: "2026-04-13T09:30:00Z",
  completedAt: null,
  body: "## User Intent\nBuild a comprehensive marketing campaign...\n\n## Success Criteria\n- Campaign plan with timeline..."
}
```

**Full Hocuspocus doc path:** `{teamId}/{goalId}/goal`  
**Example:** `team-1/build-a-marketing-campaign/goal`

**Acceptance criteria:**
- `saveGoal(goalId, title, userMessage)` creates CRDT doc with parsed user intent
- `loadGoal(goalId)` returns goal data for context injection
- Status updates reflect in CRDT and project to `.ping/collaboration/goal.md`

#### Step 3: Wire CrdtTaskSync into L2CollaborationPlugin
**Files:** Modify `packages/collaboration/src/L2/L2CollaborationPlugin.ts`  
**Depends on:** Steps 1-2

The L2CollaborationPlugin already returns `IPluginStorage` via `getStorage()` with `planStore`. Add `taskStore: CrdtTaskSync` to the same storage object.

```typescript
getStorage(): IPluginStorage {
  return {
    planStore: this.planStore,
    taskStore: this.crdtTaskSync,    // NEW — same pattern as planStore
    crdt: this,
    groupChat: this,
  };
}
```

CrdtTaskSync needs a `CollaborationSpace` — created per goal via `getOrCreateSpace(goalId)`.

**Acceptance criteria:**
- `pluginRegistry.getPluginStorage("collaboration").taskStore` returns CrdtTaskSync
- CrdtTaskSync is scoped to the active goal's CollaborationSpace

#### Step 4: Wire into OrchestratorService
**Files:** Modify `packages/agent-manager/src/orchestrator/OrchestratorService.ts`, `packages/backend/agentManager/AgentManagerV2.ts`  
**Depends on:** Step 3

**AgentManagerV2 change:** Extract `taskStore` from plugin storage (same as `planStore`):
```typescript
const collabStorage = this.pluginRegistry.getPluginStorage("collaboration");
const crdtTaskSync = collabStorage?.taskStore;
```

Pass `crdtTaskSync` to OrchestratorService config.

**OrchestratorService integration points:**
1. **`approvePlan()`** — after `taskStore.create()` loop: call `crdtTaskSync.persistTask()` for each task + `crdtGoalStore.saveGoal()` for the goal
2. **`onWorkerDone()`** — after `taskStore.completeTask()`: call `crdtTaskSync.syncStatus(taskId, 'completed', output)`
3. **`onTaskFailed()`** — call `crdtTaskSync.syncStatus(taskId, 'failed')`
4. **`initialize()`** — load tasks from CRDT via `crdtTaskSync.loadAllTasks()` → hydrate TaskStore (crash recovery)

**Acceptance criteria:**
- Existing tests pass unchanged (CrdtTaskSync is additive, not breaking)
- After `approvePlan()`, CRDT contains one doc per task at `{taskId}/task` (verifiable via `collab` tool)
- After task completion, CRDT doc's status = `completed`
- On restart, tasks reload from CRDT and resume
- `projectToFilesystem` auto-creates `.ping/collaboration/{taskId}/task.md` files

#### Step 5: Task Context Enrichment — CRDT References in Dispatch
**Files:** Modify `OrchestratorService.dispatchTask()`  
**Depends on:** Step 4

When dispatching a task to WorkerPool, inject `context.crdtRefs` so the agent knows how to access related data:

```typescript
context.crdtRefs = {
  task: "task-003/task",                   // own task CRDT doc
  plan: "plan",                            // plan CRDT doc (at goal level)
  goal: "goal",                            // goal CRDT doc (at goal level)
  dependencies: ["task-001/task", "task-002/task"],
  dependants: ["task-004/task"],
};
```

Agent's prompt includes a "## Context Sources" section:
```markdown
## Context Sources (use `collab read` to access)
- **Your task:** `collab read task-003/task` (full details + acceptance criteria)
- **Plan:** `collab read plan`
- **Goal:** `collab read goal`
- **Completed dependencies:** task-001/task, task-002/task
- **Downstream tasks:** task-004/task (depends on your output)
```

**Acceptance criteria:**
- Dispatched tasks include `context.crdtRefs` with all relevant doc names
- Agent's system prompt explains how to use `collab read` for task details
- Agents can read their own task data for acceptance criteria and context

#### Step 6: Extend collab Tool for Task/Goal Discovery
**Files:** Modify `packages/collaboration/src/L2/tools/index.ts`  
**Depends on:** Step 4

The collab tool already handles `plans` and `outputs` as special categories. Add `tasks` and `goals`:

```typescript
// discover action → include "tasks" and "goals" in top-level categories
// list tasks → list all {taskId}/task docs with status summary
// read task-003/task → return task Y.Map as JSON
// read goal → return goal Y.Map as JSON
// read plan → return plan Y.Map as JSON
// list task-003 → list all docs under task-003/ (task, discussion, decisions, doc-*)
```

Tasks and goals are **read-only to agents** (same as plans) — only CrdtTaskSync writes them via the orchestrator.

**Acceptance criteria:**
- `collab discover` shows "tasks", "goals", "plan" alongside "plans", "outputs", "crdt"
- `collab list tasks` returns `task-001 [completed] — Market Research (researcher)`
- `collab read task-003/task` returns full task data as JSON
- `collab list task-003` returns all docs under that task (task, discussion, decisions)
- Write attempts to task/goal/plan docs return "read-only" error

#### Step 7: Tests
**Depends on:** Steps 1-6

- **Unit:** CrdtTaskSync round-trip (Task → CRDT Y.Map → Task)
- **Unit:** CrdtGoalStore serialization
- **Unit:** CRDT doc creation and field mapping
- **Integration:** Full flow: submit_plan → approvePlan → CRDT task docs at `{taskId}/task` created → complete → status synced
- **Recovery:** Restart → load from CRDT .bin files → resume execution
- **Agent access:** `collab read task-003/task` returns correct data after plan approval
- **Projection:** `.ping/collaboration/task-003/task.md` has YAML frontmatter + markdown body

---

## v1.1 — Agent-Initiated Tasks & Collaboration

**What:** Worker agents can create tasks for each other. Collaboration tasks open CRDT discussions. Pre-plan research phase available.

**Branch:** `feature/markdown-tasks-v1.1`

### Steps

#### Step 1: `request_task` Tool
**Files:** Create `packages/agent-manager/src/orchestrator/tools/requestTask.ts`  
**Depends on:** v1.0 complete

- AI SDK `tool()` with Zod schema: `{ title, description, targetRole, type, priority, relationship, context }`
- Guard rails: max 5 per agent per plan, no self-assign, priority ceiling at 2
- Writes task to CRDT via CrdtTaskSync, registers in TaskStore, rebuilds DAG
- For `blocks-me` relationship: adds new prerequisite to creator's task

**Acceptance criteria:**
- Agent creates a task → CRDT doc `{taskId}/task` created (auto-projected to `.ping/collaboration/{taskId}/task.md`)
- `createdBy: agent:{role}` in task data
- DAG is rebuilt, new task dispatches normally
- Guard rails enforced (errors on violation)

#### Step 2: `bounce_task` Tool
**Files:** Create `packages/agent-manager/src/orchestrator/tools/bounceTask.ts`

- Wraps existing `reassignTaskTool` — simplified interface for workers
- Schema: `{ taskId, reason, suggestedRole? }`
- Updates task status in TaskStore + CrdtTaskSync, adds bounce note to task body

#### Step 3: Inject New Tools into WorkerPool
**Files:** Modify `packages/agent-manager/src/services/WorkerPool.ts`

- Add `request_task` and `bounce_task` to built-in tools (alongside `reportStatusTool`, `completeTaskTool`)
- Pass TaskStore, CrdtTaskSync, DependencyResolver references via tool context

#### Step 4: `discuss` Collab Action
**Files:** Modify `packages/collaboration/src/L2/tools/index.ts`

- Add `discuss` action to existing collab tool
- Operations: `post` (push to Y.Array), `read` (cursor-based filter), `decide` (push decision to Y.Map)
- Cursor protocol: `Y.Map("cursors")` per agent, timestamp-based filtering
- Guard rails: `maxRounds`, `maxTokens`, `timeoutMinutes` in `Y.Map("config")`

#### Step 5: CollabTaskDispatcher
**Files:** Modify `OrchestratorService.dispatchTask()`

- When task `type === "collaboration"`: initialize CRDT docs under `{taskId}/` with `discussion` (Y.Array), `decisions` (Y.Map), `doc-{name}` (Y.XmlFragment)
- Hierarchical doc naming: `{taskId}/discussion`, `{taskId}/decisions` — co-located with `{taskId}/task`
- Set guard rail defaults in `Y.Map("config")`

#### Step 6: Cross-Plan Task References
**Files:** Modify CrdtTaskSync + dispatchTask

**What this is:** When a team runs multiple goals over time (Goal A → Plan A, Goal B → Plan B), work from earlier plans is lost — agents can't reference it. Cross-plan references let a task in Plan B pull output from a completed task in Plan A, so agents don't repeat work.

**Example:** Last week, `plan-000/task-003` (researcher) produced a "competitor analysis report." This week, the team starts a new goal. The planner creates `task-010` (strategist) and adds `references: ["plan-000/task-003"]`. When task-010 dispatches, the system loads task-003's output and injects it as context — the strategist gets the prior research without re-doing it.

**Implementation:**
- Task CRDT Y.Map gains `references: string[]` — array of `{planId}/{taskId}` strings pointing to completed tasks from any plan
- Planner's `submit_plan` schema adds optional `references` field per task
- CrdtTaskSync reads/writes the `references` field in task CRDT doc
- In `dispatchTask()`: for each reference, load the output from the referenced task's CRDT doc (or PlanStore → find task output) → inject as `context.references[]`
- Agent's prompt includes a "## Prior Work" section with referenced outputs

**Acceptance criteria:**
- Tasks with `references: ["plan-000/task-003"]` get prior task output in their context
- Missing references (deleted/non-existent) are skipped with a warning, not errors
- Referenced tasks must be `status: completed` — pending/failed references are skipped

#### Step 7: Pre-Plan Research Phase
**Files:** Create `packages/agent-manager/src/orchestrator/tools/submitResearch.ts`, modify OrchestratorService

- New `submit_research` planner tool — creates `type: "research"` tasks before plan
- OrchestratorService gains `researching` state between `idle` and `planning`
- `submit_plan` blocked during `researching` state
- Research task outputs feed into planner context on completion

#### Step 8: Tests
- **Unit:** request_task guard rails, discuss cursor protocol
- **Integration:** Agent creates task → dispatches → completes → creator's prerequisites met
- **Integration:** Collaboration task → discuss → decision → task completes

---

## v2.0 — Frontend Discussion UI & User Participation

**What:** Users see and participate in agent discussions. Full discussion UI with DiscussionThread, DecisionPanel, DiscussionComposer. Extends the existing DetailPanel (5th tab), Sidebar (4th nav item), and App.tsx (new view mode).

**Branch:** `feature/markdown-tasks-v2.0`

### Frontend Design Reference

#### Existing patterns to follow

| Pattern | Where | Reuse for |
|---------|-------|-----------|
| Tab array (`TABS` constant) | `DetailPanel.tsx` line 20 | Add 5th "Discussions" tab |
| Nav items (`NAV_ITEMS` array) | `Sidebar.tsx` line 46 | Add 4th "Discussions" nav item |
| View mode state (`viewMode`) | `App.tsx` useState | Add `'discussions'` to union type |
| HocuspocusProvider (WebSocket) | `CollaborativeEditor.tsx` line 14 | Reuse for Y.Array/Y.Map subscriptions |
| AnimatePresence view switching | `App.tsx` line 678 | New `discussions` branch |
| Task status badges | `DetailPanel.tsx` Tasks tab | Reuse badge styles for discussion status |
| Motion.div tab transitions | `DetailPanel.tsx` line 150 | Same animation for Discussions tab |

#### Layout — Two Viewing Modes

**Mode A: Full View** — "Discussions" sidebar nav → main content area

```
┌──────────┬─────────────────────────────┬──────────────┐
│ SIDEBAR  │   DISCUSSION THREAD         │ DETAIL PANEL │
│ (w-52)   │   (flex-1, main content)    │ (w-80)       │
│          │                             │              │
│ Nav:     │   API Auth Flow             │ Tab:         │
│ ○ Chat   │   architect ↔ frontend-dev  │ Discussions  │
│ ○ Tasks  │   You: backend-dev          │              │
│ ○ Collab │                             │ ┌──────────┐ │
│ ● Discuss│   🤖 architect · 10:30 AM   │ │ Active   │ │
│          │   We need PKCE (RFC 7636)   │ │ 🔴 API   │ │
│ ─────────│   for SPAs. Questions:      │ │ 🟡 DB    │ │
│ Teams:   │   1. code_verifier support? │ │          │ │
│  ▸ team-1│   2. redirect URI scheme?   │ │ Resolved │ │
│  ▸ team-2│                             │ │ ✅ Auth  │ │
│          │   🤖 frontend-dev · 10:31   │ │ ✅ Cache │ │
│          │   SDK uses auth0-spa-js.    │ └──────────┘ │
│          │   PKCE is native.           │              │
│          │                             │              │
│          │   👤 Roshan · 11:00 AM      │              │
│          │   Use JWT with short-lived  │              │
│          │   tokens. ✅ DECISION       │              │
│          │                             │              │
│          │   ─────────────────────     │              │
│          │   [@mention ▾] [Type ▾]     │              │
│          │   ┌──────────────────┐      │              │
│          │   │ Type response... │ Send │              │
│          │   └──────────────────┘      │              │
│          │   ⚡ 3/10 rounds · 12k/50k  │              │
└──────────┴─────────────────────────────┴──────────────┘
```

**Mode B: Split Pane** — "Pin Thread" from DetailPanel while in Chat view

```
┌──────────┬────────────────┬─────────────┬──────────────┐
│ SIDEBAR  │ CHAT AREA      │ THREAD      │ DETAIL PANEL │
│ (w-52)   │ (flex-1)       │ (w-96,      │ (w-80)       │
│          │                │ resizable)  │              │
│ Nav:     │ Agent messages │ 🤖 architect│ Tab:         │
│ ● Chat   │ and streaming  │ We need ... │ Discussions  │
│ ○ Tasks  │ content here   │             │              │
│ ○ Collab │                │ 🤖 fe-dev   │ Thread list  │
│ ○ Discuss│ [Chat input]   │ SDK native  │ with badges  │
│          │                │             │              │
│          │                │ 👤 Roshan   │              │
│          │                │ Use JWT. ✅ │              │
│          │                │             │              │
│          │                │ [Compose]   │              │
└──────────┴────────────────┴─────────────┴──────────────┘
```

### Steps

#### Step 1: DiscussionThread Component
**Files:** Create `packages/frontend/components/DiscussionThread/DiscussionThread.tsx`, `DiscussionThread/index.ts`  
**Depends on:** v1.1 discuss action + HocuspocusProvider (exists in CollaborativeEditor.tsx)

**Design:**
```
┌─ DiscussionThread ──────────────────────────────────┐
│                                                      │
│  Header: "API Auth Flow · collab/task-007"           │
│  Subtitle: "architect ↔ frontend-dev · You: backend" │
│  ────────────────────────────────────────────────     │
│                                                      │
│  ┌─ DiscussionBlock (agent) ────────────────────┐    │
│  │ 🤖 architect                      10:30 AM   │    │
│  │ We need PKCE (RFC 7636) for SPAs.            │    │
│  │ Questions:                                    │    │
│  │ 1. Does the SDK handle code_verifier?         │    │
│  │ 2. What redirect URI scheme?                  │    │
│  │                          @frontend-dev  💬    │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌─ DiscussionBlock (agent) ────────────────────┐    │
│  │ 🤖 frontend-dev                   10:31 AM   │    │
│  │ SDK uses @auth0/auth0-spa-js — PKCE native.  │    │
│  │ Redirect: window.location.origin + /callback  │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ┌─ DiscussionBlock (human, decision) ──────────┐    │
│  │ 👤 Roshan (backend-dev)           11:00 AM   │    │
│  │ Use JWT with short-lived tokens.              │    │
│  │ Session cookies add CSRF complexity.          │    │
│  │                                    ✅ DECISION │    │
│  └──────────────────────────────────────────────┘    │
│                                                      │
│  ────────────────────────────────────────────────     │
│  [DiscussionComposer here]                           │
│  ⚡ Auto mode · 3/10 rounds · 12k/50k tokens         │
└──────────────────────────────────────────────────────┘
```

**Implementation:**
- HocuspocusProvider connects to `ws://localhost:1234` with doc name = `{teamId}/{goalId}/collab/{taskId}/discussion`
- `useEffect` subscribes via `yarray.observe(callback)` — fires on every new block push
- Each `DiscussionBlock` renders: role badge (🤖/👤), display name, timestamp, markdown body (use existing markdown renderer), @mention chips, type badge (decision=✅, question=❓)
- Auto-scroll: `useRef` on container, scroll to bottom on new blocks
- Status bar at bottom: mode (auto/manual), round count per agent, token usage from `Y.Map("config")`

**Acceptance criteria:**
- Renders blocks from `Y.Array("discussion")` in real-time
- New blocks appear without page refresh (CRDT sync)
- Agent blocks show 🤖 + role, human blocks show 👤 + name + (role context)
- Decision blocks have ✅ badge
- Status bar shows guard rail usage

#### Step 2: DecisionPanel Component
**Files:** Create `packages/frontend/components/DecisionPanel/DecisionPanel.tsx`, `DecisionPanel/index.ts`

**Design:**
```
┌─ DecisionPanel ─────────────────────────────────┐
│                                                  │
│  ┌─ DecisionCard ──────────────────────────┐     │
│  │ ✅ Auth Flow Decision                    │     │
│  │                                          │     │
│  │ "Use PKCE with S256"                     │     │
│  │                                          │     │
│  │ Decided by: architect                    │     │
│  │ Agreed by: frontend-dev ✓               │     │
│  │                                          │     │
│  │ ████████████████░░░░  2/3 quorum         │     │
│  │                                          │     │
│  │ Apr 11, 2026 · 10:32 AM                 │     │
│  └──────────────────────────────────────────┘     │
│                                                  │
│  ┌─ DecisionCard (pending) ────────────────┐     │
│  │ ⏳ Database Strategy                     │     │
│  │                                          │     │
│  │ No decision yet                          │     │
│  │                                          │     │
│  │ ░░░░░░░░░░░░░░░░░░░░  0/2 quorum        │     │
│  └──────────────────────────────────────────┘     │
└──────────────────────────────────────────────────┘
```

**Implementation:**
- Subscribes to `Y.Map("decisions")` via `ymap.observe(callback)`
- Each DecisionCard: status icon (✅/⏳), decision title, decision text, decided-by name, agreed-by list with checkmarks, quorum progress bar (`agreedBy.length / quorumRequired`)
- Renders inline within DiscussionThread (below blocks) or as standalone sidebar widget

**Acceptance criteria:**
- Real-time updates when decisions are recorded (Y.Map observe)
- Quorum progress bar reflects `agreedBy.length / quorumRequired`
- Completed decisions show ✅, pending show ⏳

#### Step 3: DiscussionComposer Component
**Files:** Create `packages/frontend/components/DiscussionComposer/DiscussionComposer.tsx`, `DiscussionComposer/index.ts`

**Design:**
```
┌─ DiscussionComposer ────────────────────────────┐
│                                                  │
│  [@mention ▾]  [Type: message ▾]                │
│  ┌──────────────────────────────────────┐        │
│  │                                      │        │
│  │ Type your response...                │ [Send] │
│  │                                      │        │
│  └──────────────────────────────────────┘        │
│                                                  │
│  @mention dropdown (when typing @):              │
│  ┌──────────────────────┐                        │
│  │ 🤖 architect         │                        │
│  │ 🤖 frontend-dev      │                        │
│  │ 🤖 researcher        │                        │
│  │ 👤 Roshan            │                        │
│  └──────────────────────┘                        │
│                                                  │
│  Type dropdown:                                  │
│  ┌──────────────────────┐                        │
│  │ 💬 Message (default) │                        │
│  │ ❓ Question           │                        │
│  │ ✅ Decision           │                        │
│  └──────────────────────┘                        │
└──────────────────────────────────────────────────┘
```

**Implementation:**
- Textarea with `@` trigger: detects `@` → shows filtered dropdown of agent roles + team users
- Type selector: `message | question | decision` — three-option dropdown
- On Send: pushes `DiscussionBlock` to `Y.Array("discussion")` via provider
- Block format: `{ id: crypto.randomUUID(), role: "user:{agentRole}", userId, displayName, timestamp, content, mentions: parseMentions(text), type, tokens: estimateTokens(text) }`
- Enter = send (Shift+Enter = newline)
- Disabled when discussion is `status: "closed"` or guard rails hit

**Acceptance criteria:**
- @mention autocomplete works with role list from team config
- Type selector changes the block type
- Sent message appears immediately in DiscussionThread (local-first via CRDT)
- Composer disabled when discussion closed or token limit reached

#### Step 4: DiscussionListPanel (DetailPanel Tab)
**Files:** Create `packages/frontend/components/DetailPanel/DiscussionListPanel.tsx`  
**Files:** Modify `packages/frontend/components/DetailPanel/DetailPanel.tsx` (add 5th tab)

**Design:**
```
┌─ DetailPanel · Discussions Tab ─────────────────┐
│  Events │ Agents │ Tasks │ Discussions │ ⚙ │
│  ─────────────────────────────────────────────── │
│                                                  │
│  📌 Active (2)                                   │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ 🔴 API Auth Flow                   2 new │    │
│  │    collab/task-007                        │    │
│  │    architect ↔ frontend-dev               │    │
│  │    3 blocks · awaiting your input         │    │
│  │    [Open Thread]  [📌 Pin]                │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ┌──────────────────────────────────────────┐    │
│  │ 🟡 DB Schema Review                1 new │    │
│  │    task/task-003                           │    │
│  │    backend-dev · 2 blocks                 │    │
│  │    [Open Thread]  [📌 Pin]                │    │
│  └──────────────────────────────────────────┘    │
│                                                  │
│  ✅ Resolved (3)                                 │
│  ┌──────────────────────────────────────────┐    │
│  │ ✅ Cache Strategy             resolved    │    │
│  │    task/task-002 · 5 blocks · 1 decision  │    │
│  └──────────────────────────────────────────┘    │
│  └── ...                                         │
└──────────────────────────────────────────────────┘
```

**Implementation:**
- Add to `TABS` array in `DetailPanel.tsx`: `{ id: 'discussions', label: 'Discussions', icon: <MessageCircle size={13} /> }`
- Component lists active discussions from Hocuspocus doc listing + Socket.IO `discussion:activity` events
- Each item: status dot (🔴 active/waiting, 🟡 new blocks, ✅ resolved), title, doc scope, participants, block count, unread count
- "Open Thread" → sets `activeView = 'discussions'` and passes thread ID (Mode A)
- "📌 Pin" → opens split pane alongside current view (Mode B)

**Acceptance criteria:**
- 5th tab appears in DetailPanel
- Lists active and resolved discussions with correct status
- "Open Thread" switches to full discussion view
- Unread badge count updates via Socket.IO events

#### Step 5: Sidebar + App.tsx Integration
**Files:** Modify `packages/frontend/components/Sidebar.tsx`, `packages/frontend/App.tsx`, `packages/frontend/types.ts`

**Design (Sidebar):**
```
┌─ Sidebar ──────────┐
│                     │
│  ○ Chat             │   ← existing
│  ○ Tasks            │   ← existing  
│  ○ Collaborate      │   ← existing
│  ● Discussions 🔴2  │   ← NEW (4th nav item, with unread badge)
│                     │
│  ───────────────    │
│  Teams:             │
│    ▸ marketing      │
│    ▸ engineering    │
└─────────────────────┘
```

**Implementation:**
- Add to `NAV_ITEMS` in Sidebar.tsx: `{ id: 'discussions', label: 'Discussions', icon: <MessageCircle size={15} /> }`
- Add badge count from `useDiscussionNotifications()` hook (Socket.IO `discussion:activity` counter)
- `types.ts`: extend view mode union: `'chat' | 'tasks' | 'collaborate' | 'discussions'`
- `App.tsx` AnimatePresence: add `discussions` branch → renders DiscussionThread (selected thread) or DiscussionListPanel (thread picker)
- Split-pane state: `pinnedThread: string | null` — when set, renders thread alongside current view

**Acceptance criteria:**
- 4th sidebar nav item "Discussions" appears with notification badge
- Clicking navigates to discussion view (full or list)
- URL updates to `/teams/{teamId}/discussions`
- Split-pane works when thread is pinned from DetailPanel

#### Step 6: Socket.IO Events + Notification Hook
**Files:** Modify `packages/backend/api/SocketServerV2.ts`  
**Files:** Create `packages/frontend/hooks/useDiscussionNotifications.ts`

**Backend events:**
- `discussion:activity` — server → client: `{ taskId, docName, role, action, blockCount }` — lightweight ping on discussion block creation
- `discussion:mention` — server → client: `{ fromRole, toRole, taskId, blockId }` — notification when user @mentioned
- Triggered by Hocuspocus `onChange` → detect Y.Array pushes with `mentions[]` field

**Frontend hook:**
```typescript
function useDiscussionNotifications(teamId: string) {
  // Subscribes to discussion:activity + discussion:mention via Socket.IO
  // Returns: { unreadCount, mentions: MentionNotification[], markRead(docName) }
  // Drives: Sidebar badge count, DetailPanel unread counts, toast notifications
}
```

**Notification toast (reuse existing Toast component):**
```
┌──────────────────────────────────────────────┐
│ 💬 @architect mentioned you in API Auth Flow │
│ "Use JWT with short-lived tokens..."         │
│                           [Open Thread]      │
└──────────────────────────────────────────────┘
```

**Acceptance criteria:**
- Socket.IO events fire when discussion blocks are created
- Frontend unread count updates in real-time
- @mention notifications appear as toast
- Clicking toast opens the relevant discussion thread

#### Step 7: Agent Status Extension
**Files:** Modify SwarmView / agent status components in DetailPanel Agents tab

**Design (extended agent card):**
```
┌─ Agent Card ────────────────────────────────┐
│ 🟢 architect                 working        │
│    task-003: Design REST API endpoints      │
│    💬 discussing with frontend-dev          │  ← NEW line
│       reading response in collab/task-007   │  ← NEW line
└─────────────────────────────────────────────┘
```

**Implementation:**
- Extend `agent-statuses` Y.Map with `discussionState: { activeDoc, action, lastBlock, with }` field
- SwarmView (Agents tab in DetailPanel) reads extended status → shows discussion context
- Status variants: "discussing with {role}", "reading response...", "writing response...", "idle"

**Acceptance criteria:**
- Agent cards show discussion state when active
- Updates in real-time via Y.Map observe

#### Step 8: Tests
- **Component:** DiscussionThread renders blocks correctly (agent and human variants)
- **Component:** DiscussionComposer @mention autocomplete populates from team roles
- **Component:** DecisionPanel quorum progress bar calculations
- **Component:** DiscussionListPanel groups active/resolved correctly
- **Integration:** User posts in composer → block appears in thread → agent sees via cursor
- **Integration:** Agent responds → block appears in thread → user sees live
- **Integration:** Socket.IO discussion:mention → toast notification → click opens thread
- **E2E:** Full discussion flow: agent creates collab task → discussion opens → user participates → decision recorded → discussion closes

---

## Gap Analysis Summary

| Component | Status | Version | Blocker? |
|-----------|--------|---------|----------|
| CrdtTaskSync | ✅ Done | v1.0 | **Yes** — foundational persistence |
| CrdtGoalStore | ✅ Done | v1.0 | No — enhancement for goal context |
| L2CollaborationPlugin wiring | ✅ Done | v1.0 | **Yes** — plugin injection point |
| OrchestratorService wiring | ✅ Done | v1.0 | **Yes** — core integration |
| Task context enrichment | ✅ Done | v1.0 | No — quality improvement |
| Collab tool task/goal categories | ✅ Done | v1.0 | **Yes** — agent browsability |
| projectToFilesystem .md projection | ✅ Done | v1.0 | No — human readability |
| `request_task` tool | ✅ Done | v1.1 | **Yes** — agent autonomy |
| `bounce_task` tool | ✅ Done | v1.1 | No — convenience |
| `discuss` collab action | ✅ Done | v1.1 | **Yes** — collaboration |
| CollabTaskDispatcher | ✅ Done | v1.1 | **Yes** — collaboration tasks |
| WorkerPool tool injection | ✅ Done | v1.1 | **Yes** — tool delivery |
| Cross-plan references | ✅ Done | v1.1 | No — enhancement |
| Pre-plan research | ✅ Done | v1.1 | No — enhancement |
| DiscussionThread | ❌ Missing | v2.0 | **Yes** — user visibility |
| DecisionPanel | ❌ Missing | v2.0 | No — UI complement |
| DiscussionComposer | ❌ Missing | v2.0 | **Yes** — user participation |
| DiscussionListPanel | ❌ Missing | v2.0 | No — discovery UI |
| Socket.IO events | ❌ Missing | v2.0 | **Yes** — notifications |
| Agent status extension | ⚠️ Partial | v2.0 | No — observability |

**Critical path:** CrdtTaskSync (v1.0) → OrchestratorService wiring (v1.0) → request_task tool (v1.1) → discuss action (v1.1) → DiscussionThread + Composer (v2.0)
