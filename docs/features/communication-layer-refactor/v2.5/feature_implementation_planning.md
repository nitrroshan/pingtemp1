# v2.5 — Goal-Centric Frontend

> **Scope:** Eliminate frontend `planId`, use server `goalId` in routes/state, and replay goal state after identity is established.  
> **Status:** Complete.  
> **Depends on:** v2.0 GoalSessionStore and backend explicit `goalId` support.  
> **Blocks:** v3.0 persistence, which needs stable goal identity.

## Problem

The frontend previously generated `planId` for URLs while the backend generated `goalId` for actual orchestration. Reloads and goal switching could not reliably map one to the other, so a second goal could show `0/0` tasks or restore the wrong goal.

A second race remains: planner state can be broadcast before the submitting client has set `activeGoalId`. `goalSessionStore.handleStateEvent()` correctly ignores state for non-active goals, so any state received before `newGoal()` can be dropped.

## Design

`goalId` is the only identity. Routes use `/teams/{teamId}/g/{goalId}`. `goalSessionStore` owns `activeGoalId` only. SocketServer generates `goalId`, joins the goal room, then starts planner work.

Do not wait for planner completion in a Socket.IO ack. `OrchestratorService.handleMessage()` schedules `executePlannerTurn()` asynchronously and returns immediately, so an ack containing `{ goalId, state }` would usually contain stale or empty state.

Instead, establish identity first and replay state:

1. Server emits or immediately acknowledges `{ goalId }` after joining the goal room.
2. Frontend calls `newGoal(teamId, goalId, goalText)`.
3. Frontend navigates to `/g/{goalId}`.
4. Frontend calls `agentServiceV2.getState(goalId)` to fetch any state dropped before `activeGoalId` was set.

## Implementation Steps

- [x] Parse `/teams/{teamId}/g/{goalId}` and route all goal navigation through `goalId`.
- [x] Delete `makePlanId()` / `lib/planId.ts` and remove frontend `planId` generation.
- [x] Remove `activePlanId` from `goalSessionStore`; simplify `switchGoal`, `newGoal`, and `restoreTeam` to use `goalId`.
- [x] Rename component props and selection callbacks to `activeGoalId` / `onSelectGoal`.
- [x] Keep GoalScreen visible with submit loading until server `goalId` is received.
- [x] In `SocketServerV2`, generate `resolvedGoalId`, leave the previous goal room, join `team:{teamId}:goal:{goalId}`, then call `orchestratorMessage()`.
- [x] Update `AgentServiceV2.getState(goalId?: string)` to emit `get-state` with `{ goalId }`.
- [x] After `newGoal(...)` in `App.tsx`, call `agentServiceV2.getState(goalId)` for both goal submit paths.
- [x] Explicitly handle old `/p/*` URLs by redirecting to `/teams/{teamId}`.
- [x] Remove stale `planId` comments and unused shared `planId` types.
- [x] Fix `getOrchestratorPendingPlan(goalId?)` — pass goalId through to GoalManager.
- [x] Fix planner context closure to close over goalId for `getPendingPlan`.

## Files

- `packages/frontend/App.tsx`
- `packages/frontend/stores/goalSessionStore.ts`
- `packages/frontend/services/AgentServiceV2.ts`
- `packages/frontend/components/GoalScreen/GoalScreen.tsx`
- `packages/frontend/components/GoalScreen/PlanList.tsx`
- `packages/frontend/components/PlanSwitcher.tsx`
- `packages/frontend/components/PlanViewer/PlanViewerPage.tsx`
- `packages/frontend/components/Sidebar.tsx`
- `packages/frontend/components/DetailPanel/DetailPanel.tsx`
- `packages/backend/api/SocketServerV2.ts`
- `packages/agent-manager/src/AgentManagerV2.ts`

## Verification

1. Submit Goal A, confirm route changes to `/g/{goalId}` and tasks appear without refresh.
2. Submit Goal B, confirm tasks and chat are isolated from Goal A.
3. Reload `/teams/{teamId}/g/{goalId}` and confirm the correct goal restores.
4. Switch goals from sidebar and PlanViewer, confirm task counts follow the selected goal.
5. Submit while planner is slow, confirm GoalScreen loading prevents duplicate submit.
6. Open old `/p/{planId}`, confirm it does not attempt planId resolution.

## Rollback

Git revert. No backwards-compatible `planId` mapping is maintained.
