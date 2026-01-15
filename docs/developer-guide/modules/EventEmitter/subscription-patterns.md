# Subscription Patterns

## Overview
Advanced patterns for subscribing to AgentWorker events, including error handling, retry logic, filtering, and architectural best practices.

## Basic Patterns

### One-Time Subscription (once)

For single-use handlers that auto-remove after execution.

```typescript
worker.events.once('taskComplete', (data) => {
  // Handles only the next taskComplete event
  // Automatically removed after execution
  this.handleTaskComplete(task, data);
});

worker.execute(task);
```

**When to Use**:
- Per-task event handling
- One-off operations
- Prevent memory leaks

**Benefits**:
- Automatic cleanup
- No manual removal needed
- Safe from accumulating listeners

### Persistent Subscription (on)

For handlers that remain active for multiple events.

```typescript
const handler = (data) => {
  logger.info('Task completed', { content: data.content });
  metrics.tasksCompleted++;
};

worker.events.on('taskComplete', handler);

// Execute multiple tasks
worker.execute(task1);
worker.execute(task2);
worker.execute(task3);
// Handler called 3 times

// Cleanup when done
worker.events.off('taskComplete', handler);
```

**When to Use**:
- Logging/monitoring
- Metrics collection
- Global event handling

**Must Remember**:
- Manual cleanup required
- Can cause memory leaks if forgotten

### Pre-Subscription Pattern

Subscribe before executing to avoid race conditions.

```typescript
// ✅ Correct: Subscribe first
worker.events.once('taskComplete', (data) => {
  this.handleComplete(task, data);
});
worker.execute(task);

// ❌ Wrong: Race condition
worker.execute(task);
worker.events.once('taskComplete', (data) => {
  // May miss event if task completes very fast
});
```

## Advanced Patterns

### Scoped Subscription

Create handler with closure over specific context.

```typescript
function executeWithHandler(task: Task): void {
  // Create scoped handler
  const handler = (data) => {
    // Handler has access to `task` from closure
    logger.info('Task completed', {
      taskId: task.id,
      content: data.content
    });
    
    this.updateMemory(task.id, data.content);
  };
  
  // Subscribe
  worker.events.once('taskComplete', handler);
  
  // Execute
  worker.execute(task);
}
```

### Promise-Based Subscription

Wrap event subscription in a Promise for async/await.

```typescript
function executeAndWait(task: Task): Promise<TaskCompleteEventData> {
  return new Promise((resolve, reject) => {
    // Setup timeout
    const timeout = setTimeout(() => {
      reject(new Error('Task timeout'));
    }, 30000);
    
    // Subscribe to completion
    worker.events.once('taskComplete', (data) => {
      clearTimeout(timeout);
      resolve(data);
    });
    
    // Subscribe to error
    worker.events.once('taskError', (error) => {
      clearTimeout(timeout);
      reject(new Error(error.error));
    });
    
    // Execute
    worker.execute(task);
  });
}

// Usage
try {
  const result = await executeAndWait(task);
  console.log('Completed:', result.content);
} catch (error) {
  console.error('Failed:', error);
}
```

### Multi-Event Subscription

Wait for multiple events.

```typescript
function waitForAnyWorker(workers: AgentWorker[]): Promise<any> {
  return new Promise((resolve) => {
    workers.forEach(worker => {
      worker.events.once('taskComplete', (data) => {
        // First one to complete wins
        resolve(data);
        
        // Remove listeners from other workers
        workers.forEach(w => {
          if (w !== worker) {
            w.events.removeAllListeners('taskComplete');
          }
        });
      });
    });
    
    // Execute on all workers
    workers.forEach(w => w.execute(task));
  });
}
```

### Conditional Subscription

Only handle events matching criteria.

```typescript
worker.events.on('taskComplete', (data) => {
  // Filter by input pattern
  if (data.input.includes('urgent')) {
    this.handleUrgentTask(data);
  }
  
  // Filter by content type
  if (data.content.startsWith('{')) {
    const parsed = JSON.parse(data.content);
    if (parsed.type === 'error') {
      this.handleError(parsed);
    }
  }
});
```

### Retry Pattern

Automatically retry failed tasks.

```typescript
const MAX_RETRIES = 3;
const retryCount = new Map<string, number>();

function executeWithRetry(task: Task): void {
  // Track retries
  if (!retryCount.has(task.id)) {
    retryCount.set(task.id, 0);
  }
  
  // Subscribe to error
  worker.events.once('taskError', (data) => {
    const count = retryCount.get(task.id)! + 1;
    
    if (count < MAX_RETRIES) {
      logger.warn('Task failed, retrying', {
        taskId: task.id,
        attempt: count,
        error: data.error
      });
      
      // Update retry count
      retryCount.set(task.id, count);
      
      // Retry with exponential backoff
      setTimeout(() => {
        executeWithRetry(task);
      }, Math.pow(2, count) * 1000);
    } else {
      logger.error('Task failed after max retries', {
        taskId: task.id,
        attempts: count
      });
      
      // Cleanup
      retryCount.delete(task.id);
      this.handleFinalFailure(task);
    }
  });
  
  // Subscribe to success
  worker.events.once('taskComplete', (data) => {
    logger.info('Task completed', { taskId: task.id });
    retryCount.delete(task.id);
    this.handleSuccess(task, data);
  });
  
  // Execute
  worker.execute(task);
}
```

### Circuit Breaker Pattern

Stop processing after repeated failures.

```typescript
class CircuitBreaker {
  private failures = 0;
  private readonly threshold = 5;
  private readonly timeout = 60000;
  private lastFailTime = 0;
  private isOpen = false;
  
  constructor(private worker: AgentWorker) {
    // Monitor failures
    worker.events.on('taskError', () => {
      this.onFailure();
    });
    
    // Monitor successes
    worker.events.on('taskComplete', () => {
      this.onSuccess();
    });
  }
  
  onFailure(): void {
    this.failures++;
    this.lastFailTime = Date.now();
    
    if (this.failures >= this.threshold) {
      this.isOpen = true;
      logger.error('Circuit breaker opened', {
        failures: this.failures
      });
      
      // Auto-reset after timeout
      setTimeout(() => {
        this.reset();
      }, this.timeout);
    }
  }
  
  onSuccess(): void {
    this.failures = Math.max(0, this.failures - 1);
  }
  
  reset(): void {
    this.failures = 0;
    this.isOpen = false;
    logger.info('Circuit breaker reset');
  }
  
  canExecute(): boolean {
    return !this.isOpen;
  }
}

// Usage
const breaker = new CircuitBreaker(worker);

function executeIfAllowed(task: Task): void {
  if (!breaker.canExecute()) {
    logger.warn('Circuit breaker open, rejecting task');
    return;
  }
  
  worker.execute(task);
}
```

## Event Chaining

### Sequential Execution

Execute tasks one after another.

```typescript
async function executeSequentially(tasks: Task[]): Promise<void> {
  for (const task of tasks) {
    await new Promise((resolve) => {
      worker.events.once('taskComplete', resolve);
      worker.execute(task);
    });
  }
}
```

### Pipeline Pattern

Chain multiple workers.

```typescript
async function pipeline(task: Task): Promise<void> {
  // Stage 1: Research
  const researchResult = await new Promise((resolve) => {
    researchWorker.events.once('taskComplete', resolve);
    researchWorker.execute(task);
  });
  
  // Stage 2: Development (uses research output)
  const devTask = {
    ...task,
    input: `Using research: ${researchResult.content}\nNow develop: ${task.input}`
  };
  
  const devResult = await new Promise((resolve) => {
    devWorker.events.once('taskComplete', resolve);
    devWorker.execute(devTask);
  });
  
  // Stage 3: Testing (uses development output)
  const testTask = {
    ...task,
    input: `Test this code: ${devResult.content}`
  };
  
  await new Promise((resolve) => {
    testWorker.events.once('taskComplete', resolve);
    testWorker.execute(testTask);
  });
}
```

## Event Aggregation

### Collect Multiple Results

```typescript
function executeOnMultipleWorkers(
  task: Task,
  workers: AgentWorker[]
): Promise<TaskCompleteEventData[]> {
  return Promise.all(
    workers.map(worker => 
      new Promise<TaskCompleteEventData>((resolve) => {
        worker.events.once('taskComplete', resolve);
        worker.execute(task);
      })
    )
  );
}

// Usage
const results = await executeOnMultipleWorkers(task, [
  researchWorker,
  devWorker,
  reviewWorker
]);

const combined = results.map(r => r.content).join('\n\n');
```

### Race Pattern

Use first response, ignore others.

```typescript
function executeRace(
  task: Task,
  workers: AgentWorker[]
): Promise<TaskCompleteEventData> {
  return Promise.race(
    workers.map(worker => 
      new Promise<TaskCompleteEventData>((resolve) => {
        worker.events.once('taskComplete', resolve);
        worker.execute(task);
      })
    )
  );
}

// First worker to complete wins
const fastest = await executeRace(task, workers);
```

## Error Handling Patterns

### Graceful Degradation

```typescript
worker.events.once('taskError', async (data) => {
  logger.warn('Task failed, trying fallback', {
    error: data.error
  });
  
  // Try simpler version
  const simplifiedTask = {
    ...task,
    input: `Simplified: ${task.input}`
  };
  
  fallbackWorker.execute(simplifiedTask);
});
```

### Error Notification

```typescript
worker.events.on('taskError', (data) => {
  // Log error
  logger.error('Task failed', {
    taskId: data.taskId,
    error: data.error
  });
  
  // Notify monitoring
  monitoring.trackError({
    worker: worker.role,
    error: data.error,
    timestamp: data.timestamp
  });
  
  // Send alert if critical
  if (isCriticalTask(data.taskId)) {
    alerting.sendAlert({
      severity: 'high',
      message: `Critical task failed: ${data.error}`
    });
  }
});
```

## Testing Patterns

### Mock Event Emission

```typescript
test('handles taskComplete event', () => {
  const worker = new AgentWorker('test', config);
  const handler = jest.fn();
  
  worker.events.on('taskComplete', handler);
  
  // Manually emit event
  worker.events.emit('taskComplete', {
    input: 'test',
    result: {},
    content: 'output'
  });
  
  expect(handler).toHaveBeenCalled();
});
```

### Spy on Events

```typescript
test('emits correct events during execution', async () => {
  const worker = new AgentWorker('test', config);
  
  const events: string[] = [];
  
  worker.events.on('taskComplete', () => events.push('complete'));
  worker.events.on('taskError', () => events.push('error'));
  
  await worker.execute(task);
  
  expect(events).toContain('complete');
  expect(events).not.toContain('error');
});
```

### Wait for Event

```typescript
async function waitForEvent(
  emitter: EventEmitter,
  event: string,
  timeout: number = 5000
): Promise<any> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timeout waiting for ${event}`));
    }, timeout);
    
    emitter.once(event, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

// Usage in tests
test('emits event within timeout', async () => {
  const data = await waitForEvent(worker.events, 'taskComplete', 1000);
  expect(data).toBeDefined();
});
```

## Best Practices

### 1. Use .once() for Per-Task Events

```typescript
// ✅ Good: Auto-cleanup
worker.events.once('taskComplete', handler);

// ❌ Bad: Manual cleanup required
worker.events.on('taskComplete', handler);
// ... must remember to remove
```

### 2. Subscribe Before Executing

```typescript
// ✅ Good: No race condition
worker.events.once('taskComplete', handler);
worker.execute(task);

// ❌ Bad: May miss event
worker.execute(task);
worker.events.once('taskComplete', handler);
```

### 3. Handle Both Success and Error

```typescript
worker.events.once('taskComplete', handleSuccess);
worker.events.once('taskError', handleError);
worker.execute(task);
```

### 4. Clean Up Persistent Listeners

```typescript
const handler = (data) => { /* ... */ };

worker.events.on('taskComplete', handler);

// When done
worker.events.off('taskComplete', handler);
```

### 5. Use Timeouts for Promises

```typescript
const result = await Promise.race([
  waitForEvent(worker.events, 'taskComplete'),
  timeout(30000)
]);
```

### 6. Log Event Subscriptions

```typescript
logger.debug('Subscribing to taskComplete', {
  taskId: task.id,
  worker: worker.role
});

worker.events.once('taskComplete', handler);
```

### 7. Avoid Anonymous Functions for Removal

```typescript
// ❌ Bad: Can't remove
worker.events.on('taskComplete', (data) => { /* ... */ });

// ✅ Good: Can remove
const handler = (data) => { /* ... */ };
worker.events.on('taskComplete', handler);
// ... later
worker.events.off('taskComplete', handler);
```

## Related Documentation

- [EventEmitter Overview](./README.md)
- [Event Types](./events.md)
- [AgentWorker](../README.md)
