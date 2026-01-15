# Queue Management

## Overview
Detailed documentation on TaskQueue internals, including enqueue/dequeue mechanics, task lifecycle, and queue state management.

## Queue Data Structure

### Array-Based Queue
```typescript
class TaskQueue {
  private queue: Task[] = [];
  
  // FIFO operations
  enqueue(task: Task): void {
    this.queue.push(task);  // Add to end
  }
  
  dequeue(): Task | undefined {
    return this.queue.shift();  // Remove from start
  }
}
```

### Why Array?
- Simple and efficient for FIFO
- Good performance for typical queue sizes
- Built-in JavaScript methods

### Alternative: Linked List
```typescript
// More efficient for very large queues
class Node {
  task: Task;
  next: Node | null;
}

class LinkedQueue {
  private head: Node | null = null;
  private tail: Node | null = null;
  
  enqueue(task: Task): void {
    const node = { task, next: null };
    if (!this.tail) {
      this.head = this.tail = node;
    } else {
      this.tail.next = node;
      this.tail = node;
    }
  }
}
```

## Task Lifecycle

### States
```
           ┌──────────┐
           │ Created  │
           └────┬─────┘
                │
                ▼
           ┌──────────┐
           │ Enqueued │◀── Waiting in queue
           └────┬─────┘
                │
                ▼
           ┌──────────┐
           │Processing│◀── Currently executing
           └────┬─────┘
                │
       ┌────────┴────────┐
       ▼                 ▼
  ┌─────────┐      ┌─────────┐
  │Completed│      │ Failed  │
  └─────────┘      └─────────┘
```

### State Tracking
```typescript
interface Task {
  id: string;
  input: string;
  thread_id: string;
  state: 'enqueued' | 'processing' | 'completed' | 'failed';
  enqueuedAt: number;
  startedAt?: number;
  completedAt?: number;
  error?: Error;
}

enqueue(task: Task): void {
  task.state = 'enqueued';
  task.enqueuedAt = Date.now();
  this.queue.push(task);
}

async processNext(): Promise<void> {
  const task = this.queue.shift();
  if (!task) return;
  
  task.state = 'processing';
  task.startedAt = Date.now();
  
  try {
    await this.executeTask(task);
    task.state = 'completed';
    task.completedAt = Date.now();
  } catch (error) {
    task.state = 'failed';
    task.error = error;
    task.completedAt = Date.now();
  }
}
```

## Enqueue Operations

### Basic Enqueue
```typescript
enqueue(task: Task): void {
  this.queue.push(task);
  
  // Start processing if idle
  if (!this.isProcessing) {
    this.processNext();
  }
}
```

### With Validation
```typescript
enqueue(task: Task): void {
  // Validate task
  if (!task.id) {
    throw new Error('Task must have an id');
  }
  if (!task.input) {
    throw new Error('Task must have input');
  }
  
  // Check for duplicates
  if (this.queue.some(t => t.id === task.id)) {
    logger.warn('Duplicate task ignored', { id: task.id });
    return;
  }
  
  // Check capacity
  if (this.queue.length >= this.maxSize) {
    throw new Error('Queue is full');
  }
  
  // Add to queue
  this.queue.push(task);
  this.emit('taskEnqueued', task);
  
  // Start processing
  if (!this.isProcessing) {
    this.processNext();
  }
}
```

### Batch Enqueue
```typescript
enqueueBatch(tasks: Task[]): void {
  tasks.forEach(task => {
    this.queue.push(task);
  });
  
  logger.info('Batch enqueued', { count: tasks.length });
  
  if (!this.isProcessing) {
    this.processNext();
  }
}
```

## Dequeue Operations

### Basic Dequeue
```typescript
private dequeue(): Task | undefined {
  return this.queue.shift();
}
```

### With Logging
```typescript
private dequeue(): Task | undefined {
  const task = this.queue.shift();
  
  if (task) {
    logger.debug('Task dequeued', {
      id: task.id,
      remainingTasks: this.queue.length
    });
    this.emit('taskDequeued', task);
  }
  
  return task;
}
```

### Selective Dequeue
```typescript
// Dequeue specific task (e.g., high priority)
private dequeueById(id: string): Task | undefined {
  const index = this.queue.findIndex(t => t.id === id);
  
  if (index === -1) return undefined;
  
  const [task] = this.queue.splice(index, 1);
  logger.debug('Task dequeued by id', { id });
  
  return task;
}
```

## Processing Loop

### Main Loop
```typescript
private async processNext(): Promise<void> {
  // Base case: empty queue
  if (this.queue.length === 0) {
    this.isProcessing = false;
    this.emit('queueEmpty');
    return;
  }
  
  // Mark as processing
  this.isProcessing = true;
  
  // Get next task
  const task = this.dequeue();
  if (!task) {
    this.processNext();
    return;
  }
  
  // Execute task
  try {
    await this.executeTask(task);
  } catch (error) {
    logger.error('Task execution failed', {
      taskId: task.id,
      error: error.message
    });
  }
  
  // Process next task (tail recursion)
  this.processNext();
}
```

### With Delay Between Tasks
```typescript
private async processNext(): Promise<void> {
  if (this.queue.length === 0) {
    this.isProcessing = false;
    return;
  }
  
  this.isProcessing = true;
  const task = this.dequeue();
  
  if (task) {
    try {
      await this.executeTask(task);
    } catch (error) {
      logger.error('Task failed', error);
    }
    
    // Optional delay between tasks
    if (this.interTaskDelay > 0) {
      await delay(this.interTaskDelay);
    }
  }
  
  this.processNext();
}
```

### With Concurrency Limit
```typescript
// Allow up to N concurrent tasks
private readonly maxConcurrent = 3;
private activeCount = 0;

private async processNext(): Promise<void> {
  // Process multiple tasks up to limit
  while (this.queue.length > 0 && this.activeCount < this.maxConcurrent) {
    const task = this.dequeue();
    if (!task) break;
    
    this.activeCount++;
    
    // Execute without awaiting
    this.executeTask(task)
      .catch(error => logger.error('Task failed', error))
      .finally(() => {
        this.activeCount--;
        this.processNext();  // Check for more work
      });
  }
  
  // Mark idle if no active tasks
  if (this.activeCount === 0 && this.queue.length === 0) {
    this.isProcessing = false;
  }
}
```

## Queue State Management

### State Properties
```typescript
class TaskQueue {
  private queue: Task[] = [];
  private isProcessing = false;
  private currentTask: Task | null = null;
  private taskHistory: Task[] = [];
  private metrics = {
    tasksEnqueued: 0,
    tasksCompleted: 0,
    tasksFailed: 0,
    totalProcessingTime: 0
  };
}
```

### State Queries
```typescript
// Is queue empty?
isEmpty(): boolean {
  return this.queue.length === 0;
}

// Queue size
size(): number {
  return this.queue.length;
}

// Is processing?
isActive(): boolean {
  return this.isProcessing;
}

// Current task
getCurrentTask(): Task | null {
  return this.currentTask;
}

// Pending tasks
getPendingTasks(): Task[] {
  return [...this.queue];
}
```

### State Updates
```typescript
private updateState(task: Task, state: TaskState): void {
  task.state = state;
  
  switch (state) {
    case 'enqueued':
      this.metrics.tasksEnqueued++;
      break;
    case 'processing':
      this.currentTask = task;
      break;
    case 'completed':
      this.metrics.tasksCompleted++;
      this.taskHistory.push(task);
      this.currentTask = null;
      break;
    case 'failed':
      this.metrics.tasksFailed++;
      this.currentTask = null;
      break;
  }
  
  this.emit('stateChanged', { task, state });
}
```

## Capacity Management

### Maximum Queue Size
```typescript
private readonly MAX_QUEUE_SIZE = 1000;

enqueue(task: Task): void {
  if (this.queue.length >= this.MAX_QUEUE_SIZE) {
    throw new Error(`Queue full (max: ${this.MAX_QUEUE_SIZE})`);
  }
  
  this.queue.push(task);
}
```

### With Warning Threshold
```typescript
private readonly WARNING_THRESHOLD = 0.8;

enqueue(task: Task): void {
  if (this.queue.length >= this.MAX_QUEUE_SIZE) {
    throw new Error('Queue full');
  }
  
  this.queue.push(task);
  
  // Warn if approaching capacity
  const utilization = this.queue.length / this.MAX_QUEUE_SIZE;
  if (utilization >= this.WARNING_THRESHOLD) {
    logger.warn('Queue utilization high', {
      size: this.queue.length,
      max: this.MAX_QUEUE_SIZE,
      utilization: `${(utilization * 100).toFixed(1)}%`
    });
  }
}
```

### Auto-Reject on Full
```typescript
enqueue(task: Task): void {
  if (this.queue.length >= this.MAX_QUEUE_SIZE) {
    // Reject immediately instead of throwing
    if (task.errorCallback) {
      task.errorCallback(new Error('Queue is full'));
    }
    logger.error('Task rejected - queue full', { taskId: task.id });
    return;
  }
  
  this.queue.push(task);
}
```

## Task Cancellation

### Cancel by ID
```typescript
cancel(taskId: string): boolean {
  const index = this.queue.findIndex(t => t.id === taskId);
  
  if (index === -1) {
    // Task not in queue (maybe processing or completed)
    return false;
  }
  
  // Remove from queue
  const [task] = this.queue.splice(index, 1);
  
  // Notify cancellation
  if (task.errorCallback) {
    task.errorCallback(new Error('Task cancelled'));
  }
  
  logger.info('Task cancelled', { taskId });
  this.emit('taskCancelled', task);
  
  return true;
}
```

### Cancel All
```typescript
cancelAll(): void {
  const tasks = [...this.queue];
  this.queue = [];
  
  tasks.forEach(task => {
    if (task.errorCallback) {
      task.errorCallback(new Error('Task cancelled'));
    }
  });
  
  logger.info('All tasks cancelled', { count: tasks.length });
  this.emit('allTasksCancelled', tasks);
}
```

### Cancel with Condition
```typescript
cancelIf(predicate: (task: Task) => boolean): number {
  const cancelled: Task[] = [];
  
  this.queue = this.queue.filter(task => {
    if (predicate(task)) {
      cancelled.push(task);
      if (task.errorCallback) {
        task.errorCallback(new Error('Task cancelled'));
      }
      return false;  // Remove from queue
    }
    return true;  // Keep in queue
  });
  
  logger.info('Tasks cancelled conditionally', { count: cancelled.length });
  return cancelled.length;
}

// Usage
taskQueue.cancelIf(task => task.priority < 5);
```

## Queue Persistence

### Save to Storage
```typescript
async persist(): Promise<void> {
  const state = {
    queue: this.queue,
    isProcessing: this.isProcessing,
    metrics: this.metrics,
    timestamp: Date.now()
  };
  
  await fs.writeFile(
    './queue-state.json',
    JSON.stringify(state, null, 2)
  );
}
```

### Restore from Storage
```typescript
async restore(): Promise<void> {
  try {
    const data = await fs.readFile('./queue-state.json', 'utf-8');
    const state = JSON.parse(data);
    
    this.queue = state.queue;
    this.metrics = state.metrics;
    
    logger.info('Queue restored', {
      taskCount: this.queue.length,
      savedAt: new Date(state.timestamp)
    });
    
    // Resume processing
    if (this.queue.length > 0) {
      this.processNext();
    }
  } catch (error) {
    logger.warn('Failed to restore queue', error);
  }
}
```

## Best Practices

### 1. Always Handle Errors
```typescript
try {
  await this.executeTask(task);
} catch (error) {
  logger.error('Task failed', error);
  // Continue processing next task
}
```

### 2. Validate Task Input
```typescript
enqueue(task: Task): void {
  validateTask(task);  // Throw if invalid
  this.queue.push(task);
}
```

### 3. Limit Queue Growth
```typescript
if (this.queue.length > MAX_SIZE) {
  throw new Error('Queue capacity exceeded');
}
```

### 4. Emit Events
```typescript
this.emit('taskEnqueued', task);
this.emit('taskCompleted', task);
this.emit('taskFailed', { task, error });
```

### 5. Monitor Queue Health
```typescript
setInterval(() => {
  logger.info('Queue metrics', this.getMetrics());
}, 60000);
```

## Related Documentation

- [TaskQueue Overview](./README.md)
- [Execution Patterns](./execution-patterns.md)
- [AgentWorker](../README.md)
