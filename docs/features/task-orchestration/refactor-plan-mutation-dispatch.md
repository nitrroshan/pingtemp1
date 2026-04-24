# Refactor: Plan Mutation → Task Dispatch Pipeline

**Status**: Completed  
**Severity**: High — 4 SOLID violations, 3 code smells, risk of regression  
**Scope**: `planMutationTools.ts`, `AgentManagerV2.ts`, `TaskStore.ts`, `OrchestratorService.ts`, `ITaskProvider.ts`, `Task.types.ts`

---

## Problem Statement

The plan mutation tools (`add_tasks`, `replan`, `update_task`, `reassign_task`) and the task dispatch pipeline have accumulated hotfixes (R9, R10, R11) that violate SOLID principles. The code works but is fragile — new mutations require changes in 3+ files and the dispatch path has 4 separate trigger mechanisms with no unifying abstraction.

---

## SOLID Violations Found

### 1. SRP Violation — AgentManagerV2.onMutation is a god handler

**File**: `AgentManagerV2.ts` lines 374–412  
**Problem**: The `onMutation` callback handles 4 event types with growing if/else chains. Each new mutation type requires another `if` block here. This mixes orchestration concerns (dispatch) with composition concerns (wiring).

```typescript
// Current: 4 if-blocks, growing
onMutation: (event) => {
  this.streamCallbacks?.onTaskUpdate?.({ ... });  // Always
  if (event.type === "plan:task_reassigned" && ...) { ... }  // R9-3
  if (event.type === "plan:tasks_added" || ...) { ... }      // R11-1
  if (event.type === "plan:task_updated" && ...) { ... }      // R11-2
}
```

**Fix**: Extract a `PlanMutationDispatcher` class (or move dispatch logic into `OrchestratorService.onPlanMutation(event)`) that owns the event→dispatch routing. AgentManagerV2 just forwards events.

### 2. OCP Violation — Adding new mutations requires 3-file changes

**Problem**: To add a new plan mutation tool (e.g., `split_task`), you must:
1. Add the tool in `planMutationTools.ts`
2. Add dispatch handler in `AgentManagerV2.ts` onMutation
3. Possibly add status transition in `TaskStore.ts`

**Fix**: Plan mutation tools should call `TaskStore.addTask()` which already promotes ready tasks and fires `onTaskReady`. The dispatch should flow through the existing `RoleTaskQueue → onTaskReady` callback, not through a parallel `onMutation → manualDispatch` path.

### 3. DIP Violation — Tools cast through `(task as any)` to access missing properties

**File**: `planMutationTools.ts`, `OrchestratorService.ts`  
**Problem**: The `Task` interface is missing fields that the runtime depends on:
- `(task as any).title` — used in update_task
- `(task as any).priority` — used in update_task, add_tasks
- `(task as any).expectedOutput` — used in update_task
- `(task as any)._agentCompleted` — race condition flag in OrchestratorService
- `(task as any)._lastReportedStatus` — blocked guard in OrchestratorService
- `task.status = "discarded" as any` — discarded exists in TaskStatus but cast still present

Tools depend on concrete Task shape, not the interface. And `ITaskProvider` is too thin — it has no `queue` property, so tools can't properly re-queue tasks.

**Fix**: 
- Add `title`, `priority`, `expectedOutput`, `type` to `Task` interface (they're used everywhere)
- Remove `_agentCompleted` hack — use a `completionSource` enum on Task instead
- Remove `_lastReportedStatus` hack — use a proper `lastReportedStatus` field

### 4. DRY Violation — Task creation logic duplicated between `add_tasks` and `replan`

**File**: `planMutationTools.ts` lines 190–230 and 354–395  
**Problem**: Both tools have identical:
- ID normalization (regex check, maxId counter, idMap)
- Task object construction (same 10-field object literal)
- DAG rebuild + mutation event emission

**Fix**: Extract a `normalizeAndAddTasks(ctx, tasks, existingIds)` helper that both call.

---

## Code Smells

### A. Parallel dispatch paths (4 mechanisms)

Tasks get dispatched via 4 different paths:
1. `TaskStore.create() → queueTask() → RoleTaskQueue.onTaskReady → OrchestratorService.onTaskReady` (normal approval flow)
2. `AgentManagerV2.onMutation(plan:tasks_added) → manualDispatch` (R11-1 fix)
3. `AgentManagerV2.onMutation(plan:task_reassigned) → manualDispatch` (R9-3 fix)
4. `AgentManagerV2.onMutation(plan:task_updated) → manualDispatch` (R11-2 fix)

Paths 2-4 exist because path 1 fires synchronously during the planner's tool execution, inside `streamText()`. The `onTaskReady` callback fires but the dispatch gets swallowed because the planner agent is still running.

**Root cause**: `onTaskReady` fires during `TaskStore.create()` in the same call stack as the planner's tool handler. Since `dispatchTask` is async and the planner is still in its tool loop, the dispatch may get lost.

**Fix**: `onTaskReady` should enqueue dispatches to a microtask queue, not fire inline. Or: plan mutation tools should NOT trigger dispatch at all — they should just set status, and a single post-tool-call hook in the agent loop should flush ready tasks.

### B. `_agentCompleted` flag is a runtime field, not a type field

The `_agentCompleted` flag was added to prevent the auto-complete race condition between `onWorkerDone` and the post-`runTask()` check. It's set via `(currentTask as any)._agentCompleted = true` — invisible to TypeScript.

**Fix**: Add `completionSource?: "tool" | "auto" | "manual"` to Task interface. Set it in `onWorkerDone` (tool), auto-complete (auto), or manual approval (manual). Check it instead of `_agentCompleted`.

### C. `ITaskProvider` is too thin for tool needs

Tools need `queue.enqueue()`, `completeTask()`, `getByStatus()` — none are on `ITaskProvider`. This forces either `(ctx.tasks as any).queue` casts or moving dispatch logic out of tools entirely.

**Fix**: Either expand `ITaskProvider` with `markReady(taskId)` and `getByStatus(status)`, or accept that plan mutation tools always operate on `TaskStore` (not generic `ITaskProvider`).

---

## Proposed Refactor Plan

### Phase 1: Type cleanup (low risk, do first)
1. Add `title`, `priority`, `expectedOutput`, `type`, `completionSource` to `Task` interface
2. Remove all `(task as any).title` casts in planMutationTools.ts
3. Replace `_agentCompleted` with `completionSource` field
4. Remove `_lastReportedStatus` — add `lastReportedStatus` to Task

### Phase 2: Extract shared task creation helper (medium risk)
1. Extract `normalizeAndAddTasks(ctx, rawTasks): string[]` from add_tasks/replan
2. Both tools call the helper instead of duplicating 40 lines
3. Include ID normalization, uniqueness check, DAG rebuild

### Phase 3: Unify dispatch path (higher risk, needs testing)
1. Move dispatch logic from AgentManagerV2.onMutation into OrchestratorService
2. Add `OrchestratorService.onPlanMutation(event)` method
3. Remove parallel manualDispatch calls from AgentManagerV2
4. Ensure `onTaskReady` reliably fires even during planner tool execution
5. Either: defer dispatches to microtask queue, or: flush ready tasks after each planner tool returns

### Phase 4: Interface cleanup
1. Add `markReady(taskId)` to ITaskProvider (encapsulates status change + queue)
2. Update PlanMutationContext to use `TaskStore` directly (or expanded ITaskProvider)
3. Remove `PlanMutationContext.onMutation` — tools call `TaskStore.markReady()` which triggers dispatch via existing callbacks

---

## Files Affected

| File | Phase | Change |
|------|-------|--------|
| `Task.types.ts` | 1 | Add 5 fields |
| `planMutationTools.ts` | 1, 2 | Remove casts, extract helper |
| `OrchestratorService.ts` | 1, 3 | Replace `_agentCompleted`, add `onPlanMutation` |
| `AgentManagerV2.ts` | 3 | Simplify onMutation to forward only |
| `ITaskProvider.ts` | 4 | Add `markReady()`, `getByStatus()` |
| `TaskStore.ts` | 4 | Implement new ITaskProvider methods |

---

## Risk Assessment

- **Phase 1**: Safe — additive type changes, no behavior change
- **Phase 2**: Low — pure extraction, same behavior
- **Phase 3**: Medium — dispatch timing is subtle, needs E2E validation
- **Phase 4**: Low — interface expansion, concrete impl already exists

---

## What's Working Now (Don't Break)

The hotfixes (R9-3, R10-4, R11-1, R11-2) ARE correct in behavior:
- Tasks with no deps DO get dispatched after add_tasks/replan
- Dependency updates DO check completed status
- Replan DOES avoid ID collisions
- Double-completion IS prevented

The refactor should preserve this behavior while making it structurally sound.
