# Plan Session — Feature Architecture

**Date:** May 3, 2026
**Status:** Architecture design
**Priority:** P0 — Phase 3 in [PLATFORM-ROADMAP](../../PLATFORM-ROADMAP.md)
**Depends on:** Phase 1 (DB safety + CRDT restore)
**Supersedes:** [plan-viewer](../plan-viewer/), [approval-system](../approval-system/) — both merged into this feature
**Related:** [crdt-first-architecture](../crdt-first-architecture/feature_architecture.md), [task-context-and-crdt](../task-context-and-crdt/feature_architecture.md)

---

## Problem

Plans exist as raw JSON objects (`submit_plan` tool produces a structured JSON array). The planner auto-approves without user review. Users see task cards, not readable documents. There's no way to review the planner's reasoning, edit a plan, or request revisions before execution begins.

**Current flow:**
```
Planner → submit_plan({ tasks: [...] }) → JSON in GoalContext.pendingPlan
  → Auto-approves immediately
  → User never reviews the plan
  → Tasks created from JSON array
```

**What's wrong:**
1. No readable plan document — users see task cards, not the planner's reasoning
2. Auto-approve — user can't review before execution
3. No editing — user can't modify task descriptions, priorities, or dependencies
4. No revision cycle — user can't ask "change the approach" and see the plan update
5. Plans stored as JSON files on disk (PlanStore) — fragile, not collaborative

---

## Target Flow

```
1. User submits goal: "Build a REST API for user management"
2. Planner analyzes → writes plan DOCUMENT to CRDT
   - Readable prose: approach, rationale, risks, trade-offs
   - Structured section: task breakdown with roles, deps, priority
3. Frontend renders plan in BlockNote (live from CRDT)
4. User reviews plan document:
   a) Reads the rationale and approach
   b) Sees task cards derived from the document
   c) Can edit the document directly (fix descriptions, change approach)
   d) Can chat with planner: "Split task 3 into two tasks" → planner updates doc
   e) Can click "Replan" → planner rewrites the document from scratch
5. User clicks "Approve Plan"
6. System reads plan-doc → creates task records in MongoDB + per-task CRDT pages
7. Workers dispatched → read task pages from CRDT
8. During execution: user can still edit task pages (refine acceptance criteria)
```

---

## Frontend Wireframes

The current layout is: **Sidebar (w-60) | ChatArea (flex-1) | DetailPanel (w-80, conditional)**. Title bar on top, status bar on bottom.

We keep this layout. Documents open in a **resizable Document Pane** that replaces DetailPanel when triggered.

### Current Layout (for reference)

```
┌─────────────────────────────────────────────────────────┐
│ Title Bar                                               │
├──────────┬──────────────────────────────┬───────────────┤
│ Sidebar  │ Context Bar                  │ DetailPanel   │
│ (w-60)   ├──────────────────────────────┤ (w-80)       │
│          │                              │ conditional  │
│ Team     │       ChatArea               │              │
│ ──────── │   MessageList + ChatInput    │ task/plan/   │
│ PLAN     │                              │ agent tabs   │
│ (tasks)  │                              │              │
│ ──────── │                              │              │
│ AGENTS   │                              │              │
├──────────┴──────────────────────────────┴───────────────┤
│ StatusBar                                               │
└─────────────────────────────────────────────────────────┘
```

### Document Pane (new component — replaces DetailPanel when open)

A resizable right-side pane with two views: **file list** (all CRDT pages for the goal) and **document view** (BlockNote editor for a selected page). Opens when user clicks "📄 View Documents" from DetailPanel or when system auto-opens during `awaiting_approval`.

```
Document Pane states:

File List View:                    Document View:
┌──────────────────────┐          ┌──────────────────────┐
│  📂 Documents        │          │  ← 📂 Back to list   │
│  ─────────────       │          │  ─────────────       │
│  📋 Plan Doc     NEW │   click  │  📝 task-2: CRUD     │
│  📝 task-1       ✅  │ ──────→ │  ┌──────────────────┐│
│  📝 task-2       🔄  │          │  │ [BlockNote editor]││
│  📝 task-3       ⏳  │          │  │ renders CRDT page ││
│  📄 task-1/rpt   NEW │          │  │ editable          ││
│                      │          │  └──────────────────┘│
│       [× Close]      │          │  [← Back] [× Close]  │
└──────────────────────┘          └──────────────────────┘
```

### Sidebar — Plan Document entry

Add `📋 Plan Document` as a clickable item at the top of the Plan section:

```
┌─────────────────────────┐
│ ▾ Plan (3/5)            │
│  📋 Plan Document       │ ← click = DetailPanel (plan mode)
│  ─────────────────      │    DetailPanel has "📄 View Document" button
│  ✅ Design DB           │
│  🔄 CRUD endpoints      │ ← click = DetailPanel (task mode)
│  ⏳ Authentication       │    DetailPanel has "📄 View Document" button
│  ○ Write tests          │
│  ○ API docs             │
└─────────────────────────┘
```

### DetailPanel — "View Documents" button

Both plan and task DetailPanel modes get a "📄 View Documents" button that opens the Document Pane with a file list:

```
DetailPanel (task selected):         DetailPanel (plan selected):
┌─────────────────────┐              ┌─────────────────────┐
│ task-2: CRUD endpts  │              │ 📋 Plan              │
│ ─────────────────── │              │ ─────────────────── │
│ Overview | Discuss   │              │ Tasks | Activity    │
│ ─────────────────── │              │ ─────────────────── │
│ Status: 🔄           │              │ 5 tasks, 2 agents  │
│ Role: backend-dev    │              │ Status: reviewing   │
│ Priority: 2          │              │                     │
│ Deps: task-1         │              │ [📄 View Documents] │
│ ─────────────────── │              │                     │
│ Description:         │              │ [✓ Approve Plan]    │
│ Build POST/GET...    │              │ [↻ Replan]          │
│                      │              │                     │
│ [📄 View Documents]  │              └─────────────────────┘
│ [▶ Start Task]       │
└─────────────────────┘
```

### Document Pane — File List + Document View

Click "📄 View Documents" → Document Pane opens with a **file list** of all CRDT pages for this goal. Click a file → document opens in the same pane.

**File list view (initial):**

```
┌──────────┬──────────────────────┬──────────────────────────┐
│ Sidebar  │     ChatArea         │  Document Pane           │
│          │                      │                          │
│ PLAN     │  Chat with planner   │  📂 Documents            │
│ 📋 Plan  │  or agent. Works     │  ─────────────────       │
│ • task-1 │  normally.           │  📋 Plan Document    NEW │
│ • task-2 │                      │  📝 task-1: Design DB NEW│
│ • task-3 │                      │  📝 task-2: CRUD     NEW │
│ • task-4 │                      │  📝 task-3: Auth     NEW │
│ • task-5 │                      │  📝 task-4: Tests    NEW │
│ ──────── │                      │  📝 task-5: API docs NEW │
│ AGENTS   │                      │                          │
│          │  ┌────────────────┐  │                          │
│          │  │ type message.. │  │                          │
│          │  └────────────────┘  │         [× Close]        │
└──────────┴──────────────────────┴──────────────────────────┘
```

**Click a file → document opens (same pane):**

```
┌──────────┬──────────────────────┬──────────────────────────┐
│ Sidebar  │     ChatArea         │  Document Pane           │
│          │                      │  ← 📂 Back to list       │
│ PLAN     │                      │  ─────────────────       │
│ 📋 Plan  │                      │  📝 task-2: CRUD endpts  │
│ • task-1 │                      │  ┌──────────────────┐   │
│ • task-2 │                      │  │ # CRUD Endpoints  │   │
│ • task-3 │                      │  │                   │   │
│ • task-4 │                      │  │ ## Description    │   │
│ • task-5 │                      │  │ Build POST/GET/   │   │
│          │                      │  │ PUT/DELETE for     │   │
│ ──────── │                      │  │ /users endpoint   │   │
│ AGENTS   │                      │  │                   │   │
│          │                      │  │ ## Acceptance     │   │
│          │  ┌────────────────┐  │  │ - [ ] GET /users  │   │
│          │  │ type message.. │  │  │ - [ ] POST /users │   │
│          │  └────────────────┘  │  └──────────────────┘   │
│          │                      │  [← Back]   [× Close]   │
└──────────┴──────────────────────┴──────────────────────────┘
```

**During execution — file list shows status + new docs:**

```
Document Pane (file list):
┌──────────────────────────┐
│  📂 Documents            │
│  ─────────────────       │
│  📋 Plan Document        │
│  📝 task-1: Design DB  ✅│  completed
│  📝 task-2: CRUD       🔄│  in progress
│  📝 task-3: Auth       ⏳│  waiting
│  📝 task-4: Tests      ○ │  pending
│  📝 task-5: API docs   ○ │  pending
│  ─────────────────       │
│  📄 task-1/report    NEW │  completion report
│  📄 research/pricing NEW │  agent-created doc
└──────────────────────────┘
```

**Behaviors:**

| Interaction | What happens |
|-------------|-------------|
| "📄 View Documents" in DetailPanel | DetailPanel closes → Document Pane opens with file list |
| Click file in list | File list → document view (BlockNote). "← Back" returns to list. |
| Click different task in sidebar (while doc pane open) | Document Pane navigates to that task's document (skips file list) |
| Drag left edge of Document Pane | Resize: wider or narrower. Min ~300px. |
| Edit in BlockNote | Writes to CRDT. Real-time sync. |
| `× Close` | Document Pane closes → DetailPanel returns |
| New doc appears during execution | Shows in file list with NEW badge |
| Click agent name in sidebar | Document Pane closes. Chat switches to agent. DetailPanel returns. |

### State 1: Planning (`sessionState: "planning"`)

**No layout change.** Planner streams chat in ChatArea. Task cards populate live in sidebar and DetailPanel.

```
┌─────────────────────────────────────────────────────────┐
│ Title Bar                                   🟡 Planning │
├──────────┬──────────────────────────────┬───────────────┤
│ Sidebar  │ Context Bar: "Planner"       │               │
│          ├──────────────────────────────┤ DetailPanel   │
│ Team: BE │                              │ (plan mode)  │
│ ──────── │  User: Build a REST API for  │              │
│ PLAN     │  user management with auth   │ Tasks:       │
│ 📋 Plan  │                              │ (populates   │
│ (empty)  │  Planner: I'll design a plan │  live)       │
│ ──────── │  with 5 tasks...             │ • task-1     │
│ AGENTS   │                              │ • task-2     │
│ • plnr 🔄│  [streaming plan text...]    │ • task-3     │
│ • back   │                              │              │
│ • qa     │  ┌────────────────────────┐  │              │
│          │  │ type a message...      │  │              │
│          │  └────────────────────────┘  │              │
├──────────┴──────────────────────────────┴───────────────┤
│ StatusBar                                               │
└─────────────────────────────────────────────────────────┘
```

### State 2: Awaiting Approval (`sessionState: "awaiting_approval"`)

System auto-opens Document Pane with file list showing plan doc + all task documents. User clicks a file to review it. Approve/Replan buttons on the plan document view.

```
Auto-opens with file list:

┌──────────┬────────────────────────┬─────────────────────────┐
│ Sidebar  │  ChatArea              │  Document Pane (auto)   │
│          ├────────────────────────┤← drag to resize         │
│ PLAN     │                        │  📂 Documents           │
│ 📋 Plan  │  Planner: I've created │  ─────────────────      │
│ • task-1 │  the plan. Review the  │  📋 Plan Document   NEW │
│ • task-2 │  documents and approve │  📝 task-1: Design  NEW │
│ • task-3 │  when ready.           │  📝 task-2: CRUD    NEW │
│ • task-4 │                        │  📝 task-3: Auth    NEW │
│ • task-5 │                        │  📝 task-4: Tests   NEW │
│ ──────── │                        │  📝 task-5: Docs    NEW │
│ AGENTS   │  ┌──────────────────┐  │                         │
│          │  │ type message...  │  │                         │
│          │  └──────────────────┘  │         [× Close]       │
├──────────┴────────────────────────┴─────────────────────────┤
│ StatusBar                                                   │
└─────────────────────────────────────────────────────────────┘

User clicks "📋 Plan Document" → plan opens in BlockNote:

┌──────────┬────────────────────────┬─────────────────────────┐
│ Sidebar  │  ChatArea              │  Document Pane          │
│          ├────────────────────────┤  ← 📂 Back to list      │
│ PLAN     │                        │  ─────────────────      │
│ 📋 Plan  │  User can chat here:   │  📋 Plan Document       │
│ • task-1 │  "Split task 3 into    │  ┌─────────────────┐   │
│ • task-2 │   auth and authz"      │  │ # Build User    │   │
│ • task-3 │                        │  │ Management API  │   │
│ • task-4 │  Planner: Done! I've   │  │                 │   │
│ • task-5 │  updated the plan...   │  │ ## Approach     │   │
│ ──────── │                        │  │ Express + PG... │   │
│ AGENTS   │                        │  │                 │   │
│          │  ┌──────────────────┐  │  │ ## Tasks        │   │
│          │  │ type message...  │  │  │ 1. Design DB   │   │
│          │  └──────────────────┘  │  │ 2. CRUD...     │   │
│          │                        │  └─────────────────┘   │
│          │                        │  [← Back]              │
│          │                        │  [✓ Approve] [↻ Replan]│
├──────────┴────────────────────────┴─────────────────────────┤
│ StatusBar                                                   │
└─────────────────────────────────────────────────────────────┘
```

**User can:**
- See all documents in the file list (plan + tasks)
- Click any document to review/edit it in BlockNote
- Chat with planner in ChatArea — "change the approach", "add a task"
- Planner updates documents → BlockNote updates in real-time
- Navigate between documents via "← Back" to file list
- Click "✓ Approve" on plan document → system creates tasks → execution begins
- Click "↻ Replan" → planner rewrites from scratch

### State 3: Executing (`sessionState: "executing"`)

**No layout change.** DetailPanel returns. User can click "📄 View Documents" on any task to open Document Pane.

```
┌─────────────────────────────────────────────────────────┐
│ Title Bar                                  🟢 Executing │
├──────────┬──────────────────────────────┬───────────────┤
│ Sidebar  │ Context Bar: "backend-dev"   │ DetailPanel   │
│          ├──────────────────────────────┤              │
│ PLAN     │                              │ Task: task-2 │
│ 📋 Plan  │  backend-dev: Working on     │ ───────────  │
│ ✅ task-1│  CRUD endpoints...           │ Status: 🔄   │
│ 🔄 task-2│                              │ Role: backend│
│ ⏳ task-3│  [streaming agent output]    │ Deps: task-1 │
│ ○ task-4 │                              │ ───────────  │
│ ○ task-5 │  Tool: workspace_write_file  │ Description: │
│ ──────── │  → src/routes/users.ts       │ Build CRUD.. │
│ AGENTS   │                              │              │
│          │  ┌────────────────────────┐  │[📄 View Docs]│
│          │  │ type a message...      │  │ [▶ Start]    │
│          │  └────────────────────────┘  │              │
├──────────┴──────────────────────────────┴───────────────┤
│ StatusBar                                               │
└─────────────────────────────────────────────────────────┘
```

**User clicks "📄 View Docs" → Document Pane opens with file list showing status + new docs:**

```
┌──────────┬──────────────────────┬──────────────────────────┐
│ Sidebar  │     ChatArea         │  Document Pane           │
│          │                      │← drag to resize          │
│ PLAN     │  Agent output        │  📂 Documents            │
│ 📋 Plan  │  streams here        │  ─────────────────       │
│ ✅ task-1│  as normal.           │  📋 Plan Document        │
│ 🔄 task-2│                      │  📝 task-1: Design DB ✅ │
│ ⏳ task-3│                      │  📝 task-2: CRUD      🔄 │
│          │                      │  📝 task-3: Auth      ⏳ │
│ ──────── │                      │  📝 task-4: Tests     ○  │
│ AGENTS   │                      │  📝 task-5: API docs  ○  │
│          │                      │  ─────────────────       │
│          │  ┌────────────────┐  │  📄 task-1/report   NEW  │
│          │  │ type message.. │  │  📄 research/pricing NEW │
│          │  └────────────────┘  │         [× Close]        │
└──────────┴──────────────────────┴──────────────────────────┘
```

Click `📄 task-1/report` to read the completion report. Click `📄 research/pricing` to read agent-created research. Navigate via `← Back` to return to the file list.

---

## Architecture

### Data Flow

```
Planner Agent                     CRDT (Hocuspocus)                    MongoDB
─────────────                     ──────────────────                   ───────

writes markdown ──────→ plan-doc page                                 
                        Y.Map("meta"): { goal, status: "draft",       
                          taskSummaries: [...] }                      
                        Y.XmlFragment("content"): BlockNote blocks    
                                │                                      
                    ┌───────────┘                                      
                    ▼                                                  
              Frontend observes plan-doc                               
              → renders in BlockNote                                  
              → derives task cards from meta.taskSummaries             
                                │                                      
                    ┌───────────┘                                      
                    ▼                                                  
              User reviews / edits / chats with planner               
              User clicks "Approve Plan"                              
                                │                                      
                    ┌───────────┘                                      
                    ▼                                                  
              System reads plan-doc                                    
              → creates per-task CRDT pages ──→ {goalId}/{taskId}/task 
              → derives task records ────────────────────────→ tasks collection
              → sets plan-doc status: "approved"                      
                                │                                      
                    ┌───────────┘                                      
                    ▼                                                  
              Workers dispatched                                      
              → read task pages from CRDT                             
              → write completion reports                              
              → MongoDB status updates ──────────────────────→ tasks.status
```

### How the Planner Writes the Document

**Current:** Planner calls `submit_plan({ tasks: [...] })` which produces a JSON object.

**New:** Planner writes a markdown document using `collab write-block`. The document has a specific structure the system can parse:

```markdown
# Build User Management API

## Approach
RESTful API using Express with PostgreSQL for storage. 
We'll use Knex for migrations and Passport for auth.

## Risks
- Auth complexity → mitigate with Passport.js
- Schema migrations → mitigate with Knex seed files

## Tasks

### task-1: Design DB Schema
- **Role:** backend-dev
- **Priority:** 1
- **Dependencies:** none
- **Expected Output:** Migration files for users, roles, sessions tables

Design the PostgreSQL schema for user management...

### task-2: Implement CRUD Endpoints
- **Role:** backend-dev  
- **Priority:** 2
- **Dependencies:** task-1
- **Expected Output:** Express routes for /users CRUD

Build POST/GET/PUT/DELETE endpoints...
```

The `## Tasks` section has a parseable structure. Each `### task-{id}: Title` heading starts a task with metadata lines (`Role`, `Priority`, `Dependencies`, `Expected Output`) followed by the description.

**The system extracts `meta.taskSummaries[]` from this structure** — an array of `{ id, title, role, priority, deps[], expectedOutput }` that the frontend uses for task cards and the approve flow uses for MongoDB records.

### Extraction: Document → Task Summaries

```typescript
// System observes plan-doc content changes
// Extracts structured task data from the markdown structure
function extractTaskSummaries(blocks: Block[]): TaskSummary[] {
  // Find the "## Tasks" section
  // For each "### task-{id}: Title" heading:
  //   Parse metadata lines (Role, Priority, Dependencies, Expected Output)
  //   Capture description (remaining content until next ### heading)
  // Return TaskSummary[]
}

// Write to meta.taskSummaries for frontend consumption
planDoc.getMap("meta").set("taskSummaries", summaries);
```

This extraction runs automatically when the document changes (observer). The task cards in the sidebar are derived from `meta.taskSummaries` — not from the document content directly.

### Plan States

```
draft → reviewing → approved → executing → completed
  │         │           │                      │
  │         │           └── system creates     │
  │         │               task records       │
  │         │                                   │
  │         └── user edits, chats with planner │
  │                                             │
  └── planner writing the document             │
                                                │
                              replan ──→ draft (new version)
```

| State | Who Can Edit | What Happens |
|-------|-------------|-------------|
| `draft` | Planner (writing) | Planner creates document. Frontend shows "Planning..." |
| `reviewing` | User + Planner | User reads, edits, chats. Planner can update on request. |
| `approved` | System only | System creates task records + per-task pages. Brief transition. |
| `executing` | User (task pages) | Workers execute. User can edit task pages. Plan doc read-only. |
| `completed` | Nobody | All tasks done. Plan archived. |

### Per-Task Pages (Created on Approve)

When the user approves, the system creates a CRDT page for each task:

```
{goalId}/{taskId}/task
  Y.Map("meta"): { id, title, assignedRole, status, priority, dependencies[],
                    inputDocs[], expectedOutputDocs[] }
  Y.XmlFragment("content"): task description from plan + acceptance criteria
```

Workers read these pages via `collab read {taskId}/task`. The description comes from the plan document's task section. Users can edit task pages during execution (e.g., add acceptance criteria, clarify requirements).

### What Gets Eliminated

| Current | Replacement |
|---------|------------|
| `submit_plan` tool (JSON array) | Planner writes markdown document via `collab write-block` |
| `GoalContext.pendingPlan` (in-memory JSON) | CRDT plan-doc with `status: "draft"` |
| Auto-approve in `submit_plan` | Explicit user approval via "Approve Plan" button |
| `PlanStore` (JSON files on disk) | CRDT plan-doc + MongoDB task records |
| `FilePlanStore` directory layout | Deleted |
| Task descriptions in JSON `context.title` | Task CRDT page with full BlockNote content |

---

## Integration Points

| Component | Change |
|-----------|--------|
| **Planner agent** | Uses `collab write-block` to write plan document instead of `submit_plan` JSON |
| **`submit_plan` tool** | Deprecated or replaced with `finalize_plan` (sets status to "reviewing") |
| **GoalManager.approvePlan()** | Reads plan-doc from CRDT → creates task records (not from pendingPlan JSON) |
| **OrchestratorService** | On approve: creates per-task CRDT pages from plan content |
| **SocketServerV2** | New action: `approve-plan` (existing), `replan` (planner rewrites doc) |
| **Frontend GoalScreen** | New layout: chat + plan document (BlockNote) + task sidebar |
| **Frontend PlanApproval** | Replaced by inline "Approve Plan" button on plan document view |
| **@blocknote/server-util** | New dependency in `packages/collaboration` for markdown↔blocks |
| **Hocuspocus** | Frontend connects to plan-doc via Y.XmlFragment collaboration |

---

## Open Questions

1. **Should the planner use a structured tool or raw markdown?** Option A: planner writes free-form markdown, system parses task structure. Option B: planner still calls a tool that writes structured markdown. Recommend Option B — more reliable extraction.

2. **How does task reordering work?** If user drags task cards in the sidebar, does it update the document? Or is the document the only way to reorder? Recommend: sidebar is read-only, derived from document. Reorder by editing document.

3. **What happens to existing `submit_plan` users?** Backward compat: keep `submit_plan` working but mark deprecated. New flow is default.
