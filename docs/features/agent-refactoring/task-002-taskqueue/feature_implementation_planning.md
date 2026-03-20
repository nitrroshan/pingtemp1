# Task 2: TaskQueue Implementation Plan

**Architecture Decision:** Option C - Role-Based Queue with Polling Pattern  
**Updated:** January 27, 2026

## Implementation Phases

### Phase 1: Core Data Structures ✅ COMPLETE

#### Step 1.1: PriorityQueue class ✅
**File:** `src/worker/util/PriorityQueue.ts`
- Min-heap with priority + insertOrder for FIFO
- Generic type for reuse

#### Step 1.2: TaskWithContext types ✅
**File:** `src/worker/util/RoleTaskQueue.types.ts`
- TaskWithContext, TaskContext interfaces
- TaskQueueEvents for event typing

---

### Phase 2: RoleTaskQueue Implementation ✅ COMPLETE

#### Step 2.1: RoleTaskQueue class ✅
**File:** `src/worker/util/RoleTaskQueue.ts`
- Role-based queues via Map<string, PriorityQueue>
- Task index for O(1) lookup
- Event emission on queue/complete/fail

#### Step 2.2: Queue operations ✅
- `queueTask()`, `poll()`, `peek()`, `peekAll()`
- `getTask()`, `hasTasksFor()`, `updatePriority()`

#### Step 2.3: Lifecycle methods ✅
- `completeTask()`, `failTask()`
- Event emission

---

### Phase 3: WorkerPool Overload ✅ COMPLETE

#### Step 3.1: Add runTask overload ✅
**File:** `src/worker/services/WorkerPool.ts`
- Added two overload signatures
- Implementation detects string vs TaskWithContext
- Chat mode: uses params directly
- Queue mode: calls buildMessageWithContext()

#### Step 3.2: Add buildMessageWithContext helper ✅
**File:** `src/worker/services/WorkerPool.ts`
- Injects `task.description` + previous outputs + artifacts
- Private helper method

---

### Phase 4: AgentManager Integration ✅ COMPLETE

#### Step 4.1: Add RoleTaskQueue to AgentManagerV2 ✅
**File:** `src/worker/agentManager/AgentManagerV2.ts`
- Added imports: RoleTaskQueue, TaskWithContext
- Added properties: taskQueue, taskOutputs

#### Step 4.2: Add executeQueuedTask (non-blocking) ✅
- Non-blocking execution with Promise.then/catch
- Updates queue status on completion/failure

#### Step 4.3: Add approval flow methods ✅
- `queueAllPlannedTasks()` - Queue initial tasks from plan
- `getPendingApproval(role)` - Peek without removing
- `approveTask(taskId)` - Poll and execute
- `skipTask(taskId)` - Mark as failed with skip reason
- `pickTask(taskId)` - Remove specific task regardless of position
- `hasPendingTasksForRole(role)` - Check for pending tasks
- `getQueueStats()` - Queue statistics

#### Step 4.4: Add dependency handler ✅
- `setupCompletionHandler()` - Listen for task:complete/fail
- `queueReadyDependents()` - Queue tasks when deps satisfied
- `queuePlannedTask()` - Convert PlannedTask to TaskWithContext

---

### Phase 5: Testing ✅ COMPLETE

#### Step 5.1: Unit Tests ✅
**Files:** 
- `util/PriorityQueue.test.ts` - 21 tests
- `util/RoleTaskQueue.test.ts` - 33 tests

Test Coverage:
- Basic operations (push/pop/peek/clear)
- Priority ordering (lower = higher priority)
- FIFO for same priority
- Role isolation
- Event emission
- Metrics tracking
- Update priority

#### Step 5.2: Interactive Integration Test ✅
**File:** `agentManager/agentManagerV2.queue.test.ts`

Interactive CLI test with commands:
- `a` (approve) - Approve next task with numbered selection
- `s` (skip) - Skip a task with numbered selection
- `p` (pick) - Pick specific task with numbered selection
- `l` (list) - Show all pending tasks and status
- `q` (queue) - Show queue statistics
- `x` (exit) - Exit test

Verified workflow:
- configureWorkflow → createPlan → queueAllPlannedTasks
- Approval flow: getPendingApproval → approveTask/skipTask/pickTask
- Non-blocking execution with streaming output
- Queue statistics and status tracking

---

## File Summary

| File | Action | Status |
|------|--------|--------|
| `util/PriorityQueue.ts` | Created | ✅ |
| `util/PriorityQueue.test.ts` | Unit tests | ✅ |
| `util/RoleTaskQueue.ts` | Created | ✅ |
| `util/RoleTaskQueue.test.ts` | Unit tests | ✅ |
| `util/RoleTaskQueue.types.ts` | Created | ✅ |
| `services/WorkerPool.ts` | Add overload | ✅ |
| `agentManager/AgentManagerV2.ts` | Add queue integration | ✅ |
| `agentManager/agentManagerV2.queue.test.ts` | Interactive test | ✅ |

---

## Success Criteria

- [x] PriorityQueue handles priority + FIFO correctly
- [x] RoleTaskQueue isolates queues by role
- [x] Events fire on queue/complete/fail
- [x] WorkerPool.runTask() overloaded for TaskWithContext
- [x] AgentManager approval flow (approve/skip/pick)
- [x] Dependency chain handling
- [x] All tests pass (54/54)

---

## Status

- [x] Phase 1: Core Data Structures ✅
- [x] Phase 2: RoleTaskQueue Implementation ✅
- [x] Phase 3: WorkerPool Overload ✅
- [x] Phase 4: AgentManager Integration ✅
- [x] Phase 5: Testing ✅

**Task 2: TaskQueue - COMPLETE** 🎉
