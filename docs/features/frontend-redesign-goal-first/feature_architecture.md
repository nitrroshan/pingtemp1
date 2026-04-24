# Frontend Redesign — Goal-First, Plan-Scoped (Architecture)

**Date:** 2026-04-22 · **Status:** Approved · **Risk:** High (UI rewrite, no backend changes initially)

Source design: [../frontend-redesign-goal-first.md](../frontend-redesign-goal-first.md)

## Decision

Adopt **goal-first navigation**. Replace the four hardcoded view tabs (Chat / Tasks / Collaborate / Discussions) with a single shell: **Sidebar (plan-scoped task list + agents) + Main (chat) + Detail Panel (tabbed)**.

Two design alternatives were considered and rejected:
- **A. Keep tabs, add Goal Screen as overlay** — preserves muscle memory but doesn't fix context-splitting (root pain point from screenshots).
- **B. Single-pane chat-only (Cursor-style)** — too far from current model; loses plan visibility.
- **C. Shell with plan-scoped sidebar (chosen)** — matches Linear/Notion mental model; keeps existing chat machinery; aligns with "plan as first-class object."

## Key Architectural Constraint

**Backend has no plan persistence today.** Plans live in-memory in `AgentManager` per session; no `/api/v2/plans` endpoint exists.

**Decision:** Frontend derives plans client-side from `GET /api/v2/teams/{id}/goals` for v1.0. Backend persistence is a v2.0 follow-up. Plan ID = stable hash of `(teamId, goalText, createdAt)`.

This means:
- v1.0 plan switcher shows goal history, not true plan history
- Refresh restores active plan via `localStorage` + URL
- Real plan persistence (concurrent plans, archive, etc.) deferred to v2.0

## Component Topology

```
App (router shell)
├── GoalScreen (new)               [/  or  /teams/{id}]
│   ├── GoalInput (reused)
│   └── PlanList (new) — derived from goals API
│
└── PlanShell (new)                [/teams/{id}/p/{planId}]
    ├── Sidebar (rewritten)
    │   ├── TeamSwitcher (existing)
    │   ├── PlanTaskList (new) — replaces NAV_ITEMS
    │   ├── AgentList (existing, restyled)
    │   └── BackToGoals link
    ├── TopBar
    │   ├── PlanSwitcher (new) — popover
    │   └── PlanStatusBadge
    ├── ChatArea (existing, unchanged)
    └── DetailPanel (rewritten with tabs)
        ├── TabBar (new primitive)
        ├── OverviewTab (new) — task metadata
        ├── DiscussionTab (Slack-style)
        │   ├── DiscussionMessages (extracted from DiscussionThread)
        │   ├── DiscussionInfo (new tab content)
        │   ├── DiscussionAgenda (extracted from AgendaBar)
        │   └── DiscussionDecisions (new)
        ├── DocsTab (new) — embeds CollabFileTree scoped to task
        └── LogsTab (existing Events content)
```

## Routes

| Route | Renders | Notes |
|---|---|---|
| `/` | `GoalScreen` (no team) | Lists teams to pick |
| `/teams/{teamId}` | `GoalScreen` (team selected) | Goal input + plan list for that team |
| `/teams/{teamId}/p/{planId}` | `PlanShell` | Active plan workspace |
| `/manage-teams` | `TeamsPage` (unchanged) | Special-cased |

**Removed:** `/teams/{id}/tasks`, `/teams/{id}/collaborate`, `/teams/{id}/discussions` → all become DetailPanel tabs.

## State Scope Strategy

To avoid composite-key explosion across hooks, **only one plan is "active" at a time** (single-plan mode). Switching plans is a navigation event that:
1. Updates `localStorage.activePlanId`
2. Reloads orchestration state from `/api/v2/sessions/{teamId}/restore`
3. Replays chat history scoped to that goal

`useChat`/`useOrchestration` keep their current `agentId`-keyed shape — no `(agentId, planId)` rewrite. This trades concurrent plans for simpler state. Concurrent plans is a v2.0 concern.

## Integration Points

- **Backend:** zero changes for v1.0. Reuses `/api/v2/teams/{id}/goals` and `/api/v2/sessions/{id}/restore`.
- **Socket.IO:** unchanged event contracts.
- **CRDT/Hocuspocus:** unchanged doc naming `{teamId}/{goalId}/{taskId}/discussion`.
- **Auth:** unchanged.

## Trade-offs

| Trade-off | Accepted because |
|---|---|
| Single active plan (not concurrent) | Avoids hook rewrites; matches single-session backend reality |
| Client-derived plan IDs | Backend persistence is large scope; goals API is sufficient |
| DiscussionThread split into 4 tab components | Slack/Discord pattern; current 320px panel is unusable |
| Manual routing (no React Router upgrade) | Existing `parseRouteState` works; less churn |

## Versioning

- **v1.0** — Goal Screen, plan-scoped sidebar, plan switcher (client-derived), DetailPanel tabs, DiscussionThread split. No backend changes.
- **v1.1** (deferred) — Cmd+K plan search, deep-link sharing.
- **v2.0** (deferred) — Backend plan persistence, concurrent plans, plan archive.
