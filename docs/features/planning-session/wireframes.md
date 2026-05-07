# Planning Session — Wireframes

## Layout Modes

The planning session has two layout modes. The user switches between them based on what they need.

### Mode 1: Chat View (Default)
```
┌──────────────────────────────────────────────────────────────────┐
│ ◀ Back   Marketing Team   ●  gathering   ⚡ 3 docs             │
├──────┬───────────────────────────────────────────────────────────┤
│      │                                                           │
│ Side │   CHAT                                                    │
│ bar  │                                                           │
│      │   🤖 Planner: I'll analyze this goal and create a plan.  │
│ Teams│   I'll start by researching the API landscape...          │
│      │                                                           │
│ Docs │   📄 Plan Document created                                │
│  ├plan│   📄 Research Document created                           │
│  ├res│                                                           │
│  └arch│  🤖 Planner: I've written the plan document with the    │
│      │   approach and architecture decisions. Take a look at     │
│ Tasks│   the plan doc and let me know if you want changes.       │
│      │                                                           │
│      │   👤 You: Can you add a section about error handling?     │
│      │                                                           │
│      │   🤖 Planner: Done. I've added error handling strategy    │
│      │   to the plan document. Ready to submit the plan?         │
│      │                                                           │
│      │  ┌──────────────────────────────────────────────┐         │
│      │  │  Type a message...                      Send │         │
│      │  └──────────────────────────────────────────────┘         │
└──────┴───────────────────────────────────────────────────────────┘
```

### Mode 2: Workspace View (File Explorer)
Chat compressed left. Editor dominates center. File tree narrow right.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◀  Marketing Team   ●  gathering   📁 Workspace                          │
├────────────┬───────────────────────────────────────────────┬───────────────┤
│            │                                               │               │
│  CHAT      │  DOCUMENT EDITOR                              │  FILES        │
│            │                                               │               │
│  🤖 I've  │  # Plan: Build REST API                       │  📁 plan/     │
│  written   │                                               │  ├ 📄 plan ●  │
│  the plan. │  ## Goal                                      │  ├ 📄 research│
│  Review it │  Build a REST API for a notes app with auth   │  └ 📄 arch   │
│  in the    │  and search functionality.                    │               │
│  editor.   │                                               │  📁 tasks/    │
│            │  ## Approach                                   │  ├ 📋 task-1  │
│  👤 Looks │  We'll use Express.js with PostgreSQL for     │  ├ 📋 task-2  │
│  good, but │  the database. Auth via JWT with refresh      │  ├ 📋 task-3  │
│  add rate  │  rotation. Full-text search via PostgreSQL    │  ├ 📋 task-4  │
│  limiting. │  tsvector — no external search service.       │  └ 📋 task-5  │
│            │                                               │               │
│  🤖 Added │  ## Key Decisions                             │  📁 reports/  │
│  to the    │  - **JWT over sessions**: Stateless, scales   │  └ (empty)    │
│  arch doc. │    horizontally without session store          │               │
│            │  - **PostgreSQL over MongoDB**: Relational     │  📁 user/     │
│            │    data — users, notes, permissions need       │  └ 📄 notes  │
│            │    JOINs and constraints                       │               │
│            │  - **No ORM**: Raw SQL with parameterized      │  ─────────── │
│            │    queries for performance                     │  [+ New Doc] │
│            │                                               │               │
│            │  ## Risks & Mitigations                        │               │
│            │  - Rate limiting needed for auth endpoints     │               │
│            │  - Search indexing may be slow on large        │               │
│            │    datasets — add pagination early             │               │
│            │                                               │               │
│ ┌────────┐ │  [Editing as: You]                    ●Live   │               │
│ │ Msg  ↩ │ │                                               │               │
│ └────────┘ │                                               │               │
└────────────┴───────────────────────────────────────────────┴───────────────┘
  ~15%                      ~65%                               ~20%
```

---

## File Explorer Panel Detail

```
┌───────────────────────┐
│  📁 WORKSPACE         │
│  Goal: Build REST API │
├───────────────────────┤
│                       │
│  📁 plan/             │
│  ├── 📄 plan     ← ● │  ← Selected (shown in editor)
│  ├── 📄 research      │  ← Planner's research findings
│  └── 📄 architecture  │  ← Architecture decisions
│                       │
│  📁 tasks/            │
│  ├── 📋 task-1  ○     │  ← ○ pending  ● in_progress  ✓ done
│  ├── 📋 task-2  ○     │
│  ├── 📋 task-3  ○     │
│  ├── 📋 task-4  ○     │
│  └── 📋 task-5  ○     │
│                       │
│  📁 reports/          │
│  └── (appears after   │
│       task completion) │
│                       │
│  📁 user/             │
│  ├── 📄 requirements  │  ← User-created doc
│  └── 📄 notes         │  ← User-created doc
│                       │
├───────────────────────┤
│  [+ New Document]     │
│  [📤 Export All]      │
└───────────────────────┘
```

### File Icons

| Icon | Meaning |
|------|---------|
| 📄 | Document (plan, research, architecture, user-created) |
| 📋 | Task specification |
| 📁 | Folder (collapsible) |
| ● | Currently open in editor |
| 🔴 | Has unread changes since last view |
| 👥 | Someone else is editing (co-editing active) |

---

## Ready State — Back to Default View

When the plan document has content, the user can switch back to the default (chat) view. This is the **ready** state — the plan exists, the user can review tasks, approve, and start execution. No separate "approval dialog" — the default view IS the approval surface.

```
┌──────────────────────────────────────────────────────────────────┐
│ ◀ Back   Marketing Team   ●  ready                             │
├──────┬───────────────────────────────────────────────────────────┤
│      │                                                           │
│ Side │   CHAT                                                    │
│ bar  │                                                           │
│      │   🤖 Planner: Plan submitted with 5 tasks.               │
│ Plan │   Review the plan document and approve when ready.        │
│ ├plan│                                                           │
│ ├res │   📄 Plan document ready — click to view                  │
│ └arch│                                                           │
│      │   ── Tasks ──────────────────────────────────             │
│ Tasks│   1. ○ Setup DB        backend · P1                       │
│ 1. ○ │   2. ○ Auth API        backend · P2  → task-1             │
│ 2. ○ │   3. ○ Search API      backend · P2  → task-1             │
│ 3. ○ │   4. ○ Frontend UI     frontend · P3 → 2, 3               │
│ 4. ○ │   5. ○ Testing         qa · P4       → 4                  │
│ 5. ○ │                                                           │
│      │   ── Readiness ──────────────────────────────             │
│ Ready│   ✓ Plan doc written                                      │
│ ✓✓✓✓ │   ✓ All roles exist                                      │
│      │   ✓ Valid dependency graph                                │
│      │   ✓ Repository configured                                │
│      │                                                           │
│      │   [▶ Start Execution]  [✏ Request Changes]               │
│      │                                                           │
│      │   👤 You: Looks good, but can task-3 run in parallel     │
│      │   with task-2?                                            │
│      │                                                           │
│      │   🤖 Planner: Good point — I've removed the dependency. │
│      │   Tasks 2 and 3 will now run in parallel.                 │
│      │                                                           │
│      │  ┌──────────────────────────────────────────────┐         │
│      │  │  Type a message...                      Send │         │
│      │  └──────────────────────────────────────────────┘         │
└──────┴───────────────────────────────────────────────────────────┘
```

**How the user gets here:**
1. In workspace view (`gathering`), planner writes plan document + submits plan
2. User clicks back to default/chat view → state is now `ready`
3. Sidebar shows plan docs, tasks, and readiness checklist
4. User can still chat with planner to tweak tasks before starting
5. User clicks [▶ Start Execution] → workers dispatch

**Key:** There's no popup/modal. The default chat view naturally becomes the review surface when a plan exists. The user switches to workspace view to read/edit documents, comes back to chat view to approve.

---

## Execution — Workers Active

During execution, the workspace shows **L1 only** (repo files). Worker chat on the left. No L2 docs visible — the user is in execution mode, watching code get produced.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◀  Marketing Team   ●  ready   ⏳ 2/5 running                           │
├────────────┬───────────────────────────────────────────────┬───────────────┤
│            │                                               │               │
│ WORKER CHAT│  FILE VIEWER (L1 — repo)                      │  L1 FILES     │
│            │                                               │               │
│ 🤖 backend│  // src/routes/auth.ts                        │  📁 src/      │
│ Starting   │                                               │  ├ 📁 routes/ │
│ auth API   │  import { Router } from "express";            │  │ ├ auth.ts ●│
│ implemen-  │  import { hashPassword, verifyJWT }           │  │ ├ notes.ts │
│ tation...  │    from "../utils/auth.js";                   │  │ └ search.ts│
│            │                                               │  ├ 📁 models/ │
│ 🔧 Using  │  const router = Router();                     │  │ ├ user.ts  │
│ tool:      │                                               │  │ └ note.ts  │
│ write_file │  router.post("/register", async (req, res) => │  ├ 📁 utils/  │
│ auth.ts    │    const { email, password } = req.body;      │  │ └ auth.ts  │
│            │    const hashed = await hashPassword(password);│  ├ server.ts  │
│ 🤖 Created│    // ...                                     │  └ package.json│
│ user model │  });                                          │               │
│ and auth   │                                               │               │
│ routes.    │  router.post("/login", async (req, res) => {  │               │
│ Working on │    // JWT generation + refresh token          │               │
│ JWT now... │  });                                          │               │
│            │                                               │               │
│ ┌────────┐ │  [Agent: backend]  [Read-only]  ●Live         │               │
│ │ Msg  ↩ │ │                                               │               │
│ └────────┘ │                                               │               │
└────────────┴───────────────────────────────────────────────┴───────────────┘
  ~15%                      ~65%                               ~20%
```

To see L2 docs (plan, research), user switches back to Chat View and clicks a doc in the sidebar. Execution view is purely L1.

---

## Chat Agent View (L2 workspace only)

Chat agents get the same layout — chat left, L2 docs center, L2 file tree right. User can edit L2 docs.

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ◀  Marketing Team   💬 Chat: strategist                                  │
├────────────┬───────────────────────────────────────────────┬───────────────┤
│            │                                               │               │
│ AGENT CHAT │  DOCUMENT EDITOR (L2 — editable)              │  L2 FILES     │
│            │                                               │               │
│ 👤 What's │  # Market Research Findings                    │  📁 plan/     │
│ the compe- │                                               │  ├ 📄 plan    │
│ titive     │  ## Competitor Analysis                        │  ├ 📄 research●│
│ landscape  │  The top 3 competitors in this space are:     │  └ 📄 arch   │
│ for note   │                                               │               │
│ apps?      │  1. **Notion** — All-in-one workspace,        │  📁 tasks/    │
│            │     overkill for simple notes                  │  ├ 📋 task-1  │
│ 🤖 I've   │  2. **Bear** — Markdown-first, but Apple      │  ├ 📋 task-2  │
│ researched │     only, no API                               │  ├ 📋 task-3  │
│ and written│  3. **Standard Notes** — E2E encrypted,       │  ├ 📋 task-4  │
│ findings   │     open source, limited search                │  └ 📋 task-5  │
│ to the     │                                               │               │
│ research   │  ## Our Differentiation                        │  📁 user/     │
│ doc.       │  - Full-text search (PostgreSQL tsvector)      │  └ 📄 notes  │
│            │  - REST API (programmable, integrations)       │               │
│ 👤 Add a  │  - Self-hostable with auth                     │               │
│ section on │                                               │               │
│ pricing.   │                                               │               │
│            │                                               │               │
│ ┌────────┐ │  [Editing as: You]                    ●Live   │               │
│ │ Msg  ↩ │ │                                               │               │
│ └────────┘ │                                               │               │
└────────────┴───────────────────────────────────────────────┴───────────────┘
  ~15%                      ~65%                               ~20%
```

**Key difference from gathering view:**
- File explorer shows **L1 repo** (actual files created by workers), not L2 CRDT docs
- Editor shows **code/files** being produced in real-time, not plan documents
- User can **read** worker output but not edit (it's the agent's workspace)
- L2 docs accessible via tab/link for reference ("what was the plan?")

---

## Workspace Layers

Two workspace layers, each with different access:

| Layer | What | Source | User Can | Agents Can |
|-------|------|--------|----------|-----------|
| **L2** — Team Memory | Plan, research, architecture, task specs, discussions | CRDT (Hocuspocus) | Read + Write (co-edit) | Read + Write (collab tool) |
| **L1** — Agent Workspace | Source code, configs, output files, git repo | Filesystem (git) | Read only | Read + Write (workspace tools) |

### When Each Layer Shows

| Session State | Primary Workspace | Secondary | Why |
|---------------|-------------------|-----------|-----|
| `gathering` | **L2** (CRDT docs) | — | User and planner co-create plan documents |
| `ready` (reviewing) | **L2** (plan + task specs) | — | User reviews plan docs before approving |
| `ready` (executing) | **L1** (repo files) | — | User watches workers produce actual files |
| `done` | **L1** (final output) | — | User reviews deliverables |

L2 docs are always accessible by switching to Chat View and clicking a doc in the sidebar. They are not shown inline in the execution workspace.

### Chat Agent View (deferred)

Chat agents use the same 3-panel layout with L2 workspace only:
- **Left**: Agent chat (user ↔ chat agent conversation)
- **Center**: L2 document editor (editable — user and agent can co-edit)
- **Right**: L2 file tree (CRDT docs only, no L1 repo files)

Chat agents cannot access L1 workspace directly. They work through L2 documents and delegate to workers for code changes.

---

## View Toggle

The user switches between Chat View and Workspace View via a toggle:

```
┌─────────────────────────────────────┐
│  💬 Chat View  │  📁 Workspace View │
│  ▔▔▔▔▔▔▔▔▔▔▔  │  ▔▔▔▔▔▔▔▔▔▔▔▔▔▔▔ │
└─────────────────────────────────────┘
```

- **Chat View**: Full-width chat with planner/agents. Document pane available on demand (click doc link).
- **Workspace View**: Three-panel IDE-like layout. Chat narrowed to left panel. Editor center. File tree right.

The workspace view is the "proper planning workspace" — it treats the planning session like a project with documents, not just a conversation.

---

## Implementation Notes

### Reusable from Phase 4 Research & Document Pane MVP

**Already built (document-pane MVP):**
- `DocumentPane.tsx` — container that routes between list/editor/file viewer
- `DocumentList.tsx` — groups CRDT docs by type (plan/tasks/reports/workspace)
- `CrdtDocViewer.tsx` — lazy-loads `CollaborativeEditor` with goal-scoped docId
- `WorkspaceFileViewer.tsx` — fetches + renders file content in monospace
- Backend endpoints: `GET /api/collab/:teamId/docs`, `GET /api/v2/workspaces/:teamId/goals/:goalId/files`
- `uiStore.documentPaneOpen` + `documentPanePath` state
- Keyboard shortcut: `Cmd+D` toggles document pane
- Auto-open on `awaiting_approval` state

**Reuse from Phase 4 design (not yet built):**
- **react-arborist** — file tree component for both L2 and L1 panels (already in Phase 4 dependency list)
- **Agent cursors** — Yjs Awareness + BlockNote renders real-time cursors when user and planner co-edit. Implementation: `awareness.setLocalStateField("user", { name, color })`, BlockNote auto-renders cursors
- **Connection status** — 🟢/🟡/🔴 CRDT connection indicators. Banner for reconnecting (not modal). Local edits preserved during disconnection
- **L1 workspace viewer pattern** — react-arborist file tree with color markers (🟢 new, 🔵 modified), compact git history, agent dropdown selector
- **Document picker sidebar** — list of CRDT docs with active editor count (maps to L2 file tree)

### How to Build the Workspace View

The workspace view (3-panel layout) extends the existing document-pane infrastructure:

**Step 1: Workspace layout component**
New `WorkspaceLayout.tsx` — replaces the single-column ChatArea when workspace view is active. Three resizable panels: chat (15%), editor (65%), file tree (20%).

Libraries: Use CSS grid or a split-pane library. react-arborist for file trees.

**Step 2: L2 file tree (gathering/chat-agent views)**
Reuse `DocumentList.tsx` data source (CRDT doc listing + task metadata from MongoDB). Render as react-arborist tree instead of flat list. Group into folders: `plan/`, `tasks/`, `reports/`, `user/`.

Data: `agentServiceV2.listCrdtDocs(teamId)` → filter by `{goalId}/` prefix → derive tree structure.

**Step 3: L1 file tree (execution view)**
Reuse `WorkspaceFileViewer.tsx` data source. Render as react-arborist tree with actual filesystem hierarchy.

Data: `agentServiceV2.listWorkspaceFiles(teamId, goalId)` → render as tree.

**Step 4: Editor panel**
- For L2 docs: reuse `CrdtDocViewer.tsx` (BlockNote + Hocuspocus)
- For L1 files: reuse `WorkspaceFileViewer.tsx` (read-only monospace, add syntax highlighting later)
- Add agent cursors for L2 docs via Yjs Awareness

**Step 5: Chat panel (compressed)**
Existing `ChatArea` component with `MessageList` + `ChatInput`, rendered in a narrow panel. Same data, smaller viewport. May need a compact message variant.

**Step 6: View toggle**
Add toggle to header bar. Persists to `uiStore`. Switches between full-width ChatArea and 3-panel WorkspaceLayout.

**Step 7: Context-aware file tree switching**
When session state is `gathering` or `ready` (reviewing) → show L2 tree.
When tasks are `in_progress` and user clicks workspace view → show L1 tree.
Chat agent view → always L2 tree.

### Readiness Checklist (backend)

The readiness gate runs in `GoalManager.approvePlan()`. Current implementation checks `isPlanDocWritten()`. Extend to:

```typescript
interface ReadinessCheck {
  planDocumentWritten: boolean;     // CrdtTaskSync.isPlanDocWritten()
  allTasksAssigned: boolean;        // plan.tasks.every(t => t.assignedRole)
  validDependencyGraph: boolean;    // DependencyResolver.validateDag()
  rolesExist: boolean;              // plan.tasks.every(t => teamRoles.includes(t.assignedRole))
  repoConfigured: boolean;         // goalContext.repoUrl !== undefined (if any task needs code)
}
```

Return checklist in the `plan_proposed` Socket.IO event so the frontend can render it in the sidebar.
