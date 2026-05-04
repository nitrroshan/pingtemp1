# Session Restore Bugs — Comprehensive Fix Plan

**Date:** April 25, 2026  
**Root Cause:** Multiple patches interacting unpredictably  
**Scope:** Frontend session restore + backend state recovery

---

## Bug List

### BUG-A: "Task task-1 not found" on Start Task

**Symptom:** User clicks "Start Task" on a task in the plan sidebar → error "Task task-1 not found".

**Root Cause:** The frontend shows plan tasks from the socket `state` event, but when the user clicks "Start Task", the backend's TaskStore may be empty if:
1. Plan was in `pendingPlan` (not yet approved) → auto-approve already consumed it
2. Backend restarted and `loadActivePlan()` CRDT read failed silently → TaskStore empty
3. Plan was archived/reset between state event and start-task click

**Fix:** In `handleStartTask()`, if task not found in TaskStore AND plan exists on disk, trigger `loadActivePlan()` before failing. Retry once.

**File:** `SocketServerV2.ts` (`handleStartTask`)  
**Lines:** ~10

---

### BUG-B: "Back to Goals" breaks UI state

**Symptom:** Clicking "Back to Goals" then navigating back shows empty plan area, no tasks, no agents.

**Root Cause:** `onBackToGoals` clears `activePlanId` AND `currentPlan` (just added). But `currentPlan` drives `hasAnyPlan`. When the user navigates back, `showGoalScreen` logic kicks in. The socket `get-state` response eventually sets `currentPlan` again, but there's a flash of empty state. If the plan was archived or completed, `get-state` returns nothing → permanent empty state.

**Fix:** `onBackToGoals` should clear `activePlanId` but NOT `currentPlan`. Instead, let `showGoalScreen` only check `activePlanId` and `urlHasPlan` — the `currentPlan` check was added too aggressively.

**File:** `App.tsx`  
**Lines:** ~3

---

### BUG-C: Second browser shows stale plan URL + mixed state

**Symptom:** Second browser has URL with old `plan-1777...` from localStorage. Shows current plan tasks but old plan breadcrumb. Worker streams from wrong plan.

**Root Cause:** `activePlanId` is a frontend-generated string stored in URL and localStorage. It's never synced from server. The restore endpoint returns `plan` and `tasks` but not `activePlanId`. The frontend sets `currentPlan` from restore but keeps the stale `activePlanId` from URL.

**Fix:** Restore endpoint should return a canonical `planId` (from PlanStore metadata). Frontend should update `activePlanId` from server response if it doesn't match. If URL has stale planId, redirect to current plan's URL.

**File:** `HttpServer.ts` (return planId), `App.tsx` (update activePlanId from restore)  
**Lines:** ~10

---

### BUG-D: Messages from different goals mixed in chat

**Symptom:** After running multiple goals on the same team, chat shows messages from all goals mixed.

**Root Cause:** `goalId` was only recently added to message saves. Old messages have no `goalId`. Even with the backfill migration, the restore endpoint's goalId filter only works when `activeGoalId` is set — which requires `loadActivePlan()` to succeed.

**Status:** ✅ Partially fixed (backfill done, filter added). Remains: old messages without goalId pass through the filter (by design, for backward compat).

---

### BUG-E: `showGoalScreen` logic has too many interacting conditions

**Symptom:** GoalScreen sometimes shows when it shouldn't (plan exists but `currentPlan` not set yet), or doesn't show when it should (back to goals with stale `currentPlan`).

**Root Cause:** `showGoalScreen` depends on 3 flags:
```
!!activePlanId || urlHasPlan || (currentPlan && currentPlan.length > 0)
```
These update at different times (URL sync is instant, `currentPlan` comes from socket/HTTP async). Race conditions between HTTP restore and socket `get-state` cause flickers.

**Fix:** Remove `currentPlan` from `showGoalScreen` check. Only use URL-based signals (`activePlanId`, `urlHasPlan`). `currentPlan` drives the plan sidebar, not the GoalScreen gate.

**File:** `App.tsx`  
**Lines:** ~2

---

## Fix Priority

| # | Bug | Severity | Fix Effort |
|---|-----|----------|------------|
| E | showGoalScreen race | HIGH | 2 lines — remove `currentPlan` check |
| B | Back to Goals breaks | HIGH | 3 lines — revert `setCurrentPlan(null)` |
| A | Task not found | HIGH | 10 lines — retry with loadActivePlan |
| C | Stale plan URL on 2nd browser | MEDIUM | 10 lines — return planId from restore |
| D | Mixed goal messages | LOW | Already partially fixed |

## Implementation Order

1. **Fix E** first (removes root cause of multiple symptoms)
2. **Fix B** (revert the `setCurrentPlan(null)` that was added today)
3. **Fix A** (retry with plan reload on task-not-found)
4. **Fix C** (return planId from restore, update URL)
