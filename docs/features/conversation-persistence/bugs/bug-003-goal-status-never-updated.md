# Bug: Goal status never updated to completed/failed

**Feature:** `conversation-persistence` (goal lifecycle)

**Symptom:** PlanList always shows goals as "executing" even after all tasks complete. No goal status transitions.

**Root Cause:** `goalService.updateGoal()` is never called anywhere. When OrchestratorService detects all tasks complete (`isAllComplete`), it notifies the planner but doesn't update the goal record.

**Fix Type:** `fix` (permanent) — v2.0 goal lifecycle wiring

**Changes:** Wire `goalService.updateGoal(goalId, { status: "completed" })` into the OrchestratorService all-tasks-complete callback. Same for failure. Requires passing `goalService` reference through AgentManager callbacks.

**Verification:** Run a plan to completion → check goals table shows `status: "completed"` → PlanList shows ✅.
