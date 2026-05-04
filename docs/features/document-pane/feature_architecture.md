# Document Pane — Feature Architecture

**Date:** May 4, 2026
**Status:** MVP implemented — DocumentPane, DocumentList, CrdtDocViewer, WorkspaceFileViewer, backend endpoints all shipped
**Priority:** P1 — Users can't see what agents produce until they dig into CRDT manually
**Depends on:** CRDT-First Architecture PR4 (done — plan approval, completion protocol, CRDT docs all in place)
**Related:** [crdt-first-architecture](../crdt-first-architecture/feature_architecture.md)

---

## Problem

Agents write rich documents to CRDT (completion reports, research, plans). Users can't see them. The only way to view CRDT content is the dev-only `DevCollabButton`. The `DetailPanel` shows task metadata and discussions but not the documents agents produce.

## What We Want

A **Document Pane** in the frontend that shows CRDT documents in a BlockNote editor. Users can browse, read, and edit documents that agents create — plan documents, task completion reports, research notes, custom docs.

## Current Layout

```
┌──────────┬──────────────────────────┬──────────────────┐
│ Sidebar  │   ChatArea               │  DetailPanel     │
│ (w-auto) │   (flex-1)               │  (w-320, fixed)  │
│          │                          │  Task/Plan/Agent  │
│          │                          │  tabs only        │
└──────────┴──────────────────────────┴──────────────────┘
```

## Proposed Layout

```
┌──────────┬──────────────────────────┬──────────────────┐
│ Sidebar  │   ChatArea               │  DocumentPane    │
│ (w-auto) │   (flex-1)               │  (w-480,         │
│          │                          │   resizable)      │
│          │                          │                   │
│          │                          │  ┌──────────────┐│
│          │                          │  │ Doc List     ││
│          │                          │  │ or           ││
│          │                          │  │ BlockNote    ││
│          │                          │  │ Editor       ││
│          │                          │  └──────────────┘│
└──────────┴──────────────────────────┴──────────────────┘
```

## Architecture

### Option A: Replace DetailPanel (Recommended)

Replace the current `DetailPanel` (320px, fixed) with a wider `DocumentPane` (480px, resizable) that has two views:

1. **File List View** — shows all CRDT docs for the active goal, grouped by type (plan, tasks, custom docs). Each entry shows doc name, type badge, last modified.
2. **Document View** — BlockNote editor connected to Hocuspocus for the selected doc's `Y.XmlFragment("content")`. Read-only for system docs, editable for agent/user docs.

DetailPanel's current functionality (task overview, discussion, activity) moves into the Document Pane as tabs or inline sections within the task document view.

**Pros:** One panel, cleaner layout, reuses existing CollaborativeEditor infrastructure.
**Cons:** Loses the compact task-overview layout. Task metadata needs to be shown within the document view.
**Effort:** Medium — 1 week.

### Option B: Side-by-Side

Keep DetailPanel at 320px AND add DocumentPane at 480px on the far right (4-column layout).

**Pros:** No loss of DetailPanel functionality.
**Cons:** Too wide on most screens. 320 + 480 = 800px consumed by right panels.
**Effort:** Medium.

### Option C: Tabbed Within DetailPanel

Add a "Documents" tab to the existing DetailPanel. Reuse the 320px space.

**Pros:** Minimal layout changes. Familiar tab pattern.
**Cons:** 320px is too narrow for a BlockNote editor. Documents are cramped.
**Effort:** Small — 2-3 days.

## Recommendation: Option A

Replace DetailPanel with DocumentPane. 480px is the minimum for readable BlockNote content. Task metadata can be shown as a header section above the document content.

## Wireframes

### Document Pane — Plan Review (awaiting_approval)

```
┌──────────┬──────────────────────────┬────────────────────────────────────┐
│ Sidebar  │   ChatArea               │  DOCUMENT PANE (480px, resizable)  │
│          │                          │                                    │
│          │  User: Build a todo app  │  📄 Plan Document                  │
│          │  with auth               │  ─────────────────                 │
│          │                          │                                    │
│          │  🤖 Planner: I've        │  ## Approach                       │
│          │  analyzed your goal...   │                                    │
│          │                          │  We'll build a full-stack todo     │
│          │  [Plan awaiting          │  app with JWT authentication...    │
│          │   approval]              │                                    │
│          │                          │  ## Key Decisions                  │
│          │                          │                                    │
│          │                          │  - PostgreSQL for persistence      │
│          │                          │  - JWT with refresh tokens         │
│          │                          │                                    │
│          │                          │  ## Task Breakdown                 │
│          │                          │                                    │
│          │                          │  1. Database schema (backend-dev)  │
│          │                          │  2. Auth endpoints (backend-dev)   │
│          │                          │  3. Frontend components (fe-dev)   │
│          │                          │                                    │
│          │                          ├────────────────────────────────────┤
│          │                          │  [↻ Request Changes] [✓ Approve]  │
│          │                          ├────────────────────────────────────┤
│          │  ┌────────────────────┐  │  📄 plan          (pending)        │
│          │  │ Type a message  📤 │  │  📄 task-1/task    (ready)         │
│          │  └────────────────────┘  │  📄 task-2/task    (pending)       │
└──────────┴──────────────────────────┴────────────────────────────────────┘
```

### Document Pane — During Execution

```
┌──────────┬──────────────────────────┬────────────────────────────────────┐
│ Sidebar  │   ChatArea               │  DOCUMENT PANE                     │
│          │                          │                                    │
│          │  🤖 backend-dev:         │  📄 task-1/report                  │
│          │  Working on schema...    │  ─────────────────                 │
│          │                          │                                    │
│          │  ✅ task-1 completed     │  ## What Was Done                  │
│          │  ⏳ task-2 in progress   │                                    │
│          │                          │  Created PostgreSQL schema with    │
│          │                          │  4 tables: users, products,        │
│          │                          │  orders, payments...               │
│          │                          │                                    │
│          │                          │  ## Key Decisions                  │
│          │                          │                                    │
│          │                          │  - Used UUID PKs for portability   │
│          │                          │  - CASCADE deletes on FKs          │
│          │                          │                                    │
│          │                          │  ## Files Produced                 │
│          │                          │                                    │
│          │                          │  - db/schema.sql                   │
│          │                          │  - db/migrations/001-004           │
│          │                          ├────────────────────────────────────┤
│          │                          │  📋 Plan                           │
│          │                          │  ── Tasks ──                       │
│          │                          │  📄 task-1/task   ✅               │
│          │                          │  📄 task-1/report ✅               │
│          │                          │  📄 task-2/task   ⏳               │
│          │                          │  ── Workspace ──                   │
│          │                          │  📁 src/schema.ts                  │
│          │                          │  📁 src/auth/login.ts              │
└──────────┴──────────────────────────┴────────────────────────────────────┘
```

### Document List Panel (collapsed view)

```
┌────────────────────────────────────┐
│  📄 Documents                [×]  │
├────────────────────────────────────┤
│                                    │
│  📋 Plan                           │
│    └── plan                 ⏸      │
│                                    │
│  📝 Tasks (3)                      │
│    ├── task-1/task          ✅     │
│    ├── task-1/report        ✅     │
│    ├── task-2/task          ⏳     │
│    └── task-3/task          ○      │
│                                    │
│  📁 Workspace Files (5)            │
│    ├── src/schema.ts               │
│    ├── src/auth/login.ts           │
│    ├── src/routes/users.ts         │
│    └── ... 2 more                  │
│                                    │
└────────────────────────────────────┘
```

## Implementation Approach

### Components

```
DocumentPane/
  DocumentPane.tsx        — Main container, routes between list and editor views
  DocumentList.tsx        — File list view (all CRDT docs for active goal)
  DocumentEditor.tsx      — BlockNote editor connected to Hocuspocus
  DocumentHeader.tsx      — Doc metadata bar (type, author, last modified)
```

### Data Flow

```
User clicks "📄 Documents" button
  → uiStore.documentPaneOpen = true
  → DocumentPane renders

DocumentPane mounts
  → reads docNames from goalSessionStore.tasks (task docs) + known system docs (plan, goal)
  → shows DocumentList

User clicks a document
  → uiStore.documentPanePath = "{taskId}/task"
  → DocumentEditor mounts
  → HocuspocusProvider connects to collab service: ws://{COLLAB_URL}/{teamId}/{goalId}/{docName}
  → Y.XmlFragment("content") → BlockNote editor

User can browse back to list, switch between docs
```

### Existing Infrastructure (PR4 + Document Pane MVP — Implemented)

| Component | Status | Notes |
|-----------|--------|-------|
| Hocuspocus provider | ✅ Done | `CollaborativeEditor.tsx` connects via `HocuspocusProvider` |
| BlockNote editor | ✅ Done | `@blocknote/react` + `@blocknote/mantine` installed |
| CRDT docs with content | ✅ Done | `CrdtTaskSync` writes task descriptions + completion reports to `Y.XmlFragment("content")` |
| Plan doc at proposal time | ✅ Done | `plan_proposed` event writes plan to CRDT before user reviews |
| Doc metadata in Y.Map("meta") | ✅ Done | All docs have `type`, `status`, `assignedRole` etc. |
| CRDT doc listing API | ✅ Done | `GET /api/collab/:teamId/docs` returns all doc names for a team |
| Plan approval flow | ✅ Done | `PlanApproval.tsx` — task-list modal with Approve + Request Changes buttons |
| Reject/replan flow | ✅ Done | `reject-plan` socket action routes feedback to planner |
| Agent completion protocol | ✅ Done | Agents must write `{taskId}/report` before `complete_task` (enforced by tool) |
| DocumentRef context pipeline | ✅ Done | `inputDocs`, `producedDocs`, `decisions` on Task type |
| **DocumentPane container** | ✅ Done | `DocumentPane.tsx` — routes between list/editor/file viewer |
| **DocumentList** | ✅ Done | Groups docs by type (plan/tasks/reports/workspace), status badges |
| **CrdtDocViewer** | ✅ Done | Lazy-loads `CollaborativeEditor` with goal-scoped docId |
| **WorkspaceFileViewer** | ✅ Done | Fetches + renders file content in monospace |
| **Backend workspace endpoints** | ✅ Done | `GET /api/v2/workspaces/:teamId/goals/:goalId/files` + `/file/:path` |
| **Auto-open on approval** | ✅ Done | Document Pane auto-opens with plan doc when `sessionState === "awaiting_approval"` |
| **Keyboard shortcut** | ✅ Done | `Cmd+D` toggles Document Pane |
| **DetailPanel entry points** | ✅ Done | "View Documents" button in task overview + plan mode |
| Resizable pane | ❌ Planned | Fixed width (480px) with min/max constraints, no drag resize |
| Doc metadata header | ❌ Planned | CrdtDocViewer wraps CollaborativeEditor directly, no metadata bar |
| Read-only mode for system docs | ❌ Planned | All docs are currently editable |

### Architecture Decision: Liveblocks Pattern (MongoDB Owns Directory)

**Decision:** Follow the Liveblocks pattern — flat CRDT docs (rooms), MongoDB owns the hierarchy/directory.

**Evaluated alternatives:**
- **Notion pattern** (parentId in CRDT metadata) — requires every doc to carry hierarchy info, no queryable metadata, hard to integrate with Orama search
- **Hocuspocus multi-fragment** (one Y.Doc per goal with fragments) — one giant doc per goal, all content syncs together, wasteful when agent only needs one task
- **`_pages` CRDT registry** — initially designed, then rejected: makes CRDT responsible for directory structure, which MongoDB already handles better (queryable, indexed, recoverable)

**Why Liveblocks pattern:**
1. **MongoDB is already our source of truth** for tasks, goals, status. It should own the hierarchy too.
2. **CRDT is for content, not structure.** Document names are opaque room IDs. The relationship "this doc belongs to this goal" lives in MongoDB.
3. **Orama search integration** is clean: MongoDB provides faceted metadata (goalId, type, role, status), Hocuspocus `onChange` hook provides text content. Search results return MongoDB refs → frontend opens CRDT docs.
4. **Fewer CRDT connections.** Frontend queries MongoDB for the directory (one HTTP call), then opens individual CRDT docs only when the user clicks.
5. **Already how we work.** `tasks` collection knows all task docs. `goals` collection knows goal docs. No new registry needed.

**How it works:**

```
MongoDB (directory/hierarchy):
  tasks collection: [
    { taskId: "t1", goalId: "goal-A", title: "Design Schema", status: "completed", crdtDocName: "t1/task" },
    { taskId: "t2", goalId: "goal-A", title: "Build CRUD",    status: "in_progress", crdtDocName: "t2/task" },
  ]
  goals collection: [
    { goalId: "goal-A", teamId: "team-1", status: "executing" },
  ]

Hocuspocus (flat content rooms):
  "team-1/goal-A/plan"        → Y.Map("meta") + Y.XmlFragment("content")
  "team-1/goal-A/t1/task"     → Y.Map("meta") + Y.XmlFragment("content")
  "team-1/goal-A/t2/task"     → Y.Map("meta") + Y.XmlFragment("content")
  "team-1/goal-A/research"    → Y.Map("meta") + Y.XmlFragment("content")

Frontend DocumentList:
  1. GET /api/goals/:goalId/tasks → MongoDB returns task list with metadata
  2. Derive CRDT doc names from task IDs + known system docs (plan, goal)
  3. Render tree from MongoDB data
  4. User clicks doc → open HocuspocusProvider for that specific doc
```

**Agent discovery:** Agents use `collab discover` / `collab list` which queries the `CollaborationSpace.listDocs()` (server-side, no MongoDB needed). This is fine — agents run server-side and have direct CRDT access.

**Frontend discovery:** Uses MongoDB HTTP API. No CRDT connection needed to browse the directory. Only opens CRDT connections for docs the user actually opens.

### Backend: New Workspace Endpoints

```typescript
// GET /api/v2/workspaces/:teamId/goals/:goalId/files
// Lists workspace files for a goal (uses SafeAgentWorkspace.listFiles)
// Response: { files: [{ path, size, type }] }

// GET /api/v2/workspaces/:teamId/goals/:goalId/files/*path
// Read a workspace file (uses SafeAgentWorkspace.readFile)
// Response: { content: string, path: string }
```

### Frontend: Key Patterns From Existing Code

**CollaborativeEditor.tsx** (reuse directly):
```typescript
const provider = new HocuspocusProvider({
  url: serverUrl,
  name: docId,     // "{teamId}/{goalId}/{docName}"
  token,
});
const fragment = provider.document.getXmlFragment("content");
const editor = useCreateBlockNote({ collaboration: { provider, fragment, user } });
```

**Document List data source** (Liveblocks pattern — MongoDB is the directory):
```typescript
// 1. MongoDB tasks: goalSessionStore.tasks → task docs with metadata
// 2. Known system docs: ["plan", "goal"] → always exist per goal
// 3. CRDT custom docs: GET /api/collab/{teamId}/docs → filter agent-created docs
// 4. Workspace files: GET /api/v2/workspaces/{teamId}/goals/{goalId}/files
// Frontend renders tree from MongoDB data, opens CRDT docs on click
```

### UI State (uiStore additions)

```typescript
documentPaneOpen: boolean;
documentPanePath: string | null;    // "crdt:{docName}" or "workspace:{filePath}"
documentPaneType: "crdt" | "workspace" | null;
setDocumentPane: (path: string | null, type?: "crdt" | "workspace") => void;
toggleDocumentPane: () => void;
```

### Document View Modes

| URI Scheme | Viewer | Editable? |
|------------|--------|-----------|
| `crdt:plan` | BlockNote (via CollaborativeEditor) | Read-only (system) |
| `crdt:{taskId}/task` | BlockNote (via CollaborativeEditor) | Read-only (system) |
| `crdt:{custom}` | BlockNote (via CollaborativeEditor) | Editable (agent/user) |
| `crdt:{taskId}/discussion` | DiscussionThread (existing component) | Via discuss protocol |
| `workspace:src/api.ts` | CodeViewer (Monaco or plain text) | Read-only |
| `workspace:*.md` | Markdown preview | Read-only |

### Implementation Steps

1. **Backend: Add workspace file endpoints** (`workspaceRoutes.ts`)
   - `GET /api/v2/workspaces/:teamId/goals/:goalId/files` — list files
   - `GET /api/v2/workspaces/:teamId/goals/:goalId/files/*` — read file content

2. **Frontend: AgentServiceV2 methods**
   - `listCrdtDocs(teamId)` — calls `GET /api/collab/{teamId}/docs`
   - `listWorkspaceFiles(teamId, goalId)` — calls new endpoint
   - `readWorkspaceFile(teamId, goalId, path)` — calls new endpoint

3. **Frontend: DocumentPane component**
   - `DocumentPane.tsx` — container, routes between list and viewer
   - `DocumentList.tsx` — shows CRDT docs + workspace files, grouped by type
   - `CrdtDocViewer.tsx` — wraps `CollaborativeEditor` for CRDT docs
   - `WorkspaceFileViewer.tsx` — plain text / code viewer for workspace files

4. **Frontend: Wire into layout**
   - Add `documentPaneOpen` + `documentPanePath` to uiStore
   - Replace `DetailPanel` conditionally when document pane is open
   - Add entry points (task card → "View Document", plan list → "View Plan")

5. **Frontend: Auto-open on events**
   - On `sessionState === "awaiting_approval"` → auto-open plan doc
   - On task completion → show notification with "View Report" link

---

## Goal Directory — Complete Structure

Three layers, clear separation:
- **MongoDB** = directory (what exists, who owns it, what status)
- **Hocuspocus** = content rooms (rich text, readable by agents and users)
- **Workspace** = code files (git-managed, per-goal repo clone)

```
Goal: "Build a REST API for user management"
goalId: abc12345, teamId: team-1

═══════════════════════════════════════════════════════════
MongoDB (directory)
═══════════════════════════════════════════════════════════
goals: { goalId: "abc12345", title: "Build REST API", status: "executing" }
tasks: [
  { taskId: "abc1-task-1", title: "Design Schema",    status: "completed",   assignedRole: "backend" }
  { taskId: "abc1-task-2", title: "Auth Endpoints",   status: "completed",   assignedRole: "backend" }
  { taskId: "abc1-task-3", title: "CRUD Endpoints",   status: "in_progress", assignedRole: "backend" }
]

═══════════════════════════════════════════════════════════
Hocuspocus (flat content rooms)
═══════════════════════════════════════════════════════════
team-1/abc12345/plan              → Y.Map("meta") + Y.XmlFragment("content")
team-1/abc12345/goal              → Y.Map("meta") + Y.XmlFragment("content")
team-1/abc12345/abc1-task-1/task  → Y.Map("meta") + Y.XmlFragment("content") [has completion report]
team-1/abc12345/abc1-task-2/task  → Y.Map("meta") + Y.XmlFragment("content") [has completion report]
team-1/abc12345/abc1-task-3/task  → Y.Map("meta") + Y.XmlFragment("content") [task description]
team-1/abc12345/agent-statuses    → Y.Map("meta") [ephemeral]
team-1/abc12345/_index            → Y.Map("meta") [byRole, byStatus]

═══════════════════════════════════════════════════════════
Workspace (git)
═══════════════════════════════════════════════════════════
/workspaces/abc12345/
  ├── src/schema.ts          ← produced by task-1
  ├── src/auth/login.ts      ← produced by task-2
  └── src/routes/users.ts    ← being written by task-3

═══════════════════════════════════════════════════════════
Frontend Document Pane (tree rendered from MongoDB + workspace)
═══════════════════════════════════════════════════════════
📂 Build REST API
├── 📋 Plan Document                      ← crdt: plan
├── 📝 Tasks
│   ├── ✅ Design Schema                  ← crdt: abc1-task-1/task
│   ├── ✅ Auth Endpoints                 ← crdt: abc1-task-2/task
│   └── 🔄 CRUD Endpoints                ← crdt: abc1-task-3/task
└── 📁 Workspace Files
    ├── src/schema.ts                     ← workspace
    ├── src/auth/login.ts                 ← workspace
    └── src/routes/users.ts               ← workspace
```

### How Agents Read the Goal Directory

Agents run server-side and have direct CRDT access via the `collab` tool. They DON'T use MongoDB or HTTP APIs. The goal directory for agents comes from CRDT:

```
Agent dispatched for task "abc1-task-3" (Build CRUD Endpoints)

1. ENRICHED DESCRIPTION (injected by TaskContextBuilder):
   ─────────────────────────────────────────────────────
   ## Build CRUD Endpoints
   **Role:** backend | **Priority:** 3

   ## Input Documents
   - **schema.ts**: `workspace_read_file src/schema.ts` — Produced by backend
   - **login.ts**: `workspace_read_file src/auth/login.ts` — Produced by backend
   - **backend task context**: `collab read abc1-task-1/task` — Summary: Created database schema...
   - **backend task context**: `collab read abc1-task-2/task` — Summary: JWT authentication...

   ## Upstream Decisions
   - [backend] Use UUID for primary keys
   - [backend] Use bcrypt for password hashing

   ## Context Sources (use collab read to access)
   - Your task: collab read abc1-task-3/task
   - Plan: collab read plan
   - Goal: collab read goal
   - Completed dependencies: abc1-task-1/task, abc1-task-2/task

   ## Your Team
   - technical-writer

2. AGENT DISCOVERS DIRECTORY via collab tool:
   ─────────────────────────────────────────
   collab({ action: "discover" })
   → "Available categories: crdt (7 docs), tasks (3), goal, plans"

   collab({ action: "discover", docName: "crdt" })
   → "CRDT docs: plan, goal, abc1-task-1/task, abc1-task-2/task,
      abc1-task-3/task, agent-statuses, _index"

   collab({ action: "list", docName: "abc1-task-1/task" })
   → "Keys in abc1-task-1/task: type, id, title, assignedRole,
      status, body, output, completedAt..."

3. AGENT READS SPECIFIC DOCS:
   ──────────────────────────
   collab({ action: "read", docName: "plan" })
   → Full plan overview with all tasks

   collab({ action: "read-block", docName: "abc1-task-1/task" })
   → Rich completion report in markdown (from Y.XmlFragment)

   collab({ action: "read", docName: "_index" })
   → { byRole: { backend: [...] }, byStatus: { completed: [...] } }

   collab({ action: "read", docName: "agent-statuses" })
   → { backend: { status: "busy", task: "abc1-task-3" } }

4. AGENT READS WORKSPACE FILES:
   ────────────────────────────
   workspace_read_file("src/schema.ts")
   → File content from git workspace

   workspace_list_files("src/")
   → ["schema.ts", "auth/login.ts", "auth/middleware.ts", "routes/users.ts"]

5. AGENT WRITES DURING EXECUTION:
   ──────────────────────────────
   collab({ action: "write-block", docName: "abc1-task-3/task",
     value: "## Progress\nImplemented GET /users endpoint..." })
   → Writes to Y.XmlFragment — visible to user in Document Pane in real-time

   collab({ action: "record-decision", docName: "abc1-task-3/task",
     key: "pagination", value: { decision: "Use cursor-based pagination" } })
   → Records decision for downstream agents
```

**Key difference: Agents vs Frontend:**

| | Agents (server-side) | Frontend (browser) |
|---|---|---|
| **Directory** | `collab discover` / `collab list` (CRDT) | MongoDB HTTP API (tasks, goals) |
| **Content** | `collab read` / `collab read-block` (CRDT) | HocuspocusProvider → BlockNote (CRDT) |
| **Workspace** | `workspace_read_file` / `workspace_list_files` (filesystem) | HTTP API endpoint (new) |
| **Why different** | Direct CRDT access via CollaborationSpace | Browser can't access filesystem or CRDT server directly |
