# Phase 4 Frontend UX Research: What to Show, How, and What Matters

**Date:** April 8, 2026  
**Purpose:** Design decisions for the three workspace layers (L1, L2, L3) frontend views — grounded in research from real products.

---

## The Three Layers — Frontend Story

Ping's backend has three stacking workspace layers. Each needs a distinct frontend view:

```
┌─────────────────────────────────────────────────────────┐
│  L3: Knowledge (Organizational Memory)                   │
│  Wiki browser, skills, runbooks, decisions              │
│  → /knowledge                                           │
├─────────────────────────────────────────────────────────┤
│  L2: Collaboration (Team Shared State)                   │
│  CRDT docs, group chat, artifact review, status         │
│  → /teams/:id/collaborate                               │
├─────────────────────────────────────────────────────────┤
│  L1: Workspace (Individual Agent Work)                   │
│  Git files, branches, commits, code intel, scratchpad   │
│  → /teams/:id/workspace + /teams/:id/artifacts          │
└─────────────────────────────────────────────────────────┘
```

| Layer | Backend Tools | Frontend View | Core User Question |
|-------|--------------|---------------|-------------------|
| **L1** | 31 tools: file CRUD, git, grep, glob, code intel, publish, lifecycle | **Workspace Viewer** (file tree, git history, branch info) + **Artifact Browser** (outputs with approval) | "What is each agent doing? What did they produce?" |
| **L2** | 4 MCP servers: collab-docs (search/query), group-chat, publish, status | **Collab Panel** (live CRDT editor, chat, artifact review, status board) | "How are agents coordinating? What's the shared context?" |
| **L3** | Knowledge CRUD, search, auto-injection, promotion pipeline | **Wiki Browser** (folder tree, markdown viewer, search, edit, promote) | "What does the organization know? What have we learned?" |

**Key principle:** Each layer builds on the one below. L1 is always present. L2 activates when CollaborationPlugin is registered for a team. L3 activates when KnowledgePlugin is registered. The frontend should reflect this stacking — show what's available, grey out what's not.

---

## Research Sources

Products analyzed for UX patterns:
- **Outline** (knowledge base) — folder tree + markdown + search + collaborative editing
- **Plane** (project management) — work items with status badges, peek/modal views, wiki pages, filters
- **GitButler** (git UI) — branch viewer, parallel branches, commit history, undo timeline
- **Tiptap/Liveblocks** (collaborative editing) — CRDT sync, presence cursors, threads, comments
- **GitHub** (code review) — PR reviews (Comment/Approve/Request Changes), file tree, diff viewer

---

## Artifact Trust & Review — Team Stacking Context

With team stacking (B3), artifacts arrive from different sources with different trust levels. The Artifact Browser must handle this.

### Source Trust Tiers

```
┌─────────────────────────────────────────────────────────────┐
│  Artifact Sources — Who made this?                          │
├─────────────────────────────────────────────────────────────┤
│                                                              │
│  🟢 HIGH TRUST — Internal approved agents                   │
│  • Your team's own workers (researcher, developer, etc.)    │
│  • Known external agents with "approved" status (Claude,   │
│    Codex, etc.) connected via MCP                           │
│  • Policy: Can be auto-approved or require light review     │
│                                                              │
│  🟡 MEDIUM TRUST — Child Ping teams                         │
│  • Child team = black box (B3: parent sees planner-level    │
│    status only, not individual agent activity)              │
│  • Artifacts bubble up via MCP SSE stream                   │
│  • Already reviewed within child team's own approval flow   │
│  • Policy: Show "reviewed by child planner" badge,          │
│    parent can accept or re-review                           │
│                                                              │
│  🔴 LOW TRUST — Unknown external agents                     │
│  • Third-party MCP agents discovered via registry           │
│  • No prior relationship or review history                  │
│  • Policy: Always requires full human review                │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

### How This Affects the UI

| Source | Badge | Default Review | User Can Configure |
|--------|-------|----------------|---|
| **Own team agent** | `🏠 Internal` | Per team policy (auto-approve / review) | ✅ Per-agent trust level |
| **Approved external** (Claude, etc.) | `✓ Approved Agent` + provider icon | Light review (diff-only, no full re-read) | ✅ Can promote to auto-approve |
| **Child Ping team** | `🔗 Team: Engineering` + child team name | Accept or re-review. Show "Reviewed internally ✓" if child team approved it. | ✅ Can set child team trust level |
| **Unknown external** | `⚠ External` | Full review required, no auto-approve | ✅ Can promote after track record |

### Artifact Review Flow with Team Stacking

```
Child Ping team completes task
  → Child team's approval flow runs (if enabled)
  → Artifact marked "approved" within child team
  → Artifact streams to parent via MCP SSE
  → Parent's Artifact Browser shows:
      ┌─────────────────────────────────────────────┐
      │ 📄 Auth API Implementation  🔗 Team: Eng    │
      │    ✓ Reviewed by child team                 │
      │    backend-dev · T-012 · TypeScript · 8.2KB │
      │    [Accept] [Re-Review] [Reject]            │
      └─────────────────────────────────────────────┘
  → If child team has HIGH trust → auto-accept option
  → If child team has MEDIUM trust → review queue
```

### Trust Configuration (Team Settings)

```
/teams/:id/settings → Trust & Review
  ┌──────────────────────────────────────────┐
  │ Agent Trust Levels                       │
  │                                          │
  │ Internal agents:                         │
  │   ○ Auto-approve  ● Require review       │
  │                                          │
  │ Child teams:                             │
  │   ○ Auto-accept   ● Accept with badge    │
  │   ○ Re-review required                   │
  │                                          │
  │ External agents:                         │
  │   ● Always review  ○ Per-agent trust     │
  │                                          │
  │ Agent-specific overrides:                │
  │   Claude (MCP)       [Approved ▾]        │
  │   Team: Engineering  [Trusted  ▾]        │
  │   unknown-agent-42   [Untrusted ▾]       │
  └──────────────────────────────────────────┘
```

### Decision 9: Trust/Review Model

| Option | Approach |
|--------|----------|
| **A: Flat (everyone same)** | All artifacts go through same review regardless of source. Simple but slow for trusted agents. |
| **B: Source-based tiers (recommended)** | Three tiers (internal / child team / external) with per-agent overrides. Show trust badge on every artifact. Configurable in team settings. |
| **C: Reputation-based** | Track approval history per agent/team. Auto-promote trust after N consecutive approvals. Powerful but complex for Phase 4. |

---

## 1. L1: Workspace Viewer & Artifact Browser

L1 is the **always-on layer** — every agent has a workspace. The frontend must answer: "What files exist, who changed what, and what was produced?"

With team stacking, L1 also receives artifacts from child teams and external agents. The viewer must clearly distinguish local workspace files (agent's own git branch) from incoming artifacts (streamed via MCP).

### 1a. Workspace Viewer (`/teams/:id/workspace`)

**GitButler (20k stars):**
- Parallel branches visible simultaneously (not one-at-a-time like Git CLI)
- Undo timeline — every operation is logged and reversible
- Visual branch viewer with stacking
- File tree with change indicators (modified/added/deleted markers)

**GitHub Repository View:**
- Branch selector dropdown at top
- File tree with size + last modified
- Click file → syntax-highlighted viewer
- Commit history as a timeline with messages

### What's Important for L1 Workspace

| Priority | Feature | Why It Matters |
|----------|---------|----------------|
| **P0** | **Agent/task selector** | "Which agent's workspace am I looking at?" Default to current active agent or most recent task. Dropdown to switch. |
| **P0** | **Branch info bar** | Always visible: `branch: task/T-003/researcher` + status (in_progress / completed). |
| **P1** | **Change markers on files** | Like VS Code git gutter: green = new, blue = modified, red = deleted. Users scan for what changed. |
| **P1** | **Workspace vs .scratch separation** | Two clear sections. Workspace = deliverables. .scratch = experiments. Different visual treatment (scratch is dimmer/indented). |
| **P2** | **Commit history** | Compact timeline. Most recent 5 commits visible, "Show all" expands. Each commit = message + timestamp + files changed count. |
| **P3** | **Multi-branch view** | Like GitButler's parallel branches view: see all agent branches side-by-side. Ambitious but unique. |

### 1b. Artifact Browser (`/teams/:id/artifacts`)

**GitHub PR Reviews:**
- Three review states: Comment / Approve / Request Changes
- Each file shows diff with inline commenting
- Status checks (CI/CD) as badges

**Plane Work Items:**
- Side-peek preview (modal slides in from right) — user stays in context
- Status badges with colors (green=done, yellow=in progress, red=blocked)

### What's Important for L1 Artifacts

| Priority | Feature | Why It Matters |
|----------|---------|----------------|
| **P0** | **Status at a glance** | User's #1 question: "Is this ready?" Large, colored badges (✅ Approved / ⏳ Pending / ❌ Rejected). |
| **P0** | **Source/trust badge** | With team stacking: every artifact must show WHERE it came from (🏠 Internal / 🔗 Child Team / ⚠ External) and its trust tier. See Trust section above. |
| **P0** | **Goal grouping** | Artifacts outside a goal context are meaningless. Group by goal, show goal progress %. |
| **P0** | **Preview without leaving page** | Side-peek pattern: click artifact → slide-in panel. User stays in list context. |
| **P1** | **"Pre-reviewed" indicator** | Artifacts from child Ping teams that already passed child team's approval should show "✓ Reviewed by Team: Engineering". User can accept without re-reading OR choose to re-review. |
| **P1** | **Diff view for revisions** | When agent revises after "Request Changes" — show what changed (before/after). |
| **P1** | **Bulk approve** | If 5 artifacts are pending from a trusted source, let user approve-all with one click. |
| **P2** | **Review history timeline** | Who reviewed, when, what changed. Vertical timeline per artifact. |

### L1 Design Decisions

**Decision 1: Workspace file viewer scope**

| Option | Approach |
|--------|----------|
| **A: Read-only always** | Workspace viewer is strictly read-only. Users see files, can't edit. Clear boundary. |
| **B: Read + download** | Read-only view + "Download file" and "Copy content" buttons. |
| **C: Read + annotate (recommended)** | Read-only but user can add comments/annotations on files (stored separately, not in git). Agent can read these via L2 collab. E.g., "This function needs error handling." |

**Decision 2: Agent workspace navigation**

| Option | Approach |
|--------|----------|
| **A: Dropdown selector (recommended)** | Single dropdown at top: "Agent: researcher (T-003)". Simple, familiar. |
| **B: Tab bar** | One tab per active agent. Shows all at once but gets crowded with 5+ agents. |
| **C: Split view** | Two workspaces side-by-side. Compare files between agents. Power feature but complex. |

**Decision 3: Artifact list layout**

| Option | Approach |
|--------|----------|
| **A: Card grid** | Each artifact as a card with thumbnail + metadata. Good for mixed media (images + docs). |
| **B: Table list (recommended)** | Dense table. Columns: name, type, **source/trust**, status, creator, date. Sort + filter. Best for scanning 10+ artifacts. |
| **C: Kanban** | Columns = status (Pending → Approved → Rejected). Visual but wastes horizontal space. |

**Decision 4: Approval flow**

| Option | Approach |
|--------|----------|
| **A: Inline buttons** | Approve/Reject buttons directly in list row. Fast but accident-prone. |
| **B: Preview-then-approve (recommended)** | Must open preview to see content before approve/reject buttons appear. Prevents blind approval. "Request Changes" opens comment textarea. |
| **C: Trust-aware (recommended enhancement to B)** | Same as B, but for pre-reviewed artifacts from trusted child teams, show an "Accept" shortcut (not "Approve") — acknowledges the child team already reviewed it. Untrusted sources always require preview-first. |

---

## 2. L2: Collaboration Panel (`/teams/:id/collaborate`)

L2 is the **shared state layer** — where agents coordinate. Not just editing docs, but the full collab surface: CRDT docs, group chat, published status updates, and artifact review discussions.

### What L2 Shows (mapped from 4 MCP servers)

| MCP Server | Frontend Component | What Users See |
|------------|-------------------|----------------|
| **collab-docs** (search/grep/query/whatsnew) | CRDT Editor + Document List | Live-editing documents shared between agents. Search across all shared docs. |
| **group-chat** | Chat Thread Panel | Agent-to-agent conversations. User can observe or participate. |
| **publish** | Activity Feed / Status Board | "researcher published: Market analysis complete" — a feed of status updates from agents. |
| **status** | Status Dashboard | Per-agent status cards: what each agent is doing right now + blockers. |

### What's Important for L2

| Priority | Feature | Why It Matters |
|----------|---------|----------------|
| **P0** | **Live doc editing with presence** | The core L2 experience. See agents editing in real-time with colored cursors. |
| **P0** | **Connection stability** | #1 UX killer. Show clear status: 🟢 Connected / 🟡 Reconnecting / 🔴 Disconnected. Auto-reconnect. Local changes preserved during disconnection. |
| **P0** | **Document picker** | Sidebar listing all CRDT docs for current goal. Click to switch. Show who's currently in each doc. |
| **P1** | **Agent activity feed** | Published status updates from agents — like a team Slack channel. "researcher: Completed market analysis, 3 competitors identified." |
| **P1** | **Reconnection UX** | Banner, NOT modal: "Reconnecting... Local changes will sync when connection is restored." |
| **P2** | **Read-only observe mode** | Users can watch agents coordinate without interfering. Toggle: "Observe mode". |
| **P3** | **Comment threads** | Like Liveblocks AnchoredThreads: select text → add comment → agent sees it in context. |

### L2 Design Decisions

**Decision 5: Editor technology**

| Option | Approach |
|--------|----------|
| **A: BlockNote + Hocuspocus (current)** | Already partially implemented. BlockNote = block-based editor (like Notion). Hocuspocus = Yjs websocket server. Fix existing bugs. |
| **B: Tiptap + Hocuspocus** | Tiptap = more mature, better extension ecosystem (60+ extensions). Same Yjs/Hocuspocus backend. More work to switch. |
| **C: Fix BlockNote, evaluate Tiptap for v2 (recommended)** | Minimize Phase 4 scope by fixing what exists. If BlockNote proves limiting, migrate to Tiptap in Phase 5+. |

**Decision 6: Agent cursor behavior**

| Option | Approach |
|--------|----------|
| **A: Real cursors (recommended)** | Each agent shows colored cursor + name label, moving in real-time. Standard collaborative editing UX. |
| **B: Activity indicators** | Instead of cursors, show block-level indicators: "researcher is editing this section." Less granular but simpler. |
| **C: Ghost mode** | Agent edits appear silently (no cursor shown). User just sees text changing. Low complexity but confusing UX. |

---

## 3. L3: Knowledge Wiki Browser (`/knowledge`)

L3 is the **organizational memory layer** — persistent knowledge that outlives individual goals. While L1 is per-task and L2 is per-goal, L3 is per-organization.

### What Leading Products Do Well

**Outline (38k GitHub stars):**
- Left sidebar = nested document tree (collections → nested docs)
- Right panel = full markdown viewer with inline editing
- Top = global search (Ctrl+K) with AI answers
- Revision history per doc
- Backlinks: "which docs link to this one?"

**Plane Wiki (47k stars):**
- Nested pages with drag-reorder
- Inline comments on paragraphs
- "Link pages to work items" — connects docs to tasks

### What's Important for L3 Wiki

| Priority | Feature | Why It Matters |
|----------|---------|----------------|
| **P0** | **Search** | Users scan, not browse. 80% of wiki access is via search (Outline data). Put search front-and-center. |
| **P0** | **Type badges** | Skills vs runbooks vs decisions are fundamentally different. Color-coded type badges let users scan instantly. |
| **P1** | **"Agent-contributed" provenance** | Unique to Ping — users need to know "was this written by a human or promoted from agent output?" Show source clearly. |
| **P1** | **Promotion queue** | Knowledge promoted from L1 artifacts or L2 collab needs human review. Badge: "3 new proposals to review." |
| **P2** | **Audience indicator** | 🤖 Agent-facing vs 👤 Human-facing docs. Helps users understand who consumes this. |
| **P2** | **Related docs/backlinks** | "This doc is referenced by 3 agents and used in 5 tasks." |

### L3 Design Decisions

**Decision 7: Wiki navigation model**

| Option | Approach | When to use |
|--------|----------|-------------|
| **A: Folder-first** | Left tree = folders (skills/runbooks/projects/decisions). Click folder → see docs. | When category structure is strong and doc count is < 200 |
| **B: Search-first** | Landing = search bar + recent docs. Folder tree is secondary/collapsible. | When doc count grows large or categories blur |
| **C: Hybrid (recommended)** | Search bar prominent at top. Folder tree on left BUT collapsed by default on mobile. Recent/promoted docs in main area as cards. | Scales from 10 → 1000+ docs |

**Decision 8: Wiki viewing vs editing**

| Option | Approach |
|--------|----------|
| **A: Read-only viewer + separate edit page** | Like GitHub — view is clean, "Edit" button opens editor page |
| **B: Inline editing (click to edit)** | Like Outline/Notion — click any paragraph to edit in place |
| **C: Side-by-side (recommended)** | View rendered markdown by default. "Edit" toggle switches to split-pane: source + preview |

---

## Cross-Cutting Concerns

### How Layers Stack in the UI

Not every team has all three layers. The frontend navigation should adapt:

```
Team with L1 only:             Team with L1 + L2:           Team with L1 + L2 + L3:
┌──────────────┐              ┌──────────────┐              ┌──────────────┐
│ 💬 Chat      │              │ 💬 Chat      │              │ 💬 Chat      │
│ 📁 Workspace │              │ 📁 Workspace │              │ 📁 Workspace │
│ 📦 Artifacts │              │ 📦 Artifacts │              │ 📦 Artifacts │
│ ⚙️ Settings  │              │ 🤝 Collab    │              │ 🤝 Collab    │
│              │              │ ⚙️ Settings  │              │ 📚 Knowledge │
│              │              │              │              │ ⚙️ Settings  │
└──────────────┘              └──────────────┘              └──────────────┘
```

### Real-Time Updates
All views need real-time data:
1. **Socket.IO events (recommended)** — Already have Socket.IO infrastructure. Add channels: `knowledge:update`, `artifact:update`, `workspace:update`
2. **L2 CRDT** — Yjs handles state internally for collaborative editor
3. **L1 workspace** — API calls with no caching (always fresh git state)

### State Management
- **L3 Knowledge wiki** — React Query for API data caching + invalidation on socket events
- **L1 Artifacts** — React Query, invalidate on `artifact:update`. Include `source` and `trustLevel` in cached data.
- **L1 Workspace** — Fresh API calls per navigation (git state changes frequently)
- **L2 Collaborative editor** — Yjs handles state internally (CRDT)

### Mobile/Responsive
- Knowledge wiki tree → collapsible sidebar (hamburger on mobile)
- Artifact list → card layout on mobile (stack, not table)
- Workspace viewer → full-width file list on mobile, no split view
- Editor → full-screen editor on mobile, no side panel

---

## Summary of Decisions Required

| # | Layer | Decision | Options | Recommendation |
|---|-------|----------|---------|----------------|
| 1 | L1 | Workspace file viewer scope | Read-only / Read+download / Read+annotate | **Read+annotate** |
| 2 | L1 | Agent workspace navigation | Dropdown / Tabs / Split | **Dropdown** |
| 3 | L1 | Artifact list layout | Card grid / Table / Kanban | **Table list** (with source/trust column) |
| 4 | L1 | Approval flow | Inline / Preview-then-approve / Trust-aware | **Trust-aware preview** |
| 5 | L2 | Editor technology | Fix BlockNote / Switch Tiptap / Fix now, evaluate later | **Fix now, evaluate later** |
| 6 | L2 | Agent cursor behavior | Real cursors / Activity indicators / Ghost | **Real cursors** |
| 7 | L3 | Wiki navigation model | Folder-first / Search-first / Hybrid | **Hybrid** |
| 8 | L3 | Wiki view vs edit | Separate pages / Inline / Split-pane | **Split-pane** |
| 9 | All | Trust/review model | Flat / Source-based tiers / Reputation | **Source-based tiers** |

**Please review and decide on each. I can adjust the architecture doc and implementation plan based on your choices.**

---

## Open-Source Libraries — Recommended Stack

### L1: Workspace Viewer & Artifact Browser

| Need | Library | Stars | Why |
|------|---------|-------|-----|
| **File tree** | **react-arborist** | 3.6k | Full-featured: virtualized, drag-drop, filtering, keyboard nav, custom renderers. Built the Zui (Brim) sidebar. Feels like VS Code file explorer. MIT. |
| **File tree (alt)** | @rc-component/tree | 1.3k | Ant Design's tree. Checkable, draggable, async load, virtual scroll. More enterprise, less opinionated. MIT. |
| **Code viewer** | **react-syntax-highlighter** | 4k | Syntax highlighting for 200+ languages (Prism or Highlight.js). Use for file preview modal. MIT. |
| **Diff viewer** | **react-diff-viewer-continued** | 500+ | Side-by-side or unified diff view. For artifact revision diffs (before/after "Request Changes"). MIT. |
| **Markdown preview** | **react-markdown** | 15.6k | Safe (no dangerouslySetInnerHTML), GFM via remark-gfm plugin, custom components for code blocks. The standard. MIT. |
| **Git timeline** | Custom (simple) | — | No good off-the-shelf git timeline component for React. Build a compact commit list with Mantine Timeline or custom `<ul>`. |

**Recommended L1 stack:**
```
react-arborist          → file tree (workspace files + .scratch)
react-markdown          → file preview (markdown files)
react-syntax-highlighter → file preview (code files)  
react-diff-viewer-continued → artifact revision diffs
Mantine Table           → artifact list (sortable, filterable)
Mantine Drawer          → side-peek artifact preview
```

### L2: Collaboration Panel

| Need | Library | Stars | Why |
|------|---------|-------|-----|
| **CRDT editor** | **BlockNote** | 9.3k | Already in use. Notion-style block editor. Built on Tiptap/ProseMirror. First-class Yjs collab (pass `Y.Doc` fragment + provider). Drag-drop blocks, slash menu, format toolbar. AI support via XL package. MPL-2.0 (core), GPL-3.0 (XL). |
| **CRDT sync** | **Hocuspocus** | 2k+ | Already in use. Yjs WebSocket server. Auto-reconnect, auth hooks, persistence hooks. Tiptap team maintains it. MIT. |
| **CRDT library** | **Yjs** | 20k+ | Already in use. The CRDT. Conflict-free, offline-capable, peer-to-peer possible. Awareness protocol for presence (cursors). MIT. |
| **Presence cursors** | Yjs Awareness + BlockNote | — | BlockNote's `collaboration.user` config shows cursors natively. Pass `{ name, color }` per user/agent. No extra library needed. |
| **Chat panel** | Custom | — | Simple message list component. No need for a library — it's just a scrollable list with timestamps and agent avatars. |

**Recommended L2 stack:**
```
BlockNote (@blocknote/react + @blocknote/mantine) → CRDT editor
Hocuspocus (@hocuspocus/server)     → WebSocket CRDT sync + persistence
Yjs (y-websocket, y-protocols)      → CRDT + awareness (presence)
Custom                              → chat panel, activity feed, status board
```

**Key BlockNote collab setup (already proven):**
```typescript
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";

const doc = new Y.Doc();
const provider = new WebsocketProvider("ws://localhost:1234", "room-id", doc);

const editor = useCreateBlockNote({
  collaboration: {
    fragment: doc.getXmlFragment("document"),
    user: { name: "researcher", color: "#ff6b6b" }, // agent name + color
    provider,
  }
});
```

### L3: Knowledge Wiki Browser

| Need | Library | Stars | Why |
|------|---------|-------|-----|
| **Folder tree** | **react-arborist** | 3.6k | Same lib as L1 workspace — consistent UX. Configure for knowledge categories (skills/runbooks/etc.) with type-based icons. |
| **Markdown viewer** | **react-markdown** | 15.6k | Same as L1. Add `remark-gfm` for tables, `rehype-highlight` for code blocks, `remark-frontmatter` to parse YAML metadata. |
| **Markdown editor** | **@uiw/react-md-editor** | 2.8k | Split-pane editor (source + preview). Dark mode. Custom toolbars. Based on textarea (lightweight, no heavy deps). KaTeX + Mermaid support via plugins. MIT. |
| **Markdown editor (alt)** | **MDXEditor** | 2k+ | WYSIWYG markdown. Closer to Notion feel but heavier. Good if we want inline editing (Decision 8, Option B). MIT. |
| **Search** | **MiniSearch** | 5k+ | Already chosen for L2 search (see l2-search-indexing docs). Lightweight full-text search. Works client-side. Alternatively, hit `/api/v2/knowledge/search` server-side. MIT. |
| **Frontmatter parsing** | **gray-matter** | 5k+ | Parse YAML frontmatter (type, audience, roles) from markdown files. Used in the knowledge doc model. MIT. |

**Recommended L3 stack:**
```
react-arborist          → folder tree (skills/runbooks/projects/decisions)
react-markdown          → document viewer (rendered markdown)
@uiw/react-md-editor   → document editor (split-pane: source + preview)
gray-matter             → parse YAML frontmatter metadata
MiniSearch              → client-side full-text search
Mantine Spotlight       → Ctrl+K search modal (like Outline)
```

### Cross-Cutting Libraries

| Need | Library | Stars | Why |
|------|---------|-------|-----|
| **UI framework** | **Mantine** | 30k+ | Already in frontend. Provides Table, Drawer, Modal, Timeline, Spotlight, Tabs, Badge, etc. |
| **Data fetching** | **@tanstack/react-query** | 45k+ | Cache API responses, invalidate on socket events. Used for knowledge, artifact, and workspace API calls. |
| **Icons** | **@tabler/icons-react** | — | Already with Mantine. File type icons, status icons, trust badges. |
| **Virtualization** | Built into react-arborist | — | react-arborist uses react-window internally. No extra lib needed for large trees. |

### Full Dependency Summary

```
# L1 - Workspace & Artifacts (new deps)
npm install react-arborist react-syntax-highlighter react-diff-viewer-continued

# L2 - Collaboration (already installed)
# @blocknote/react, @blocknote/mantine, @hocuspocus/server, yjs — already in project

# L3 - Knowledge Wiki (new deps)  
npm install @uiw/react-md-editor gray-matter

# Shared (already installed or add)
# react-markdown — may already be installed, verify
# @tanstack/react-query — add if not present
```

**Total new dependencies: ~5-6 packages.** Everything else reuses existing libraries or Mantine components.
