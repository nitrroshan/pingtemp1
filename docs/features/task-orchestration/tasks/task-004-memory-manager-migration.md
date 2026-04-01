# Task 004: Migrate from MemoryManager

**Status:** `not-started`
**Assignee:**
**Estimated:** 1-2 days
**Branch:** `feature/planner-as-agent`

## Description
Deprecate MemoryManager's task management methods and route all task operations through TaskStore. MemoryManager retains only memory/context/L2 functions.

## Acceptance Criteria
- [ ] Deprecate `MemoryManager.storeTasks()` → `TaskStore.create()`
- [ ] Deprecate `MemoryManager.getReadyTasks()` → `DependencyResolver.resolveReady()`
- [ ] Deprecate `MemoryManager.updateStatus()` → `TaskStore.updateStatus()`
- [ ] Replace `prerequisites: Map<string, boolean>` → `dependencies: Array<{ taskId, type }>`
- [ ] Refactor `RoleTaskQueue`: add `pollN(role, n)` for parallel dispatch, keep per-role priority queues
- [ ] Remove `EventEmitter` events from `RoleTaskQueue` (move to emittery in WorkerPool — A5 Step 7)
- [ ] Feature flag: `TASK_STORE=new|legacy` for rollback
- [ ] MemoryManager retains: memory, context, L2, shared knowledge methods

## Migration Map
| Before (MemoryManager) | After (TaskStore) |
|---|---|
| `storeTasks()` | `TaskStore.create()` |
| `getReadyTasks()` | `DependencyResolver.resolveReady()` |
| `prerequisites: Map<string, boolean>` | `dependencies: Array<{ taskId, type }>` |
| `updateStatus()` | `TaskStore.updateStatus()` (single writer) |
| `RoleTaskQueue.poll()` one-at-a-time | `RoleTaskQueue.pollN(role, n)` parallel per role |

## Dependencies
- A6 Tasks 001-003
- A5 Task 010 (OrchestratorService refactor — migration happens as part of the same refactor)

## Testing
- Integration: all task operations route through TaskStore, MemoryManager task methods unused
- Feature flag toggle: `legacy` mode still works with old MemoryManager
