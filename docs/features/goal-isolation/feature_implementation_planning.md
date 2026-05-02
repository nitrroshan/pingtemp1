## Goal Isolation — Implementation Plan

## Branch
`feature/goal-isolation`

## Scope
Phase 1: Fix 18 contamination violations. Phase 2: Remove 11 serialization barriers. Result: goals run in parallel without interfering.

---

## Phase 1: Fix Contamination

- [x] **Step 1: ITaskProvider.getByGoal()** (V30)
  - `packages/agent-manager/src/orchestrator/ITaskProvider.ts` — add `getByGoal(goalId): Task[]`

- [x] **Step 2: NotificationQueue + notifyPlanner** (V2, V7, V10, V31)
  - `NotificationQueue.ts` — `push(goalId, message)`, partition pending by goalId, flush per-goal
  - `OrchestratorService.ts:626` — `notifyPlanner(goalId, message)` 
  - `GoalManager.ts:562+` — `onNotifyPlanner(goalId, message)`, pass `task.goalId`
  - `AgentManagerV2.ts:249` — `onFlush(goalId, batch)` → `executePlannerTurn(goalId, batch)`

- [x] **Step 3: GoalManager lifecycle** (V5, V6)
  - `GoalManager.ts:548,729` — remove `activeGoalId` fallback in `onTaskComplete`/`onTaskFailed`, use `task.goalId`

- [x] **Step 4: Planner context closures** (V11, V12, V29)
  - `AgentManagerV2.ts:283-287` — `getPendingPlan(goalId)`, `getState(goalId)`, `setState(goalId)` → goal-scoped
  - `GoalManager.ts` — `getGoalState(goalId)`, `setGoalState(goalId, state)` added
  - `OrchestratorService.ts` — `_handleMessage` switches goal before state read/write

- [x] **Step 5: get_status** (V15)
  - `getStatus.ts:22` — `taskProvider.getByGoal(currentGoalId)`

- [x] **Step 6: get_blocked + DependencyResolver** (V17, V22)
  - `DependencyResolver.ts:28` — add `rebuildForGoal(source, goalId)`
  - `executionTools.ts:77` — rebuild per goal before query

- [x] **Step 7: dispatchReadyTasks** (V3, V4)
  - `OrchestratorService.ts:461` — filter by executing goal's tasks only

- [x] **Step 8: WorkerPool currentGoalId** (V14, V25, V26, V27)
  - `WorkerPool.ts:86,143,288,307` — read goalId per-task from TaskStore

- [x] **Step 9: submitResearch goalId** (V19)
  - `submitResearch.ts:80` — add `goalId: octx.currentGoalId`

- [x] **Step 10: Shared messages array** (V1)
  - `OrchestratorService.ts:113` — removed shared `messages[]`

---

## Phase 2: Enable Parallelism

- [x] **Step 11: Remove execution mutex** (GoalManager:411)
  - All goals execute immediately on approval — no queuing. DAG rebuild scoped per goal. `autoAdvanceToNextGoal()` removed.

- [x] **Step 12: Per-goal dispatch** (V23, V24)
  - `DispatchManager.ts` — per-goal tracking via `goalDispatches` Map for ALL paths: `dispatch`, `directDispatch`, `manualDispatch`, `handleError` retry. Deferred drain respects per-goal caps.

- [x] **Step 13: handleTaskFailure scope** (V8)
  - `GoalManager.ts:623` — `getByGoal(task.goalId)` instead of `getAll()`

- [x] **Step 14: getChatAgentByRole scope** (V9)
  - `GoalManager.ts:269` — requires goalId, removed all-goals fallback search

- [x] **Step 15: chatAgentMessage scope** (V13)
  - `AgentManagerV2.ts:462` — goalId required, throws if not provided

- [x] **Step 16: get_context scope** (V16)
  - `getContext.ts` — filter manifests by `context.currentGoalId`

- [x] **Step 17: get_critical_path scope** (V18)
  - `executionTools.ts:99` — `rebuildForGoal` before query

- [x] **Step 18: cancel_task ownership** (V20)
  - `executionTools.ts:59` — verify `task.goalId === currentGoalId`

- [x] **Step 18b: planMutationTools scope** (V8 extension)
  - `planMutationTools.ts` — `getAllTasks()` → goal-scoped in `add_tasks`, `remove_task`, `replan`

- [x] **Step 18c: Task ID collision across goals** (V32 — implemented via goal-prefix)
  - **Implementation:** All task creation paths prefix IDs with `goalId.slice(0,8)`: `approvePlan` (GoalManager), `submitResearch`, `normalizeAndAddTasks` (planMutationTools), `request_task` (worker lifecycle tool).
  - **DAG rebuilds** in planMutationTools use `rebuildForGoal` when goalId available.
  - **Worker task counts** scoped by `getByGoal()` in `request_task`.
  - **Long-term hardening (optional):** UUID task IDs with `plannerTaskId` alias for cleaner separation.

- [x] **Step 19: RoleTaskQueue** (V28)
  - `RoleTaskQueue.ts:31` — queue key `${goalId}:${role}`. `TaskStore.queueTask()` now copies `goalId` to `TaskWithContext`.
  - `poll(role)` / `peek(role)` marked `@deprecated` — use DispatchManager for goal-aware dispatch.

- [x] **Step 20: Socket.IO broadcasts** (done)
  - Room broadcasts (stream/progress/error/onTaskUpdate) — ✅ all use `goalRoom(goalId)`
  - `handleCompleteTask` state emit — ✅ prefers `task?.goalId` before `getCurrentGoalId()`
  - `handleCancelTask` state emit — ✅ prefers `cancelTask?.goalId` before `getCurrentGoalId()`
  - `handleGetState` pending plan — ✅ passes `goalId` through
  - `handleChatAgentMessage` — ✅ `resolvedGoalId` declared before `try`, all emits use it
  - `onGoalStatusChange` callback — ✅ carries `goalId` from GoalManager, SocketServerV2 updates by exact ID

---

## Remaining Issues (from thorough review)

### Critical — FIXED
- [x] `GoalManager.ts:625` — `handleTaskFailure`: fallback changed from `getAll()` to `[]` when no goalId
- [x] `GoalManager.ts:697` — `onTaskFailed` CRDT `updateIndex`: same fix
- [x] `onGoalStatusChange` callback: `goalId` added to payload type (`OrchestratorCallbacks`, `GoalManagerCallbacks`, `ManagerStreamCallbacks`). GoalManager passes `goalId` at invocation. SocketServerV2 updates DB by exact goalId instead of querying for first executing goal.

### Medium — FIXED
- [x] `GoalManager.ts:795` — `onWorkerDone` plugin: reads goalId from `taskStore.get(taskId)?.goalId` first, then `activeGoalId`
- [x] `GoalManager.ts:829` — `onWorkerDone` CRDT `updateIndex`: fallback changed to `[]`
- [x] `GoalManager.ts:272` — `ingestTaskUpdateToChatAgent`: resolves goalId from task, passes to `getChatAgentByRole`
- [x] `SocketServerV2.ts:handleCompleteTask` — state emit uses `task?.goalId` before `getCurrentGoalId()`
- [x] `SocketServerV2.ts:handleCancelTask` — state emit uses `cancelTask?.goalId` before `getCurrentGoalId()`
- [x] `SocketServerV2.ts:handleChatAgentMessage` — `resolvedGoalId` declared outside `try`, all emit/persist sites use it, `catch` no longer references out-of-scope variable
- [x] `AgentManagerV2.ts:getChatAgentContext(role, goalId?)` — now passes goalId to `getChatAgent`, so persisted context comes from the correct goal's ChatAgent
- [x] `SocketServerV2.ts:onPlanUpdate` — destructures `goalId` from callback data instead of calling `getCurrentGoalId()`; plan-approved DB save uses `getGoalMessages(teamId, goalId)` for goal-scoped user message lookup
- [x] `OrchestratorService.ts:getChatAgent` — when `goalId` is provided, no longer falls back to `getChatAgentByRole(role)` (which uses `activeGoalId`). Returns `null` instead of silently binding to wrong goal.

### Workspace Isolation
- [ ] Workspace directories keyed by `planId` not `goalId` — two goals with same planId could share directories
- [x] Branch names already use `goal-${goalId}/task-${taskId}` — correctly scoped
- [ ] `WorkspaceManager.planRepos` Map tracks clones by planId — should also consider goalId

### Known Non-Isolation Issues
- Worker git clone failure: "Repository inspection requires manual access" — workspace plugin can't clone private repos without auth token. Not a goal isolation bug. Fix: ensure `authTokenResolver` is wired correctly for GitHub OAuth tokens.

---

## Testing
- Two goals running simultaneously → no cross-contamination
- Fail Goal A task while viewing Goal B → correct planner notified
- Both goals dispatch workers simultaneously
- Each goal gets separate workspace directory and git branches

## Rollback
Phase 1 ships independently (fixes contamination, goals still serial). Phase 2 depends on Phase 1.
