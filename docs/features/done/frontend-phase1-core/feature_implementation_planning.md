# Frontend Phase 1: Core Loop UI — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 1 (Core Loop)

---

## Branch
- `feature/frontend-phase1-core`

## Scope
Refactor App.tsx from 1200-line monolith to hooks + router architecture. Build core user flow: submit goal → see plan → approve → watch execution → see results.

## Implementation Steps

### Step 1: Create Custom Hooks
**Files to create:**
- `packages/frontend/hooks/useSocket.ts` — Socket.IO connection lifecycle. Auto-connect on teamId change, disconnect on unmount. Returns `{ isConnected, socket }`.
- `packages/frontend/hooks/useOrchestration.ts` — Plan + task state from backend. Listens to `state`, `progress`, `output`, `error`. Returns plan, tasks, sessionState, approval actions.
- `packages/frontend/hooks/useChat.ts` — Chat histories per agent. Routes `message` events to correct agent. Returns chatHistories, sendMessage, setActiveAgent.
- `packages/frontend/hooks/useAgentTree.ts` — Agent hierarchy from backend. Returns agents, activeAgent, selectAgent, toggleCollapse.
- `packages/frontend/hooks/useTeam.ts` — Team CRUD + selection. Returns teams, selectedTeamId, selectTeam, createTeam.

**Exit criteria:** All hooks work in isolation, manage state correctly with cleanup

### Step 2: Set Up React Router
**Files to modify:**
- `packages/frontend/App.tsx` — Add BrowserRouter with routes:
  - `/` → TeamSelect
  - `/teams/:teamId` → TeamLayout (sidebar + outlet)
  - `/teams/:teamId/chat` → TeamChat
  - `/teams/:teamId/tasks` → TaskDashboard
  - `/teams/:teamId/collaborate` → Collaborate

**Exit criteria:** Navigation works between pages, URL reflects current view

### Step 3: Refactor App.tsx
**Files to modify:**
- `packages/frontend/App.tsx` — Remove all inline state/effects/handlers. Import hooks. Render Routes + Layout shell only. Target: <300 lines.

**Exit criteria:** App.tsx under 400 lines, all logic in hooks

### Step 4: Build Goal Input Component
**Files to create:**
- `packages/frontend/components/GoalInput.tsx` — Shown when no active goal. Large textarea + submit button. Example prompts. Submit triggers orchestrator flow.

**Exit criteria:** Goal submission starts planning

### Step 5: Enhance Plan Approval
**Files to modify:**
- `packages/frontend/components/PlanApproval.tsx` — Enhance with: task dependency visualization (DAG diagram), edit/reorder tasks, risk banner, critical path display, approve/modify/reject buttons.

**Exit criteria:** User can visualize and approve DAG-based plans

### Step 6: Build Task Dashboard
**Files to create:**
- `packages/frontend/components/TaskDashboard.tsx` — Real-time task status: colored chips per status, assigned role, progress %, timing info. Live updates via Socket.IO.

**Exit criteria:** Tasks update in real-time, status clearly visible

### Step 7: Add Error Toasts
**Files to modify:**
- `packages/frontend/App.tsx` — Add toast notification provider. Wire `onError()` events to toasts instead of hidden panel.

**Exit criteria:** Errors show as toasts with context

## Testing Strategy
- Navigate full flow: login → team → goal → plan → approve → tasks → complete
- Verify hooks cleanup on unmount (no memory leaks)
- Legacy agent chat still works

## Complexity
Medium — 10-12 days.
