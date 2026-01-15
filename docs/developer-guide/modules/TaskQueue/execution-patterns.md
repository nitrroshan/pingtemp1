# Execution Patterns

## Overview
Deep dive into serial vs parallel execution patterns, concurrency control strategies, and when to use TaskQueue vs alternative approaches.

## Serial Execution (Current Pattern)

### How It Works
```
Time ──▶

Task 1: |████████████|
Task 2:              |████████████|
Task 3:                           |████████████|

One task at a time, FIFO order
```

### Implementation
```typescript
class TaskQueue {
  private queue: Task[] = [];
  private isProcessing = false;
  
  async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }
    
    this.isProcessing = true;
    const task = this.queue.shift()!;
    
    // Wait for task to complete
    await this.executeTask(task);
    
    // Then process next (serial)
    this.processNext();
  }
}
```

### Characteristics
- **Order**: Guaranteed FIFO
- **Concurrency**: 1 (single task at a time)
- **Thread Safety**: Inherent (no concurrent access)
- **Throughput**: Limited by slowest task
- **Predictability**: High (deterministic order)

### When to Use
✅ **Use Serial When**:
- Agent state must be consistent
- Tasks depend on previous task results
- LangGraph checkpointing is used (thread safety)
- Simplicity is priority
- Throughput requirements are modest

❌ **Avoid Serial When**:
- Tasks are independent
- High throughput is critical
- Tasks are I/O-bound and slow
- No shared state

### Example: Serial Execution in AgentWorker
```typescript
class AgentWorker {
  private taskQueue: TaskQueue;
  
  execute(task: Task): void {
    // Add to queue (returns immediately)
    this.taskQueue.enqueue({
      id: task.id,
      input: task.input,
      thread_id: task.thread_id,
      callback: (result) => {
        this.handleTaskComplete(task, result);
      }
    });
  }
  
  private async executeTask(task: Task): Promise<void> {
    // Invokes agent serially
    const result = await this.callAgent(task.input, task.thread_id);
    task.callback(result);
  }
}
```

## Parallel Execution

### How It Works
```
Time ──▶

Task 1: |████████████|
Task 2: |████████████|
Task 3: |████████████|

All tasks execute simultaneously
```

### Implementation
```typescript
class ParallelQueue {
  private tasks: Task[] = [];
  
  async executeAll(): Promise<void> {
    // Execute all tasks in parallel
    await Promise.all(
      this.tasks.map(task => this.executeTask(task))
    );
  }
  
  async executeTask(task: Task): Promise<void> {
    return this.callAgent(task.input, task.thread_id);
  }
}
```

### Characteristics
- **Order**: No guaranteed order
- **Concurrency**: N (all tasks simultaneously)
- **Thread Safety**: Must be managed explicitly
- **Throughput**: Maximum (for I/O-bound tasks)
- **Predictability**: Low (race conditions possible)

### When to Use
✅ **Use Parallel When**:
- Tasks are completely independent
- No shared state
- High throughput required
- Tasks are I/O-bound
- Agents are stateless

❌ **Avoid Parallel When**:
- Shared state exists (e.g., LangGraph checkpoints)
- Tasks have dependencies
- Resource exhaustion is a concern
- Order matters

### ⚠️ Why Not Used for AgentWorker
```typescript
// DANGEROUS: Don't do this with LangGraph!
await Promise.all([
  agent.invoke(messages1, { thread_id: '1' }),
  agent.invoke(messages2, { thread_id: '1' }),  // Same thread_id!
  agent.invoke(messages3, { thread_id: '1' })
]);
// Result: Checkpoint corruption, race conditions
```

**Problem**: LangGraph's MemorySaver checkpointing is **not thread-safe**. Concurrent invocations with the same `thread_id` cause:
- Checkpoint overwrites
- Lost messages
- Inconsistent state

## Controlled Concurrency

### Limited Parallel Execution
```
Time ──▶

Task 1: |████████████|
Task 2: |████████████|
Task 3:              |████████████|
Task 4:              |████████████|

Max 2 concurrent tasks
```

### Implementation
```typescript
class BoundedParallelQueue {
  private queue: Task[] = [];
  private activeCount = 0;
  private readonly maxConcurrent = 3;
  
  async processNext(): Promise<void> {
    while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
      const task = this.queue.shift()!;
      this.activeCount++;
      
      // Execute without awaiting (fire and forget)
      this.executeTask(task)
        .finally(() => {
          this.activeCount--;
          this.processNext();  // Check for more work
        });
    }
  }
  
  async executeTask(task: Task): Promise<void> {
    try {
      await this.callAgent(task.input, task.thread_id);
    } catch (error) {
      logger.error('Task failed', error);
    }
  }
}
```

### Characteristics
- **Order**: No guaranteed order
- **Concurrency**: N (configurable limit)
- **Thread Safety**: Requires unique thread_ids
- **Throughput**: Higher than serial
- **Predictability**: Moderate

### When to Use
✅ **Use Controlled Concurrency When**:
- Tasks are independent
- Each task has unique `thread_id`
- Want balance between throughput and resource usage
- Need to control resource consumption

### Example: Per-Thread Queues
```typescript
class ThreadSafeAgentWorker {
  private queues: Map<string, TaskQueue> = new Map();
  
  execute(task: Task): void {
    const thread_id = task.thread_id;
    
    // Get or create queue for this thread
    if (!this.queues.has(thread_id)) {
      this.queues.set(thread_id, new TaskQueue());
    }
    
    // Enqueue to thread-specific queue
    this.queues.get(thread_id)!.enqueue(task);
  }
}
```

**Benefits**:
- Tasks with same `thread_id` execute serially (safe)
- Tasks with different `thread_id` execute in parallel (fast)

## Multiple Workers Pattern (System Default)

### Architecture
```
┌─────────────┐
│ AgentManager│
└──────┬──────┘
       │
       ├─▶ Worker 1 (researcher)
       │   └─ TaskQueue (serial)
       │
       ├─▶ Worker 2 (developer)
       │   └─ TaskQueue (serial)
       │
       └─▶ Worker 3 (tester)
           └─ TaskQueue (serial)

Each worker processes serially
Workers run in parallel
```

### Implementation
```typescript
class RoleManager {
  private workers: Map<string, AgentWorker> = new Map();
  
  createWorker(role: string, config: AgentConfig): AgentWorker {
    const worker = new AgentWorker(role, config);
    this.workers.set(role, worker);
    return worker;
  }
  
  assignTask(task: Task): void {
    const role = task.assigned_role;
    const worker = this.workers.get(role);
    
    if (!worker) {
      throw new Error(`No worker for role: ${role}`);
    }
    
    // Each worker has its own serial TaskQueue
    worker.execute(task);
  }
}
```

### Characteristics
- **Order**: Per-worker FIFO, no global order
- **Concurrency**: N workers (one task per worker)
- **Thread Safety**: Each worker is thread-safe
- **Throughput**: Scales with worker count
- **Predictability**: High per worker, none globally

### Benefits
✅ **Best of Both Worlds**:
- Serial execution per worker (thread-safe)
- Parallel execution across workers (high throughput)
- Simple to reason about
- Scales horizontally

### Load Distribution
```typescript
class AgentManager {
  async assignTasksToWorkers(): Promise<void> {
    const readyTasks = await this.memoryManager.getReadyTasks();
    
    for (const task of readyTasks) {
      const role = task.assigned_role;
      const worker = this.roleManager.getWorker(role);
      
      if (!worker) continue;
      
      // Each worker processes serially
      worker.execute(task);
      
      // Subscribe to completion
      worker.events.once('taskComplete', (data) => {
        this.handleTaskComplete(task, data);
      });
    }
  }
}
```

## Execution Pattern Comparison

### Throughput
```
Serial (1 worker):     |████| 1 task/sec
Parallel (unsafe):     |████████████| 10 tasks/sec (but corrupts state!)
Multiple Workers (3):  |████████| 3 tasks/sec (safe)
Controlled (3):        |████████| 3 tasks/sec (safe with unique thread_ids)
```

### Thread Safety
```
Serial:            ✅ Inherently safe
Parallel:          ❌ Requires external synchronization
Multiple Workers:  ✅ Each worker safe
Controlled:        ⚠️  Safe if thread_ids unique
```

### Complexity
```
Serial:            ⭐ Simple
Parallel:          ⭐⭐⭐⭐⭐ Complex
Multiple Workers:  ⭐⭐⭐ Moderate
Controlled:        ⭐⭐⭐⭐ Complex
```

### Resource Usage
```
Serial:            ⭐ Low (1 agent instance)
Parallel:          ⭐⭐⭐⭐⭐ High (N agent instances)
Multiple Workers:  ⭐⭐⭐ Moderate (M worker instances)
Controlled:        ⭐⭐⭐⭐ High (N concurrent)
```

## Concurrency Control Strategies

### 1. Mutex/Lock (Not Needed for TaskQueue)
```typescript
// NOT USED: TaskQueue provides implicit serialization
class MutexProtectedAgent {
  private mutex = new Mutex();
  
  async invoke(input: string): Promise<any> {
    return await this.mutex.runExclusive(async () => {
      return await this.agent.invoke(input);
    });
  }
}
```

### 2. Semaphore (For Bounded Concurrency)
```typescript
class SemaphoreQueue {
  private semaphore = new Semaphore(3);  // Max 3 concurrent
  
  async execute(task: Task): Promise<void> {
    await this.semaphore.acquire();
    try {
      await this.executeTask(task);
    } finally {
      this.semaphore.release();
    }
  }
}
```

### 3. Rate Limiting
```typescript
class RateLimitedQueue {
  private lastExecution = 0;
  private readonly minInterval = 1000;  // 1 sec between tasks
  
  async executeTask(task: Task): Promise<void> {
    const now = Date.now();
    const elapsed = now - this.lastExecution;
    
    if (elapsed < this.minInterval) {
      await delay(this.minInterval - elapsed);
    }
    
    this.lastExecution = Date.now();
    await this.callAgent(task.input, task.thread_id);
  }
}
```

### 4. Debouncing/Throttling
```typescript
class DebouncedQueue {
  private debounceTimer: NodeJS.Timeout | null = null;
  private readonly debounceDelay = 300;
  
  enqueue(task: Task): void {
    // Clear previous timer
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
    }
    
    // Set new timer
    this.debounceTimer = setTimeout(() => {
      this.queue.push(task);
      this.processNext();
    }, this.debounceDelay);
  }
}
```

## Performance Optimization

### 1. Task Batching
```typescript
class BatchedQueue {
  private batch: Task[] = [];
  private readonly batchSize = 10;
  
  enqueue(task: Task): void {
    this.batch.push(task);
    
    if (this.batch.length >= this.batchSize) {
      this.processBatch();
    }
  }
  
  async processBatch(): Promise<void> {
    const tasks = [...this.batch];
    this.batch = [];
    
    // Process batch serially
    for (const task of tasks) {
      await this.executeTask(task);
    }
  }
}
```

### 2. Priority Queue
```typescript
class PriorityQueue {
  private queue: PriorityTask[] = [];
  
  enqueue(task: PriorityTask): void {
    this.queue.push(task);
    
    // Sort by priority (higher first)
    this.queue.sort((a, b) => b.priority - a.priority);
  }
  
  dequeue(): PriorityTask | undefined {
    return this.queue.shift();  // Highest priority first
  }
}
```

### 3. Lazy Initialization
```typescript
class LazyInitQueue {
  private agent: Agent | null = null;
  
  async executeTask(task: Task): Promise<void> {
    // Initialize agent only when needed
    if (!this.agent) {
      this.agent = await this.initializeAgent();
    }
    
    await this.agent.invoke(task.input);
  }
}
```

## Testing Execution Patterns

### Serial Execution Test
```typescript
test('executes tasks serially', async () => {
  const queue = new TaskQueue();
  const order: number[] = [];
  
  queue.enqueue({ id: '1', execute: async () => order.push(1) });
  queue.enqueue({ id: '2', execute: async () => order.push(2) });
  queue.enqueue({ id: '3', execute: async () => order.push(3) });
  
  await queue.waitUntilEmpty();
  
  expect(order).toEqual([1, 2, 3]);
});
```

### Concurrency Test
```typescript
test('maintains concurrency limit', async () => {
  const queue = new BoundedParallelQueue(maxConcurrent: 2);
  let concurrent = 0;
  let maxConcurrent = 0;
  
  const tasks = Array(10).fill(0).map((_, i) => ({
    id: String(i),
    execute: async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await delay(100);
      concurrent--;
    }
  }));
  
  await queue.executeAll(tasks);
  
  expect(maxConcurrent).toBeLessThanOrEqual(2);
});
```

## Best Practices

### 1. Use Serial for Thread Safety
When using LangGraph with checkpointing, always use serial execution (TaskQueue).

### 2. Use Multiple Workers for Scale
Don't increase concurrency per worker; add more workers instead.

### 3. Unique thread_ids for Concurrency
If using controlled concurrency, ensure each task has a unique `thread_id`.

### 4. Monitor Queue Depth
Track queue size to detect bottlenecks:
```typescript
if (queue.size() > 100) {
  logger.warn('Queue backlog detected');
}
```

### 5. Set Timeouts
Prevent tasks from running indefinitely:
```typescript
const result = await Promise.race([
  executeTask(task),
  timeout(30000)
]);
```

## Related Documentation

- [TaskQueue Overview](./README.md)
- [Queue Management](./queue-management.md)
- [AgentWorker](../README.md)
