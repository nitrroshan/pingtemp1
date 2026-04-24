# Frontend Redesign — Implementation Planning (v1.1)

**Status:** Phase 1-5, 7-10 done · Phase 6 skipped (UX polish only) · Phase 11-14 planned (most need backend)  
**Branch:** `feature/frontend-redesign-goal-first` · **Backend changes:** none for v1.0; ChatAgent backend required for v2.0

See [feature_architecture.md](../frontend-redesign-goal-first.md) for the full design with wireframes.

---

## Phase Summary

| Phase | Title | Status | Risk | Backend needed? |
|---|---|---|---|---|
| 1 | Goal Screen + PlanList | ✅ Done | Low | No |
| 2 | Plan-scoped Sidebar | ✅ Done | Medium | No |
| 3 | Plan switcher + URL | ✅ Done | Medium | No |
| 4 | Remove old view routes | ✅ Done | Low | No |
| 5 | TabBar + DetailPanel task Overview | ✅ Done | Medium | No |
| 6 | DiscussionThread Slack-style split | ⏭️ Skipped | High | No |
| 7 | Top bar plan info | ✅ Done | Low | No |
| **8** | **DetailPanel full tab system** | ✅ Done (Discussion sub-tab; Docs deferred) | Medium | No |
| **9** | **Task row enhancements** | ✅ Done | Low | Channel B (optional) |
| **10** | **Task detail actions** | ✅ Done | Low | Retry/Pause endpoints |
| **11** | **All Docs overlay** | 📋 Planned | Medium | Doc metadata API |
| **12** | **ChatAgent sidebar (R1 chat)** | 📋 Planned | Medium | `ENABLE_CHAT_AGENTS` |
| **13** | **Channel B routing + task threads** | 📋 Planned | High | `ENABLE_TASK_THREADS` |
| **14** | **ask_user + review queue** | 📋 Planned | High | `ENABLE_CHAT_AGENT_DISPATCH` |

---

## Completed Phases (v1.0)

### Phase 1 — Goal Screen + PlanList ✅
**Built:** `GoalScreen.tsx`, `PlanList.tsx`, `lib/planId.ts`, `GoalScreen/index.ts`  
**Modified:** `App.tsx` — GoalScreen at `/` and `/teams/{id}` (no plan), `activePlanId` state  
**Deviation:** PlanList uses localStorage (not goals API). planId is timestamp-based.

### Phase 2 — Plan-scoped Sidebar ✅
**Built:** `Sidebar/PlanTaskList.tsx`  
**Modified:** `Sidebar.tsx` — new props (`planTasks`, `planName`, `selectedTaskId`, `onSelectTask`, `activePlanId`, `onBackToGoals`). PlanTaskList replaces NAV_ITEMS when plan is active.

### Phase 3 — Plan switcher + URL ✅
**Built:** `PlanSwitcher.tsx`  
**Modified:** `App.tsx` — `parseRouteState` extracts planId from `/teams/{id}/p/{planId}`, PlanSwitcher in context bar, `storedPlans` memo from localStorage.

### Phase 5 — TabBar + DetailPanel (partial) ✅
**Built:** `ui/TabBar.tsx`  
**Modified:** `DetailPanel.tsx` — `selectedTask` prop, task-scoped Overview rendering.  
**Not yet done:** Full 4-tab system (Overview/Discussion/Docs/Logs) → see Phase 8.

### Phase 7 — Top bar plan info ✅
**Modified:** `App.tsx` — PlanSwitcher replaces agent name in context bar when plan active.

---

## Deferred Phases (acceptable for v1.0)

### Phase 4 — Remove old view routes ✅
**Done:** App.tsx stripped of `viewMode`/`collabDocId`/`activeDiscussion` state, 4-branch AnimatePresence collapsed to single `<ChatArea/>` render, `CollabFileTree`/`ActiveDiscussionView` inline components removed, `parseRouteState` simplified to `teamId`/`planId` only. Sidebar lost `ViewMode`/`NAV_ITEMS`/`NavButton`. CommandPalette stripped of Navigation group. `TaskDashboard/` directory deleted.
**Result:** ~250 lines removed across App.tsx + Sidebar.tsx + CommandPalette.tsx.

### Phase 6 — DiscussionThread Slack-style split ⏭️ Skipped
**Why skipped:** Current DiscussionThread works. The Slack-style refactor is pure UX polish, not a functional gap. May revisit if user feedback demands richer discussion UX.
**Files (if revisited):** Rewrite `DiscussionThread.tsx`, extract `DiscussionMessages.tsx`, `DiscussionInfo.tsx`, `DiscussionAgenda.tsx`, `DiscussionDecisions.tsx`.

---

## Planned Phases (v1.1 — frontend-only, no backend gate)

### Phase 8 — DetailPanel full tab system ✅
**Goal (revised):** Replace the flat 5-tab DetailPanel with a context-aware **3-mode × N-tab** system driven by what's selected.
**Shipped:**
- Three modes inferred from selection state:
  - **Task-scoped** (`selectedTask` set) → Overview · Discussion · Logs
  - **Plan-scoped** (manager/orchestrator agent active, no task) → Tasks · Activity
  - **Agent-scoped** (worker/chat agent active, no task) → Skills · Activity
- `TaskActions` rendered inside Overview (Phase 10).
- Discussion sub-tab embeds `<DiscussionThread>` via `useDiscussion({ teamId, goalId: activePlanId, taskId })` with connecting/error fallbacks.
- Closing the panel (or unselecting the task) routes back through the mode resolver — there is no "global" 5-tab fallback anymore.

**Deferred to v2.0:**
- **Docs sub-tab** — needs `GET /api/collab/:teamId/docs?taskId=` (doc metadata API) so the panel can list CRDT docs scoped to a task. Tracked under Phase 11.
- **Output / files-changed** in Overview — needs Channel B `TaskUpdate.completed` payload.

### Phase 9 — Task row enhancements (sidebar) ✅
**Shipped:** `TaskTimeLabel`, `TaskProgressBar`, `ModeIndicator` built and wired into `Sidebar/PlanTaskList.tsx` and the agent rows. v1.1 uses `createdAt` + `status` for elapsed time and indeterminate progress; click-to-cycle on `ModeIndicator` is rendered but no-op until backend supports mode changes.

### Phase 10 — Task detail actions ✅
**Shipped:** `TaskActions` rendered at the bottom of the Overview tab. Conditional buttons by status (Review/Retry for completed, Retry/View Error for failed, Pause for in_progress, none for pending/ready). API calls are best-effort with toasts on failure; backend retry/cancel endpoints still TBD (button click is a no-op + toast when endpoint missing).

### Phase 11 — All Docs overlay
**Goal:** Full-screen overlay for browsing all CRDT docs across tasks. Entry: Docs tab footer `[Browse all docs]`, Cmd+K "docs", or `⌘⇧D`.
**Risk:** Medium — new overlay pattern, needs doc metadata API enrichment.

**Files:**
- NEW `components/AllDocsOverlay/AllDocsOverlay.tsx` — full-screen overlay (Esc to dismiss)
- NEW `components/AllDocsOverlay/DocRow.tsx` — row with type icon (📝/💬/📊/📋), name, metadata, click action

**Layout:**
```
📚 Engineering Team · Documents     🔍 Search...    ✕
Filter: [All ▾]  [Documents ▾]  [Discussions ▾]

T-1: Set up schema
  📝 Schema Design      Document · idle · Apr 22
  💬 Discussion          Thread · 5 blocks

T-2: API Contract
  📝 API Spec           Document · 2 editing · now
  📊 Decisions (3)      agreed · Apr 22
  💬 Discussion          Thread · 12 blocks

GOAL-LEVEL                                    🔐
  🎯 Goal               active · Apr 22
  📋 Plan v1            executing · Apr 22
```

**Backend dependency:** `GET /api/collab/:teamId/docs` needs to return `{ name, type, createdBy, createdAt }` instead of just `string[]`. The `_meta` Y.Map approach from the CRDT audit is the right solution — each doc carries its own type info.

**Done when:**
- Overlay opens from 3 entry points (Docs tab, Cmd+K, ⌘⇧D)
- Docs grouped by task, searchable, filterable by type
- Click a doc → closes overlay, opens task in sidebar + doc in editor overlay
- Graceful fallback when `_meta` is missing (show 📄 + raw name)

---

## Planned Phases (v2.0 — requires ChatAgent backend)

These phases are feature-gated and only activate when the corresponding backend feature flags are enabled. Without the flags, the UI behaves exactly as v1.1.

### Phase 12 — ChatAgent sidebar + R1 Chat
**Gate:** `VITE_ENABLE_CHAT_AGENT_CHAT=true`
**Backend requires:** `ENABLE_CHAT_AGENTS` + `ENABLE_CHAT_AGENT_CHAT` (backend Steps 1-2)
**Risk:** Medium — new chat surface, new API endpoint.

**Files:**
- NEW `components/Sidebar/AgentRoleRow.tsx` — expandable role row: mode icon, role name, active/queued count. Click name → R1 Chat. Expand → show task threads.
- NEW `components/ChatArea/RoleChatArea.tsx` — persistent conversation with ChatAgent (not worker stream). Chat input sends to `POST /api/v2/teams/{id}/roles/{role}/messages`. Task completion summaries appear as inline timeline entries.
- EDIT `components/Sidebar.tsx` — when gate is on, AGENTS section uses `AgentRoleRow` instead of flat `AgentRow`. Task threads nested under role.
- EDIT `App.tsx` — new selection mode: `selectedRole` state. When set, main area shows `RoleChatArea` instead of `ChatArea`. Route stays same (`/teams/{id}/p/{planId}`).
- NEW `lib/features.ts` — frontend feature gate helpers:
  ```ts
  export const FEATURES = {
    chatAgentChat: import.meta.env.VITE_ENABLE_CHAT_AGENT_CHAT === 'true',
    taskThreads: import.meta.env.VITE_ENABLE_TASK_THREADS === 'true',
  };
  ```

**Behavior when gate is OFF:** Clicking agent shows worker stream (today's behavior). No AgentRoleRow, no RoleChatArea. Zero visual change.

**Behavior when gate is ON:**
- Clicking agent NAME → opens R1 Chat (persistent conversation with ChatAgent)
- Clicking task under agent → opens task thread in main area (worker stream for active; timeline for others)
- User can type messages to the role; ChatAgent responds using read-only tools (get_my_tasks, read_workspace, etc.)

**Done when:**
- With gate off: zero visual change
- With gate on: clicking role opens R1 Chat; user can ask "what are you working on?" and get a response
- Task completion summaries from ChatAgent threads appear as timeline entries in R1 Chat

### Phase 13 — Channel B routing + task threads
**Gate:** `VITE_ENABLE_TASK_THREADS=true`
**Backend requires:** `ENABLE_TASK_THREADS` (backend Step 3)
**Risk:** High — new Socket.IO channel, hook changes, message partitioning.

**Files:**
- NEW `types/TaskUpdate.ts` — `TaskUpdate` discriminated union (7 variants: started, progress, tool_milestone, ask_user, blocked, completed, failed). Same shape as backend.
- EDIT `hooks/useOrchestration.ts` — subscribe to new `task_update` Socket.IO channel. Store per-task `TaskUpdate[]` in state. Behind gate check.
- EDIT `hooks/useChat.ts` — when gate is on, partition messages by `taskId` into `threads[taskId]` map. Main conversation = messages with no taskId.
- NEW `components/ChatArea/TaskThreadView.tsx` — renders a task thread:
  - For `in_progress`: live Channel A stream + Channel B milestones as inline timeline entries
  - For `completed`/`failed`/`pending`: Channel B timeline entries only (compact)
- NEW `components/ChatArea/TimelineEntry.tsx` — renders a single Channel B event as a compact timeline entry (icon + one-liner + timestamp). Expandable on click.

**Data flow:**
```
Socket.IO 'task_update' → useOrchestration.taskUpdates[taskId].push(update)
  → Sidebar badge update (PlanTaskList re-renders with new status)
  → If viewing this task's thread → TaskThreadView re-renders with new entry

Socket.IO 'stream' → useChat (existing, unchanged)
  → If viewing this task's thread → live token rendering (Channel A)
```

**Done when:**
- With gate off: zero change, all stream events go to flat conversation
- With gate on: task-level events route to per-task threads; sidebar badges update on Channel B events
- Clicking a task shows its thread with timeline entries
- Channel A (live tokens) and Channel B (milestones) render side-by-side in active task threads

### Phase 14 — ask_user inline chip + review queue
**Gate:** `VITE_ENABLE_CHAT_AGENT_CHAT=true` (same as Phase 12)
**Backend requires:** `ENABLE_CHAT_AGENT_DISPATCH` (backend Step 4)
**Risk:** High — new interaction pattern, notification routing.

**Files:**
- NEW `components/ChatArea/AskUserChip.tsx` — inline chip in task thread for worker questions:
  ```
  ❓ Which authentication strategy should I use?
  [JWT]  [Session cookies]  [OAuth2]  [Type...]
  ```
  Clicking option → `POST /api/v2/tasks/:id/answer` → worker resumes.
- NEW `components/Sidebar/AskUserBadge.tsx` — ❓ badge on task row when ask_user is pending and user is viewing a different thread.
- NEW `components/ChatArea/ReviewQueue.tsx` — pending actions section at top of R1 Chat when agent mode = `review`:
  ```
  PENDING REVIEW (2)
  ▶ Dispatch T-3 "Build auth API"    [Approve] [Edit] [Reject]
  + Create task "Add rate limiting"   [Approve] [Edit] [Reject]
  ```
- EDIT `hooks/useOrchestration.ts` — subscribe to `ask_user` Socket.IO channel. Route to active thread or badge.
- EDIT `App.tsx` — toast notification when ask_user fires and user is not viewing that thread.

**Done when:**
- Worker ask_user → inline chip appears in task thread
- User answers → worker resumes
- When viewing different thread: sidebar badge (❓) + toast notification
- Review mode: pending actions appear with Approve/Edit/Reject at top of R1 Chat

---

## Out of Scope (all versions)

- Cmd+K plan search — palette already exists; add when plans list gets long (v1.2)
- Backend plan persistence — v2.0 when goals API ships
- Concurrent multi-plan execution
- Plan archive / delete
- Multi-agent dialog between ChatAgents — Planner mediates
- Agent memory persistence UI — separate feature

---

## Rollout Strategy

| Version | Phases | Backend dependency | Feature gates |
|---|---|---|---|
| **v1.0** (current) | 1-3, 5 (partial), 7 | None | None |
| **v1.1** (next) | 4, 6, 8, 9, 10, 11 | Doc metadata API for Phase 11 | None (all frontend-only) |
| **v2.0** (ChatAgent) | 12, 13, 14 | ChatAgent backend Steps 1-4 | `VITE_ENABLE_CHAT_AGENT_CHAT`, `VITE_ENABLE_TASK_THREADS` |

**v1.0 → v1.1:** Pure frontend. Ship any phase independently. Each leaves app working.
**v1.1 → v2.0:** Requires backend ChatAgent feature flags. Frontend gates ensure zero change when flags are off.

## Validation

After each phase: `bun run dev:frontend`, smoke test:
1. Login → GoalScreen shows
2. Select team → submit goal → sidebar shows tasks
3. Click task → DetailPanel opens with Overview
4. Plan switcher → switch plans → back/forward works
5. (v2.0) Click agent name → R1 Chat surface
6. (v2.0) ask_user fires → inline chip + badge

## Open Questions

1. **Default route on first login** — **Decision:** `/` if no `localStorage.activeTeamId`; otherwise `/teams/{id}`.
2. **In-flight streams when switching plans** — Preserved in background; visible when switching back.
3. **Plan ID stability** — `plan-{timestamp}` for v1.0. SHA1 when goals API ships.

## Tasks Index

| Task | Title | Phase | Status |
|---|---|---|---|
| [001](./tasks/task-001-goal-screen.md) | Goal Screen component | 1 | ✅ Done |
| [002](./tasks/task-002-plan-list.md) | PlanList from goals API | 1 | ✅ Done |
| [003](./tasks/task-003-sidebar-plan-task-list.md) | Sidebar plan task list | 2 | ✅ Done |
| [004](./tasks/task-004-plan-switcher.md) | Plan switcher + URL planId | 3 | ✅ Done |
| [005](./tasks/task-005-remove-old-routes.md) | Remove old view routes | 4 | ⏸️ Deferred |
| [006](./tasks/task-006-tabbar-primitive.md) | TabBar primitive | 5 | ✅ Done |
| [007](./tasks/task-007-detail-panel-tabs.md) | DetailPanel tab rewrite | 5 | 🟡 Partial (Overview only) |
| [008](./tasks/task-008-discussion-messages-extract.md) | Extract DiscussionMessages | 6 | ⏸️ Deferred |
| [009](./tasks/task-009-discussion-tabs.md) | Discussion Info/Agenda/Decisions tabs | 6 | ⏸️ Deferred |
| [010](./tasks/task-010-top-bar-plan-info.md) | Top bar plan info | 7 | ✅ Done |
| — | DetailPanel full 4-tab system | 8 | 📋 Planned |
| — | TaskTimeLabel + TaskProgressBar + ModeIndicator | 9 | 📋 Planned |
| — | TaskActions (Review/Retry/Pause) | 10 | 📋 Planned |
| — | AllDocsOverlay | 11 | 📋 Planned |
| — | ChatAgent sidebar + R1 Chat | 12 | 📋 Planned |
| — | Channel B routing + task threads | 13 | 📋 Planned |
| — | ask_user + review queue | 14 | 📋 Planned |
