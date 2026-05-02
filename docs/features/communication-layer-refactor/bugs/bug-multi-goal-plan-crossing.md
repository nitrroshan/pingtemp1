# Bug: Second Goal's Plan Lands on First Goal

**Feature:** `goal-isolation` (see `docs/features/goal-isolation/`)
**Fix Type:** fix (permanent)
**Status:** Resolved

## Symptom

Submitting Goal B while Goal A is executing caused Goal B's tasks to appear under Goal A. Goal B showed 0/0 tasks and became unresponsive.

## Root Cause

`OrchestratorService` had a single `activeGoalId` that was never switched. `setPendingPlan`, `approvePlan`, and `getPendingPlan` all used this implicit state instead of the incoming `goalId`. The `ActionPayloadSchema` also lacked a `goalId` field, preventing the frontend from specifying which goal to approve.

## Fix (Goal Isolation — Phase 1+2)

- `OrchestratorService._handleMessage` switches to incoming goalId before state read/write
- `GoalManager`: `setPendingPlan(goalId, plan)`, `approvePlan(goalId)`, `getPendingPlan(goalId)` — explicit params
- `ActionPayloadSchema` includes `goalId`; frontend sends `activeGoalId` with approve action
- `onPlanUpdate` and `onGoalStatusChange` callbacks carry `goalId` from source
- Task IDs prefixed with goal slug to prevent collision
- All planner context closures (`getState`, `setState`, `getPendingPlan`) scoped by goalId

## Verification

Submit two goals concurrently. Each goal's tasks appear under the correct sidebar entry. Approving Goal B does not affect Goal A.
