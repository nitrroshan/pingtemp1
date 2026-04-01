# MemoryManager

## Purpose

MemoryManager is the central task storage and dependency engine. It stores all tasks, tracks their prerequisites, determines when tasks become ready for execution, and cascades completion to unlock dependent tasks. It also integrates with RoleTaskQueue for event-driven dispatch.

## Source Files

- `src/worker/memoryManager/MemoryManager.ts` — Main class
- `src/worker/memoryManager/types/Task.types.ts` — Task, TaskStatus, BranchStatus
- `src/worker/memoryManager/types/index.ts` — Barrel export
- `src/worker/util/RoleTaskQueue.ts` — Priority queue per role, event-driven
- `src/worker/util/RoleTaskQueue.types.ts` — TaskWithContext, QueueMetrics

## Task Data Model

```typescript
// From Task.types.ts
type TaskStatus = "ready" | "pending" | "in_progress" | "completed" | "failed";
type BranchStatus = "not_created" | "active" | "merged" | "merge_requested" | "discarded";

interface Task {
  id: string;
  description: string;
  assigned_role: string;         // MUST be lowercase
  status: TaskStatus;
  priority?: number;
  context?: Record<string, any>;
  output?: any;

  // Dependency tracking
  prerequisites: Map<string, boolean>;  // taskId → completed?
  dependants: string[];                 // tasks that depend on this one

  // Workspace fields (L1 integration)
  workspaceId?: string;
  branchName?: string;
  branchStatus?: BranchStatus;
  branchVersion?: number;

  // Artifact/knowledge fields
  artifacts?: string[];
  knowledgeRefs?: string[];
}
```

## Task Status State Machine

```
pending ─────(all prerequisites true)─────► ready ────(assigned to worker)────► in_progress
                                                                                    │
                                                                          ┌─────────┴─────────┐
                                                                          ▼                   ▼
                                                                      completed            failed
```

A task starts as `pending` if it has unresolved prerequisites. When all prerequisite values in the Map become `true`, the task transitions to `ready` and is queued via RoleTaskQueue.

## Key Class: MemoryManager

### Fields

```typescript
class MemoryManager {
  private tasks: Map<string, Task>;
  public readonly taskQueue: RoleTaskQueue;  // exposed for event subscription
}
```

### Public API

| Method | Signature | Description |
|--------|-----------|-------------|
| `addTask` | `(task: Task): void` | Adds task, auto-queues if no prerequisites |
| `storeTasks` | `(tasks: Task[]): void` | Bulk add tasks |
| `getTasks` | `(role: string): Task[]` | Returns ready tasks for a role |
| `getTask` | `(taskId: string): Task` | Retrieve single task by ID |
| `getAllTasks` | `(): Task[]` | All tasks regardless of status |
| `updateTaskStatus` | `(taskId: string, status: TaskStatus): void` | Update task state |
| `completeTask` | `(taskId: string, outputData: any): Task[]` | Complete task, returns newly-ready dependents |
| `isComplete` | `(): boolean` | True when all tasks are completed |
| `getTaskContext` | `(taskId: string): { task, dependencyOutputs }` | Get task with outputs from completed dependencies |
| `clearAllTasks` | `(): void` | Remove all tasks (used when approving a new plan) |
| `getMetrics` | `(): QueueMetrics` | Queue metrics (tasks queued, completed, failed, avg time) |

### Internal Methods

| Method | Description |
|--------|-------------|
| `checkTaskReady(taskId)` | Returns true when `prerequisites.size === 0` or all values are `true` |
| `updateDependantTasks(task)` | Marks this task as completed in each dependant's prerequisites map |
| `updateContext(completedTask, dependantTask)` | Merges completed task's output into dependant's context |
| `queueTask(taskId)` | Converts Task to TaskWithContext, pushes to RoleTaskQueue |
| `toTaskWithContext(task)` | Builds TaskWithContext with previousOutputs from context entries |

## Dependency Resolution Flow

When `completeTask(taskId, output)` is called:

1. Sets task status to `completed` and stores `output`
2. Calls `updateDependantTasks()` — for each dependant:
   - Sets `dependant.prerequisites.set(taskId, true)`
   - Calls `updateContext()` to merge output into dependant's context
   - If `checkTaskReady(dependantId)` is now true, sets status to `ready` and calls `queueTask()`
3. Returns array of newly-ready tasks

## RoleTaskQueue

A separate priority queue per role with event-driven dispatch.

### Key Methods

| Method | Description |
|--------|-------------|
| `queueTask(task: TaskWithContext)` | Add task to role's queue, emit `task:available` |
| `poll(role): TaskWithContext?` | Pop highest-priority task for a role |
| `peek(role): TaskWithContext?` | Look without removing |
| `completeTask(taskId, output)` | Mark complete, emit `task:complete` |
| `failTask(taskId, error)` | Mark failed, emit `task:failed` |
| `clear()` | Clear all queues and tasks (preserves event listeners) |

### Events

| Event | Payload | Emitted When |
|-------|---------|-------------|
| `task:available` | `{ role, taskId }` | Task queued and ready for execution |
| `task:complete` | `{ taskId, output }` | Task marked complete |
| `task:failed` | `{ taskId, error }` | Task marked failed |

### TaskWithContext

```typescript
interface TaskWithContext {
  id: string;
  assigned_role: string;
  description: string;
  priority: number;
  context: {
    previousOutputs: Array<{ taskId: string; output: any }>;
    artifacts: string[];
  };
  createdAt: number;
  status: "queued" | "in_progress" | "completed" | "failed";
}
```

## Integration Points

- **Created by**: `AgentManager.initializeOrchestrator()` (creates new MemoryManager instance)
- **OrchestratorService**: Subscribes to `taskQueue` events (`task:available`, `task:complete`, `task:failed`). Calls `addTask()` during `approvePlan()` for each planned task.
- **AgentManager**: Calls `completeTask()` via `completeTaskByUser()`. Reads task state via `getTask()`, `getAllTasks()`, `getTaskContext()`.
- **MemoryCoordinator**: Wraps `completeTask()` for task completion with knowledge layer integration.

## Example: Task with Dependencies

```typescript
const mm = new MemoryManager();

// Task 1: no dependencies → auto-queued as ready
mm.addTask({
  id: "research",
  description: "Research AI trends",
  assigned_role: "researcher",
  status: "pending",
  prerequisites: new Map(),        // empty = ready immediately
  dependants: ["write-article"],
});

// Task 2: depends on research → stays pending
mm.addTask({
  id: "write-article",
  description: "Write article from research",
  assigned_role: "writer",
  status: "pending",
  prerequisites: new Map([["research", false]]),
  dependants: [],
});

// Complete research → write-article becomes ready
const newlyReady = mm.completeTask("research", { findings: "..." });
// newlyReady = [{ id: "write-article", status: "ready", ... }]
```
