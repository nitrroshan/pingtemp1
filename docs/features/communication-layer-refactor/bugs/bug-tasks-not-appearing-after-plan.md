# Bug: Tasks not appearing after goal submission

**Feature:** `communication-layer-refactor/v2.5` goalId migration.

**Symptom:** After submitting a goal, planner output appears in chat but the sidebar PLAN section can remain `0/0` tasks until refresh or goal switch.

**Root Cause:** Goal-scoped state can arrive before the submitting client has set `activeGoalId`. `goalSessionStore.handleStateEvent()` correctly ignores plan/task updates whose `goalId` does not match the active goal, so early state is dropped. `orchestratorMessage()` does not block until planner completion; it schedules `executePlannerTurn()` asynchronously, so an acknowledgement containing final `{ goalId, state }` would usually be stale.

**Fix Type:** `fix` (permanent).

**Changes:** Keep server-side goal ID generation and room auto-join before planner start. After `App.tsx` calls `newGoal(teamId, goalId, goalText)`, call `AgentServiceV2.getState(goalId)`. Update `AgentServiceV2.getState(goalId?)` to emit `get-state` with `{ goalId }` so `SocketServerV2.handleGetState()` returns goal-scoped tasks.

**Verification:** Submit a goal with slow planner/auto-approve, confirm tasks appear without refresh; reload `/teams/{teamId}/g/{goalId}` and confirm the same tasks restore.
