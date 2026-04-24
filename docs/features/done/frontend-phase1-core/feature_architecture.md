# Frontend Phase 1: Core Loop UI — Feature Architecture

**Status:** New  
**Date:** April 1, 2026  
**Phase:** 1  
**Depends on:** Planner as Agent (A5), Task Orchestration (A6)

---

## Overview

Refactor the frontend from a 1200-line monolithic `App.tsx` into a clean, routable architecture. Build the core user flow: submit goal → see plan → approve → watch execution → see results.

### Current State
- `App.tsx` = 1200+ lines, 50+ `useState` calls, all logic in one file
- No React Router — single page with tab toggle
- No state management — everything in local component state
- PlanApproval modal exists but basic (approve/reject only)
- TaskList exists but read-only, no live progress
- `onProgress()` events received but never displayed
- `onOutput()` events received but not rendered

### Target State
- App.tsx < 300 lines — logic extracted to custom hooks
- React Router: `/teams/:id/chat`, `/teams/:id/tasks`, `/teams/:id/collaborate`
- Dedicated goal submission UI
- Enhanced plan approval with task editing
- Live task dashboard with real-time status
- Error toasts instead of hidden log panel

---

## Architecture: The Refactor

### Before (monolithic)

```
App.tsx (1200 lines)
  ├── 50+ useState
  ├── 15+ useEffect
  ├── 10+ useRef (stale closure workarounds)
  ├── Socket event handlers inline
  ├── HTTP calls inline
  ├── All business logic
  └── Renders: Sidebar + ChatArea + AgentManagerPanel
```

### After (hooks + router)

```
App.tsx (~300 lines)
  ├── React Router <Routes>
  ├── Layout shell (sidebar + main)
  └── Route components

hooks/
  ├── useOrchestration.ts      — plan state, approval, task tracking
  ├── useChat.ts               — chat histories, message send/receive
  ├── useAgentTree.ts          — agent hierarchy, selection, team discovery
  ├── useSocket.ts             — Socket.IO connection lifecycle
  └── useTeam.ts               — team selection, team CRUD

pages/
  ├── TeamChat.tsx             — Chat with agents (current main view)
  ├── TaskDashboard.tsx        — Real-time task execution view
  ├── Collaborate.tsx          — BlockNote CRDT editor
  └── TeamSelect.tsx           — Team list / create team
```

### Custom Hooks

#### `useSocket(teamId)`
```typescript
// Manages Socket.IO connection lifecycle
// Returns: { isConnected, socket }
// Auto-connects when teamId changes, disconnects on unmount
```

#### `useOrchestration(socket)`
```typescript
// Manages plan + task state from backend
// Listens: 'state', 'progress', 'output', 'error'
// Returns: { 
//   plan, tasks, sessionState,
//   approvePlan(), startTask(), completeTask(), cancelTask(),
//   autoExecute, toggleAutoExecute()
// }
```

#### `useChat(socket, agentTree)`
```typescript
// Manages chat histories per agent
// Listens: 'message' events, routes to correct agent
// Returns: {
//   chatHistories, activeAgentId,
//   sendMessage(), setActiveAgent()
// }
```

#### `useAgentTree(teamId)`
```typescript
// Fetches and manages agent hierarchy from backend
// Returns: {
//   agents, activeAgent, 
//   selectAgent(), toggleCollapse()
// }
```

#### `useTeam()`
```typescript
// Team CRUD + selection
// Returns: {
//   teams, selectedTeamId,
//   selectTeam(), createTeam(), deleteTeam()
// }
```

---

## Routing

```typescript
<BrowserRouter>
  <Routes>
    <Route path="/" element={<TeamSelect />} />
    <Route path="/teams/:teamId" element={<TeamLayout />}>
      <Route index element={<Navigate to="chat" />} />
      <Route path="chat" element={<TeamChat />} />
      <Route path="tasks" element={<TaskDashboard />} />
      <Route path="collaborate" element={<Collaborate />} />
    </Route>
  </Routes>
</BrowserRouter>
```

`TeamLayout` renders: Sidebar (left) + `<Outlet>` (center) + optional AgentManagerPanel (right).

---

## New Components

### Goal Input

Replaces "just type in chat" with a dedicated UI for starting goals:

```
┌─────────────────────────────────────────────────────────────┐
│                                                              │
│  🎯 What do you want to build?                              │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Build a marketing campaign for product X              │  │
│  │                                                        │  │
│  │                                                        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  💡 Examples:                                                │
│  • "Build a REST API for user management"                    │
│  • "Research competitors and write a report"                 │
│  • "Create a landing page with copy and design"              │
│                                                              │
│                                     [Submit Goal →]          │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

Shows when no active goal. After submit, switches to chat view where planner starts responding.

### Plan Approval (Enhanced)

Current modal shows tasks as a flat list. Enhance:

```
┌─────────────────────────────────────────────────────────────┐
│  📋 Plan: Marketing Campaign for Product X                   │
│                                                              │
│  Strategy: Research-first with parallel execution            │
│                                                              │
│  ┌────────────────────────────────────────────────────────┐  │
│  │  T-001 Market Research ──────┐                        │  │
│  │  📎 researcher               │                        │  │
│  │                              ├─▶ T-003 Positioning    │  │
│  │  T-002 Competitive Analysis ─┘   📎 strategist        │  │
│  │  📎 researcher                         │              │  │
│  │                                   ┌────┴────┐         │  │
│  │                                   ▼         ▼         │  │
│  │                              T-004 Copy  T-005 Design │  │
│  │                              📎 writer   📎 designer  │  │
│  │                                   └────┬────┘         │  │
│  │                                        ▼              │  │
│  │                                   T-006 Landing       │  │
│  │                                   📎 developer        │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                              │
│  ⚠️ Risk: Medium — Rate limits on design API                │
│  🔀 Critical path: T-001 → T-003 → T-004 → T-006           │
│                                                              │
│  [✕ Reject]  [✏️ Modify]  [✓ Approve]                       │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

- Dependency DAG visualization (not flat list)
- Risk banner from planner's risk assessment
- Critical path highlighted
- Edit tasks before approving (drag to reorder, edit descriptions)

### Task Dashboard

Real-time execution view — the "mission control":

```
┌─────────────────────────────────────────────────────────────┐
│  📊 Execution: Marketing Campaign          ⏱ 12m elapsed   │
│                                                              │
│  ┌──────────────────────────────────────────────────────┐    │
│  │ ■■■■■■■■■□□□□□  4/6 tasks done (67%)                │    │
│  └──────────────────────────────────────────────────────┘    │
│                                                              │
│  ✅ T-001 Market Research          researcher     2m 15s    │
│  ✅ T-002 Competitive Analysis     researcher     3m 42s    │
│  ✅ T-003 Product Positioning      strategist     4m 01s    │
│  🔄 T-004 Copy Writing            writer         ⏳ 2m...   │
│     └─ "Writing section 2 of 3..."                          │
│  ⏳ T-005 Visual Design            designer       waiting    │
│     └─ Blocked by: T-003 ✅                                 │
│  ⏸ T-006 Landing Page             developer      waiting    │
│     └─ Blocked by: T-004, T-005                             │
│                                                              │
│  📝 Latest: "Researcher found 12 competitors"               │
│                                                              │
└─────────────────────────────────────────────────────────────┘
```

- Color-coded status chips (green/blue/yellow/red/gray)
- Progress bar with percentage
- Per-task elapsed time
- Blocked-by indicators with links to upstream tasks
- Live progress messages from workers
- Auto-updates via `progress` and `state` socket events

### Error Toasts

Replace hidden AgentManagerPanel error logs with visible toasts:

```typescript
// Using Mantine's notification system
import { notifications } from '@mantine/notifications';

socket.on('error', (data) => {
  notifications.show({
    title: `Error: ${data.source}`,
    message: data.message,
    color: 'red',
    autoClose: 10000,
  });
});
```

---

## Implementation Checklist

| Component | Status | Effort |
|---|---|---|
| Extract `useSocket` hook | ❌ | 0.5 day |
| Extract `useOrchestration` hook | ❌ | 1 day |
| Extract `useChat` hook | ❌ | 1 day |
| Extract `useAgentTree` hook | ❌ | 0.5 day |
| Extract `useTeam` hook | ❌ | 0.5 day |
| Add React Router + route structure | ❌ | 1 day |
| Slim App.tsx to layout shell | ❌ | 1 day |
| Goal Input component | ❌ | 1 day |
| Plan Approval enhancement (DAG viz) | ❌ | 2 days |
| Task Dashboard component | ❌ | 2-3 days |
| Error toasts (Mantine notifications) | ❌ | 0.5 day |
| Wire `onProgress()` to task dashboard | ❌ | 1 day |

**Total effort:** ~10-12 days frontend work (parallel with backend Phase 1)
