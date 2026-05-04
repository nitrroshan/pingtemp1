# v1.0 — GoalCoordinator + Shared Types

> **Scope:** Centralize goal switching (Option E) + shared types + dead code cleanup (Option A)
> **Branch:** `feature/comm-refactor-v1.0` (from `dev`)
> **Depends on:** None — first version

## Scope

Two parallel workstreams delivering together:

1. **GoalCoordinator** — single `switchGoal()` function replaces 11 scattered paths
2. **Shared types + cleanup** — `packages/shared/`, dead code removal, error handling

## Implementation Steps

### Track 1: GoalCoordinator (Option E)

- [ ] **Step 1**: Create `packages/frontend/lib/GoalCoordinator.ts`
  - `switchGoal(teamId, goalId, planId)` — 6 operations atomic
  - `switchGoalAndNavigate(teamId, goalId, planId, pushRoute)` — + URL update
  - `restoreTeam(teamId)` — initial team load
  - Calls `unsubscribeFromGoal()` before subscribing to new room

- [ ] **Step 2**: Replace Paths G, H, I, J with coordinator calls
  - Sidebar onSelectPlan (App.tsx ~L723)
  - GoalScreen onSelectPlan (App.tsx ~L852)
  - PlanSwitcher onSelectPlan (App.tsx ~L1065)
  - Sidebar onSelectGoal (App.tsx ~L808)

- [ ] **Step 3**: Replace Path D (team load restore) with `goalCoordinator.restoreTeam()`

- [ ] **Step 4**: Add `unsubscribeFromGoal()` to AgentServiceV2 + backend handler
  - Frontend: emits event, clears `subscribedGoal`
  - Backend: `socket.leave(room)` handler in SocketServerV2

- [ ] **Step 5**: Remove side-effect `useEffect`s (activeGoalId → orchStore sync, activeGoalId → subscribeToGoal)

### Track 2: Shared Types + Cleanup (Option A)

- [ ] **Step 6**: Create `packages/shared/` package
  - `events.ts` — `ServerToClientEvents`, `ClientToServerEvents`
  - `messages.ts` — `Message`, `StreamPayload`, `ChatMessage`
  - `tasks.ts` — `Task`, `TaskStatus`, `PlanSummary`, `GoalSession`
  - `errors.ts` — `ErrorResponse`, `ApiError`

- [ ] **Step 7**: Remove dead code
  - `{ response }` unwrapping in useOrchestration
  - Empty `WORKER_EVENT_ROUTES` entries
  - `worker:stream` references in comments

- [ ] **Step 8**: Global HTTP error handler in `authFetch()`
  - 401 → redirect to login
  - 5xx → single retry with 500ms delay
  - Replace silent `catch {}` → `console.error` + toast

- [ ] **Step 9**: Fix silent error swallowing (10+ locations)

## Files Changed

| File | Change | New? |
|------|--------|------|
| `frontend/lib/GoalCoordinator.ts` | Coordinator class | **New** |
| `packages/shared/` (4 files) | Type definitions | **New package** |
| `frontend/App.tsx` | Replace 6 switching paths, remove side effects | Modify |
| `frontend/services/AgentServiceV2.ts` | `unsubscribeFromGoal()`, authFetch, shared types | Modify |
| `frontend/stores/chatStore.ts` | Error logging | Modify |
| `backend/api/SocketServerV2.ts` | `unsubscribeFromGoal` handler, shared types | Modify |

## Testing

1. New goal → chat + tasks load
2. Switch plans → old clears, new loads
3. Refresh mid-task → restores
4. Close browser, reopen → persisted
5. 401 expired session → redirects to login
6. Backend 500 → retries once, then shows toast

## Rollback

Revert GoalCoordinator + restore inline logic. Frontend-only — no data changes.
