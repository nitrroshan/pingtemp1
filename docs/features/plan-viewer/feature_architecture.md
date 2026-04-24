# Plan Viewer — Feature Architecture

> **Status**: ✅ Done (Steps 1-7), Polish pending  
> **Last Updated**: 2026-04-24  
> **Goal**: Full-screen plan management UI — view all plans, drill into tasks/agents, take actions.  
> **Related**: [frontend-redesign-goal-first](../frontend-redesign-goal-first.md), [parallel-plans](../parallel-plans/feature_architecture.md)

---

## 1. Problem

The current plan/task view is fragmented:
- **Sidebar** shows a flat task list for the active plan (no plan selection)
- **DetailPanel** shows task detail in a 320px side panel (cramped)
- **PlanSwitcher** is a small popover in the context bar (no overview)
- **GoalScreen** handles plan creation but not management

There's no single place to see all plans, compare progress, see agents across roles, or take bulk actions. The screenshot from the current app shows tasks grouped by role with status — but this lives inside the main chat layout, competing for space.

---

## 2. UX Research — Patterns

| Tool | Pattern | What we adopt |
|------|---------|---------------|
| **Linear** | Project → Issue list grouped by status/assignee. Sidebar shows detail. | Role-grouped task list, status badges, keyboard nav |
| **GitHub Projects** | Board + Table views, status columns, assignee avatars | Board view (Kanban by status) as alternate view |
| **Vercel** | Deployment list → click → detail page with logs | Plan list → plan detail with task output |
| **Notion** | Database views — toggle between Table/Board/Timeline | View toggle (List / Board) |

---

## 3. Design

### Route

`/plans` — full-screen page, like `/manage-teams`. Replaces the main shell (no sidebar, no chat area).

### Layout: Two-Panel Master-Detail

```
┌──────────────────────────────────────────────────────────────────────┐
│  ← Back    Plan Viewer    [team ▾]              🔍 Filter  + Goal   │
├────────────────────┬─────────────────────────────────────────────────┤
│                    │                                                 │
│  PLAN LIST (320px) │  PLAN DETAIL (flex-1)                          │
│                    │                                                 │
│  🟢 React dash... │  Design a React dashboard with real-time ...    │
│     7/15 · running │  7/15 tasks · 3 roles · running                │
│                    │                                                 │
│  ✅ Landing page   │  [List] [Board]                   [⟳ Retry]   │
│     5/5 · done     │                                                 │
│                    │  ▾ FRONTEND (6)                                 │
│  ⏸️ Postgres       │  ✅ Research charting library       frontend    │
│     0/3 · paused   │  ✅ Design dashboard wireframes     frontend    │
│                    │  ⊘ Implement React components       frontend    │
│                    │  ○ Integrate redesigned API          frontend    │
│                    │                                                 │
│                    │  ▾ BACKEND (6)                                  │
│                    │  ⊗ Set up real-time data API         backend    │
│                    │  ✅ Diagnose API setup failure        backend    │
│                    │  ✅ Redesign and implement data API   backend    │
│                    │                                                 │
│                    │  ▾ QA (3)                                       │
│                    │  ...                                            │
│                    │                                                 │
│                    │  ┌─ AGENTS ──────────────────────────────────┐  │
│                    │  │ 🤖 frontend (idle) · backend (working)   │  │
│                    │  │ 🤖 qa (idle)                              │  │
│                    │  └──────────────────────────────────────────┘  │
├────────────────────┴─────────────────────────────────────────────────┤
│  StatusBar                                                           │
└──────────────────────────────────────────────────────────────────────┘
```

### Left Panel — Plan List

- All plans for selected team, sorted by recency
- Each card: plan goal (truncated), progress fraction, status badge, running indicator
- Click → loads detail on right
- Active plan highlighted
- Team dropdown at top (switch without navigating away)
- Data source: `localStorage` (v1), `GET /api/v2/teams/{id}/goals` (v2)

### Right Panel — Plan Detail

#### Header
- Plan goal (full text)
- Stats: `X/Y tasks · N roles · status`
- View toggle: **List** (default) | **Board** (Kanban)
- Actions: Retry Failed, Open in Chat, Pause/Resume

#### List View (default)
Tasks grouped by role (matches current sidebar/DetailPanel pattern):
- Collapsible role groups: `FRONTEND (6)`, `BACKEND (6)`, `QA (3)`
- Each task row: status icon, title, assigned role, dependency indicator
- Click task → slide-over with: description, deps, status history, output/logs

Status icons:
| Status | Icon | Color |
|--------|------|-------|
| ready | ○ | blue |
| pending | ◔ | gray |
| in_progress | ◐ | amber (animated) |
| completed | ✅ | green |
| failed | ⊗ | red |
| discarded | ⊘ | gray strikethrough |

#### Board View (toggle)
Kanban columns by status:
- Columns: `Ready` | `In Progress` | `Completed` | `Failed`
- Cards: task title + role badge
- Visual density — see the pipeline at a glance
- No drag-and-drop (v1) — status driven by backend

#### Agents Bar (bottom of detail)
- Horizontal strip showing each role involved in the plan
- Status dot: idle (gray), working (amber pulse), completed (green), failed (red)
- Click role → filter task list to that role's tasks
- Shows agent name + current task (if working)

#### Task Detail Slide-Over
Triggered by clicking a task row. 480px slide-over from right:
- Task title, description, status badge
- Dependencies (with status of each prerequisite)
- Assigned role
- Output/deliverables (if completed)
- Error message (if failed)
- Actions: Start (manual mode), Retry, Open Agent Chat

---

## 4. Component Tree

```
PlanViewerPage (route: /plans)
├── PlanViewerHeader
│   ├── BackButton (→ previous route)
│   ├── TeamDropdown (switch team in context)
│   ├── SearchFilter (filter tasks by text)
│   └── NewGoalButton (→ GoalScreen or inline)
├── PlanListPanel (left, 320px, scrollable)
│   └── PlanCard × N
│       ├── PlanGoalText (truncated)
│       ├── ProgressBar (completed / total)
│       └── StatusBadge (active/completed/paused/failed)
└── PlanDetailPanel (right, flex-1)
    ├── PlanDetailHeader
    │   ├── PlanGoalFull
    │   ├── PlanStats (tasks, roles, status)
    │   ├── ViewToggle (List | Board)
    │   └── ActionButtons (Retry, Open Chat, Pause)
    ├── TaskListView (when view=list)
    │   └── RoleGroup × N (collapsible)
    │       └── TaskRow × N (status, title, role)
    ├── TaskBoardView (when view=board)
    │   └── StatusColumn × 4
    │       └── TaskCard × N
    ├── AgentsBar (bottom strip)
    │   └── AgentChip × N (role, status, current task)
    └── TaskSlideOver (480px, conditional)
        ├── TaskHeader (title, status, role)
        ├── TaskDependencies (prerequisite list)
        ├── TaskOutput (deliverables, summary)
        └── TaskActions (Start, Retry, Open Chat)
```

---

## 5. Data Sources

| Data | Source (v1) | Source (v2 — future) |
|------|-------------|---------------------|
| Plan list | `localStorage ping:plans:{teamId}` | `GET /api/v2/teams/{id}/goals` |
| Tasks | `useOrchestration()` hook (live Socket.IO) | Same |
| Agents/roles | `useAgentTree()` hook | Same |
| Task actions | Existing handlers (`handleStartTask`, etc.) | Same |

The Plan Viewer connects to the **same hooks** used by the main chat shell — it's a different layout over the same data, not a new data source.

---

## 6. Navigation & Integration

### Entry points
1. **Cmd+K** → "View All Plans" command (already wired)
2. **Menu bar** → View → Plan Viewer
3. **URL** → `/plans` (direct navigation)
4. **Sidebar** → "Plans" quick action in footer

### Exit points
1. **Back button** → returns to previous route
2. **"Open in Chat"** on a plan → navigates to `/teams/{id}/p/{planId}`
3. **"Open Agent Chat"** on a task → navigates to `/teams/{id}/p/{planId}` with agent selected

---

## 7. Interaction with Existing Features

| Feature | Relationship |
|---------|-------------|
| **DetailPanel** (right panel) | Plan Viewer replaces the need for DetailPanel's "plan mode". DetailPanel stays for task-scoped and agent-scoped views within chat. |
| **PlanSwitcher** (context bar) | Stays — quick plan switch within chat. Plan Viewer is the full management experience. |
| **Sidebar PlanTaskList** | Stays — compact in-context task list. Plan Viewer is the expanded version. |
| **GoalScreen** | Stays — goal creation flow. Plan Viewer's "+ Goal" button can route to GoalScreen or use inline creation. |
| **Cmd+K "View All Plans"** | Updated to navigate to `/plans` instead of toggling DetailPanel. |
