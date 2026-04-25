# Frontend Redesign — Goal-First, Plan-Scoped

**Date:** April 22, 2026  
**Status:** Design  
**Principle:** Goal → Team → Planner Chat. Tasks and discussions live inside the plan, not as separate views.

### Current Screenshots (Authenticated)
- **Chat view** — Sidebar nav (Chat/Tasks/Collaborate/Discussions), agent header with Chat/Tasks toggle + Auto switch, empty "Start a conversation" state, GoalInput at bottom
- **Tasks view** — Standalone "Task Dashboard" page, "No tasks yet. Submit a goal to get started." → confirms tasks feel detached from plan
- **Collaborate view** — Two-pane layout: CRDT Documents list + editor — currently disconnected from active task context
- **Discussions view (no team)** — Empty placeholder telling user to select team
- **Discussions view (Engineering)** — Sub-sidebar with agent list (backend-dev, devops, frontend-dev, qa-engineer) → confusing: are these discussions or agents?
- **Manage Teams** — Card grid of teams (Engineering, Marketing, Meta, Product, Research). Keep this view.

**Confirmed pain points from screenshots:**
1. 4 nav tabs split context — user must hop between Chat/Tasks/Collaborate/Discussions to follow one plan
2. Tasks/Collaborate/Discussions all show empty states without team context
3. Discussions view conflates "agents" and "discussions" in sub-sidebar
4. No plan grouping anywhere — everything is flat per team

---

## UX Review

### Heuristic Audit

| Heuristic | Current Score | Issue | Fix |
|-----------|---------------|-------|-----|
| **Visibility of system status** | 6/10 | Status only in tiny bottom bar; per-agent status hidden in detail panel | Top bar shows plan status; sidebar shows per-agent live dots |
| **Match real world** | 5/10 | "Collaborate" / "Discussions" / "Tasks" are dev jargon, not user mental model | One mental model: a *plan* with *steps* (tasks). Discussions are part of a step. |
| **User control** | 7/10 | Cmd+K, theme toggle, but no easy "back to start" | Goal Screen as home; persistent ← Back |
| **Consistency** | 5/10 | Each view has different layout (TaskDashboard vs ChatArea vs CollabEditor) | One shell: sidebar + main + detail panel. Always. |
| **Recognition over recall** | 4/10 | User must remember which tab has the discussion; agents listed flat without role grouping | Discussion lives next to its task; agents grouped by role with status |
| **Aesthetic & minimal** | 7/10 | Dark theme is clean BUT detail panels (esp. Discussion) cram 5+ sections into 320px | One thing per pane. Tabs for secondary info. |
| **Help users recover** | 6/10 | "No tasks yet" is okay but no path forward | Empty states always include CTA ("Submit a goal") |

### Information Density Issues (current Discussion panel — biggest violator)

The current Discussion panel attempts to render in 320px width:
- Title bar
- Lifecycle status bar  
- Participant bar (avatars + tick marks)
- Agenda bar (checklist)
- Posts (markdown bodies)
- Inline decision cards
- Token/round counters
- Composer

**Result:** Each section gets ~50px. Posts — the actual content — get squeezed. This violates Slack/Discord/Teams convention where the message list dominates 80%+ of vertical space.

### Three Core UX Principles for Redesign

1. **One purpose per pane.** Sidebar = navigation. Main = primary content. Detail panel = focused secondary.
2. **Chat panes look like chat panes.** Headers thin, messages dominant, composer pinned bottom. Metadata in tabs/popovers, not stacked sections.
3. **Progressive disclosure.** Show 3 things by default, reveal more on demand (tabs, expandable sections, popovers).

---

## Industry Research (April 2026)

Researched 7 leading products to validate design decisions and find gaps.

### Products Analyzed

| Product | What we learned |
|---|---|
| **OpenAI Codex** | "What should we code next?" centered prompt + repo selector + task list sidebar. Parallel task execution. Task cards show elapsed time + "review/request changes/open PR" action bar. |
| **Cursor Cloud Agents** | Prompt → agent works autonomously → "Worked for 14m 22s" → result with walkthrough. Tiled layout for parallel agents. Autonomy slider concept (Karpathy: "you control how much independence to give the AI"). |
| **Devin** | Single prompt → plans → parallel subtasks → PR with diff review. Task-level progress tracking. |
| **Linear Agents** | Agents are "full members of workspace" — assign to issues, @mention in threads. Dual-assignee model (human primary + agent contributor). "Orchestrate issues at scale — delegate multiple in parallel, monitor progress." Activity timeline per issue. |
| **Slack / Discord / Teams** | Channel → Messages tab dominant (80%+ vertical) + metadata in secondary tabs (Files/Pinned/About). Thread model for per-topic conversation. |
| **Anthropic (Building Effective Agents)** | Orchestrator-workers pattern: central LLM breaks down tasks, delegates to workers, synthesizes results. Keep agents simple, show planning steps transparently. |
| **Taskade** | AI agents + automations + projects in one workspace. Community-shared templates. Agent builder. |

### What Our Design Already Gets Right

| Pattern | Industry standard | Our design |
|---|---|---|
| Goal-first entry | Codex: centered prompt + task list. Cursor: central prompt → execution. | ✅ Goal Screen with centered input + recent plans |
| Plan → tasks in sidebar | Codex: sidebar task cards with status. Linear: issue list with agent status. | ✅ PLAN section with status icons + AGENTS section |
| Chat + task threading | Slack: messages dominate, metadata in tabs. Linear: activity feed per issue. | ✅ Discussion refactored to Messages-first + Info/Agenda/Decisions tabs |
| Plan switching | Linear: project switcher popover. Notion: Cmd+K with inline results. | ✅ Three mechanisms: popover + Cmd+K + Goal Screen browse |
| Autonomy control | Cursor: autonomy slider. | ✅ Mode toggle (auto/review/manual) per ChatAgent role (chat-agent-layer feature) |
| Parallel agent work | Codex: multiple tasks running simultaneously. Linear: "orchestrate at scale." | ✅ Per-role concurrency via ChatAgent (chat-agent-layer Q4c) |

### Gaps Found — Additions to Make

| # | Gap | Seen in | Addition | Effort |
|---|---|---|---|---|
| 1 | **No elapsed time per task** | Codex shows time; Cursor shows "worked for 14m" | Add elapsed time to sidebar task rows (computed from Channel B `started` → `completed` timestamps) | Trivial |
| 2 | **No mode indicator on agents** | Cursor's autonomy slider visible in UI | Show mode icon next to agent in sidebar: 🟢 auto, 🟡 review, ⚪ manual. Click to cycle. | Trivial |
| 3 | **No files-changed summary** | Codex shows inline diffs; Devin shows PR diffs | `▶ Changes` collapsible at bottom of task Overview — expands to show file list with per-file Diff/File toggle. Syntax highlighted, line numbers, copy button. API: `GET /tasks/:id/changes`. Phase 15. | Medium |
| 4 | **Channel B events as chat bubbles** | Linear uses compact timeline entries, not full messages | Render Channel B `TaskUpdate` events as **timeline entries** (icon + one-liner + timestamp) not chat bubbles. Saves vertical space. | Small |
| 5 | **No task-level action buttons** | Codex: "review / request changes / open PR" per task | Add action buttons in task detail panel on completion: Review, Retry, Pause | Small |
| 6 | **No progress indicator on task row** | Codex shows spinner + step count | Add thin progress bar or percentage on sidebar task row (from Channel B `progress.pct`) | Trivial |
| 7 | **Active plan badge in switcher** | Codex shows running status with elapsed time | Show "Running · 4m" badge on active plan in plan switcher popover | Trivial |

### Visual Design References

| Aspect | Best reference | Why it fits Ping |
|---|---|---|
| Dark theme + clean density | **Linear** | Same energy as current dark theme. Monochrome with color accents for status only. |
| Agent status indicators | **Linear agents** | Green dot = active, gray = idle. Simple, universally understood. |
| Task cards in sidebar | **Codex sidebar** | Status icon + title + role badge + elapsed time. One line per task. |
| Chat rendering | **Slack** | Avatar + name + timestamp, full-width message, tool calls as collapsed blocks. Already matches our StreamMessage/ToolCard. |
| Detail panel tabs | **Linear issue detail** | Activity / Details / Sub-issues → maps to our Overview / Discussion / Docs / Logs. |
| Goal screen | **Codex landing** | "What should we code next?" + repo selector + recent tasks below. |

---

## What's Wrong with Current

| Issue | Current | Problem |
|-------|---------|---------|
| **No goal-first flow** | User lands on empty chat, must type into GoalInput | No clear starting point. What do I do? |
| **Tasks is a separate view** | `/teams/{id}/tasks` — full-page TaskDashboard | Tasks are detached from the plan. No context of which plan they belong to. |
| **Discussion is a separate view** | `/teams/{id}/discussions` — separate navigation | Discussions happen during a plan but live elsewhere. Context lost. |
| **4 view modes** | Chat / Tasks / Collaborate / Discussions | Too many tabs. User bounces between views to understand what's happening. |
| **No plan scope** | Tasks are flat, no plan hierarchy | A team should handle multiple plans. Currently tasks are global per team. |

## What to Keep

- ✅ Current Chat view (ChatArea, StreamMessage, ToolCard, ReasoningSection)
- ✅ Sidebar agent list with role chips
- ✅ Detail panel (Events, Agents tabs)
- ✅ Plan approval overlay
- ✅ Status bar
- ✅ Command palette (Cmd+K)
- ✅ Team switcher
- ✅ Markdown rendering in messages

---

## New Flow

### Step 1: Goal Screen (Landing)

When no plan is active, user sees:

```
┌──────────────────────────────────────────────────────┐
│  Ping                                    🌙  Sign Out│
├──────────────────────────────────────────────────────┤
│                                                      │
│              What would you like to build?            │
│                                                      │
│   ┌──────────────────────────────────────────────┐   │
│   │ Build a REST API for a notes app with auth   │   │
│   │ and search...                                │   │
│   └──────────────────────────────────────────────┘   │
│                                                      │
│   Team: [Engineering Team ▾]          [Start ▶]      │
│                                                      │
│   ─── Recent Plans ──────────────────────────────    │
│   📋 Movie Booking App          3/8 tasks   ✅ Done  │
│   📋 Note Taking App            1/5 tasks   🟡 Active│
│   📋 Dashboard Design           0/4 tasks   ⏳ Paused│
│                                                      │
└──────────────────────────────────────────────────────┘
```

- **Center stage:** Goal input (large, prominent)
- **Team selector:** Dropdown below the input
- **Recent plans:** Show past plans for this team (clickable to resume)
- **No sidebar** on this screen — clean, focused

### Empty States

Every empty state includes a clear CTA. No dead-end screens.

**Goal Screen — no teams yet (first-time user):**
```
┌──────────────────────────────────────────────────────┐
│  Ping                                    🌙  Sign Out│
├──────────────────────────────────────────────────────┤
│                                                      │
│              What would you like to build?            │
│                                                      │
│   ┌──────────────────────────────────────────────┐   │
│   │ (textarea disabled)                          │   │
│   └──────────────────────────────────────────────┘   │
│                                                      │
│   Team: [No teams — create one first ▾]  [Start ▶]  │
│                         ↑                            │
│              dropdown shows "Create team" action     │
│                                                      │
│   ─── No recent plans ──────────────────────────     │
│   Create a team to get started.                      │
│   [Go to Manage Teams →]                             │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Goal Screen — team selected, no plans yet:**
```
┌──────────────────────────────────────────────────────┐
│  Ping                                    🌙  Sign Out│
├──────────────────────────────────────────────────────┤
│                                                      │
│              What would you like to build?            │
│                                                      │
│   ┌──────────────────────────────────────────────┐   │
│   │ Build a REST API for a notes app...          │   │
│   └──────────────────────────────────────────────┘   │
│                                                      │
│   Team: [Engineering Team ▾]          [Start ▶]      │
│                                                      │
│   ─── No plans yet ─────────────────────────────     │
│   Submit a goal above to create your first plan.     │
│                                                      │
│   Try one of these:                                  │
│   [Build a REST API with auth]                       │
│   [Create a marketing analysis]                      │
│   [Design a React dashboard]                         │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**Sidebar — plan active but planning in progress (no tasks yet):**
```
PLAN: (creating…)        🟡
──────────────────────────────────
  ⏳ Planner is creating a plan…

  (spinner animation)
──────────────────────────────────
AGENTS
  (no agents assigned yet)
──────────────────────────────────
← Back to goals
```

**Sidebar — plan active, all tasks done:**
```
PLAN: Note Taking App     ✅
──────────────────────────────────
✅ T-1  Set up schema     BE  1m
✅ T-2  API contract      BE  4m
✅ T-3  Build auth        BE  6m
✅ T-4  Login form        FE  3m
✅ T-5  Write tests       QA  5m
──────────────────────────────────
  🎉 All tasks complete!
  Total time: 19m
──────────────────────────────────
AGENTS
🟢 backend       idle         auto
🟡 frontend      idle         review
⚪ qa            idle         manual
──────────────────────────────────
← Back to goals
```

**DetailPanel — no task selected:**
```
┌──────────────────────────────────────┐
│ Details                         ✕    │
├──────────────────────────────────────┤
│ Events │ Agents │ Tasks │ Settings   │
├──────────────────────────────────────┤
│                                      │
│  (current behavior — unchanged)      │
│  Shows global events/agents/tasks    │
│                                      │
│  Click a task in the sidebar to      │
│  see its details here.               │
│                                      │
└──────────────────────────────────────┘
```

### Step 2: Planner Chat (After goal submitted)

Once the user submits a goal, they enter the **Planner Chat** — the main workspace.

```
┌────────┬─────────────────────────────────────────────┐
│  Ping  │ 📋 Note Taking App          🟢 Executing    │
├────────┼─────────────────────────────────────────────┤
│        │                                             │
│ PLAN   │  🤖 Planner                        02:15 AM │
│ ────── │  I'll create 5 tasks:                       │
│ ✅ T-1 │  1. Set up database schema (backend)        │
│  1m   │  2. Align on API contract (discussion)      │
│ ▶ T-2  │  3. Build auth API (backend, depends: T-2)  │
│  3m   │  4. Build login form (frontend, depends: T-2)│
│ ⏳ T-3 │  5. Write tests (qa, depends: T-3, T-4)    │
│ ⏳ T-4 │                                             │
│ ⏳ T-5 │  > ✏️ submit_plan                    done   │
│        │                                             │
│ AGENTS │  ✅ Task completed · backend         02:16  │
│ ────── │                                             │
│🟢 BE   │  🤖 Backend (task-2)                02:17   │
│  auto │  Starting API contract discussion...        │
│🟡 FE   │  > 💬 collab discuss post            done   │
│ review│                                             │
│ ← Back │  ┌─────────────────────────────────────┐   │
│        │  │ [Type a message to planner...]   [▶] │   │
│        │  └─────────────────────────────────────┘   │
└────────┴─────────────────────────────────────────────┘
```

**Key changes from current:**

1. **Sidebar shows plan tasks + agents** — not separate views
   - **PLAN section:** Compact task list with status icons (✅ ▶ ⏳ ❌). Click a task → shows task detail inline or in detail panel.
   - **AGENTS section:** Active agents with status dots
   - **← Back:** Returns to Goal Screen

2. **Main area is the planner chat** — same ChatArea as today, unchanged

3. **Top bar shows plan info** — plan name + status badge

4. **No Tasks tab** — tasks ARE the sidebar
5. **No Discussions tab** — discussions appear inline in chat as tool cards, and the Discussion view opens as a panel (not a separate route)

### Step 3: Viewing a Task (Click task in sidebar)

When user clicks a task in the sidebar, it opens in the **Detail Panel** (right side, 320px):

```
┌────────┬─────────────────────────────┬──────────────┐
│ PLAN   │  (Planner Chat)             │ Task: T-2    │
│ ────── │                             │ ──────────── │
│ ✅ T-1 │  ...                        │ Align on API │
│ ▶ T-2 ←│  ...                        │ contract     │
│ ⏳ T-3 │  ...                        │              │
│ ⏳ T-4 │  ...                        │ Status: ▶    │
│ ⏳ T-5 │  ...                        │ Role: backend│
│        │  ...                        │ Type: discuss│
│ AGENTS │  ...                        │ Time: 3m 22s │
│ ────── │                             │              │
│🟢 BE   │                             │ Depends on:  │
│🟡 FE   │                             │  (none)      │
│        │                             │ Blocks:      │
│        │                             │  T-3, T-4    │
│        │                             │              │
│        │                             │ [Review]     │
│        │                             │ [Retry]      │
│        │                             │──────────────│
│        │                             │▶ Changes     │
│        │                             │ (3 files +157)│
└────────┴─────────────────────────────┴──────────────┘
```

- Task detail in the **existing Detail Panel** (already 320px, already togglable)
- No new route — stays on `/teams/{id}/chat`
- Same detail panel can show Events, Agents, or Task detail depending on what's selected
- **Elapsed time** shown for in-progress and completed tasks
- **`▶ Changes` collapsible** pinned at bottom — click expands to show file list with Diff/File toggle per file. Replaces panel content when expanded. `[← Back]` returns to overview.
- **Action buttons** above the collapsible: Review (opens diff), Retry (resets to ready), Pause (cancels worker, keeps status)

### Step 4: Viewing a Discussion (Click discussion task)

When user clicks a discussion task (type: "discussion"), the detail panel switches to its **Discussion** tab. See the **Discussion in Detail Panel** section below for the full Slack/Discord-style design.

---

## Routes (Simplified)

| Route | What | Notes |
|-------|------|-------|
| `/` | Goal Screen | No sidebar, centered goal input + recent plans |
| `/teams/{id}` | Planner Chat | Sidebar (plan + agents) + Chat + optional Detail Panel |
| `/manage-teams` | Teams management | Full-page, unchanged (keep current design) |

**Removed routes:**
- ~~`/teams/{id}/tasks`~~ → Tasks in sidebar
- ~~`/teams/{id}/collaborate`~~ → Feature-gated, accessible via Cmd+K or linked from task detail
- ~~`/teams/{id}/discussions`~~ → Discussions in detail panel

---

## Agent Chat

**How it works:** Click an agent in the AGENTS sidebar section → main chat area shows that agent's stream/conversation. Click `Planner` → shows planner chat.

```
┌────────┬─────────────────────────────────────────────┐
│ PLAN   │                                             │
│ ────── │  🤖 backend (task-2)              02:17 AM  │
│ ✅ T-1 │  Working on API endpoints...                │
│ ▶ T-2  │                                             │
│ ⏳ T-3 │  > workspace_create_file           done     │
│        │  > collab discuss post             done     │
│ AGENTS │                                             │
│ ────── │  I've created the auth endpoints:           │
│ ● BE ← │  - POST /auth/register                     │
│ ● FE   │  - POST /auth/login                        │
│ ○ QA   │  - GET /auth/validate                      │
│        │                                             │
│ Planner│  [Chat with backend...]               [▶]  │
└────────┴─────────────────────────────────────────────┘
```

Same as today — unchanged ChatArea, StreamMessage, ToolCard components.

---

## Discussion in Detail Panel

**Pattern: Slack/Discord-style channel.** The pane is a chat surface — header thin, messages dominate, composer (if enabled) at bottom. Everything else moves into **tabs** at the top.

### Default view: Messages tab (the chat)

```
┌──────────────────────────────────────┐
│ 💬 API Contract            🟢   ✕    │ ← thin header (40px)
│ T-2 · 3 participants                 │
├──────────────────────────────────────┤
│ Messages │ Info │ Agenda │ Decisions │ ← tabs (36px)
├──────────────────────────────────────┤
│                                      │
│  🤖 backend             10:30        │
│  **POST /auth/register**             │
│  Body: { username, password }        │
│  Response: { userId, token }         │
│                                      │
│  Thoughts? @frontend @qa             │
│                                      │
│  🤖 frontend            10:31        │
│  Agreed. Add a refresh token         │
│  endpoint too — clients will need    │
│  to re-auth without password.        │
│                                      │
│  🤖 qa                  10:32        │
│  +1. Also need /auth/logout for      │
│  token invalidation tests.           │
│                                      │
│  ─── ✅ Decision · api-endpoints ─── │ ← inline only when posted
│  REST with /register, /login,        │
│  /refresh, /logout                   │
│                                      │
│  🤖 backend             10:34        │
│  Locked in. Implementing now.        │
│                                      │
├──────────────────────────────────────┤
│ ✏️ (composer hidden — agents only)   │ ← composer area (48px)
└──────────────────────────────────────┘
```

- **Messages = 80%+ of vertical height** (Slack/Discord ratio)
- **No agenda, participants, decisions, token counters in the chat tab** — just messages
- **Inline decision card** appears in message stream at the moment it was posted (single visual element, not a separate section)
- **Composer** at bottom, feature-gated (current behavior preserved)
- Avatar + role name + timestamp = standard chat row

### Other tabs (progressive disclosure)

**Info tab** — metadata that doesn't change often:
```
┌──────────────────────────────────────┐
│ Messages │ Info │ Agenda │ Decisions │
├──────────────────────────────────────┤
│  Status      🟢 Active                │
│  Started     10:28 AM                 │
│  Task        T-2 · API Contract       │
│  Plan        Note Taking App          │
│                                       │
│  Participants                         │
│   🤖 backend     ✅ posted           │
│   🤖 frontend    ✅ posted           │
│   🤖 qa          ✅ posted           │
│                                       │
│  Limits                               │
│   Rounds     3 / 10 per agent         │
│   Tokens     1.2k / 50k               │
│   Timeout    13m left                 │
│                                       │
│  [Close discussion]                   │
└──────────────────────────────────────┘
```

**Agenda tab** — checklist + progress:
```
│  Agenda  (1 / 3 resolved)             │
│  ☑ Endpoint shapes                    │
│  ☐ Auth token format                  │
│  ☐ Error response schema              │
```

**Decisions tab** — log of all decisions in this discussion:
```
│  ✅ api-endpoints           10:34     │
│  REST with /register, /login,         │
│  /refresh, /logout                    │
│  Agreed by: backend, frontend, qa     │
│                                       │
│  (no other decisions yet)             │
```

### Why this works

- **Like Slack:** Channel header → tabs (Messages | Files | Pinned | About) → message list → composer
- **Like Discord:** Channel header → tabs (Chat | Threads | Pinned | Members) → message list → composer
- **Like Teams:** Channel → tabs (Posts | Files | Wiki | +) → posts → composer
- Discussions inherit a familiar visual grammar — users don't have to learn anything new
- Each tab is single-purpose, vertically scrollable, never cramped

### What gets removed from current `DiscussionThread`

| Current element | New location |
|----|----|
| `StatusBar` (lifecycle states) | Header dot + Info tab |
| `ParticipantBar` (avatars row) | Subtitle ("3 participants") + Info tab |
| `AgendaBar` (inline checklist) | Agenda tab |
| Token/round counter footer | Info tab |
| `InlineDecision` cards | Stay inline in Messages (this is correct) |
| Posts | Stay inline in Messages |

---

## Collaboration Docs Access (revised)

Same tab pattern in **Task detail panel**:

```
┌──────────────────────────────────────┐
│ T-2: API Contract          ▶    ✕    │
├──────────────────────────────────────┤
│ Overview │ Discussion │ Docs │ Logs  │
├──────────────────────────────────────┤
│  (selected tab content)              │
└──────────────────────────────────────┘
```

- **Overview** — title, status, role, dependencies, blocks, output
- **Discussion** — embeds the Discussion panel (Messages/Info/Agenda/Decisions sub-tabs)
- **Docs** — list of CRDT docs scoped to this task; click → opens `CollaborativeEditor` overlay
- **Logs** — agent events for this task (existing Events tab content, scoped)

### Logs Tab — Task-Scoped Event Feed

Shows orchestration events filtered to the selected task. Reuses the existing `EventsView` component with a task filter applied.

```
┌──────────────────────────────────────┐
│ Overview │ Discussion │ Docs │ Logs  │
├──────────────────────────────────────┤
│                                      │
│  02:17:03  ▶ task_dispatched         │
│  T-2 assigned to backend-dev         │
│                                      │
│  02:17:05  🔧 tool_start             │
│  workspace_create_file               │
│  path: /src/auth/register.ts         │
│                                      │
│  02:17:08  ✅ tool_result             │
│  workspace_create_file → success     │
│                                      │
│  02:17:12  🔧 tool_start             │
│  collab discuss post                 │
│  "POST /auth/register endpoint..."   │
│                                      │
│  02:17:15  💭 thinking               │
│  "Considering refresh token..."      │
│                                      │
│  02:18:30  🔧 tool_start             │
│  workspace_commit                    │
│  "Added auth register endpoint"      │
│                                      │
│  ─── end of events for T-2 ───      │
│                                      │
└──────────────────────────────────────┘
```

**Behavior:**
- Filters existing `orchestrationLogs` array by `taskId` match (from event metadata)
- Same event rendering as current EventsView (timestamp + icon + type + detail)
- Auto-scrolls to bottom as new events arrive
- If no events match the task: "No events recorded for this task yet."
- Falls back to showing all events (unfiltered) if task has no `taskId` in event metadata (backward compat)

### Docs Tab — Rich Document List (not a flat string dump)

The current Collaborate view shows raw doc names in a flat list with no metadata, no grouping, no type icons. The Docs tab replaces this with a structured, task-scoped view:

```
┌──────────────────────────────────────┐
│ Overview │ Discussion │ Docs │ Logs  │
├──────────────────────────────────────┤
│                                      │
│ THIS TASK                            │
│ ┌──────────────────────────────────┐ │
│ │ 📝 API Spec        2 editing now │ │
│ │ 📊 Decisions (3)   all agreed    │ │
│ └──────────────────────────────────┘ │
│                                      │
│ GOAL CONTEXT             🔒 [show ▾]│
│ ┌──────────────────────────────────┐ │
│ │ 🎯 Goal            active       │ │
│ │ 📋 Plan v1         executing    │ │
│ │ 🏠 Agent Statuses  live         │ │
│ └──────────────────────────────────┘ │
│                                      │
│ [+ New shared doc]                   │
└──────────────────────────────────────┘
```

**Doc type icons:**

| Icon | Y.js Type | Meaning | Click action |
|------|-----------|---------|-------------|
| 📝 | Y.XmlFragment | Rich text document | Opens `CollaborativeEditor` overlay |
| 💬 | Y.Array | Discussion thread | Switches to Discussion tab |
| 📊 | Y.Map (decisions) | Formal decisions | Opens inline `DecisionPanel` |
| 📋 | Y.Map (plan/goal) | System docs | Opens read-only detail view |
| 📄 | Y.Map (generic) | Agent-created structured data | Opens JSON viewer |

**Doc metadata — self-describing via `_meta` Y.Map inside each doc:**

Every CRDT doc carries a `_meta` Y.Map with type info (written at creation time). The listing endpoint reads it:

```typescript
// GET /api/collab/:teamId/docs returns:
[{ name: "task-003/doc-api-spec", type: "xmlfragment", createdBy: "system" },
 { name: "task-003/discussion",   type: "discussion",   createdBy: "system" },
 { name: "plan",                  type: "plan",          createdBy: "system" }]
```

Frontend maps `type` → icon: `xmlfragment` → 📝, `discussion` → 💬, `decisions` → 📊, system types → 📋.

**Cross-task doc access via Cmd+K:**

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

Cmd+K results include docs alongside tasks/plans — for power users who want to jump directly to a doc across any task.

### CollaborativeEditor Overlay

When user clicks a 📝 document in the Docs tab, it opens in a **slide-in overlay** (not full-screen — user can still see sidebar + main area dimmed behind it). Dismissible with Esc or clicking the dimmed backdrop.

```
┌────────┬─────────────────────────────┬──────────────────────────────────────┐
│ PLAN   │  (dimmed main area)         │ 📝 API Spec                    ✕    │
│ ──────  │                             │ T-2 · 2 editing · last saved 10s   │
│ (dim)  │                             ├──────────────────────────────────────┤
│        │                             │                                      │
│        │                             │  # Auth API Specification            │
│        │                             │                                      │
│        │                             │  ## Endpoints                        │
│        │                             │                                      │
│        │                             │  ### POST /auth/register             │
│        │                             │  **Body:** `{ username, password }`  │
│        │                             │  **Response:** `{ userId, token }`   │
│        │                             │                                      │
│        │                             │  ### POST /auth/login                │
│        │                             │  **Body:** `{ username, password }`  │
│        │                             │  **Response:** `{ token, refresh }`  │
│        │                             │                                      │
│        │                             │  ## Decisions                        │
│        │                             │  - Use JWT (RS256) with 15min expiry │
│        │                             │  - Refresh token in HttpOnly cookie  │
│        │                             │                                      │
│        │                             │  ── 👤 You │ 🤖 backend-dev ──      │
│        │                             │  (awareness: who's editing)          │
│        │                             │                                      │
└────────┴─────────────────────────────┴──────────────────────────────────────┘
```

**Overlay spec:**
- **Width:** 50% of viewport (min 480px, max 800px), anchored to right edge
- **Header:** doc name + task ref + editor count + last-saved indicator + ✕ close
- **Body:** existing `CollaborativeEditor` (BlockNote) — unchanged component, just wrapped in overlay
- **Awareness bar** at bottom: shows who's editing (avatars + cursor colors) — ready for Phase 3 awareness wiring
- **Backdrop:** dimmed main area (click to close)
- **Animation:** slide in from right (200ms ease-out), same as DetailPanel
- **Z-index:** above DetailPanel (so they don't conflict)

**Alternative: read-only system docs (📋 plan, goal, agent-statuses):**
```
┌──────────────────────────────────────┐
│ 📋 Plan v1                   🔒  ✕  │
│ Read-only system document           │
├──────────────────────────────────────┤
│                                      │
│  status: executing                   │
│  tasks:                              │
│    - task-1: completed               │
│    - task-2: in_progress             │
│    - task-3: pending                 │
│    - task-4: pending                 │
│    - task-5: pending                 │
│                                      │
│  (JSON/YAML formatted view)         │
│                                      │
└──────────────────────────────────────┘
```

System docs use a simple read-only JSON/YAML viewer instead of BlockNote.

### All Docs View — Browsable Document Explorer

The Docs tab is task-scoped (shows docs for one task). But users also need to **browse and search all docs across all tasks** — for post-mortems, finding something an agent created earlier, or just exploring what the team has produced.

**This is always scoped to the current team.** Docs are namespaced by `{teamId}/{goalId}/` in CRDT — the overlay shows all docs for the selected team's active goal.

**Entry points:**
- Docs tab footer: `[Browse all docs]` link
- Cmd+K: type "docs" → "Browse all documents" action
- Keyboard shortcut: `⌘⇧D` (Cmd+Shift+D)

**Opens as a full-screen overlay** (not a route — stays on the current plan URL, dismissible with Esc):

```
┌──────────────────────────────────────────────────────────┐
│ 📚 Engineering Team · Documents     🔍 Search...    ✕   │
├──────────────────────────────────────────────────────────┤
│                                                          │
│ Filter: [All ▾]  [Documents ▾]  [Discussions ▾]          │
│                                                          │
│ T-1: Set up schema                                       │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 📝 Schema Design        Document  · idle · Apr 22   │ │
│ │ 💬 Discussion            Thread   · 5 blocks         │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ T-2: API Contract                                        │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 📝 API Spec             Document  · 2 editing · now  │ │
│ │ 📊 Decisions (3)        agreed    · Apr 22           │ │
│ │ 💬 Discussion            Thread   · 12 blocks        │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ T-5: Write Tests                                         │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 📝 Test Plan            Document  · idle · Apr 23    │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
│ GOAL-LEVEL                                     🔐        │
│ ┌──────────────────────────────────────────────────────┐ │
│ │ 🎯 Goal                  active   · Apr 22           │ │
│ │ 📋 Plan v1               executing · Apr 22          │ │
│ │ 🏠 Agent Statuses        live                        │ │
│ └──────────────────────────────────────────────────────┘ │
│                                                          │
└──────────────────────────────────────────────────────────┘
```

**Key features:**
- **Team-scoped** — header shows `Engineering Team · Documents`. All docs belong to the current team's active goal.
- **Grouped by task** — docs nested under their task, with task title as section header
- **Search** — filters by doc name and content (typeahead, uses the same `DocInfo` API)
- **Type filters** — filter by Document / Discussion / Decisions / System
- **Click a doc** → closes overlay, opens that task in sidebar + doc in editor overlay
- **Goal-level docs** at the bottom with 🔐 read-only badge

**Why overlay, not a route:**
- Doesn't break the plan context — user is still "in" their plan
- Dismissible with Esc — quick in-and-out
- No sidebar/layout shift — the full-screen overlay has its own layout
- URL doesn't change — no back-button confusion

This replaces the old `/collaborate` route's browsing function while keeping docs integrated in the plan-first flow.

This unifies task + discussion + docs into **one detail panel**, with tabs replacing the current crammed sections.

---

## Sidebar Redesign

### Current (4 nav items + agent list)
```
Chat | Tasks | Collaborate | Discussions
──────────────────────────────────────
Agent list (flat)
```

### New (Plan tasks + agents, no nav items)
```
PLAN: Note Taking App        🟢
──────────────────────────────────
✅ T-1  Set up schema    BE  1m
▶  T-2  API contract (💬) BE  3m ━━━━░░
⏳ T-3  Build auth API   BE
⏳ T-4  Build login form  FE
⏳ T-5  Write tests       QA
──────────────────────────────────
AGENTS
🟢 backend       in_progress  auto
🟡 frontend      ready        review
⚪ qa            idle         manual
──────────────────────────────────
← Back to goals
```

Each task row:
- Status icon: ✅ Done, ▶ In Progress, ⏳ Pending, ❌ Failed, 🔇 Blocked
- Task title (truncated)
- 💬 icon if type is "discussion"
- Role badge (abbreviated)
- **Elapsed time** (from Channel B `started` → now or `completed` timestamp)
- **Progress bar** (thin, from Channel B `progress.pct` — only shown when in_progress)
- Click → opens task/discussion in detail panel

### Task Row Close-Up (actual scale, 240px sidebar width)

Each row is 36px tall. Components are packed left-to-right:

```
 In-progress row (with progress bar + elapsed time):
┌──────────────────────────────────────┐
│ ▶  Build auth API         BE   3m   │ ← 36px height
│ ━━━━━━━━━━░░░░░░░░░░░░░░░░░░░░░░░░░│ ← 2px progress bar, fills left-to-right
└──────────────────────────────────────┘
  ↑   ↑                      ↑    ↑
  │   title (truncate)       │    elapsed time
  status icon (16px)         role badge (4-char, 9px, border)

 Completed row (no progress bar, shows elapsed time):
┌──────────────────────────────────────┐
│ ✅  Set up schema          BE   1m  │
└──────────────────────────────────────┘

 Pending row (no progress bar, no elapsed time):
┌──────────────────────────────────────┐
│ ⏳  Write tests             QA      │
└──────────────────────────────────────┘

 Failed row:
┌──────────────────────────────────────┐
│ ❌  Deploy pipeline        DO   8m  │
└──────────────────────────────────────┘

 Discussion task (💬 badge after title):
┌──────────────────────────────────────┐
│ ▶  API contract 💬         BE   3m  │
│ ━━━━━━━━━━━━━━━━━━━━░░░░░░░░░░░░░░░│
└──────────────────────────────────────┘

 Task with ask_user pending (❓ badge, yellow tint):
┌──────────────────────────────────────┐
│ ▶  Build auth API    ❓    BE   5m  │ ← yellow bg tint on row
│ ━━━━━━━━━━━━━━━━━━━━━━━━░░░░░░░░░░░│
└──────────────────────────────────────┘
```

**`TaskTimeLabel` spec:**
- Format: `< 1m` → `< 1m`, 1-59m → `3m`, 60m+ → `1h 5m`
- Color: `text-muted-foreground` (same as role badge)
- Updates every 10s while task is `in_progress` (no per-second flicker)
- Shows final duration once task is `completed` or `failed`
- Not shown for `pending` or `ready` tasks

**`TaskProgressBar` spec:**
- Height: 2px, sits directly below the task row (no gap)
- Color: `bg-primary` (blue) fill, `bg-muted` track
- Width: `progress.pct`% of row width
- If no `pct` available: indeterminate animation (slow pulse left-to-right)
- Only visible for `in_progress` tasks. Hidden for all other statuses.
- Transition: `width 300ms ease` for smooth updates

### Agent Row Close-Up

Each agent row is 32px tall:

```
 Auto mode (active):
┌──────────────────────────────────────┐
│ 🟢  backend        in_progress auto │
└──────────────────────────────────────┘
  ↑    ↑              ↑           ↑
  │    role name      status      mode label
  mode icon (click to cycle)

 Review mode (idle):
┌──────────────────────────────────────┐
│ 🟡  frontend       ready    review  │
└──────────────────────────────────────┘

 Manual mode (idle):
┌──────────────────────────────────────┐
│ ⚪  qa              idle    manual  │
└──────────────────────────────────────┘

 Auto mode with active count (ChatAgent v2.0):
┌──────────────────────────────────────┐
│ 🟢  backend    2 active       auto  │
└──────────────────────────────────────┘
```

**`ModeIndicator` spec:**
- Icons: 🟢 `auto`, 🟡 `review`, ⚪ `manual`
- Click → cycles to next mode (auto → review → manual → auto)
- Tooltip on hover: "Auto mode — workers dispatch immediately" / "Review mode — approve before dispatch" / "Manual mode — you say go"
- v1.1: static display only (no click — backend doesn't support mode changes yet)
- v2.0: click-to-cycle wired via `POST /api/v2/teams/{id}/roles/{role}/mode`

Each agent row:
- **Mode indicator**: 🟢 auto, 🟡 review, ⚪ manual (click to cycle)
- Role name + status text
- Status dot color matches mode icon

---

## Plan Switching

Three mechanisms, ordered by speed:

### 1. Plan switcher in top bar (primary, click)

The plan name in the top bar is clickable — opens a popover with recent plans, search, and actions. Pattern: Linear's project switcher / Notion's page switcher.

```
┌────────┬──────────────────────────────────────────────┐
│  Ping  │ 📋 Note Taking App ▾       🟢 Executing      │
├────────┼─[ click ▾ ]──────────────────────────────────┤
│        │ ┌──────────────────────────────────────┐     │
│        │ │ 🔍 Search plans...                   │     │
│        │ ├──────────────────────────────────────┤     │
│        │ │ ★ ACTIVE                             │     │
│        │ │ • 📋 Note Taking App   🟢 1/5  · 4m  │     │
│        │ │                                      │     │
│        │ │ RECENT                               │     │
│        │ │   📋 Movie Booking     ✅ 8/8        │     │
│        │ │   📋 Dashboard         ⏳ 0/4        │     │
│        │ │                                      │     │
│        │ │ ──────────────────────────────────── │     │
│        │ │ + New goal                    ⌘N     │     │
│        │ │ View all plans                ⌘P     │     │
│        │ └──────────────────────────────────────┘     │
└────────┴──────────────────────────────────────────────┘
```

- **Active plan** pinned at top with a dot
- **Recent plans** sorted by last activity (max 5)
- **Search** filters by title (typeahead)
- **+ New goal** → returns to Goal Screen
- **View all plans** → Goal Screen with full list

### 2. Cmd+K (fast, keyboard)

Existing command palette gets a "Switch plan" entry and direct plan results:

```
┌─────────────────────────────────────┐
│ 🔍 movie                            │
├─────────────────────────────────────┤
│ PLANS                               │
│  📋 Movie Booking App      ✅ 8/8   │
│                                     │
│ ACTIONS                             │
│  + New goal                  ⌘N     │
│  View all plans              ⌘P     │
└─────────────────────────────────────┘
```

Plans show inline with the current command palette results. Hit Enter to switch.

### 3. ← Back to Goal Screen (browse, slow)

The `← Back to goals` link in the sidebar (already in the design) returns to the Goal Screen which lists **all** plans grouped by status:

```
─── Active Plans ────────────────────
📋 Note Taking App         🟢 1/5
─── Recent ─────────────────────────
📋 Movie Booking App       ✅ 8/8
📋 Dashboard Design        ⏳ 0/4
─── Archived ───────────────────────
📋 Old Prototype           ✅ 5/5
```

This is the **discoverable** path — for users who don't know about the switcher or palette.

### Cross-team plans?

**Plans are scoped to a team.** Switching teams (existing team selector at the top of sidebar) reloads the plan list for that team. The Goal Screen and plan switcher both filter by current team.

If a user wants to find a plan across all teams: Cmd+K searches globally; the popover and Goal Screen are team-scoped.

### URL convention

```
/                          → Goal Screen (no team selected)
/teams/{teamId}            → Goal Screen for that team
/teams/{teamId}/p/{planId} → Planner Chat for a specific plan
```

Switching plans updates `planId` in the URL → enables back/forward and deep-linking. Refresh restores the active plan.

### State preservation

When switching away from a plan and back:
- Chat scroll position restored
- Detail panel state (which task/tab was open) restored
- In-flight streaming events continue in the background; you'll see them when you switch back

This is critical because plans can run for minutes/hours — users will switch away to check other plans without losing context.

---

## What Changes

| Component | Change | Risk |
|-----------|--------|------|
| `App.tsx` | New goal screen route, remove tasks/discussions view modes | Medium |
| `Sidebar.tsx` | Replace nav items with plan task list | Medium |
| `DetailPanel.tsx` | Add tab system (Overview/Discussion/Docs/Logs) | Medium |
| `DiscussionThread.tsx` | Strip to Messages-only; extract Info/Agenda/Decisions into sibling tab components | **High** — biggest UI rewrite |
| `GoalInput.tsx` | Move to standalone Goal Screen component | Low |
| `TaskDashboard.tsx` | Remove (replaced by sidebar task list) | Low |
| Routes | Remove `/tasks`, `/discussions`, `/collaborate` | Low |
| New: `TabBar.tsx` | Reusable tab strip for detail panel and discussion | Low |
| New: `TaskTimeLabel.tsx` | Elapsed time display from Channel B timestamps | Trivial |
| New: `TaskProgressBar.tsx` | Thin progress bar from Channel B `progress.pct` | Trivial |
| New: `ModeIndicator.tsx` | Agent mode icon (🟢/🟡/⚪) with click-to-cycle | Trivial |
| New: `TaskActions.tsx` | Action buttons (Review, Retry, Pause) in task detail panel | Small |
| New: `AllDocsOverlay.tsx` | Full-screen doc browser (grouped by task, searchable, filterable) | Small |

### What's NOT Changing
- `ChatArea`, `StreamMessage`, `ToolCard`, `MessageList` — unchanged
- `AgentServiceV2` — unchanged
- Backend — **zero changes** (for the frontend redesign itself; ChatAgent layer is a separate backend feature)

### What IS Changing (hooks — for Channel B support)
- `useOrchestration` — adds `task_update` and `ask_user` Socket.IO subscriptions (behind `VITE_ENABLE_TASK_THREADS` gate)
- `useChat` — adds per-task thread partitioning of messages (behind gate)
- `types.ts` — adds `TaskUpdate` discriminated union type

---

## ChatAgent & Worker UX (L2/L3 Layer)

This section designs how ChatAgent (persistent per-role, L2) and Workers (transient, L3) appear in the frontend. See [chat-agent-layer architecture](./chat-agent-layer/feature_architecture.md) for the backend design.

**Key distinction:** The sidebar AGENTS section represents **ChatAgents** (persistent roles), not transient workers. Workers appear as task threads under a role.

### Agent Sidebar — ChatAgent as Persistent Entity

Today: sidebar shows agents as flat worker instances.
Target: sidebar shows **ChatAgents** (one per role). Workers are invisible — they're sub-agents behind the scenes.

```
AGENTS
──────────────────────────────────
🟢 backend       2 active  auto
   ├── T-2 API contract    ▶ 3m
   └── T-3 Build auth      ▶ 1m
🟡 frontend      1 queued   review
   └── T-4 Login form      ⏳
⚪ qa             idle      manual
──────────────────────────────────
```

- Each **role row** shows: mode icon (🟢/🟡/⚪), role name, active/queued count, mode label
- Expanding a role shows its **task threads** (active + queued). These are the workers.
- Click role name → opens **R1 Chat** (conversation with the persistent ChatAgent)
- Click task thread → opens **task thread** in main area (Channel A live stream for active; Channel B timeline for others)

### R1 Chat — Talking to the Role (Not the Worker)

**Pattern from Codex app:** Thread-based conversation with an agent that persists across tasks. Mid-turn steering. Fork from earlier messages.

When user clicks a role name in the sidebar, the main area shows a **persistent conversation with that ChatAgent** — not a worker's stream.

```
┌────────┬─────────────────────────────────────────────┐
│ PLAN   │                                             │
│ ──────  │  🤖 backend-dev                              │
│ ✅ T-1 │  I've completed 2 tasks so far. T-2 (API    │
│ ▶ T-2  │  contract) is in progress with 3 endpoints  │
│ ▶ T-3  │  defined. T-3 (auth) just started.          │
│ ⏳ T-4 │                                             │
│ ⏳ T-5 │  ─── Task T-1 completed · 1m ──────────── │
│        │  Set up Postgres schema with users, notes,  │
│ AGENTS │  and sessions tables.                       │
│ ──────  │                                             │
│🟢 BE ← │  👤 You                          02:20 AM   │
│  auto  │  What auth library are you using?           │
│🟡 FE   │                                             │
│ review │  🤖 backend-dev                              │
│⚪ QA   │  Passport.js with bcrypt for password       │
│ manual │  hashing. See /src/auth/middleware.ts        │
│        │                                             │
│        │  ┌─────────────────────────────────────┐   │
│        │  │ [Chat with backend-dev...]       [▶] │   │
│        │  └─────────────────────────────────────┘   │
└────────┴─────────────────────────────────────────────┘
```

**Key differences from current "Agent Chat":**
- This is an **interactive conversation** (user types, ChatAgent responds using read-only tools)
- ChatAgent has context from all its completed tasks (via `roleContext`)
- Task completion summaries appear as **inline timeline entries** (compact, not full chat bubbles)
- User can say "add rate limiting" → ChatAgent calls `create_agent_task` → task appears in sidebar
- Route: same `/teams/{id}/p/{planId}` — sidebar selection state determines what the main area shows

### Task Thread — Worker's Live Stream + Timeline

When user clicks a **task** in the sidebar (under a role), the main area shows that task's thread.

**Two rendering modes depending on task state:**

| Task state | Main area shows | Source |
|---|---|---|
| `in_progress` | **Live token stream** (Channel A) + Channel B milestones as inline cards | Socket.IO `stream` channel (existing) + `task_update` channel (new) |
| `completed` / `failed` / `pending` | **Channel B timeline only** — compact entries | `task_update` channel events from `chatAgent.threads[taskId]` |

```
┌────────┬─────────────────────────────────────────────┐
│ PLAN   │ Task T-2: Align on API contract    ▶ 3m    │
│ ──────  ├─────────────────────────────────────────────┤
│ ✅ T-1 │                                             │
│ ▶ T-2←  │  ⏺ Started                        02:17   │
│ ▶ T-3  │                                             │
│ ⏳ T-4 │  🤖 Worker output (live stream)             │
│        │  Creating POST /auth/register endpoint...   │
│ AGENTS │  > workspace_create_file             done   │
│ ──────  │  > workspace_write_file              done   │
│🟢 BE   │                                             │
│🟡 FE   │  ◆ Milestone: workspace_commit     02:19   │
│⚪ QA   │    "Added auth register endpoint"           │
│        │                                             │
│        │  ◇ Progress: 3/10 steps · 1.2k tokens      │
│        │                                             │
│        │  Creating POST /auth/login endpoint...      │
│        │  > workspace_write_file              ...    │
│        │                                             │
└────────┴─────────────────────────────────────────────┘
```

**Channel B events as timeline entries (not chat bubbles):**

| Channel B type | Icon | Rendering |
|---|---|---|
| `started` | ⏺ | Gray dot + "Started" + timestamp. Single line. |
| `progress` | ◇ | Outline diamond + note + step/token count. Single line. |
| `tool_milestone` | ◆ | Filled diamond + tool name + summary. Two lines max. |
| `ask_user` | ❓ | Yellow highlight + question. Expandable. |
| `blocked` | 🚫 | Red highlight + reason. Expandable. |
| `completed` | ✅ | Green + summary + deliverables list. Expandable. |
| `failed` | ❌ | Red + error + last step. Expandable. |

Timeline entries are **compact** — icon + one-liner + timestamp on a single line. Expand on click for details. Live stream text (Channel A) flows between them in real-time. This matches Linear's activity feed pattern.

### `ask_user` — Worker Asks the User a Question

**Pattern from Claude Code:** Permission prompt appears inline. User approves/denies. Agent resumes.

When a worker calls `ask_user`, the user sees an **inline chip in the task thread** (not a modal — modals block multi-tasking):

```
│  ─── ❓ Worker question ──────────────────────── │
│  Which authentication strategy should I use?      │
│  Options: JWT, Session cookies, OAuth2            │
│                                                   │
│  [JWT]  [Session cookies]  [OAuth2]  [Type...]   │
│  ─────────────────────────────────────────────── │
```

**Flow:**
1. Worker calls `ask_user` tool → backend emits Socket.IO `ask_user` event with `{ taskId, questionId, question, options? }`
2. Frontend renders inline chip in the active task thread
3. If user is NOT viewing this thread: **sidebar badge** on the task row (❓ icon) + optional toast notification
4. User clicks an option or types free text → `POST /api/v2/tasks/:id/answer` → backend resumes worker
5. Channel B `{ type: 'ask_user' }` also sent to ChatAgent for thread recording (notification copy only — ChatAgent doesn't mediate)

**Multi-task awareness:** If the user is viewing a different thread when `ask_user` fires:
- Task row in sidebar shows ❓ badge
- Agent row shows "1 question" count
- Toast: "backend-dev's worker needs your input on T-2"
- User clicks → switches to that task thread → sees the chip

### Review Queue — When Mode = `review`

**Pattern from Claude Code:** `acceptEdits` mode where each action needs approval. Codex app's "parallel approvals."

When a ChatAgent is in `review` mode, pending actions appear in a **review section** at the top of the R1 chat (or as a sidebar popover).

```
┌─────────────────────────────────────────────────┐
│ 🟡 backend-dev · review mode                    │
├─────────────────────────────────────────────────┤
│ PENDING REVIEW (2)                              │
│                                                 │
│ ▶ Dispatch T-3 "Build auth API"                │
│   Worker will use AiSdkAgent with 3 skills      │
│   [Approve] [Edit] [Reject]                     │
│                                                 │
│ + Create task "Add rate limiting middleware"     │
│   Requested by: user in R1 chat                 │
│   [Approve] [Edit] [Reject]                     │
│                                                 │
├─────────────────────────────────────────────────┤
│ (R1 conversation continues below)               │
```

**What gets queued in review mode:**
- Worker dispatch (ChatAgent received `onTaskReady` but won't spawn without approval)
- `create_agent_task` calls (ChatAgent won't submit to Orchestrator without approval)
- Planner escalation (ChatAgent won't notify Planner without approval)

**Approve/Edit/Reject:**
- **Approve** → action proceeds (dispatch, create, escalate)
- **Edit** → opens inline editor (e.g. edit task description before creating)
- **Reject** → action dropped; ChatAgent records rejection in thread

### Hook Changes — Channel A/B Routing

The frontend doc previously said "useChat, useOrchestration — unchanged." This needs revision for Channel B.

**New subscriptions in `useOrchestration`:**
```ts
// NEW: subscribe to task_update channel (Channel B)
socket.on('task_update', (update: TaskUpdate) => {
  // Route to sidebar (badge update) + task thread state
  updateTaskThread(update.taskId, update);
  updateSidebarBadge(update.taskId, update.type);
});

// NEW: subscribe to ask_user channel
socket.on('ask_user', (payload: { taskId, questionId, question, options? }) => {
  // Show inline chip if viewing this thread; otherwise badge + toast
  showAskUserChip(payload);
});

// EXISTING: stream channel (Channel A) — UNCHANGED
socket.on('stream', (part) => {
  // Live token rendering in active task thread — same as today
  processStreamPart(part);
});
```

**New frontend type (add to `types.ts`):**
```ts
type TaskUpdate =
  | { type: 'started';        taskId: string; role: string; ts: number }
  | { type: 'progress';       taskId: string; role: string; note: string; pct?: number; ts: number }
  | { type: 'tool_milestone'; taskId: string; role: string; tool: string; summary: string; ts: number }
  | { type: 'ask_user';       taskId: string; role: string; questionId: string; question: string; ts: number }
  | { type: 'blocked';        taskId: string; role: string; reason: string; ts: number }
  | { type: 'completed';      taskId: string; role: string; summary: string; deliverables?: string[]; ts: number }
  | { type: 'failed';         taskId: string; role: string; error: string; ts: number };
```

### Feature Gates (Frontend)

```ts
// packages/frontend/lib/features.ts
export const FEATURES = {
  chatAgentChat:  import.meta.env.VITE_ENABLE_CHAT_AGENT_CHAT === 'true',
  taskThreads:    import.meta.env.VITE_ENABLE_TASK_THREADS === 'true',
};
```

When `chatAgentChat` is off: clicking an agent in sidebar shows worker stream (today's behavior).
When on: clicking an agent opens R1 Chat surface; clicking a task opens task thread.

When `taskThreads` is off: all stream events go to one flat conversation (today).
When on: events are partitioned by `taskId` into per-task threads.

---

## Mobile Responsive Layout

The current app has a mobile sidebar drawer (hamburger → slide-in). The redesign preserves this pattern but adapts the new components.

**Breakpoint:** `< 1024px` (same as current `isMobileViewport` check in App.tsx)

### Goal Screen on Mobile

Full-width, stacked vertically. No sidebar at all.

```
┌──────────────────────────┐
│ Ping           🌙 Sign Out│
├──────────────────────────┤
│                          │
│  What would you like     │
│  to build?               │
│                          │
│ ┌──────────────────────┐ │
│ │ Build a REST API...  │ │
│ └──────────────────────┘ │
│                          │
│ Team: [Engineering ▾]    │
│                [Start ▶] │
│                          │
│ ── Recent Plans ──────── │
│ 📋 Movie Booking   ✅ 8/8│
│ 📋 Note Taking    🟡 1/5│
│                          │
│ [Build a REST API...]    │
│ [Create a marketing...]  │
│ [Design a dashboard...]  │
│                          │
└──────────────────────────┘
```

### Planner Chat on Mobile (sidebar closed)

Full-width main area. Hamburger → opens sidebar drawer.

```
┌──────────────────────────┐
│ ☰ 📋 Note Taking App 🟢  │ ← hamburger + plan name + status
├──────────────────────────┤
│                          │
│ 🤖 Planner      02:15 AM│
│ I'll create 5 tasks:    │
│ 1. Set up schema         │
│ 2. API contract          │
│ ...                      │
│                          │
│ > ✏️ submit_plan   done  │
│                          │
│ ✅ Task completed  02:16 │
│                          │
│ 🤖 Backend       02:17  │
│ Starting API contract... │
│                          │
├──────────────────────────┤
│ [Type a message...]  [▶] │
└──────────────────────────┘
```

### Mobile Sidebar Drawer (hamburger → slide-in)

```
┌──────────────────────────┐
│ ┌────────────────────┐   │
│ │ Engineering Team ▾ │   │
│ ├────────────────────┤   │
│ │                    │   │
│ │ PLAN               │   │
│ │ ✅ T-1  Schema  BE │   │
│ │ ▶  T-2  API 💬  BE │   │
│ │ ⏳ T-3  Auth   BE │   │
│ │ ⏳ T-4  Login  FE │   │
│ │ ⏳ T-5  Tests  QA │   │
│ │                    │   │
│ │ AGENTS             │   │
│ │ 🟢 backend   auto  │   │
│ │ 🟡 frontend review │   │
│ │ ⚪ qa       manual │   │
│ │                    │   │
│ │ ← Back to goals    │   │
│ └────────────────────┘   │
│  (dimmed backdrop)       │
└──────────────────────────┘
```

- Full-height drawer, 280px wide
- Same content as desktop sidebar (PlanTaskList + Agents)
- Click task → closes drawer, opens task detail (in main area on mobile, not side panel)
- DetailPanel on mobile: opens as full-screen overlay (not 320px side panel)

### DetailPanel on Mobile (full-screen overlay)

```
┌──────────────────────────┐
│ ← Task: T-2              │
│ Align on API contract    │
├──────────────────────────┤
│ Overview │ Disc │ Docs   │
├──────────────────────────┤
│                          │
│ Status: ▶ in_progress    │
│ Role:   backend-dev      │
│ Time:   3m 22s           │
│                          │
│ Depends on: (none)       │
│ Blocks: T-3, T-4         │
│                          │
│ [Review]  [Retry]        │
│                          │
│──────────────────────────│
│ ▶ Changes                │
│  (3 files, +157 lines)   │
└──────────────────────────┘
```

← back arrow returns to planner chat. No side-by-side on mobile.

---

## Future: Multi-Plan Support

Current design is single-plan. Future addition:

```
PLANS
──────────────────────────────────
📋 Note Taking App     🟢 3/5
📋 Dashboard Redesign  ⏳ 0/4
──────────────────────────────────
```

Click a plan → expands its task list. This is why tasks are plan-scoped in the sidebar, not global. The data structure already supports this (planId on each task context).

---

## Implementation Order

### Phase 0 — Chat Agent Frontend (Minimal, No Redesign)

> **Status:** Ready to implement  
> **Depends on:** Backend Chat Agent Steps 1+2 ✅ (already built)  
> **Scope:** Make Chat Agents accessible in the CURRENT frontend with minimal changes. No sidebar redesign, no new routes, no new components.

**Why Phase 0?** The full frontend redesign (Phases 1-4 below) is a multi-week effort. But the backend Chat Agent is ready NOW. Phase 0 wires the existing frontend to talk to Chat Agents with the smallest possible change set — so we can validate the feature before committing to the full redesign.

#### Current State (Ground Truth from Code Audit)

```
User clicks agent in sidebar
  → ChatArea.handleSubmit()
  → if (!agent.parentId) → sendToManager("manager")     // orchestrator
  → if (agent.parentId)  → sendToWorker(role, content)   // worker
  
Response arrives on socket "stream" channel
  → useOrchestration routes by agentId
  → findAgentByRole(agentId) → resolves to MongoDB agent ID
  → processStreamPart(resolvedId, part)
  → chatHistories[resolvedId] updated
```

**Problem:** Clicking an agent always goes through `sendToWorker(role)` which routes to `handleWorkerMessage` on the backend — creating a transient worker, not using the persistent ChatAgent.

#### Design: What Changes

**Principle:** Reuse everything. No new components, no new routes, no sidebar changes. Just change the message routing.

```
BEFORE:                              AFTER (with FF_ENABLE_CHAT_AGENTS):
────────                             ─────────────────────────────────────
Click agent → sendToWorker(role)     Click agent → sendToChatAgent(role)
Backend: handleWorkerMessage()       Backend: handleChatAgentMessage()
  → spawns transient AiSdkAgent        → uses persistent ChatAgent
  → fresh context each time             → persistent conversation
  → dies after response                  → stays alive
```

**Visual change: NONE.** The UI looks identical. The user clicks an agent, types a message, sees a streamed response. The only difference is the response comes from a persistent ChatAgent with task knowledge instead of a transient worker.

#### File Changes (5 files, ~40 lines total)

**1. `AgentServiceV2.ts` — add `sendToChatAgent()` method**

```typescript
// NEW method — sends to persistent ChatAgent instead of transient worker
sendToChatAgent(role: string, content: string): void {
  if (!this.isReady()) throw new Error("Not connected");
  this.socket!.emit("message", {
    teamId: this.teamId,
    agentId: `chat-${role}`,          // ← "chat-" prefix routes to ChatAgent
    sessionId: this.sessionId,
    content,
  });
}
```

**2. `ChatArea.tsx` — route sub-agent messages through ChatAgent**

```typescript
// BEFORE (line ~153):
if (isOrchestrator) {
  agentServiceV2.sendToManager(userMsg.content);
} else {
  agentServiceV2.sendToWorker(agent.role.toLowerCase(), userMsg.content, activeTask?.id);
}

// AFTER:
if (isOrchestrator) {
  agentServiceV2.sendToManager(userMsg.content);
} else if (FEATURES.chatAgentChat) {
  agentServiceV2.sendToChatAgent(agent.role.toLowerCase(), userMsg.content);
} else {
  agentServiceV2.sendToWorker(agent.role.toLowerCase(), userMsg.content, activeTask?.id);
}
```

**3. `useOrchestration.ts` — handle `chat-` prefixed agentId in stream responses**

```typescript
// In onStream callback, add handling for chat-* agentId:
if (streamAgentId.startsWith("chat-")) {
  // ChatAgent response — map back to the role's MongoDB agent ID
  const role = streamAgentId.replace("chat-", "");
  const resolved = findAgentByRole(role, teamIdRef.current);
  if (resolved) {
    onStreamPart(resolved.id, part);
    return;
  }
}
// ... existing isOrchestrator / findAgentByRole logic continues
```

**4. `lib/features.ts` — NEW file, frontend feature flags**

```typescript
export const FEATURES = {
  chatAgentChat: import.meta.env.VITE_ENABLE_CHAT_AGENT_CHAT === 'true',
};
```

**5. `.env` or `.env.local` — enable the flag**

```
VITE_ENABLE_CHAT_AGENT_CHAT=true
```

#### What This Achieves

| Before (worker path) | After (ChatAgent path) |
|---|---|
| "What tasks do you have?" → empty response (worker has no context) | "What tasks do you have?" → lists tasks with status (ChatAgent has `get_my_tasks` tool) |
| Every message creates a new agent | Same agent persists across messages |
| No memory of previous conversations | Multi-turn conversation maintained |
| No task awareness | Full task awareness via read-only tools |

#### What This Does NOT Do (Deferred to Full Redesign)

- No mode indicators (🟢/🟡/⚪) in sidebar — Phase 1
- No `ask_user` inline chips — Phase 2
- No review queue — Phase 3
- No sidebar redesign — Phase 1

#### Click Task → Show Worker Stream (Phase 0 Addition)

Tasks are already rendered in the sidebar via `PlanTaskList`. Clicking a task currently opens the DetailPanel. We add: **clicking an in-progress task switches the main area to show that worker's live stream**.

```
TASKS (existing sidebar)           MAIN AREA (what changes)
──────────────────────              ─────────────────────────
✅ T-1  Set up schema  BE  1m      
▶ T-2   API contract  BE  3m  ←── Click → shows worker's live stream for T-2
⏳ T-3  Build auth     BE          
⏳ T-4  Login form     FE         Click → shows task detail (description, deps)
⏳ T-5  Write tests    QA         Click → shows task detail
```

| Task State | Main Area Shows | Source |
|---|---|---|
| `in_progress` | Worker's live stream (StreamMessage, ToolCard — same components) | `stream` socket events filtered by taskId |
| `completed` | Worker's saved output (loaded from chat history) | Persisted messages from `IChatService` |
| `pending` / `ready` | Task detail card (description, role, deps) | Static from task data |
| `failed` | Error + last output | Persisted messages |

**How it works:** The `stream` socket event already carries `agentId` (role) and `taskId`. When a task is selected in the sidebar, the main area filters `chatHistories` by `taskId` to show only that task's messages. For live streams, `processStreamPart` routes by `taskId` when `selectedTaskId` is set.

#### Agent Row — Active Worker Count Badge

Agent rows in the AGENTS section show an active worker count instead of expandable threads:

```
AGENTS
🟢 backend  (2)    auto       ← "(2)" = 2 workers running. No expansion needed.
🟡 frontend (1)    review     ← Click agent → ChatAgent R1 Chat
⚪ qa              manual     ← No badge when idle
```

The count comes from `tasks.filter(t => t.assignedRole === role && t.status === 'in_progress').length`. No backend change needed.

#### Click Agent → R1 Chat + Running Workers Panel

Clicking an agent row opens the ChatAgent R1 Chat in the main area. When that role has active workers, a **collapsible running workers panel** appears at the top of the chat:

```
┌─────────────────────────────────────────────────────┐
│ 🟢 backend-dev · 2 active workers            auto  │
├─────────────────────────────────────────────────────┤
│ RUNNING WORKERS                              [hide] │
│ ┌─────────────────────────────────────────────────┐ │
│ │ ▶ T-2  API contract      3m    ━━━━━━░░░  [→]  │ │
│ │ ▶ T-3  Build auth         1m    ━━░░░░░░░  [→]  │ │
│ └─────────────────────────────────────────────────┘ │
├─────────────────────────────────────────────────────┤
│                                                     │
│  🤖 backend-dev                                     │
│  I've completed 2 tasks so far. T-2 is in progress  │
│  with 3 endpoints defined. T-3 just started.        │
│                                                     │
│  👤 You                              02:20 AM       │
│  What auth library are you using?                   │
│                                                     │
│  🤖 backend-dev                                     │
│  Passport.js with bcrypt for password hashing.      │
│                                                     │
│  ┌───────────────────────────────────────────────┐  │
│  │ [Chat with backend-dev...]                [▶] │  │
│  └───────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────┘
```

**Running Workers Panel spec:**
- **Position:** Pinned between header and chat messages. Scrollable chat below.
- **Shows ONLY active (`in_progress`) workers.** Completed/failed/pending workers are NOT shown here — see them by clicking the task in the sidebar.
- **Sort order:** Last started first (newest at top). Worker that just started appears at the top.
- **Each row:** Status icon + task title + elapsed time + progress bar + `[→]` jump button
- **`[→]` button:** Switches main area to that task's worker stream
- **Three states:**

  ```
  State 1: Collapsed (32px)         State 2: Compact (≤3 rows)       State 3: Full view (overlay)
  ──────────────────────             ──────────────────────            ──────────────────────
  ▶ 7 active [expand]               ACTIVE (7)      [full] [hide]    ┌──────────────────────┐
                                     ▶ T-9  Queue  0m ░░░░░  [→]     │ ACTIVE WORKERS (7)   │
                                     ▶ T-8  Cache  4m ━━░░░  [→]     │                      │
                                     ▶ T-7  API    0m ░░░░░  [→]     │ ▶ T-9  Queue  0m ░░ │
                                     ╌╌ 4 more ╌╌╌╌╌╌╌╌╌╌╌          │ ▶ T-8  Cache  4m ━━ │
                                                                      │ ▶ T-7  API    0m ░░ │
                                                                      │ ▶ T-6  Docs   2m ━░ │
                                                                      │ ▶ T-5  Tests  0m ░░ │
                                                                      │ ▶ T-3  Auth   1m ━░ │
                                                                      │ ▶ T-2  API    3m ━━ │
                                                                      │           [close ✕]  │
                                                                      └──────────────────────┘
  ```

  - **Collapsed → Compact:** Click "expand" or header
  - **Compact → Full view:** Click `[full]` or "N more" — slide-down overlay, 50% viewport max, scrollable
  - **Compact → Collapsed:** Click `[hide]`

- **Visibility rules:**
  - **0 active workers → panel not rendered at all** (no empty state, no "0 active" message)
  - **1-3 active workers → compact by default** (no scroll needed)
  - **4+ active workers → compact with "N more" hint**
  - **Worker completes → row disappears from panel** (user sees it by clicking the task in sidebar)
  - **New worker starts → row appears at top** (most recent first)

- **Where to see non-active workers:**
  - Click **completed task** in sidebar TASKS section → main area shows saved worker output
  - Click **failed task** → shows error + last output
  - Click **pending task** → shows task detail (no worker view — never started)

- **Data source:** `tasks.filter(t => t.assignedRole === role && t.status === 'in_progress').sort((a, b) => (b.startedAt || 0) - (a.startedAt || 0))` — no backend change.
- **User preference:** Last used state (collapsed/compact) persisted in localStorage.

#### Sidebar Layout — Flat, No Nesting (Future-Ready for Goals)

```
┌────────────────────────────────┐
│ GOALS (Phase 4+)               │  ← future: parallel plans v1.0
│ 🟢 Build REST API       3/5   │
│ ⏳ Setup CI Pipeline    0/4   │
├────────────────────────────────┤
│ TASKS (current plan)           │  ← existing PlanTaskList
│ ✅ T-1  Schema      BE  1m    │  ← click → saved output
│ ▶ T-2   API         BE  3m   │  ← click → live worker stream  
│ ⏳ T-3  Auth        BE        │  ← click → task detail
├────────────────────────────────┤
│ AGENTS                         │
│ 🟢 backend  (2)    auto       │  ← click → ChatAgent R1 Chat
│ 🟡 frontend (1)    review     │
│ ⚪ qa              manual     │
│ Planner                        │  ← click → planner chat
├────────────────────────────────┤
│ ← Back to goals               │
└────────────────────────────────┘
```

**Why flat, no nesting:**
- Tasks stay in TASKS section (not duplicated under agents)
- Agents show badge count only (not expandable worker threads)
- GOALS section reserved for parallel plans (Phase 4+) — just a list, click to switch
- 3 sections max: Goals + Tasks + Agents. Clean, no clutter.

#### Rollback

`VITE_ENABLE_CHAT_AGENT_CHAT=false` → messages route through `sendToWorker()` as before. Zero visual change.

---

### Full Redesign Phases (After Phase 0)

| Phase | What | Effort | Depends On |
|---|---|---|---|
| **1** | Sidebar redesign (GOALS + TASKS + AGENTS flat sections, mode indicators, worker count badges) | 1 week | Phase 0 |
| **2** | ask_user inline chips + toast notifications + Channel B timeline entries | 1 week | Phase 1 + Backend Step 3 |
| **3** | Review queue (review mode UI, approve/reject actions) | 3 days | Phase 2 + Backend Step 4 |
