# Task 002: WorkerPool Parallel Dispatch

**Status:** `not-started`
**Assignee:**
**Estimated:** 2-3 days
**Branch:** `feature/planner-as-agent`

## Description
Modify WorkerPool to dispatch ready tasks in parallel with configurable **dispatch modes**. Not all teams want auto-dispatch — internal agents and user-controlled external agents should only run tasks the user explicitly starts.

## Dispatch Modes

Three modes based on agent type:

| Mode | Who | Default Behavior | When tasks dispatch |
|---|---|---|---|
| **`auto`** | External agents (Ping Team) | Tasks auto-flow when approved + ready | Orchestrator dispatches immediately — no user action needed |
| **`user-started`** | External agents (user-controlled) | User picks which ready tasks to start | Task stays `ready` until user clicks "Start" → then dispatches |
| **`user-started`** | Internal agents | User picks which ready tasks to start | Same — user must explicitly start each task |

**Configurable per team:**
```typescript
interface TeamDispatchConfig {
  mode: 'auto' | 'user-started';    // default depends on agent type
  maxConcurrentWorkers: number;      // default: 5 per team
  maxWorkersPerRole: number;         // default: 2
}
```

**Why this split:**
- **Ping Team (external, auto):** Agents run remotely, managed by the platform. Let the orchestrator drive — it's the whole point of automation. User approved the plan, that's enough.
- **User-controlled external agents:** User has external agents but wants to manually control execution pace. Maybe budget-conscious, or reviewing output between tasks.
- **Internal agents:** Running on user's machine/resources. Default to user-started — user controls when their compute is used.

### `auto` mode flow
```
Plan approved → ready tasks auto-dispatch → completion triggers downstream → repeat
User just watches (can still pause/cancel)
```

### `user-started` mode flow
```
Plan approved → ready tasks shown to user as "Ready to start"
User clicks "Start T-003" → dispatches T-003
T-003 completes → T-004, T-005 become ready → shown to user
User clicks "Start T-004" → dispatches T-004
(User can start multiple at once for parallel execution)
```

## Acceptance Criteria
- [ ] `TeamDispatchConfig.mode` controls dispatch behavior (`auto` | `user-started`)
- [ ] `auto` mode: dispatch all ready tasks immediately (current plan behavior)
- [ ] `user-started` mode: ready tasks wait for explicit user action via Socket.IO `task:start` event
- [ ] User can start multiple ready tasks at once (parallel dispatch in both modes)
- [ ] `maxConcurrentWorkers` config (default: 5 per team)
- [ ] `maxWorkersPerRole` config (default: 2 — prevent one role hogging)
- [ ] Priority ordering via existing `RoleTaskQueue.poll()` — already priority-sorted per role
- [ ] Add `pollN(role, n)` method to `RoleTaskQueue` — pops up to N tasks from a role's queue (parallel dispatch)
- [ ] On planner `reprioritize`: `RoleTaskQueue.updatePriority()` re-heapifies automatically, UI updated via `plan:task_reprioritized` event
- [ ] **Only planner can reprioritize tasks** — user can only start ready tasks, not reorder them
- [ ] No preemption: in-progress tasks are NOT interrupted for higher-priority work (documented design decision)
- [ ] On task completion → `DependencyResolver.resolveReady()` → in `auto` mode: dispatch; in `user-started` mode: emit `task:status_changed` (pending→ready) so UI updates task card with "Start" button — NOT an approval gate, just dispatch control
- [ ] Default mode: `auto` for Ping Team external agents, `user-started` for all others
- [ ] Mode switchable at runtime via API (user can toggle during execution)

## Implementation Notes
- File: modify `packages/backend/services/WorkerPool.ts`
- Add `dispatchMode` check in the dispatch loop:
  ```typescript
  // Ready tasks flow into RoleTaskQueue (already priority-sorted per role)
  const readyTasks = depResolver.resolveReady(tasks);
  readyTasks.forEach(t => roleTaskQueue.queueTask(t));

  if (config.mode === 'auto') {
    // Pop up to maxWorkersPerRole from each role, dispatch in parallel
    for (const role of roleTaskQueue.getRoles()) {
      const available = config.maxWorkersPerRole - activeForRole(role);
      if (available > 0) {
        const batch = roleTaskQueue.pollN(role, available);
        batch.forEach(t => this.dispatch(t));  // parallel, fire-and-forget
      }
    }
  } else {
    // Emit to frontend: "These tasks are ready — start when you want"
    transport.send(teamId, { type: 'tasks_ready', tasks: readyTasks.map(summarize) });
    // Dispatch happens when user sends `task:start` event
  }
  ```
- Socket.IO events:
  - Server → Client: `tasks:ready` (list of ready tasks user can start)
  - Client → Server: `task:start` (user picks task to dispatch)
  - Client → Server: `task:start-all` (user starts all ready tasks at once)
  - Client → Server: `dispatch:toggle-mode` (switch auto ↔ user-started)
- **Keep `RoleTaskQueue`** — refactor, don't replace. Already has per-role priority queues, `poll()`, `updatePriority()`, events, metrics. Add:
  - `pollN(role, n)` — pop up to N tasks from a role's queue for parallel dispatch
  - `pollAllReady(maxPerRole)` — convenience: iterate all roles, pop up to N each, return flat array
  - Remove `EventEmitter` events from RoleTaskQueue (move to emittery in WorkerPool — A5 Step 7)
- **Why not a single queue?** Per-role queues give natural `maxWorkersPerRole` enforcement. A single queue needs a separate `roleCount` map for the same result. Cross-role priority comparison ("should I run a critical researcher task before a low writer task?") rarely matters — we usually have enough slots for all ready tasks.
- Uses A5's DependencyResolver (Task 004) for `resolveReady()` to determine which tasks are ready
- `DependencyResolver.resolveReady()` returns ready tasks → `RoleTaskQueue.queueTask()` adds them → WorkerPool calls `pollN()` per role

## Dependencies
- A6 Task 001 (TaskStore)
- A5 Task 004 (DependencyResolver)
- A5 Task 007 (NotificationTransport — for `tasks:ready` events)

## Testing
- Unit: auto dispatch, user-started gating, mode toggle, concurrency limits, priority ordering
- Unit: `task:start` event dispatches single task, `task:start-all` dispatches all ready
- Unit: planner `reprioritize` → `PriorityQueue.updatePriority()` → next `pop()` returns correct task
- Integration: task completion → downstream ready → `auto` dispatches vs `user-started` notifies
- Integration: mode toggle mid-execution (switch from user-started to auto, pending ready tasks auto-dispatch)
