# Goal-Scoped Sessions — Implementation Plan

> Architecture: [feature_architecture.md](./feature_architecture.md) — **Option A (Goal-Room Routing)** chosen.

## Branch
`feature/goal-scoped-sessions`

## Scope
Route Socket.IO events to goal rooms instead of team rooms. Per-goal session state. ~95 lines of changes.

---

## Implementation Steps

### Step 1: Backend — Add goal-room routing helper

**File:** `packages/backend/api/SocketServerV2.ts`

- [ ] Add helper method to resolve the emit target:
```ts
private goalRoomOrTeam(room: string, teamId: string, goalId?: string | null): string {
  return goalId ? `team:${teamId}:goal:${goalId}` : room;
}
```
- [ ] This is called from every callback that should be goal-scoped.

**Entry criteria:** Architecture doc approved
**Exit criteria:** Helper method exists, compiles

---

### Step 2: Backend — Route `onStream` to goal room

**File:** `packages/backend/api/SocketServerV2.ts`, line 516

- [ ] Change `this.io.to(room).emit("stream", payload)` to use `streamGoalId`:
```ts
const target = this.goalRoomOrTeam(room, teamId, streamGoalId);
this.io.to(target).emit("stream", payload);
```
- [ ] Also route the `onEvent` stream emission (line 548) — resolve goalId from `manager.getTaskStore().get(taskId)?.goalId`

**Exit criteria:** Stream events only go to goal room subscribers. Other goals' clients don't receive them.

---

### Step 3: Backend — Route `onDone`, `onError` to goal room

**File:** `packages/backend/api/SocketServerV2.ts`, lines 558, 568

- [ ] `onDone`: resolve goalId from `manager.getTaskStore().get(taskId)?.goalId`
```ts
const task = manager.getTaskStore()?.get(taskId);
const target = this.goalRoomOrTeam(room, teamId, task?.goalId);
this.io.to(target).emit("stream", { ... });
```
- [ ] `onError`: same pattern

**Exit criteria:** Finish/error events scoped to goal room

---

### Step 4: Backend — Route `onTaskUpdate` to goal room

**File:** `packages/backend/api/SocketServerV2.ts`, line 577

- [ ] Resolve goalId from task:
```ts
const task = manager.getTaskStore()?.get(taskId);
const target = this.goalRoomOrTeam(room, teamId, task?.goalId);
```
- [ ] Route `state` broadcast to goal room (line 577)
- [ ] Route `stream` task-started/completed/failed to goal room (lines 590, 599, 608)

**Exit criteria:** Task status updates only go to the goal's subscribers

---

### Step 5: Backend — Route `onWorkerTaskUpdate`, `progress` to goal room

**File:** `packages/backend/api/SocketServerV2.ts`, lines 527, 662

- [ ] `progress` (line 527): resolve goalId from taskId
- [ ] `onWorkerTaskUpdate` (line 662): use `update.goalId` or resolve from taskId

**Exit criteria:** Worker progress and task updates goal-scoped

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

**File:** `packages/frontend/App.tsx`

- [ ] The `subscribeToGoal` call already exists (line ~222):
```ts
useEffect(() => {
  if (selectedTeamId && activePlanGoalId) {
    agentServiceV2.subscribeToGoal(selectedTeamId, activePlanGoalId);
  }
}, [selectedTeamId, activePlanGoalId]);
```
- [ ] Verify the backend `subscribeToGoal` handler leaves the previous room (line 392-400):
```ts
socket.on("subscribeToGoal", ({ teamId, goalId }) => {
  const prevGoalRoom = socket.data.currentGoalRoom;
  if (prevGoalRoom) socket.leave(prevGoalRoom);  // ← already exists
  const goalRoom = `team:${teamId}:goal:${goalId}`;
  socket.join(goalRoom);
  socket.data.currentGoalRoom = goalRoom;
});
```
- [ ] This already works. No change needed.

**Exit criteria:** Switching plans subscribes to the new goal's room, leaves the old one

---

### Step 8: Frontend — Remove `activePlanGoalIdRef` stream filter

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

### Step 9: Frontend — Per-goal session state

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
