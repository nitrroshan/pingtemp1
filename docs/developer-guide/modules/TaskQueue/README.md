# TaskQueue Component

## Overview
The TaskQueue manages serial task execution for AgentWorker, ensuring tasks are processed one at a time in FIFO order to maintain thread safety and prevent concurrent invocations.

## Architecture

```
┌─────────────────────────────────┐
│        TaskQueue                │
│                                 │
│  ┌───────────────────────────┐ │
│  │ Queue: Task[]             │ │
│  │ - task1: { id, input }    │ │
│  │ - task2: { id, input }    │ │
│  │ - task3: { id, input }    │ │
│  └───────────────────────────┘ │
│                                 │
│  ┌───────────────────────────┐ │
│  │ Processing State          │ │
│  │ - isProcessing: boolean   │ │
│  │ - currentTask: Task       │ │
│  └───────────────────────────┘ │
│                                 │
│  Methods:                       │
│  - enqueue(task)                │
│  - processNext()                │
│  - isEmpty()                    │
└─────────────────────────────────┘
         │
         ├─ Enqueue ──▶ Add to queue
         ├─ Process ──▶ Execute serially
         └─ Complete ─▶ Process next
```

## Purpose

### Problem Being Solved
LangGraph agents with checkpointing are **not thread-safe**. Concurrent invocations can cause:
- Checkpoint corruption
- Race conditions
- State inconsistencies
- Lost messages

### Solution
TaskQueue serializes all task execution:
1. Tasks are enqueued as they arrive
2. Only one task executes at a time
3. Next task starts only after current completes
4. Maintains FIFO order

## Key Characteristics

### 1. Serial Execution
```typescript
// Only one task executes at a time
Task 1 ──▶ Complete ──▶ Task 2 ──▶ Complete ──▶ Task 3
```

### 2. FIFO Order
First task added is first task processed:
```
Enqueue: [Task A] → [Task B] → [Task C]
Process: Task A → Task B → Task C
```

### 3. Non-Blocking Enqueue
Adding tasks doesn't block caller:
```typescript
taskQueue.enqueue(task);  // Returns immediately
// Task executes asynchronously
```

### 4. Automatic Processing
Queue automatically processes next task when current completes.

## Implementation

### Basic Structure
```typescript
class TaskQueue {
  private queue: Task[] = [];
  private isProcessing = false;
  
  enqueue(task: Task): void {
    this.queue.push(task);
    if (!this.isProcessing) {
      this.processNext();
    }
  }
  
  private async processNext(): Promise<void> {
    if (this.queue.length === 0) {
      this.isProcessing = false;
      return;
    }
    
    this.isProcessing = true;
    const task = this.queue.shift()!;
    
    try {
      await this.executeTask(task);
    } catch (error) {
      logger.error('Task execution failed', error);
    }
    
    // Process next task
    this.processNext();
  }
}
```

### Task Structure
```typescript
interface Task {
  id: string;
  input: string;
  thread_id: string;
  callback: (result: any) => void;
  errorCallback?: (error: any) => void;
}
```

## Usage in AgentWorker

### Task Submission
```typescript
class AgentWorker {
  private taskQueue: TaskQueue;
  
  async execute(task: Task): Promise<void> {
    // Non-blocking: returns immediately
    this.taskQueue.enqueue({
      id: task.id,
      input: task.input,
      thread_id: task.thread_id || generateThreadId(),
      callback: (result) => {
        this.events.emit('taskComplete', {
          input: task.input,
          result: result,
          content: result.content
        });
      },
      errorCallback: (error) => {
        logger.error('Task failed', error);
      }
    });
  }
}
```

### Task Execution
```typescript
private async executeTask(task: Task): Promise<void> {
  try {
    // Call agent with task input
    const result = await this.callAgent(task.input, task.thread_id);
    
    // Invoke success callback
    if (task.callback) {
      task.callback(result);
    }
  } catch (error) {
    // Invoke error callback
    if (task.errorCallback) {
      task.errorCallback(error);
    }
    throw error;
  }
}
```

## Benefits

### 1. Thread Safety
- Prevents concurrent agent invocations
- Protects checkpoint integrity
- Eliminates race conditions

### 2. Simplicity
- Straightforward FIFO logic
- Easy to understand and debug
- Minimal overhead

### 3. Reliability
- Guaranteed execution order
- No task loss
- Predictable behavior

### 4. Resource Management
- Prevents resource exhaustion
- Controls concurrency naturally
- Bounded memory usage (queue size)

## Limitations

### 1. No Parallelism
Cannot execute multiple tasks simultaneously:
```
❌ Task 1 ──┐
            ├──▶ All parallel
❌ Task 2 ──┤
            ├──▶ 
❌ Task 3 ──┘

✅ Task 1 ──▶ Task 2 ──▶ Task 3 (Serial)
```

### 2. Throughput Bottleneck
- Single-threaded execution limits throughput
- Long-running tasks block queue
- High-load scenarios may require multiple workers

### 3. No Priority
All tasks treated equally, no prioritization:
```
Queue: [Low Priority] [High Priority] [Low Priority]
       ↑ This executes first (FIFO)
```

### 4. No Timeout
Tasks can potentially run indefinitely without timeout.

## Advanced Patterns

### Task Timeout
```typescript
private async executeTask(task: Task): Promise<void> {
  const TIMEOUT = 30000; // 30 seconds
  
  const timeoutPromise = new Promise((_, reject) => {
    setTimeout(() => reject(new Error('Task timeout')), TIMEOUT);
  });
  
  const taskPromise = this.callAgent(task.input, task.thread_id);
  
  const result = await Promise.race([taskPromise, timeoutPromise]);
  
  if (task.callback) {
    task.callback(result);
  }
}
```

### Queue Size Limit
```typescript
private readonly MAX_QUEUE_SIZE = 100;

enqueue(task: Task): void {
  if (this.queue.length >= this.MAX_QUEUE_SIZE) {
    throw new Error('Queue is full');
  }
  
  this.queue.push(task);
  if (!this.isProcessing) {
    this.processNext();
  }
}
```

### Queue Metrics
```typescript
getMetrics() {
  return {
    queueSize: this.queue.length,
    isProcessing: this.isProcessing,
    tasksProcessed: this.tasksProcessed,
    avgProcessingTime: this.avgProcessingTime
  };
}
```

## Alternatives Considered

### 1. Multiple Workers (Chosen for System)
Run multiple AgentWorker instances:
```typescript
const workers = [
  new AgentWorker(config),
  new AgentWorker(config),
  new AgentWorker(config)
];

// Distribute tasks across workers
const workerIndex = hash(task.id) % workers.length;
workers[workerIndex].execute(task);
```

**Pros**:
- True parallelism
- Higher throughput
- Scales horizontally

**Cons**:
- More complex
- Requires load balancing
- Higher resource usage

### 2. Thread Pool
```typescript
// NOT USED: LangGraph agents are not thread-safe
const threadPool = new ThreadPool(5);
await threadPool.execute(task);
```

**Why Not Used**:
- LangGraph checkpointing is not thread-safe
- Would cause checkpoint corruption

### 3. Promise.all
```typescript
// DANGEROUS: Causes race conditions
await Promise.all(tasks.map(t => this.callAgent(t)));
```

**Why Avoided**:
- Concurrent invocations corrupt state
- Checkpoints get mixed
- Unpredictable results

## Monitoring

### Queue Depth
```typescript
logger.info('Queue metrics', {
  depth: taskQueue.getQueueSize(),
  processing: taskQueue.isProcessing()
});
```

### Processing Time
```typescript
const startTime = Date.now();
await executeTask(task);
const duration = Date.now() - startTime;
logger.info('Task completed', { duration });
```

### Queue Full Events
```typescript
if (queue.length > THRESHOLD) {
  logger.warn('Queue approaching capacity', {
    current: queue.length,
    max: MAX_QUEUE_SIZE
  });
}
```

## Testing

### Unit Tests
```typescript
describe('TaskQueue', () => {
  it('should execute tasks serially', async () => {
    const queue = new TaskQueue();
    const results: number[] = [];
    
    queue.enqueue({ id: '1', execute: async () => results.push(1) });
    queue.enqueue({ id: '2', execute: async () => results.push(2) });
    queue.enqueue({ id: '3', execute: async () => results.push(3) });
    
    await queue.waitUntilEmpty();
    
    expect(results).toEqual([1, 2, 3]);
  });
});
```

## Best Practices

1. **Keep Tasks Small**: Break large operations into smaller tasks
2. **Monitor Queue Depth**: Alert when queue grows too large
3. **Set Timeouts**: Prevent tasks from running indefinitely
4. **Handle Errors**: Always catch and log task errors
5. **Use Multiple Workers**: For high-throughput scenarios

## Related Documentation

- [Queue Management](./queue-management.md) - Detailed queue operations
- [Execution Patterns](./execution-patterns.md) - Serial vs parallel patterns
- [AgentWorker Overview](../README.md)
