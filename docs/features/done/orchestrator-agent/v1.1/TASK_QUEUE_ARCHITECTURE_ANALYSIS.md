# Task Queue Architecture - v1.1 Decision

**Date:** January 29, 2026  
**Decision:** Merge RoleTaskQueue INTO MemoryManager for priority-based, event-driven execution

---

## ✅ FINAL DECISION

**Architecture:** MemoryManager with integrated RoleTaskQueue (internal implementation detail)

**Why:**
- ✅ Priority queuing for critical path optimization
- ✅ Event-driven (0ms dispatch latency vs 1000ms polling)
- ✅ State persistence + task history
- ✅ Built-in metrics tracking
- ✅ Zero breaking changes to external API
- ✅ Clean encapsulation (OrchestratorService only knows MemoryManager)

**Performance:** 200ms for 6-task plan (vs 3050ms with polling = **15x faster**)

---

## Implementation Overview

### Execution Flow (Event-Driven)

```
Plan Approval
    ↓
MemoryManager.addTask(task)
    ├─ Store in tasks Map (source of truth)
    └─ If ready → Internal queue with priority
         ↓
    Emit 'task:available' {role, taskId}
         ↓
Worker polls memoryManager.getTasks(role)
         ↓
Execute task
         ↓
memoryManager.completeTask(taskId, output)
    ├─ Update tasks Map
    ├─ Complete in internal queue
    └─ Auto-queue ready dependents
         ↓
    Emit 'task:available' for dependents
         ↓
Workers wake instantly (0ms latency)
```

**6-Task Execution Timeline:**
```
t=0ms    : Plan approved
t=1-2ms  : task-1 queued with priority
t=50ms   : task-1 complete → task-2, task-3 ready
t=53ms   : Both queued and workers wake (0ms wait)
t=100ms  : Both complete → task-4 ready
t=150ms  : task-4 complete → task-5, task-6 ready
t=200ms  : All complete ✅

Total: 200ms (vs 3050ms with polling)

---

## Architecture Details

### MemoryManager with Integrated RoleTaskQueue

**Architecture:**
```typescript
import { RoleTaskQueue } from '../util/RoleTaskQueue.js';
import type { TaskWithContext } from '../util/RoleTaskQueue.types.js';

export class MemoryManager {
  private tasks: Map<string, Task>;
  private taskQueue: RoleTaskQueue; // NEW: Internal queue for tracking

  constructor() {
    this.tasks = new Map();
    this.taskQueue = new RoleTaskQueue();
    
    // Subscribe to queue events for internal coordination
    this.taskQueue.on('task:complete', (event) => {
      this.onQueueTaskComplete(event.taskId, event.output);
    });
  }

  // Existing interface unchanged
  addTask(task: Task): void {
    // Store in tasks map (source of truth)
    if (!task.id) {
      task.id = randomUUID();
    }
    this.tasks.set(task.id, task);
    
    // NEW: Queue if ready
    if (this.checkTaskReady(task.id)) {
      this.queueTask(task);
    }
  }

  // NEW: Internal method to queue tasks
  private queueTask(task: Task): void {
    const taskWithContext = this.toTaskWithContext(task);
    this.taskQueue.queueTask(taskWithContext);
  }

  // Enhanced getTasks - returns from queue
  getTasks(role: string): TaskWithContext[] {
    // Poll from queue instead of scanning all tasks
    const queuedTasks: TaskWithContext[] = [];
    
    // Get all queued tasks for this role
    while (true) {
      const task = this.taskQueue.poll(role);
      if (!task) break;
      queuedTasks.push(task);
    }
    
    return queuedTasks;
  }

  // Existing completeTask enhanced
  completeTask(taskId: string, outputData: any): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      log.error("completeTask: Task not found", { taskId });
      return;
    }
    
    // Update task storage
    task.output = outputData;
    this.updateTaskStatus(taskId, "completed");
    this.updateDependantTasks(task);
    this.tasks.set(taskId, task);
    
    // Complete in queue
    this.taskQueue.completeTask(taskId, outputData);
    
    // Queue newly ready dependents
    this.queueReadyDependents(task);
  }

  // NEW: Queue dependents that became ready
  private queueReadyDependents(completedTask: Task): void {
    for (const dependantId of completedTask.dependants) {
      const dependant = this.tasks.get(dependantId);
      if (dependant && this.checkTaskReady(dependantId)) {
        this.queueTask(dependant);
      }
    }
  }

  // NEW: Conversion from Task to TaskWithContext
  private toTaskWithContext(task: Task): TaskWithContext {
    const previousOutputs = [];
    
    for (const [prereqId, isComplete] of task.prerequisites) {
      if (isComplete) {
        const prereqTask = this.tasks.get(prereqId);
        if (prereqTask?.output) {
          previousOutputs.push({
            taskId: prereqId,
            output: prereqTask.output
          });
        }
      }
    }
    
    return {
      id: task.id,
      description: task.description,
      assigned_role: task.assigned_role,
      priority: (task as any).priority || 0,
      status: "queued",
      context: {
        previousOutputs,
        artifacts: [] // TODO: from task.context
      },
      createdAt: Date.now()
    };
  }

  // NEW: Subscribe to queue events externally
  on(event: string, handler: Function): void {
    this.taskQueue.on(event, handler);
  }

  off(event: string, handler: Function): void {
    this.taskQueue.off(event, handler);
  }

  // NEW: Get metrics from queue
  getMetrics() {
    return this.taskQueue.getMetrics();
  }
}
```

**Pros:**
- ✅ **No breaking changes:** External interface unchanged (getTasks, addTask, completeTask)
- ✅ **Internal optimization:** Uses RoleTaskQueue for efficient tracking
- ✅ **Event support:** Exposes queue events (task:available, task:complete, task:failed)
- ✅ **Priority support:** Tasks can have priority (internal queue feature)
- ✅ **Metrics:** Built-in completion tracking via queue
- ✅ **Clean encapsulation:** OrchestratorService doesn't know about internal queue
- ✅ **Best of both:** Task storage (Map) + execution queue (RoleTaskQueue)
- ✅ **Reusable:** MemoryManager API stays generic, queue is implementation detail

**Cons:**
- ⚠️ **Dual storage (internal):** Tasks in both `tasks` Map and `taskQueue` (but encapsulated)
- ⚠️ **Conversion overhead:** Task → TaskWithContext conversion on queueing
- ⚠️ **Slightly more complex:** ~50 lines added to MemoryManager

**Key Benefits:**
1. **OrchestratorService simplified:**
   ```typescript
   // No RoleTaskQueue, just MemoryManager
   async approvePlan(plan: TaskPlan) {
     for (const task of plan.tasks) {
       this.memoryManager.addTask(task); // Auto-queues if ready
     }
     
     // Listen to events from MemoryManager
     this.memoryManager.on('task:complete', this.onTaskComplete);
     
     // Start workers (same as before)
     this.startExecutionWorkers(this.teamRoles);
   }
   ```

2. **Event-driven from MemoryManager:**
   ```typescript
   // MemoryManager emits queue events
   memoryManager.on('task:available', ({ role, taskId }) => {
     // Wake worker
   });
   ```

3. **getTasks() returns ready tasks from queue:**
   ```typescript
   // No more scanning all tasks
   const tasks = memoryManager.getTasks("backend"); // From queue
   ```

---

## ✅ FINAL DECISION: **Option 5 - MemoryManager with Integrated RoleTaskQueue** 🎯

**User's Requirement:** "I want Priority queuing But I will merge RoleTaskQueue Logic with Memory Manager"

This combines the best of both worlds:
- ✅ Priority queuing (RoleTaskQueue feature)
- ✅ Metrics tracking (RoleTaskQueue feature)
- ✅ Event-driven dispatch (RoleTaskQueue feature)
- ✅ State persistence (MemoryManager feature)
- ✅ Dependency tracking (MemoryManager feature)
- ✅ Clean API - OrchestratorService only knows about MemoryManager
- ✅ Zero breaking changes

### Rationale

1. **You already have RoleTaskQueue** - Rebase complete, battle-tested, ready to merge
2. **Event-driven > Polling** - No CPU waste, instant task dispatch (0ms latency)
3. **Priority support** - Critical path optimization (e.g., schema before API routes)
4. **Metrics built-in** - Free monitoring via `getMetrics()`
5. **Clean encapsulation:**
   - **MemoryManager** = State persistence + dependency tracking + internal queue
   - **RoleTaskQueue** = Internal implementation detail (priority queue + events)
   - **OrchestratorService** = Simple consumer of MemoryManager API
   - **WorkerPool** = Task execution only
6. **No dual state management** - OrchestratorService doesn't manage both components

### Implementation Path: Merge RoleTaskQueue INTO MemoryManager

**Phase 1: Add RoleTaskQueue to MemoryManager (1.5 hours)**
- [ ] **File:** `src/worker/memoryManager/MemoryManager.ts`
- [ ] Import RoleTaskQueue: `import { RoleTaskQueue } from '../util/RoleTaskQueue.js'`
- [ ] Add private field: `private taskQueue: RoleTaskQueue`
- [ ] Initialize in constructor: `this.taskQueue = new RoleTaskQueue()`
- [ ] Add `toTaskWithContext()` method to convert Task → TaskWithContext
- [ ] Update `addTask()` to auto-queue if ready: `if (this.checkTaskReady(id)) { this.queueTask(task) }`
- [ ] Update `completeTask()` to:
  1. Complete in internal queue
  2. Queue newly ready dependents
- [ ] Add event forwarding methods:
  - `on(event, handler)` → `this.taskQueue.on(event, handler)`
  - `off(event, handler)` → `this.taskQueue.off(event, handler)`
- [ ] Add `getMetrics()` → `this.taskQueue.getMetrics()`
- [ ] Update `getTasks(role)` to poll from internal queue

**Phase 2: Update MemoryManager Types (30 min)**
- [ ] **File:** `src/worker/memoryManager/types/index.ts`
- [ ] Add `priority?: number` to Task interface
- [ ] Export TaskWithContext from RoleTaskQueue types (for type safety)

**Phase 3: Update OrchestratorService (1 hour)**
- [ ] **File:** `src/worker/orchestrator/OrchestratorService.ts`
- [ ] Remove RoleTaskQueue imports/instances (no longer needed)
- [ ] Subscribe to MemoryManager events:
  - `memoryManager.on('task:available', handleTaskAvailable)`
  - `memoryManager.on('task:complete', handleTaskComplete)`
- [ ] Update worker loops to call `memoryManager.getTasks(role)`
- [ ] Remove manual queueing logic (MemoryManager handles internally)

**Phase 4: Testing (1 hour)**
- [ ] Unit tests for MemoryManager with internal queue
- [ ] Integration test: 6-task plan with dependencies
- [ ] Verify event-driven dispatch (0ms latency)
- [ ] Verify priority ordering works
- [ ] Metrics validation (getMetrics returns queue stats)

**Total:** ~4 hours

**Key Files Modified:**
1. `src/worker/memoryManager/MemoryManager.ts` - Core integration (~80 new lines)
2. `src/worker/memoryManager/types/index.ts` - Add priority field
3. `src/worker/orchestrator/OrchestratorService.ts` - Simplified (~40 lines removed)

**Code Reduction:**
- OrchestratorService: -40 lines (no dual state management)
- MemoryManager: +80 lines (queue integration)
- **Net:** +40 lines for significantly better architecture

---

## Migration Strategy

### Step 1: Update v1.1 Planning Doc

Replace ExecutionLoop design with RoleTaskQueue approach:

```markdown
### Phase 2: Execution Loop (~2 hours)

- [ ] **Step 2: Integrate RoleTaskQueue into OrchestratorService**
  - File: `src/worker/orchestrator/OrchestratorService.ts`
  - Add: `taskQueue: RoleTaskQueue` instance
  - Implement: Event-driven task dispatch
  - Entry: RoleTaskQueue available
  - Exit: Tasks execute on queue events

- [ ] **Step 3: Implement dependency queueing**
  - File: `src/worker/orchestrator/OrchestratorService.ts`
  - Subscribe: `task:complete` event
  - Queue: Newly ready dependents
  - Entry: RoleTaskQueue integrated
  - Exit: Dependents auto-queue on completion
```

### Step 2: Update Types

Add to `OrchestratorContext`:
```typescript
export interface OrchestratorContext {
  teamId: string;
  teamRoles: string[];
  memoryManager: MemoryManager;
  taskQueue: RoleTaskQueue;  // NEW
  workerPool: WorkerPool;
  events: EventEmitter;
}
```

### Step 3: Implementation

See hybrid approach code above. Key methods:
1. `queueReadyTasks()` - Initial queueing + recheck after completions
2. `toTaskWithContext()` - Conversion layer
3. `startExecutionWorkers()` - Event-driven workers (no polling)

---

## Alternatives Considered

### Alternative 1: Enhance MemoryManager with Events

Add event emission to MemoryManager:
```typescript
class MemoryManager {
  completeTask(id: string, output: any) {
    // ... existing logic ...
    
    // Emit for newly ready dependents
    for (const depId of this.getDependents(id)) {
      if (this.checkTaskReady(depId)) {
        this.events.emit('task:ready', { taskId: depId, role: ... });
      }
    }
  }
}
```

**Verdict:** ❌ Reject
- Mixes concerns (state management + execution signaling)
- MemoryManager should be dumb storage, not orchestrator

### Alternative 2: Pure WorkerPool Polling

Have WorkerPool poll MemoryManager directly:
```typescript
class WorkerPool {
  async autoExecute(memoryManager: MemoryManager, roles: string[]) {
    while (...) {
      for (const role of roles) {
        const tasks = memoryManager.getTasks(role);
        for (const task of tasks) {
          this.runTask(task);
        }
      }
    }
  }
}
```

**Verdict:** ❌ Reject
- Polling inefficiency
- WorkerPool should be passive executor, not orchestrator
- Tight coupling between WorkerPool and MemoryManager

---

## ✅ FINAL DECISION: Option 5 - Merge RoleTaskQueue INTO MemoryManager

**User's Choice:** "I want Priority queuing But I will merge RoleTaskQueue Logic with Memory Manager"

**Next Steps:**
1. Update [v1.1 planning doc](./feature_implementation_planning.md) Phase 2
2. Merge RoleTaskQueue logic into MemoryManager (internal queue)
3. Add `toTaskWithContext()` conversion method
4. Expose queue events via MemoryManager API
5. Update OrchestratorService to use MemoryManager only
6. Test with 6-task plan from E2E test

**Estimated Effort:** ~4 hours

**Benefits Over All Other Options:**
- **vs Polling (Option 2):** 15x faster (200ms vs 3050ms)
- **vs Hybrid (Option 3):** No dual state in OrchestratorService
- **vs RoleTaskQueue-only (Option 1):** State persistence + history
- **vs Enhanced RoleTaskQueue (Option 4):** Keeps MemoryManager features

**What You Get:**
- ✅ **Instant dispatch:** 0ms latency (event-driven)
- ✅ **Priority support:** Critical path optimization
- ✅ **Metrics:** Built-in performance tracking
- ✅ **State persistence:** Full task history in MemoryManager.tasks
- ✅ **Zero breaking changes:** MemoryManager API unchanged
- ✅ **Clean architecture:** Queue is encapsulated implementation detail
- ✅ **Reusable:** MemoryManager works in orchestrator and non-orchestrator modes

**Conclusion:** Best of all worlds - priority queuing + state persistence + clean API. RoleTaskQueue becomes an internal optimization of MemoryManager.

---

## Questions for Consideration

1. **Priority assignment:** How do you calculate priority? Critical path analysis?
2. **Worker count per role:** Fixed (1) or dynamic based on queue size?
3. **Task timeout:** Should RoleTaskQueue track task execution time and timeout?
4. **Failure handling:** Retry policy? Dead letter queue?
5. **Plan persistence:** How does RoleTaskQueue integrate with FilePlanStore?

**Suggestion:** Start simple (1 worker/role, no priority, no retries) and iterate in v1.2+.

---

## Flow Comparison Table

| Aspect | Option 1: RoleTaskQueue | Option 2: Polling | Option 3: Hybrid |
|--------|------------------------|-------------------|------------------|
| **Task Storage** | RoleTaskQueue only | MemoryManager only | MemoryManager (source) + RoleTaskQueue (execution) |
| **Dependency Tracking** | Manual in OrchestratorService | Built-in MemoryManager | MemoryManager (authoritative) |
| **Ready Task Detection** | Manual prerequisite check | MemoryManager.getTasks() | MemoryManager.getTasks() → queue |
| **Task Dispatch** | Event-driven (`task:available`) | Poll every 1000ms | Event-driven (`task:available`) |
| **Latency to Start** | 0-5ms (instant) | 0-1000ms (polling interval) | 0-5ms (instant) |
| **Worker Wake Mechanism** | Event listener | Polling loop | Event listener |
| **CPU Efficiency** | High (event-driven) | Low (continuous polling) | High (event-driven) |
| **Priority Support** | ✅ Built-in | ❌ None | ✅ Built-in |
| **Metrics** | ✅ Built-in | ❌ Manual | ✅ Built-in |
| **State Persistence** | ❌ No persistence | ✅ MemoryManager | ✅ MemoryManager |
| **Event Flow** | Simple (queue only) | None (polling) | Dual (queue + memory) |
| **Complexity** | Medium | Low | Medium-High |
| **Memory Overhead** | Low (queue only) | Low (memory only) | Medium (both) |
| **Code Lines** | ~150 | ~80 | ~180 | ~120 | ~140 |

**Option 4 & 5 Comparison:**

| Aspect | Option 4: Enhanced RoleTaskQueue | Option 5: MemoryManager + Internal Queue |
|--------|----------------------------------|------------------------------------------|
| **Task Storage** | EnhancedRoleTaskQueue only (with dependencies) | MemoryManager.tasks + internal RoleTaskQueue |
| **Dependency Tracking** | Built-in to EnhancedRoleTaskQueue | MemoryManager (source of truth) |
| **Ready Task Detection** | isTaskReady() in EnhancedRoleTaskQueue | MemoryManager.checkTaskReady() |
| **Task Dispatch** | Event-driven (`task:available`) | Event-driven (via internal queue) |
| **Latency to Start** | 0-5ms (instant) | 0-5ms (instant) |
| **Worker Wake Mechanism** | Event listener | Event listener (forwarded from queue) |
| **CPU Efficiency** | High (event-driven) | High (event-driven) |
| **Priority Support** | ✅ Built-in | ✅ Built-in (via queue) |
| **Metrics** | ✅ Built-in | ✅ Built-in (via getMetrics()) |
| **State Persistence** | ⚠️ Must track completed tasks separately | ✅ MemoryManager.tasks has full history |
| **Event Flow** | Simple (queue only) | Encapsulated (internal queue) |
| **Complexity** | Medium (adds dependencies to queue) | Medium (queue is implementation detail) |
| **Memory Overhead** | Low (queue only) | Medium (Map + queue internally) |
| **Code Lines** | ~120 (EnhancedRoleTaskQueue) | ~140 (MemoryManager with queue) |
| **Reusability** | ❌ Orchestrator-specific (can't use in AgentManagerV2) | ✅ MemoryManager API unchanged |
| **Separation of Concerns** | ❌ Execution + state in one class | ✅ Queue is encapsulated detail |
| **Breaking Changes** | ✅ Yes (new component replaces MemoryManager) | ✅ No (MemoryManager API unchanged) |
| **OrchestratorService Changes** | Must manage queue directly | No changes (uses MemoryManager) |

### Key Differences in Event Flow

**Option 1 (RoleTaskQueue):**
```
Plan → Queue Tasks → Emit 'task:available' → Worker wakes → Execute
                                                ↓
                        Complete → Emit 'task:complete' → Queue dependents
```

**Option 2 (Polling):**
```
Plan → Store Tasks → Poll loop checks → Execute
                           ↓
           Complete → Update memory → [Wait 1000ms] → Poll finds dependents
```

**Option 3 (Hybrid):**
```
Plan → Store in Memory + Queue ready tasks → Emit 'task:available' → Worker wakes → Execute
                                                       ↓
                Complete → Update Memory → Find dependents → Queue them → Emit 'task:available'
```

**Option 4 (Enhanced RoleTaskQueue):**
```
Plan → Queue All Tasks (ready + pending) → Emit 'task:available' for ready → Worker wakes → Execute
                                                       ↓
                Complete → Queue auto-unblocks dependents → Emit 'task:available'
```

---

## Real-World Scenario: 6-Task Plan

**Plan Structure:**
```
task-1 (backend)     → No dependencies
task-2 (backend)     → Depends on task-1
task-3 (frontend)    → Depends on task-1
task-4 (devops)      → Depends on task-2, task-3
task-5 (backend)     → Depends on task-4
task-6 (frontend)    → Depends on task-4
```

### Option 1: RoleTaskQueue Execution Timeline

```
t=0ms     : Plan approved
t=1ms     : task-1 queued → 'task:available' (backend)
t=2ms     : Backend worker wakes, polls task-1
t=50ms    : task-1 completes → 'task:complete'
t=51ms    : Check dependencies: task-2, task-3 ready
t=52ms    : task-2 queued → 'task:available' (backend)
t=52ms    : task-3 queued → 'task:available' (frontend)
t=53ms    : Workers wake, poll both tasks (parallel)
t=100ms   : task-2 completes → 'task:complete'
t=105ms   : task-3 completes → 'task:complete'
t=106ms   : Check dependencies: task-4 ready (both prereqs done)
t=107ms   : task-4 queued → 'task:available' (devops)
t=108ms   : Devops worker wakes, polls task-4
t=150ms   : task-4 completes → 'task:complete'
t=151ms   : task-5, task-6 queued → 'task:available'
t=152ms   : Workers wake, poll both tasks (parallel)
t=200ms   : All complete ✅

TOTAL TIME: 200ms
WAIT TIME: 0ms (all instant dispatch)
```

### Option 2: Polling Execution Timeline

```
t=0ms     : Plan approved, polling starts
t=0ms     : Poll #1 → task-1 found (ready), dispatch
t=50ms    : task-1 completes, task-2 & task-3 become ready
t=50ms    : ⏳ Wait for next poll (950ms remaining)
t=1000ms  : Poll #2 → task-2, task-3 found, dispatch both
t=1050ms  : task-2 completes
t=1055ms  : task-3 completes, task-4 becomes ready
t=1055ms  : ⏳ Wait for next poll (945ms remaining)
t=2000ms  : Poll #3 → task-4 found, dispatch
t=2050ms  : task-4 completes, task-5 & task-6 become ready
t=2050ms  : ⏳ Wait for next poll (950ms remaining)
t=3000ms  : Poll #4 → task-5, task-6 found, dispatch both
t=3050ms  : All complete ✅

TOTAL TIME: 3050ms
WAIT TIME: 2850ms (95% of time spent waiting!)
SPEEDUP: 15x slower than Option 1
```

### Option 3: Hybrid Execution Timeline

```
t=0ms     : Plan approved
t=1ms     : task-1 added to MemoryManager
t=2ms     : task-1 queued in RoleTaskQueue → 'task:available'
t=3ms     : Backend worker wakes, polls task-1
t=50ms    : task-1 completes → 'task:complete'
t=51ms    : Update MemoryManager (task-1 complete)
t=52ms    : Find ready dependents: task-2, task-3
t=53ms    : Queue both → 'task:available' events
t=54ms    : Workers wake, poll both tasks (parallel)
t=100ms   : task-2 completes
t=105ms   : task-3 completes
t=106ms   : Update MemoryManager (both complete)
t=107ms   : Find ready dependent: task-4 (all prereqs done)
t=108ms   : Queue task-4 → 'task:available'
t=109ms   : Devops worker wakes, polls task-4
t=150ms   : task-4 completes
t=151ms   : Update MemoryManager
t=152ms   : Queue task-5, task-6 → 'task:available'
t=153ms   : Workers wake, poll both (parallel)
t=200ms   : All complete ✅

TOTAL TIME: 200ms
WAIT TIME: 0ms (all instant dispatch)
STATE PERSISTENCE: ✅ Full history in MemoryManager
```

**Winner:** Option 3 has same speed as Option 1 **PLUS** state persistence.

### Option 5: MemoryManager with Internal RoleTaskQueue Timeline

```
t=0ms     : Plan approved
t=1ms     : MemoryManager.addTask(task-1)
t=2ms     : Internal: taskQueue.queueTask(task-1) ← Auto-queued (ready)
t=2ms     : MemoryManager emits: 'task:available' {role: "backend", taskId: "task-1"}
t=3ms     : Backend worker calls memoryManager.getTasks("backend")
t=4ms     : MemoryManager polls from internal queue, returns [task-1]
t=5ms     : Worker executes task-1
t=50ms    : Worker calls memoryManager.completeTask("task-1", output)
t=51ms    : MemoryManager: Updates tasks Map, completes in queue
t=52ms    : MemoryManager: Checks dependents (task-2, task-3)
t=53ms    : MemoryManager: Auto-queues task-2 & task-3 (ready)
t=53ms    : MemoryManager emits: 'task:available' for both
t=54ms    : Workers call getTasks() and receive tasks
t=55ms    : Parallel execution of task-2 & task-3
t=100ms   : Both complete, MemoryManager queues task-4
t=150ms   : task-4 completes, queues task-5 & task-6
t=200ms   : All complete ✅

TOTAL TIME: 200ms
WAIT TIME: 0ms (instant dispatch)
EXTERNAL API: No change (still use MemoryManager methods)
IMPLEMENTATION: Queue is internal detail
```

**Analysis:** Same speed as Hybrid, but cleaner external API (no dual management).

### Option 4: Enhanced RoleTaskQueue Execution Timeline

```
t=0ms     : Plan approved
t=1ms     : All 6 tasks added to EnhancedRoleTaskQueue
t=2ms     : Only task-1 queued (no prerequisites)
t=2ms     : task:available {role: "backend", taskId: "task-1"}
t=3ms     : Backend worker wakes, polls task-1
t=50ms    : task-1 completes → completeTask() triggered
t=51ms    : EnhancedRoleTaskQueue updates prerequisites in task-2, task-3
t=52ms    : Both become ready, auto-queued
t=52ms    : task:available {role: "backend", taskId: "task-2"}
t=52ms    : task:available {role: "frontend", taskId: "task-3"}
t=53ms    : Workers wake, poll both tasks (parallel)
t=100ms   : task-2 completes
t=105ms   : task-3 completes
t=106ms   : task-4 prerequisites updated (both complete)
t=107ms   : task-4 auto-queued → 'task:available'
t=108ms   : Devops worker wakes, polls task-4
t=150ms   : task-4 completes
t=151ms   : task-5, task-6 auto-queued
t=152ms   : task:available events for both
t=153ms   : Workers wake, poll both (parallel)
t=200ms   : All complete ✅

TOTAL TIME: 200ms
WAIT TIME: 0ms (all instant dispatch)
PERSISTENCE: ⚠️ Must track completed tasks separately
```

**Analysis:** Same speed as Hybrid, but loses completed task history.

---

## Task Storage Deep Dive

### Where Are Plan Tasks Stored?

#### Option 1: RoleTaskQueue Only

```typescript
// Plan approval
async approvePlan(plan: TaskPlan) {
  // Store plan in OrchestratorService (in-memory)
  this.pendingPlan = plan;
  
  // Convert and queue tasks
  for (const task of plan.tasks) {
    if (this.isTaskReady(task)) {
      const taskWithContext = this.buildTaskWithContext(task);
      this.taskQueue.queueTask(taskWithContext); // ← ONLY storage
    }
  }
  
  // Store dependency graph separately (for lookup)
  this.taskDependencies = this.buildDependencyMap(plan.tasks);
}
```

**Storage Locations:**
1. **Original plan:** `OrchestratorService.pendingPlan` (TaskPlan object)
2. **Queued tasks:** `RoleTaskQueue.tasks` (Map<taskId, TaskWithContext>)
3. **Dependency graph:** `OrchestratorService.taskDependencies` (Map<taskId, string[]>)

**Problems:**
- ❌ **No persistence:** If server restarts, all lost
- ❌ **Manual tracking:** Must manually track which tasks completed
- ❌ **No history:** Completed tasks removed from queue, no record

---

#### Option 2: MemoryManager Only

```typescript
// Plan approval
async approvePlan(plan: TaskPlan) {
  // Convert plan tasks to MemoryManager format
  for (const task of plan.tasks) {
    const memTask: Task = {
      id: task.id,
      description: task.description,
      assigned_role: task.role,
      status: task.dependencies.length === 0 ? "ready" : "pending",
      prerequisites: new Map(task.dependencies.map(d => [d, false])),
      dependants: [], // Filled by MemoryManager
      output_data: null
    };
    
    this.memoryManager.addTask(memTask); // ← ONLY storage
  }
}
```

**Storage Locations:**
1. **All tasks:** `MemoryManager.tasks` (Map<taskId, Task>)
   - Includes: ready, pending, in_progress, completed, failed
   - Tracks: prerequisites, dependants, status, output

**Benefits:**
- ✅ **Single source of truth:** All task data in one place
- ✅ **Automatic dependency tracking:** MemoryManager updates prerequisites
- ✅ **Complete history:** Completed tasks remain in memory

**Current State:**
```typescript
MemoryManager.tasks = {
  "task-1": { status: "completed", output_data: "..." },
  "task-2": { status: "in_progress", prerequisites: Map { "task-1" => true } },
  "task-3": { status: "pending", prerequisites: Map { "task-1" => false } }
}
```

---

#### Option 4: Enhanced RoleTaskQueue (No MemoryManager)

```typescript
// Plan approval
async approvePlan(plan: TaskPlan) {
  // Convert and add ALL tasks to EnhancedRoleTaskQueue
  for (const task of plan.tasks) {
    const taskWithDeps: TaskWithDependencies = {
      id: task.id,
      description: task.description,
      assigned_role: task.role,
      prerequisites: new Map(task.dependencies.map(d => [d, false])),
      dependants: [],
      priority: task.priority || 0,
      status: "queued",
      context: { previousOutputs: [], artifacts: [] },
      createdAt: Date.now()
    };
    
    // Queue stores ALL tasks, but only emits events for ready ones
    this.taskQueue.queueTask(taskWithDeps); // ← ONLY storage
  }
  
  // Build dependants map
  this.buildDependantsMap(plan.tasks);
}
```

**Storage Locations:**
1. **All tasks:** `EnhancedRoleTaskQueue.tasks` (Map<taskId, TaskWithDependencies>)
   - Includes: queued (ready + pending), in_progress, completed, failed
   - Built-in: Prerequisites map, dependants array
   - Auto-queuing: When prerequisites complete

**Benefits:**
- ✅ **Single storage:** No MemoryManager needed
- ✅ **No conversion:** Tasks stay in same format
- ✅ **Automatic dependency handling:** Queue manages unblocking

**Problems:**
- ❌ **Completed tasks deleted:** RoleTaskQueue removes completed tasks by design
- ❌ **No persistence:** Can't save/restore full plan history
- ❌ **Must duplicate:** checkTaskReady(), dependency update logic
- ❌ **Breaks abstraction:** RoleTaskQueue becomes orchestrator-specific

**To Enable Persistence:**
```typescript
class EnhancedRoleTaskQueue {
  private completedTasks: Map<string, TaskWithDependencies> = new Map();
  
  completeTask(taskId: string, output: any): void {
    const task = this.tasks.get(taskId);
    
    // Move to completed storage instead of deleting
    this.completedTasks.set(taskId, task); // ← Adds MemoryManager behavior!
    
    // ... rest of completion logic
  }
  
  // Now you're rebuilding MemoryManager inside RoleTaskQueue!
}
```

**Verdict:** You'd end up rebuilding MemoryManager features inside RoleTaskQueue anyway.

---

#### Option 3: Hybrid (MemoryManager + RoleTaskQueue)

```typescript
// Plan approval
async approvePlan(plan: TaskPlan) {
  // 1. Store ALL tasks in MemoryManager (source of truth)
  for (const task of plan.tasks) {
    const memTask: Task = {
      id: task.id,
      description: task.description,
      assigned_role: task.role,
      status: task.dependencies.length === 0 ? "ready" : "pending",
      prerequisites: new Map(task.dependencies.map(d => [d, false])),
      priority: task.priority || 0,
      output_data: null
    };
    
    this.memoryManager.addTask(memTask); // ← Persistent storage
  }
  
  // 2. Queue ONLY ready tasks in RoleTaskQueue (execution queue)
  const readyTasks = this.memoryManager.getAllTasks()
    .filter(t => t.status === "ready");
  
  for (const task of readyTasks) {
    const taskWithContext = this.toTaskWithContext(task);
    this.taskQueue.queueTask(taskWithContext); // ← Execution queue
  }
}
```

**Storage Locations:**
1. **Permanent storage:** `MemoryManager.tasks` (Map<taskId, Task>)
   - All tasks: ready, pending, in_progress, completed, failed
   - Full history: Never deleted
   - Dependencies: prerequisites map, automatic tracking
   
2. **Execution queue:** `RoleTaskQueue.tasks` (Map<taskId, TaskWithContext>)
   - ONLY queued/in_progress tasks (ephemeral)
   - Includes: dependency outputs in context
   - Deleted: After completion (not needed anymore)

**Data Flow:**
```
Plan → MemoryManager (ALL tasks)
         ↓
      Find ready tasks
         ↓
      RoleTaskQueue (ONLY ready tasks)
         ↓
      Worker executes
         ↓
      Complete in RoleTaskQueue (remove from queue)
         ↓
      Update MemoryManager (mark complete, store output)
         ↓
      Find newly ready dependents
         ↓
      Queue them in RoleTaskQueue
```

---

### Conversion Layer Explained

**Why conversion is needed:**

**MemoryManager Task:**
```typescript
interface Task {
  id: string;
  description: string;
  assigned_role: string;
  status: "ready" | "pending" | "in_progress" | "completed" | "failed";
  prerequisites: Map<string, boolean>;  // ← Just IDs and completion flags
  dependants: string[];
  output_data: any;
  priority?: number;
}
```

**RoleTaskQueue TaskWithContext:**
```typescript
interface TaskWithContext {
  id: string;
  description: string;
  assigned_role: string;
  priority: number;
  status: "queued" | "in_progress" | "completed" | "failed";
  context: {
    previousOutputs: Array<{     // ← Full outputs from prerequisites
      taskId: string;
      output: any;
    }>;
    artifacts: string[];          // ← File paths/references
  };
  createdAt: number;
}
```

**Conversion Method:**
```typescript
private toTaskWithContext(task: Task): TaskWithContext {
  // Extract outputs from completed prerequisites
  const previousOutputs = [];
  
  for (const [prereqId, isComplete] of task.prerequisites) {
    if (isComplete) {
      const prereqTask = this.memoryManager.getTask(prereqId);
      if (prereqTask?.output_data) {
        previousOutputs.push({
          taskId: prereqId,
          output: prereqTask.output_data
        });
      }
    }
  }
  
  return {
    id: task.id,
    description: task.description,
    assigned_role: task.assigned_role,
    priority: task.priority || 0,
    status: "queued",
    createdAt: Date.now(),
    context: {
      previousOutputs,
      artifacts: [] // TODO: from ArtifactRegistry
    }
  };
}
```

**Why this matters:**
- MemoryManager tracks "which tasks must complete" (just IDs)
- RoleTaskQueue needs "what those tasks produced" (actual outputs)
- Worker needs prerequisite outputs to build context (e.g., "use the schema from task-1")

---

### Example: Task-2 Depends on Task-1

**In MemoryManager:**
```typescript
{
  id: "task-2",
  description: "Build API routes using schema",
  prerequisites: Map {
    "task-1" => true  // ← Just knows task-1 is complete
  },
  status: "ready",
  output_data: null
}
```

**Converted to TaskWithContext:**
```typescript
{
  id: "task-2",
  description: "Build API routes using schema",
  context: {
    previousOutputs: [
      {
        taskId: "task-1",
        output: "Created schema.ts with User, Post models" // ← Actual output
      }
    ],
    artifacts: ["src/models/schema.ts"] // ← File created
  }
}
```

**Sent to WorkerPool:**
```typescript
// WorkerPool builds message with context
const message = `
${task.description}

Previous work:
- task-1: ${task.context.previousOutputs[0].output}

Available files:
- ${task.context.artifacts.join('\n- ')}
`;

// Worker receives: "Build API routes using schema. Previous: Created schema.ts..."
```

---

### Storage Comparison

| Aspect | Option 1 | Option 2 | Option 3 |
|--------|----------|----------|----------|
| **Where tasks stored** | RoleTaskQueue.tasks | MemoryManager.tasks | Both (MemoryManager + RoleTaskQueue) |
| **What's stored** | TaskWithContext (execution) | Task (state) | Task (state) + TaskWithContext (execution) |
| **Persistence** | ❌ In-memory only | ✅ Can persist MemoryManager | ✅ Can persist MemoryManager |
| **History** | ❌ Lost after completion | ✅ All tasks retained | ✅ All tasks retained |
| **Dependency data** | Manual tracking needed | ✅ Built-in prerequisites map | ✅ Built-in prerequisites map |
| **Execution context** | ✅ Embedded in TaskWithContext | ❌ Must build manually | ✅ Built during conversion | ✅ Built during internal conversion |
| **Completed tasks** | Deleted from queue | Marked "completed" in memory | Deleted from queue, kept in memory | Deleted from queue, kept in Map |
| **External API** | New API (RoleTaskQueue) | Same (MemoryManager) | Dual (both) | Same (MemoryManager) |

**Option 5 Storage Pattern:**

**MemoryManager with Internal RoleTaskQueue:**
```typescript
class MemoryManager {
  private tasks: Map<string, Task>; // ← Source of truth (all tasks)
  private taskQueue: RoleTaskQueue; // ← Internal queue (execution)
  
  addTask(task: Task) {
    // 1. Store in Map (permanent)
    this.tasks.set(task.id, task);
    
    // 2. Queue if ready (internal optimization)
    if (this.checkTaskReady(task.id)) {
      this.taskQueue.queueTask(this.toTaskWithContext(task));
    }
  }
  
  getTasks(role: string): TaskWithContext[] {
    // Return from queue (event-driven)
    return this.taskQueue.poll(role);
  }
  
  completeTask(taskId: string, output: any) {
    // 1. Update Map
    this.tasks.get(taskId).output = output;
    this.updateTaskStatus(taskId, "completed");
    
    // 2. Complete in queue
    this.taskQueue.completeTask(taskId, output);
    
    // 3. Queue ready dependents
    this.queueReadyDependents(taskId);
  }
}
```

**Storage Locations:**
1. **Permanent:** `MemoryManager.tasks` Map (all task history)
2. **Execution:** `MemoryManager.taskQueue` internal queue (ready tasks only)
3. **External API:** Same as before (getTasks, addTask, completeTask)

**Benefits:**
- ✅ **No breaking changes:** OrchestratorService uses same MemoryManager API
- ✅ **Event-driven:** Queue events exposed via memoryManager.on()
- ✅ **Encapsulation:** Queue is implementation detail (can swap later)
- ✅ **Performance:** Event-driven dispatch (0ms latency)
- ✅ **Persistence:** Full history in tasks Map

### Recommendation: MemoryManager with Internal RoleTaskQueue (Option 5)

**Why Hybrid is Best:**

1. **MemoryManager = Database**
   - Permanent record of all tasks
   - Source of truth for dependencies
   - Can save to disk (FilePlanStore in v1.1)
   - Query: "Show me all completed tasks"

2. **RoleTaskQueue = Work Queue**
   - Temporary holding area for tasks
   - Optimized for execution (priority, events)
   - Cleared after completion (not needed)
   - Query: "What's next for backend role?"

3. **Separation of Concerns:**
   - MemoryManager: "What tasks exist and their relationships?"
   - RoleTaskQueue: "What should workers do next?"
   - OrchestratorService: Translator between the two

**Real-World Analogy:**
- **MemoryManager** = Project management tool (Jira, Asana)
  - All tasks, history, relationships
  - Never deleted, always queryable
  
- **RoleTaskQueue** = Worker's to-do list
  - Only current tasks
  - Cleared when done
  - Prioritized, actionable

- **OrchestratorService** = Project manager
  - Reads from project tool
  - Assigns to worker lists
  - Updates both on completion
