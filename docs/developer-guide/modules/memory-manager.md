# MemoryManager - Task and Dependency Management

## Overview
MemoryManager is responsible for task storage, lifecycle management, dependency tracking, and context management across the multi-agent system.

## Location
`src/worker/memoryManager/MemoryManager.ts`

## Core Responsibilities

### 1. Task Storage
Stores all tasks with metadata including:
- Task description
- Assigned role
- Execution status
- Prerequisites/dependencies
- Output data
- Context

### 2. Dependency Management
- Tracks task prerequisites
- Determines task readiness
- Updates dependencies on completion
- Manages dependent tasks

### 3. Status Tracking
Monitors task lifecycle through defined statuses:
- `ready`: Can be executed immediately
- `pending`: Waiting for prerequisites
- `in_progress`: Currently executing
- `completed`: Successfully finished
- `failed`: Execution failed

### 4. Context Management
Stores and provides access to:
- Task results
- Intermediate data
- Shared context across agents

## Data Structure

### Task Interface
```typescript
interface Task {
  id: string;                              // Unique task identifier
  description: string;                     // What the task should accomplish
  assigned_role: string;                   // Role responsible (lowercase!)
  context?: string;                        // Additional context
  status: 'ready' | 'pending' | 'in_progress' | 'completed' | 'failed';
  output?: any;                            // Task result/output
  prerequisites: Map<string, boolean>;     // taskId -> isCompleted
  dependants: string[];                    // Tasks waiting on this one
}
```

### Internal Storage
```typescript
private tasks: Map<string, Task>
// Example:
{
  "task-1": { id: "task-1", description: "...", status: "completed", ... },
  "task-2": { id: "task-2", description: "...", status: "in_progress", ... }
}
```

## Task Status Lifecycle

```
         [Created]
            |
            v
    +----> ready <----+
    |       |         |
    |       v         |
    |   in_progress   |
    |       |         |
    |       v         |
    |   completed ----+  (updates dependants)
    |       |
    +--- failed
    
pending --> ready (when prerequisites complete)
```

### Status Transitions

1. **ready → in_progress**
   - Task assigned to worker
   - Worker begins execution

2. **in_progress → completed**
   - Task successfully completes
   - Output stored
   - Dependent tasks updated

3. **in_progress → failed**
   - Task encounters error
   - Dependent tasks remain pending

4. **pending → ready**
   - All prerequisites complete
   - Task becomes available for execution

## Key Methods

### addTask()
Adds a new task to the memory system.

**Signature**:
```typescript
addTask(task: Task): void
```

**Behavior**:
- Generates UUID if no ID provided
- Stores task in internal map
- Logs task addition

**Example**:
```typescript
memoryManager.addTask({
  id: "task-1",
  description: "Research AI trends",
  assigned_role: "researchagent",
  status: "ready",
  prerequisites: new Map(),
  dependants: []
});
```

### getTasks()
Retrieves ready tasks for a specific role.

**Signature**:
```typescript
getTasks(role: string): Task[]
```

**Process**:
1. Iterates through all tasks
2. Checks if task is ready via `checkTaskReady()`
3. Filters by assigned role
4. Returns matching ready tasks

**Example**:
```typescript
const readyTasks = memoryManager.getTasks("researchagent");
// Returns: [{ id: "task-1", status: "ready", ... }]
```

### updateTaskStatus()
Updates the status of a task.

**Signature**:
```typescript
updateTaskStatus(
  taskId: string,
  status: 'ready' | 'pending' | 'in_progress' | 'completed' | 'failed'
): void
```

**Example**:
```typescript
memoryManager.updateTaskStatus("task-1", "in_progress");
```

### completeTask()
Marks task as completed and updates dependants.

**Signature**:
```typescript
completeTask(taskId: string, outputData: any): void
```

**Process**:
1. Retrieves task
2. Stores output data
3. Updates status to `completed`
4. Calls `updateDependantTasks()` to update prerequisites
5. Logs completion

**Example**:
```typescript
memoryManager.completeTask("task-1", {
  result: "Research complete",
  data: { findings: [...] }
});
```

### isComplete()
Checks if all tasks are completed.

**Signature**:
```typescript
isComplete(): boolean
```

**Returns**: `true` if all tasks have `completed` status, otherwise `false`.

**Usage**:
```typescript
while (!memoryManager.isComplete()) {
  await delay(1000);
  // Continue polling
}
console.log("All tasks completed!");
```

### checkTaskReady() (Private)
Determines if a task is ready for execution.

**Logic**:
```typescript
private checkTaskReady(taskId: string): boolean {
  const task = this.tasks.get(taskId);
  
  // No prerequisites = ready
  if (task.prerequisites.size === 0) {
    return true;
  }
  
  // All prerequisites must be completed
  for (const completed of task.prerequisites.values()) {
    if (completed === false) {
      return false;
    }
  }
  
  return true;
}
```

### updateDependantTasks() (Private)
Updates dependent tasks when a task completes.

**Process**:
```typescript
private updateDependantTasks(task: Task): void {
  for (const dependantId of task.dependants) {
    const dependant = this.tasks.get(dependantId);
    
    // Mark this task as completed in dependant's prerequisites
    dependant.prerequisites.set(task.id, true);
    
    // Check if dependant is now ready
    if (this.checkTaskReady(dependantId)) {
      this.updateTaskStatus(dependantId, 'ready');
    }
  }
}
```

## Dependency Management

### Setting Up Dependencies

#### Example: Sequential Tasks
```typescript
// Task 1: Research (no dependencies)
memoryManager.addTask({
  id: "task-1",
  description: "Research topic",
  assigned_role: "researchagent",
  status: "ready",
  prerequisites: new Map(),
  dependants: ["task-2"]  // Task 2 depends on this
});

// Task 2: Write (depends on Task 1)
memoryManager.addTask({
  id: "task-2",
  description: "Write article",
  assigned_role: "writeragent",
  status: "pending",
  prerequisites: new Map([["task-1", false]]),  // Waiting for task-1
  dependants: []
});
```

#### Example: Parallel Tasks with Final Step
```typescript
// Parallel tasks
memoryManager.addTask({
  id: "task-1",
  description: "Research part A",
  assigned_role: "researchagent",
  status: "ready",
  prerequisites: new Map(),
  dependants: ["task-3"]
});

memoryManager.addTask({
  id: "task-2",
  description: "Research part B",
  assigned_role: "researchagent",
  status: "ready",
  prerequisites: new Map(),
  dependants: ["task-3"]
});

// Final task (depends on both)
memoryManager.addTask({
  id: "task-3",
  description: "Combine research",
  assigned_role: "writeragent",
  status: "pending",
  prerequisites: new Map([
    ["task-1", false],
    ["task-2", false]
  ]),
  dependants: []
});
```

### Automatic Promotion to Ready

When a task completes, dependent tasks are automatically promoted:

```typescript
// Initial state
task-1: ready
task-2: pending (depends on task-1)

// After task-1 completes
memoryManager.completeTask("task-1", output);

// Automatic update
task-1: completed
task-2: ready (prerequisites satisfied!)
```

## Usage Examples

### Basic Task Workflow
```typescript
const memoryManager = new MemoryManager();

// Add task
memoryManager.addTask({
  id: "task-1",
  description: "Process data",
  assigned_role: "dataprocessor",
  status: "ready",
  prerequisites: new Map(),
  dependants: []
});

// Get ready tasks for role
const tasks = memoryManager.getTasks("dataprocessor");
console.log(tasks); // [{ id: "task-1", ... }]

// Update status when worker picks it up
memoryManager.updateTaskStatus("task-1", "in_progress");

// Complete task with output
memoryManager.completeTask("task-1", { result: "Success" });

// Check if all done
console.log(memoryManager.isComplete()); // true
```

### With Dependencies
```typescript
const memoryManager = new MemoryManager();

// Step 1: Research
memoryManager.addTask({
  id: "step-1",
  description: "Gather information",
  assigned_role: "researcher",
  status: "ready",
  prerequisites: new Map(),
  dependants: ["step-2"]
});

// Step 2: Analyze (depends on step-1)
memoryManager.addTask({
  id: "step-2",
  description: "Analyze data",
  assigned_role: "analyst",
  status: "pending",
  prerequisites: new Map([["step-1", false]]),
  dependants: ["step-3"]
});

// Step 3: Report (depends on step-2)
memoryManager.addTask({
  id: "step-3",
  description: "Create report",
  assigned_role: "writer",
  status: "pending",
  prerequisites: new Map([["step-2", false]]),
  dependants: []
});

// Execute step-1
const researchTasks = memoryManager.getTasks("researcher");
memoryManager.updateTaskStatus("step-1", "in_progress");
memoryManager.completeTask("step-1", { findings: [...] });

// Now step-2 is ready
const analysisTasks = memoryManager.getTasks("analyst");
console.log(analysisTasks); // [{ id: "step-2", status: "ready", ... }]
```

## Integration with AgentManager

### Task Assignment Flow
```typescript
// In AgentManager
class AgentManager {
  async assignTasksToWorkers(planTasks: PlanTask[]): Promise<void> {
    for (const planTask of planTasks) {
      // Add to memory
      this.memoryManager.addTask({
        id: generateId(),
        description: planTask.task,
        assigned_role: planTask.role.toLowerCase(),
        status: planTask.dependencies.length > 0 ? 'pending' : 'ready',
        prerequisites: new Map(
          planTask.dependencies.map(dep => [dep, false])
        ),
        dependants: []
      });
      
      // Get worker
      const worker = this.roleManager.roleWorkers[planTask.role.toLowerCase()];
      
      // Subscribe to completion
      worker.events.once('taskComplete', (data) => {
        this.memoryManager.completeTask(taskId, data.content);
      });
      
      // Execute
      worker.createTask(planTask.task);
    }
  }
}
```

## Error Handling

### Task Not Found
```typescript
const task = this.tasks.get(taskId);
if (!task) {
  logger.error("Task not found", { taskId });
  return; // or throw error
}
```

### Invalid Status Transition
Currently not enforced, but could be added:
```typescript
const validTransitions = {
  'ready': ['in_progress'],
  'in_progress': ['completed', 'failed'],
  'pending': ['ready'],
  'completed': [],
  'failed': []
};

// Validate transition
if (!validTransitions[currentStatus].includes(newStatus)) {
  throw new Error(`Invalid transition: ${currentStatus} -> ${newStatus}`);
}
```

## Best Practices

### 1. Generate Unique IDs
```typescript
import { randomUUID } from 'crypto';

memoryManager.addTask({
  id: randomUUID(),
  // ...
});
```

### 2. Use Lowercase Role Keys
```typescript
// ✅ Correct
assigned_role: "researchagent"

// ❌ Wrong (won't match worker keys)
assigned_role: "ResearchAgent"
```

### 3. Set Up Bidirectional Dependencies
```typescript
// Task A
dependants: ["task-b"]

// Task B
prerequisites: new Map([["task-a", false]])
```

### 4. Store Meaningful Output
```typescript
memoryManager.completeTask(taskId, {
  result: "Success",
  data: { /* useful data */ },
  metadata: { /* execution info */ }
});
```

## Testing

### Unit Test Example
```typescript
describe('MemoryManager', () => {
  let manager: MemoryManager;
  
  beforeEach(() => {
    manager = new MemoryManager();
  });
  
  it('should add task', () => {
    manager.addTask({
      id: 'test-1',
      description: 'Test',
      assigned_role: 'tester',
      status: 'ready',
      prerequisites: new Map(),
      dependants: []
    });
    
    const tasks = manager.getTasks('tester');
    expect(tasks).toHaveLength(1);
    expect(tasks[0].id).toBe('test-1');
  });
  
  it('should handle dependencies', () => {
    // Add task with dependency
    manager.addTask({
      id: 'task-1',
      description: 'First',
      assigned_role: 'role1',
      status: 'ready',
      prerequisites: new Map(),
      dependants: ['task-2']
    });
    
    manager.addTask({
      id: 'task-2',
      description: 'Second',
      assigned_role: 'role2',
      status: 'pending',
      prerequisites: new Map([['task-1', false]]),
      dependants: []
    });
    
    // Complete first task
    manager.completeTask('task-1', { result: 'Done' });
    
    // Second task should now be ready
    const readyTasks = manager.getTasks('role2');
    expect(readyTasks).toHaveLength(1);
    expect(readyTasks[0].id).toBe('task-2');
  });
  
  it('should check completion', () => {
    manager.addTask({
      id: 'test-1',
      description: 'Test',
      assigned_role: 'tester',
      status: 'ready',
      prerequisites: new Map(),
      dependants: []
    });
    
    expect(manager.isComplete()).toBe(false);
    
    manager.completeTask('test-1', {});
    expect(manager.isComplete()).toBe(true);
  });
});
```

## Performance Considerations

### Task Lookup
- Uses Map for O(1) lookup by ID
- `getTasks()` iterates all tasks (O(n))
- Consider indexing by role for large task sets

### Memory Usage
- Tasks stored in memory until process ends
- Consider cleanup for long-running processes
- Implement task archiving for completed tasks

### Optimization Ideas
```typescript
// Index by role for faster lookup
private tasksByRole: Map<string, Set<string>> = new Map();

getTasks(role: string): Task[] {
  const taskIds = this.tasksByRole.get(role) || new Set();
  return Array.from(taskIds)
    .map(id => this.tasks.get(id))
    .filter(task => this.checkTaskReady(task.id));
}
```

## Future Enhancements

1. **Task Priority**: Add priority levels for execution order
2. **Task Timeout**: Automatic failure after timeout
3. **Retry Logic**: Automatic retry on failure
4. **Task History**: Track execution history
5. **Persistent Storage**: Save tasks to database
6. **Task Cancellation**: Cancel running tasks
7. **Progress Tracking**: Sub-task progress updates
8. **Resource Limits**: CPU/memory constraints per task

## Related Files

- [AgentManager](./agentManager.md)
- [RoleManager](./roleManager.md)
- [AgentWorker](./agentWorker.md)
