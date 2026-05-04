# Goal-Scoped Sessions — Implementation Plan

> Architecture: [feature_architecture.md](./feature_architecture.md) — **Option A (Goal-Room Routing)** chosen.

## Branch
`user/nitrroshan/fixplans` (merged into existing branch)

## Status
Backend complete (Steps 1-7). Frontend pending (Steps 8-9).
See also: [workspace-push-issues.md](../github-connect/workspace-push-issues.md) — Phase D references these steps.

---

## Implementation Steps

### Step 1: Backend — Add goal-room routing helper ✅ DONE

**File:** `packages/backend/api/SocketServerV2.ts`

- [x] `goalRoom()` helper exists (line 437-438)

---

### Step 2: Backend — Route `onStream` to goal room ✅ DONE

- [x] 7+ broadcasts routed to goal rooms using `goalRoom()` helper

### Step 3: Backend — Route `onDone`, `onError` to goal room ✅ DONE

- [x] Done — events emit to `team:{id}:goal:{goalId}` room

### Step 4: Backend — Route `onTaskUpdate` to goal room ✅ DONE

- [x] Task state/stream events emit to goal room

### Step 5: Backend — Route `onWorkerTaskUpdate`, `progress` to goal room ✅ DONE

- [x] Worker progress and task updates goal-scoped

---

### Step 6: Backend — Keep team-room events for team-wide data

These stay on the team room (no change needed):
- `onPlanUpdate` (line 614) — affects sidebar plan list (all goals)
- `goal:stateChange` (line 682) — updates plan list (all goals)
- `discussion:activity` (line 747) — cross-goal discussions
- `discussion:mention` (line 758) — cross-goal mentions

**Exit criteria:** Plan list and goal summaries still broadcast to all team clients

---

### Step 7: Frontend — Subscribe to goal room on plan switch

### Step 6: Backend — Keep team-room for team-wide data ✅ DONE

- [x] `onPlanUpdate`, `goal:stateChange`, `discussion:*` stay on team room

---

### Step 7: Frontend — Subscribe to goal room on plan switch ✅ DONE

- [x] `subscribeToGoal` handler exists with room cleanup (leave previous, join new)

---

### Step 8: Frontend — Remove `activePlanGoalIdRef` stream filter ❌ PENDING

**File:** `packages/frontend/App.tsx`, lines ~364-369

- [ ] Remove the client-side goal filter (rooms handle it now):
```ts
// DELETE these lines — goal room already isolates events:
const isPlanner = streamAgentId === 'manager' || ...;
if (!isPlanner && streamGoalId && activePlanGoalIdRef.current
    && streamGoalId !== activePlanGoalIdRef.current) {
  return;
}
```
- [ ] Can also remove `activePlanGoalIdRef` entirely (the ref was only for this filter)

**Exit criteria:** No client-side goal filtering. Room membership does the isolation.

---

### Step 9: Frontend — Per-goal session state ❌ PENDING

**File:** `packages/frontend/stores/orchestrationStore.ts`

- [ ] Change `sessionState: string | null` → derived from active goal:
```ts
interface OrchestrationState {
  goalStates: Record<string, { sessionState: string | null; tasks: Task[] }>;
  activeGoalId: string | null;
  // ...
}

// Selectors:
getSessionState: () => get().goalStates[get().activeGoalId ?? '']?.sessionState ?? null,
getActiveTasks: () => get().goalStates[get().activeGoalId ?? '']?.tasks ?? [],
```
- [ ] Update `handleStateEvent` to write into `goalStates[goalId]` instead of flat `tasks`/`sessionState`
- [ ] Update `setActiveGoalId` when plan switches
- [ ] Update App.tsx: `useOrchestrationStore(s => s.getSessionState())` instead of `s.sessionState`

**Exit criteria:** Each goal has independent session state. Switching plans shows the right state.

---

### Step 10: Build + Test

- [ ] `bun run build:backend` — verify backend compiles
- [ ] Manual test matrix:

| Test | Expected |
|------|----------|
| Submit Goal A → plan streams | Only tab viewing Goal A sees the stream |
| Submit Goal B in another tab | Goal B streams independently, Goal A unaffected |
| Switch from Goal A to Goal B | See Goal B's state, not Goal A's |
| Switch back to Goal A | Goal A's tasks + state preserved |
| Both goals executing, view Goal A | Only Goal A's worker streams show |
| Refresh page | Restore shows correct goal's state |

---

## Files Modified

| File | Changes | Lines |
|------|---------|-------|
| `packages/backend/api/SocketServerV2.ts` | Add `goalRoomOrTeam()`, route 10 broadcasts to goal room | ~40 |
| `packages/frontend/App.tsx` | Remove client-side goal filter (~8 lines) | -8 |
| `packages/frontend/stores/orchestrationStore.ts` | Per-goal `goalStates`, selectors | ~35 |
| `packages/frontend/App.tsx` | Update `sessionState` references to use selector | ~15 |
| **Total** | | **~90 lines changed** |

## Rollback Plan
- Revert `goalRoomOrTeam()` calls to `room` — all events go back to team room
- Frontend goal filter can be re-added as backup
- Feature branch isolates all changes

## Estimated Effort

| Step | Complexity | Lines |
|------|-----------|-------|
| 1-6 Backend routing | Easy | ~40 |
| 7-8 Frontend room mgmt | Trivial | ~10 |
| 9 Per-goal state | Medium | ~35 |
| 10 Testing | Manual | — |
| **Total** | | **~85 lines** |
