# Frontend Orchestrator Integration — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 1 (Core Loop)

---

## Branch
- `feature/frontend-orchestrator-integration`

## Scope
Wire the orchestrator planner flow into the frontend: goal submission → planner interaction (clarify/discuss/research) → plan approval → task execution tracking → plan mutations → completion. Extract App.tsx (1100+ lines) into hooks + focused components.

---

## Current Codebase Inventory

Audit of every frontend file this feature touches. Each tagged:
- **STAYS** — No changes needed. Used as-is.
- **REFACTOR** — Exists, needs modification. Details of what changes.
- **NEW** — Does not exist. Must be created from scratch.

### Entry Points

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `index.tsx` | ~15 | **STAYS** | `ReactDOM.createRoot`, `<App />` in StrictMode. No changes. |
| `index.html` | ~65 | **REFACTOR** (minor) | **Exists:** CDN Tailwind, custom nexus color theme, typing-dot animation. **Change:** Add toast container div (`<div id="toast-root">`). Keep CDN Tailwind (migrate to PostCSS later in frontend-phase1-core). |
| `vite.config.ts` | ~25 | **STAYS** | Port 3000, `@/` alias, env vars. No changes. |
| `constants.ts` | ~3 | **STAYS** | Empty constants. No changes. |

### Core Application

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `App.tsx` | ~1100 | **REFACTOR** (heavy) | **Exists:** `CollabFileTree` inline component (~115 lines), 17 useState hooks, 5 useEffect hooks (socket connection, agent sync, team fetch, ref sync ×2), `findAgentByRole()` fuzzy matcher, `unsubMessage/unsubState/unsubOutput/unsubError` inline Socket.IO subscriptions (~120 lines), team fetcher + agent fetcher (~80 lines), utility functions (`findAgentById`, `updateAgents`, `createSubAgent`, `addSubAgentToParent`, `createAgentFromRole`, `updateOrchestratorWithSubAgents` — ~100 lines), handlers (`handleSelectAgent`, `handleToggleCollapse`, `handleOpenAddAgentModal`, `handleAddAgent` with V2 API team creation — ~120 lines), message handlers (`handleToggleAutoExecute`, `handleApprovePlan`, `handleStartTask`, `handleCompleteTask`, `handleCancelTask`, `handleUpdateMessages` — ~60 lines), task handlers (`handleAddTask`, `handleToggleTask`, `handleDeleteTask` — ~30 lines), orchestration handlers (`handleAssignTask` with mock timeouts — ~25 lines), JSX render with tab bar + sidebar + chat + panels (~120 lines). **Extract to hooks:** `useSocket` (connection + subscriptions), `useTeams` (fetch + state), `useAgentTree` (agents + selection + collapse), `useOrchestration` (plan + tasks + approval + planner interaction), `useChat` (messages + send). **Extract to components:** `CollabFileTree` to own file. **Remove:** Mock `handleAssignTask` with fake timeouts (replaced by real orchestrator). `INITIAL_AGENTS` dependency (replaced by backend teams). **Keep:** `viewMode` (chat/collaborate toggle), component wiring in render. **Target:** ~200 lines (imports + hooks + JSX wiring). |
| `types.ts` | ~65 | **REFACTOR** | **Exists:** `Agent` (id, name, role, description, icon, systemInstruction, parentId, subAgents, collapsed, hasAppInterface), `Message` (id, role, content, timestamp, isError), `TaskStatus` (5 states), `Task` (id, title, description, status, assignedRole, priority, dependencies, completed, createdAt), `ChatSession`, `ThemeColor`, `ActiveAgentState`, `OrchestrationEvent`. **Add:** `PlannerQuestion` (id, content, options?, type: 'ask'|'discuss'|'tell'), `PlannerNotification` (id, type, severity, message, timestamp), `PlanMutationEvent` (type, taskId?, payload), `SessionPhase` ('idle'|'planning'|'awaiting_approval'|'executing'|'completed'), `TaskDependencyInfo` (taskId, blockedBy[], blocks[]), `GoalSubmission` (content, context?). **Change:** `Task` — add `output_data?: string`, `blockedBy?: string[]`. `Message` — add `messageType?: 'chat'|'planner_ask'|'planner_tell'|'planner_discuss'|'notification'`, `questionId?: string`, `options?: string[]`. |

### Services

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `services/AgentServiceV2.ts` | ~570 | **REFACTOR** | **Exists:** `AgentServiceV2` class with Socket.IO connection (`/socket.io/v2` path, polling transport), `register` + `registered` handshake, 5 event handlers (`message`, `state`, `output`, `progress`, `error`), callback sets for each event type, `sendToManager()`, `sendToWorker()`, 6 action methods (`approvePlan`, `startTask`, `completeTask`, `cancelTask`, `autoExecute`, `getState`), HTTP methods (`createTeam`, `getTeams`, `getTeam`, `deleteTeam`, `getAgents`, `getSession`, `getTasks`). Types: `AgentMessage`, `SessionState`, `Task`, `TaskUpdate`, `AgentOutput`, `Progress`, `ErrorInfo`, HTTP response types. **Add:** New Socket.IO event handlers: `planner:ask_user` → callback set, `planner:tell_user` → callback set, `planner:discuss_approach` → callback set, `plan:task_updated`/`plan:tasks_added`/`plan:task_removed` → mutation callback set, `planner:notification` → notification callback set. New send methods: `respondToPlanner(questionId, answer)` → emits `planner:user_response`, `rejectPlan(reason?)` → emits action `reject-plan`. New subscription methods: `onPlannerAsk()`, `onPlannerTell()`, `onPlannerDiscuss()`, `onPlanMutation()`, `onNotification()`. **Refactor:** `SessionState` type — add `phase: SessionPhase`, `notifications?: PlannerNotification[]`. |
| `services/AgentManagerService.ts` | — | **STAYS** (deprecated) | Legacy service. Not touched. Will be removed in frontend-phase1-core. |
| `services/SocketService.ts` | — | **STAYS** (deprecated) | Legacy WebSocket service. Same. |
| `services/HttpService.ts` | — | **STAYS** (deprecated) | Legacy HTTP service. Same. |
| `services/geminiService.ts` | — | **STAYS** | Direct Gemini API (local-only feature). Not modified. |

### Components — ChatArea

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `components/ChatArea/ChatArea.tsx` | ~190 | **REFACTOR** | **Exists:** `viewMode` (chat/tasks), `inputValue`, `isStreaming` state. `handleSubmit()` routes to `sendToManager()` or `sendToWorker()` based on `agent.parentId`. **Change:** Add `viewMode: 'plan'` option for plan view. Render `PlannerInteraction` component inline in chat when `message.messageType` is `planner_ask`/`planner_discuss`. Add progress spinner when `sessionPhase === 'planning'`. |
| `components/ChatArea/MessageList.tsx` | ~95 | **REFACTOR** | **Exists:** Maps `Message[]` to bubble UI. User messages right-aligned (indigo), model messages left-aligned (cyan). Streaming dots. **Change:** Add planner message types: `planner_tell` → info banner (blue left border, info icon). `planner_ask` → question card with text input + submit. `planner_discuss` → option cards (radio/checkbox selection + submit). `notification` → compact notification row (severity-colored dot + message). Keep existing chat bubbles for regular messages. |
| `components/ChatArea/ChatInput.tsx` | ~65 | **REFACTOR** (minor) | **Exists:** Textarea + send button. `agentName` placeholder. **Change:** When `pendingQuestion` is active (planner asked something), show answer-mode UI: question context above input, "Reply to planner" placeholder, answer button instead of send. Disable regular send while question pending. |
| `components/ChatArea/Header.tsx` | ~100 | **REFACTOR** (minor) | **Exists:** Agent name/icon, chat/tasks toggle, auto-execute toggle, panel toggle. **Change:** Add `plan` tab to view toggle (3 tabs: Chat / Tasks / Plan). Add session phase indicator badge (Planning → yellow pulse, Executing → green pulse, Awaiting Approval → orange). |
| `components/ChatArea/TaskList.tsx` | ~65 | **STAYS** | Read-only task list with TaskItem rendering. No changes needed — task updates come via props. |
| `components/ChatArea/TaskItem.tsx` | ~140 | **REFACTOR** (minor) | **Exists:** Status badge (Ready/Pending/Running/Done/Failed), Start/Complete/Cancel buttons, dependency indicator. **Change:** Add `output_data` preview (truncated, expandable). Add click handler to navigate to task's agent chat. |
| `components/ChatArea/index.ts` | ~6 | **REFACTOR** (minor) | Barrel exports. Add new component exports. |

### Components — PlanApproval

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `components/PlanApproval/PlanApproval.tsx` | ~95 | **REFACTOR** | **Exists:** Fixed overlay modal with task list (numbered, role badge, priority badge), "Approve & Execute" button, "Review Later" dismiss. **Change:** Add "Reject" button → calls `rejectPlan(reason)`. Add inline edit: click task title to edit, drag to reorder, remove task button. Add dependency visualization: indented tree or simple arrow lines showing task→dependency. Add summary stats bar (total tasks, roles involved, estimated complexity). Keep existing approve flow. |
| `components/PlanApproval/index.ts` | ~2 | **STAYS** | Barrel export. No changes. |

### Components — Sidebar

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `components/Sidebar.tsx` | ~190 | **REFACTOR** | **Exists:** Collapsible sidebar (64→256px), recursive `renderAgent()` tree, active agent highlight with cyan border, role badge, add sub-agent button, "New Workflow" footer button. **Change:** Add task progress indicator per agent: small progress bar or fraction (2/5 tasks) next to role badge. Add session phase dot (colored) next to team name. Add notification badge (count) when planner has pending questions. |

### Components — AgentManagerPanel

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `components/AgentManagerPanel/AgentManagerPanel.tsx` | ~30 | **REFACTOR** (minor) | **Exists:** 380px right panel with PanelHeader + PanelTabs (swarm/events) + SwarmView/EventsView. **Change:** Add third tab: "Notifications" — shows planner notifications with severity colors. |
| `components/AgentManagerPanel/SwarmView.tsx` | ~50 | **STAYS** | Displays active agents. No changes. |
| `components/AgentManagerPanel/EventsView.tsx` | ~50 | **STAYS** | Displays orchestration logs. No changes. |
| `components/AgentManagerPanel/AgentCard.tsx` | ~40 | **STAYS** | Agent status card. No changes. |
| `components/AgentManagerPanel/PanelHeader.tsx` | ~20 | **STAYS** | Close button + title. No changes. |
| `components/AgentManagerPanel/PanelTabs.tsx` | **REFACTOR** (minor) | Add "Notifications" tab with badge count. |
| `components/AgentManagerPanel/index.ts` | ~8 | **STAYS** | Barrel exports. No changes. |

### Components — AgentModal

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `components/AgentModal/*` (7 files) | ~400 total | **STAYS** | Agent creation modal (form, library, tabs, header, footer). No changes for this feature. |

### Components — Other

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `components/CollaborativeEditor.tsx` | ~150 | **STAYS** | BlockNote + Hocuspocus CRDT editor. No changes. |
| `components/PingView.tsx` | ~300 | **STAYS** | Demo/prototype component with mock mission data. Not used in main flow. |

### New Files

| File | Tag | Purpose |
|------|-----|---------|
| `hooks/useSocket.ts` | **NEW** | Socket.IO connection lifecycle. Extracted from App.tsx lines 290-410. Manages: connect/disconnect per team, event subscriptions (message, state, output, progress, error + new planner events), cleanup on team change. Returns: `{ isConnected, error }`. |
| `hooks/useTeams.ts` | **NEW** | Team fetching + state. Extracted from App.tsx lines 500-560. Manages: fetch teams on mount, fetch agents per team, merge into agent tree. Returns: `{ teams, isLoading, refetch }`. |
| `hooks/useAgentTree.ts` | **NEW** | Agent hierarchy state. Extracted from App.tsx utility functions + agent handlers. Manages: `agents[]`, `activeAgentId`, `selectedTeamId`, selection routing (team vs sub-agent → socket connection), collapse toggle, add agent flow. Returns: `{ agents, activeAgent, selectedTeamId, selectAgent, toggleCollapse, addAgent }`. |
| `hooks/useOrchestration.ts` | **NEW** | Plan + task + approval + planner interaction state. Manages: `currentPlan`, `sessionPhase`, `tasks` record, `notifications[]`, `pendingQuestion`. Subscribes to: `state` (plan + task updates), `planner:ask_user`, `planner:tell_user`, `planner:discuss_approach`, `plan:*` mutation events, `planner:notification`. Actions: `approvePlan()`, `rejectPlan(reason)`, `respondToQuestion(id, answer)`, `startTask(id)`, `completeTask(id)`, `cancelTask(id)`. Returns all state + actions. |
| `hooks/useChat.ts` | **NEW** | Message state + send. Extracted from App.tsx message routing + handlers. Manages: `chatHistories` record, `isStreaming`. Subscribes to: `message` events, routes by agentId. Actions: `sendMessage(agentId, content)`, `clearHistory(agentId)`. Returns: `{ messages, isStreaming, sendMessage, clearHistory }`. |
| `components/PlannerInteraction.tsx` | **NEW** | Inline planner question/discussion UI rendered within MessageList. Three variants: **Ask** (question text + text input + reply button), **Discuss** (question + option cards + select + confirm), **Tell** (info banner, no input). Shows `questionId` context, times out with "Planner proceeded without answer" after deadline. |
| `components/NotificationPanel.tsx` | **NEW** | Notification list for AgentManagerPanel third tab. Groups by severity (urgent red, warning yellow, info blue). Shows timestamp + source. Click to navigate to related task/agent. |
| `components/TaskDashboard.tsx` | **NEW** | Full plan view (third tab in ChatArea). DAG visualization: tasks as cards connected by dependency arrows. Progress summary bar. Filter by status/role. Click task → navigate to agent chat. Real-time status updates via Socket.IO. |
| `components/GoalInput.tsx` | **NEW** | Shown in ChatArea when no active session. Large textarea with "What would you like to build?" prompt. Example goal chips below. Submit triggers `sendToManager()`. Replaces empty chat state for team orchestrators. |
| `components/Toast.tsx` | **NEW** | Toast notification system. Renders into `#toast-root` portal. Auto-dismiss after 5s. Severity colors (error=red, warning=yellow, success=green, info=blue). Stacks bottom-right. Used for `agent:error`, `task:failed`, planner notifications. |

### Data / Config

| File | Lines | Tag | What Exists → What Changes |
|------|-------|-----|----------------------------|
| `dummyData/constants.ts` | ~100 | **REFACTOR** (minor) | **Exists:** `INITIAL_AGENTS` (3 dummy orchestrators with sub-agents), `AGENT_TEMPLATES` (4 templates). **Change:** `INITIAL_AGENTS` → empty array `[]` (teams come from backend now). Keep `AGENT_TEMPLATES` for AgentModal library. |
| `assets/icons.ts` | ~30 | **STAYS** | `getIconForRole()` helper. No changes. |
| `metadata.json` | — | **STAYS** | App metadata. No changes. |

---

## Summary: Stays / Refactor / New

| Category | Count | Files |
|----------|-------|-------|
| **STAYS** (no changes) | 16 | index.tsx, vite.config.ts, constants.ts, AgentManagerService, SocketService, HttpService, geminiService, TaskList, SwarmView, EventsView, AgentCard, PanelHeader, PlanApproval/index, AgentModal/* (7), CollaborativeEditor, PingView, assets/icons, metadata.json |
| **REFACTOR** (modify existing) | 12 | App.tsx (**heavy**), types.ts, AgentServiceV2.ts, index.html (minor), ChatArea.tsx, MessageList.tsx, ChatInput.tsx (minor), Header.tsx (minor), TaskItem.tsx (minor), PlanApproval.tsx, Sidebar.tsx, AgentManagerPanel.tsx (minor), PanelTabs.tsx (minor), dummyData/constants.ts (minor) |
| **NEW** (create from scratch) | 10 | useSocket.ts, useTeams.ts, useAgentTree.ts, useOrchestration.ts, useChat.ts, PlannerInteraction.tsx, NotificationPanel.tsx, TaskDashboard.tsx, GoalInput.tsx, Toast.tsx |

---

## State Architecture

### Before (App.tsx — 17 useState, all in one component)
```
App.tsx
├── agents: Agent[]                          → useAgentTree
├── activeAgentId: string                    → useAgentTree
├── chatHistories: Record<string, Message[]> → useChat
├── tasks: Record<string, Task[]>            → useOrchestration
├── isModalOpen, modalParentId               → stays local
├── isPanelOpen                              → stays local
├── isWorkflowsExpanded                      → stays local
├── selectedTeamId                           → useAgentTree
├── isSocketConnected                        → useSocket
├── activeOrchestrationAgents                → useOrchestration
├── orchestrationLogs                        → useOrchestration
├── autoExecuteEnabled                       → useOrchestration
├── currentPlan                              → useOrchestration
├── sessionState                             → useOrchestration
├── viewMode                                 → stays local
├── collabDocId                              → stays local
└── (5 useRefs for callbacks)                → eliminated by hooks
```

### After (hooks own their state)
```
App.tsx (~200 lines) — wires hooks to components
├── useSocket(selectedTeamId)
│   └── { isConnected, error }
│
├── useTeams()
│   └── { teams, isLoading, refetch }
│
├── useAgentTree(teams)
│   ├── agents: Agent[]
│   ├── activeAgent: Agent | undefined
│   ├── selectedTeamId: string | null
│   ├── selectAgent(agent)
│   ├── toggleCollapse(id)
│   └── addAgent(data)
│
├── useOrchestration(selectedTeamId)
│   ├── currentPlan: Task[] | null
│   ├── sessionPhase: SessionPhase
│   ├── tasks: Record<string, Task[]>
│   ├── notifications: PlannerNotification[]
│   ├── pendingQuestion: PlannerQuestion | null
│   ├── orchestrationLogs: OrchestrationEvent[]
│   ├── autoExecuteEnabled: boolean
│   ├── approvePlan()
│   ├── rejectPlan(reason)
│   ├── respondToQuestion(id, answer)
│   ├── startTask(id), completeTask(id), cancelTask(id)
│   └── toggleAutoExecute()
│
├── useChat(selectedTeamId, agents)
│   ├── chatHistories: Record<string, Message[]>
│   ├── isStreaming: boolean
│   ├── sendMessage(agentId, content)
│   └── clearHistory(agentId)
│
└── Local state (5 useState)
    ├── isModalOpen, modalParentId
    ├── isPanelOpen
    ├── isWorkflowsExpanded
    ├── viewMode ('chat' | 'collaborate')
    └── collabDocId
```

### Data Flow Diagram
```
Backend Socket.IO ←→ AgentServiceV2 (singleton)
                         │
        ┌────────────────┼────────────────┐
        ↓                ↓                ↓
   useSocket        useChat         useOrchestration
   (connection)     (messages)      (plan, tasks, planner Q&A)
        │                │                │
        └────────┬───────┘                │
                 ↓                        ↓
            useAgentTree            PlannerInteraction
            (agent hierarchy)       TaskDashboard
                 │                  PlanApproval
                 ↓                  NotificationPanel
              App.tsx                     │
                 │                        ↓
    ┌────────────┼──────────────┐    Toast (portal)
    ↓            ↓              ↓
 Sidebar     ChatArea    AgentManagerPanel
```

---

## UI Design

### Layout (unchanged structure, enhanced content)
```
┌──────────────────────────────────────────────────────────────────┐
│ Tab Bar: [Chat] [Collaborate]                            (right) │
├──────────┬───────────────────────────────────────┬───────────────┤
│ Sidebar  │ Center Area                           │ Right Panel   │
│ (64/256) │ (flex-1)                              │ (380px,toggle)│
│          │                                       │               │
│ Teams    │ ┌─ Header ──────────────────────────┐ │ Swarm View    │
│ tree     │ │ Agent name │ [Chat][Tasks][Plan]  │ │ Events View   │
│ with     │ │ Phase dot  │ [Auto] [Panel]       │ │ Notifications │
│ progress │ ├────────────────────────────────────┤ │               │
│ badges   │ │                                    │ │               │
│          │ │  Chat: MessageList (existing)      │ │               │
│ ● team   │ │  + PlannerInteraction (inline)     │ │               │
│   2/5    │ │  + GoalInput (when idle)           │ │               │
│  ├─ dev  │ │                                    │ │               │
│  ├─ qa   │ │  Tasks: TaskList (existing)        │ │               │
│          │ │                                    │ │               │
│          │ │  Plan: TaskDashboard (new)         │ │               │
│          │ │                                    │ │               │
│          │ ├────────────────────────────────────┤ │               │
│          │ │ ChatInput (or answer input)        │ │               │
│          │ └────────────────────────────────────┘ │               │
├──────────┴───────────────────────────────────────┴───────────────┤
│ Toast notifications (portal, bottom-right)                        │
└──────────────────────────────────────────────────────────────────┘

Plan Approval (modal overlay — enhanced):
┌─────────────────────────────────────────────────┐
│ Plan Ready for Approval          [×]            │
│ 5 tasks · 3 roles · Est: Medium                 │
├─────────────────────────────────────────────────┤
│ 1. ✏️ Research market trends    [researcher]     │
│    └─ no dependencies                            │
│ 2. ✏️ Design API schema         [architect]      │
│    └─ depends on: #1                             │
│ 3. ✏️ Implement endpoints       [developer]      │
│    └─ depends on: #2                             │
│ (drag to reorder, click to edit, × to remove)   │
├─────────────────────────────────────────────────┤
│ [Reject with reason...]   [Approve & Execute ✓] │
└─────────────────────────────────────────────────┘

Planner Question (inline in chat):
┌─────────────────────────────────────────────────┐
│ 🤔 Planner is asking:                           │
│ "Should we use REST or GraphQL for the API?"    │
│                                                  │
│ [REST — simpler, standard]                       │
│ [GraphQL — flexible, one endpoint]               │
│ [Let me type...]                                 │
│                                                  │
│ ⏱ Auto-proceed in 4:32                          │
└─────────────────────────────────────────────────┘

Planner Status (inline in chat):
┌─────────────────────────────────────────────────┐
│ ℹ️ Planner: Researching framework options...     │
│    Found 3 viable approaches. Evaluating.        │
└─────────────────────────────────────────────────┘
```

---

## Implementation Steps

### Step 1: Types + Service Layer
**Tag: REFACTOR (types.ts, AgentServiceV2.ts)**

**REFACTOR files:**
- `types.ts` — Add `PlannerQuestion`, `PlannerNotification`, `PlanMutationEvent`, `SessionPhase`, `GoalSubmission`. Extend `Message` with `messageType`, `questionId`, `options`. Extend `Task` with `output_data`, `blockedBy`.
- `services/AgentServiceV2.ts` — Add 6 new event handlers in `setupEventHandlers()`: `planner:ask_user`, `planner:tell_user`, `planner:discuss_approach`, `plan:task_updated`, `plan:tasks_added`/`plan:task_removed`, `planner:notification`. Add callback sets + subscription methods (`onPlannerAsk()`, `onPlannerTell()`, `onPlannerDiscuss()`, `onPlanMutation()`, `onNotification()`). Add send methods: `respondToPlanner(questionId, answer)` → emits `planner:user_response`. `rejectPlan(reason?)` → emits action `reject-plan`. Update `SessionState` type with `phase` field.

**Exit:** Types compile, new service methods emit correct Socket.IO events, new subscription methods return unsubscribe functions

### Step 2: Extract Hooks from App.tsx
**Tag: NEW (5 hook files) + REFACTOR (App.tsx)**

**NEW files:**
- `hooks/useSocket.ts` — Extract from App.tsx lines 290-310 (connection logic) + lines 312-410 (event subscriptions). Takes `selectedTeamId`, returns `{ isConnected, error }`. Internal: manages `agentServiceV2.connect()` / `disconnect()` lifecycle, reconnection on team change.
- `hooks/useTeams.ts` — Extract from App.tsx lines 500-560 (fetchTeams effect). Returns `{ teams: TeamResponse[], isLoading, refetch() }`.
- `hooks/useAgentTree.ts` — Extract from App.tsx: `agents` state + `activeAgentId` + `selectedTeamId` + all agent utility functions (`findAgentById`, `updateAgents`, `createSubAgent`, `addSubAgentToParent`, `createAgentFromRole`, `updateOrchestratorWithSubAgents`, `findAgentByRole`) + handler functions (`handleSelectAgent`, `handleToggleCollapse`, `handleAddAgent`). Returns: `{ agents, activeAgent, activeAgentId, selectedTeamId, selectAgent, toggleCollapse, addAgent, findAgentByRole }`.
- `hooks/useOrchestration.ts` — Extract from App.tsx: `currentPlan`, `sessionState`, `tasks`, `autoExecuteEnabled`, `activeOrchestrationAgents`, `orchestrationLogs` state. Subscribes to AgentServiceV2 `state`, `planner:*`, `plan:*` events. Includes `respondToQuestion(questionId, answer)` action. Returns all state + actions + `pendingQuestion` + `notifications`.
- `hooks/useChat.ts` — Extract from App.tsx: `chatHistories` state + message routing logic from `unsubMessage` callback (agent matching, auto-switch, JSON parsing). Returns `{ chatHistories, isStreaming, sendMessage(agentId, content, taskId?), clearHistory(agentId) }`.

**REFACTOR files:**
- `App.tsx` — Replace 17 useState + 5 useEffect with 5 hook calls. Remove all extracted functions. Target ~200 lines: imports + hook calls + local state (modal, panel, view) + JSX wiring.

**Exit:** App.tsx under 250 lines. All existing functionality preserved. No visual changes.

### Step 3: Planner Interaction Components
**Tag: NEW (PlannerInteraction, GoalInput, Toast)**

**NEW files:**
- `components/PlannerInteraction.tsx` — Renders inside MessageList for planner message types. Three variants:
  - **Ask**: Question text + text input field + "Reply" button. Calls `respondToQuestion(questionId, answer)`.
  - **Discuss**: Question text + option cards (radio select) + optional freeform + "Confirm" button. Calls `respondToQuestion(questionId, selectedOption)`.
  - **Tell**: Info/progress/warning banner. Blue/yellow/red left border. No interaction needed.
  - Timeout countdown: shows "Auto-proceeding in X:XX" when planner has timeout. After timeout, shows "Planner proceeded without your input."
- `components/GoalInput.tsx` — Full-width centered form. "What would you like to build?" heading. Large textarea. Example goal chips ("Build a REST API", "Create a marketing campaign", "Analyze competitor data"). Submit button calls `sendMessage(teamId, content)`. Shown when: team selected + `sessionPhase === 'idle'` + no messages.
- `components/Toast.tsx` — Portal component into `#toast-root`. Stack of toast notifications (bottom-right, max 5 visible). Auto-dismiss 5s (errors 10s). Props: `{ message, severity, onDismiss }`. Managed by `useToast()` hook (internal). Triggered by: `agent:error`, `task:failed`, urgent planner notifications.

**REFACTOR files:**
- `index.html` — Add `<div id="toast-root"></div>` before closing body tag.

**Exit:** Planner questions render inline in chat. Goal input shows for idle sessions. Toast system works.

### Step 4: Enhanced MessageList + ChatInput
**Tag: REFACTOR (MessageList.tsx, ChatInput.tsx)**

**REFACTOR files:**
- `components/ChatArea/MessageList.tsx` — Currently renders all messages as chat bubbles (user right, model left). **Add:** Check `message.messageType`:
  - `undefined` or `'chat'` → existing bubble rendering (no change)
  - `'planner_ask'` → render `<PlannerInteraction type="ask" ... />`
  - `'planner_discuss'` → render `<PlannerInteraction type="discuss" ... />`
  - `'planner_tell'` → render `<PlannerInteraction type="tell" ... />`
  - `'notification'` → compact notification row (colored severity dot + timestamp + message)
- `components/ChatArea/ChatInput.tsx` — Currently: textarea + send button. **Add:** When `pendingQuestion` is provided (planner waiting for answer), show:
  - Question context bar above input ("Planner asked: {question preview}")
  - Input placeholder changes to "Reply to planner..."
  - Send button label changes to "Reply"
  - After reply: revert to normal input mode

**Exit:** Planner messages display correctly inline. Input adapts to planner questions.

### Step 5: Enhanced Plan Approval + Reject
**Tag: REFACTOR (PlanApproval.tsx)**

**REFACTOR files:**
- `components/PlanApproval/PlanApproval.tsx` — Currently: modal with task list + approve/dismiss buttons. **Add:**
  - "Reject" button with reason input (text field appears on click, submit calls `rejectPlan(reason)`)
  - Dependency visualization: show "depends on: #N" under each task that has dependencies
  - Summary stats bar in header: "N tasks · M roles · Est: complexity"
  - Task editing: click task title → inline edit. Click × → remove task from plan (local only, doesn't mutate backend yet).
  - Role count pills: show unique roles as colored badges

**Exit:** User can approve, reject with reason, or dismiss. Dependencies visible.

### Step 6: Task Dashboard (Plan View)
**Tag: NEW (TaskDashboard.tsx) + REFACTOR (Header.tsx, ChatArea.tsx)**

**NEW files:**
- `components/TaskDashboard.tsx` — Third view mode in ChatArea (Chat / Tasks / Plan). Shows:
  - Progress summary bar: colored segments (green=completed, blue=in_progress, yellow=ready, gray=pending, red=failed) with percentage
  - Task cards in a vertical list (or simple column layout): each card shows task title, assigned role badge, status chip, dependency arrows (CSS lines or indentation)
  - Click task → navigate to that agent's chat view
  - Filter buttons: All / Ready / In Progress / Completed / Failed
  - Real-time: task status updates animate (color transition)

**REFACTOR files:**
- `components/ChatArea/Header.tsx` — Add "Plan" tab to `viewMode` toggle (3 tabs: Chat / Tasks / Plan)
- `components/ChatArea/ChatArea.tsx` — Add `viewMode === 'plan'` rendering case → `<TaskDashboard />`. Pass `currentPlan`, `tasks`, `sessionPhase`.

**Exit:** Plan tab shows live task DAG with status updates. Clicking task navigates to agent.

### Step 7: Sidebar + Panel Enhancements
**Tag: REFACTOR (Sidebar.tsx, AgentManagerPanel, PanelTabs)**

**NEW files:**
- `components/NotificationPanel.tsx` — Notification list for right panel. Groups by severity. Shows source, timestamp, message. Click navigates to related task.

**REFACTOR files:**
- `components/Sidebar.tsx` — Add per-agent task progress: next to role badge, show `(2/5)` fraction for completed/total tasks. Add session phase dot: small colored circle next to team name (yellow=planning, green=executing, orange=awaiting_approval, gray=idle). Add notification badge: red circle with count when planner has pending questions/urgent notifications.
- `components/AgentManagerPanel/PanelTabs.tsx` — Add "Notifications" tab (third tab). Show badge with unread notification count.
- `components/AgentManagerPanel/AgentManagerPanel.tsx` — Add `notifications` prop. Render `<NotificationPanel>` when notifications tab active.

**Exit:** Sidebar shows live progress. Panel shows notifications. Visual indicators for planner attention needed.

### Step 8: Integration + Remove Legacy Mocks
**Tag: REFACTOR (App.tsx, dummyData/constants.ts)**

**REFACTOR files:**
- `App.tsx` — Wire all new hooks and components together. Ensure prop flow: `useOrchestration` → `pendingQuestion` → `ChatInput`. `useOrchestration` → `notifications` → `AgentManagerPanel`. `useOrchestration` → `currentPlan` + `sessionPhase` → `TaskDashboard`. `useOrchestration` → `respondToQuestion` → `PlannerInteraction`.
- `dummyData/constants.ts` — `INITIAL_AGENTS` → `[]` (empty). Teams come from backend. Keep `AGENT_TEMPLATES` for modal.
- Remove: `handleAssignTask` mock with fake `setTimeout` (dead code now). Remove: `CollabFileTree` inline in App.tsx → extract to `components/CollabFileTree.tsx` (code-only move, no behavior change).

**Exit:** Full flow works: goal → planner asks questions → user answers → plan proposed → approve/reject → tasks execute → tasks complete → planner adapts. Legacy agent chat preserved for sub-agents.

---

## Testing Strategy
**Manual testing (real backend + frontend):**
- Full orchestrator flow: submit goal → planner clarifies → user answers → plan → approve → execute → complete
- Planner question types: `ask_user` (text input), `discuss_approach` (option select), `tell_user` (info banner)
- Plan rejection: reject → planner adapts → new plan → approve
- Task lifecycle: ready → in_progress → completed (real-time updates in sidebar + dashboard)
- Notification flow: task fails → notification appears in panel + toast
- Plan mutations: task added/removed mid-execution → dashboard updates
- Legacy flow: sub-agent direct chat still works (no orchestrator)
- Auto-execute: toggle on → plan auto-approved → tasks auto-start
- Error handling: socket disconnect → reconnect → state restored via `getState()`
- Goal input: idle session shows GoalInput → submit → transitions to planning phase

**Verify no regressions:**
- Existing team creation flow (AgentModal → createTeam API)
- Collaborative editor (tab switch)
- Sidebar collapse/expand
- Agent selection routing (team vs sub-agent)

## Rollback Plan
- Hooks gracefully degrade: if no planner events received, UI behaves like current version (basic plan approval only)
- `INITIAL_AGENTS` change is the only breaking change — revert to original array to restore dummy agents
- All new components are additive (new messageTypes, new view tabs) — existing chat bubbles unchanged

## Complexity
Medium — ~5 days total:
- Step 1 (types + service): ~0.5 day
- Step 2 (extract hooks): ~1.5 days (biggest refactor — App.tsx decomposition)
- Steps 3-4 (planner interaction + message enhancements): ~1 day
- Step 5 (plan approval enhancements): ~0.5 day
- Step 6 (task dashboard): ~0.5 day
- Steps 7-8 (sidebar/panel + integration): ~1 day
