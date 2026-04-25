# Bug: addGoal() missing sessionId — goal never saved

**Feature:** `conversation-persistence` (v1.1 onPlanUpdate wiring)

**Symptom:** Cross-browser restore shows GoalScreen instead of active plan. Goals table is always empty. SQLite logs `NOT NULL constraint failed: goals.sessionId` error (silently caught).

**Root Cause:** `SocketServerV2.onPlanUpdate` calls `addGoal()` without `sessionId` (required by `Goal` type + SQLite schema). Also passes `status: "active"` (not in enum) and `taskCount` (not a Goal field).

**Fix Type:** `fix` (permanent) — part of v2.0 session identity feature

**Changes:** Fix `addGoal()` call to include `sessionId: "default"` (short-term), replace with real auth session ID (long-term). Correct status to `"executing"`. Remove `taskCount`.

**Verification:** Approve plan → check SQLite `goals` table has entry → second browser restore returns goal → PlanList shows it.
