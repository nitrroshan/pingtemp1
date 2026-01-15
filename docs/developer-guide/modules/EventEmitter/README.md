# EventEmitter Component

## Overview
The EventEmitter provides event-driven communication between AgentWorker and AgentManager, enabling non-blocking task execution and decoupled architecture.

## Architecture

```
┌──────────────────────────────────────┐
│         AgentWorker                  │
│                                      │
│  events: EventEmitter                │
│                                      │
│  execute(task)                       │
│    │                                 │
│    └─▶ taskQueue.enqueue             │
│         │                            │
│         └─▶ callAgent()              │
│              │                       │
│              └─▶ events.emit()       │
└──────────────┬───────────────────────┘
               │
               │ 'taskComplete' event
               │
               ▼
┌──────────────────────────────────────┐
│       AgentManager                   │
│                                      │
│  worker.events.on('taskComplete')    │
│    │                                 │
│    └─▶ updateMemory()                │
│         │                            │
│         └─▶ assignNextTask()         │
└──────────────────────────────────────┘
```

## Node.js EventEmitter

AgentWorker extends Node.js EventEmitter:

```typescript
import { EventEmitter } from 'events';

class AgentWorker extends EventEmitter {
  constructor(role: string, config: AgentConfig) {
    super();  // Initialize EventEmitter
    
    this.role = role;
    this.config = config;
  }
}
```

## Event Types

### taskComplete

Emitted when a task finishes execution (success or failure).

#### Event Data
```typescript
interface TaskCompleteEvent {
  input: string;          // Original task input
  result: any;            // Raw agent response
  content: string;        // Extracted content string
}
```

#### Emission
```typescript
class AgentWorker extends EventEmitter {
  async execute(task: Task): Promise<void> {
    this.taskQueue.enqueue({
      id: task.id,
      input: task.input,
      thread_id: task.thread_id || generateThreadId(),
      callback: (result) => {
        // Extract content
        const content = this.extractContent(result);
        
        // Emit event
        this.events.emit('taskComplete', {
          input: task.input,
          result: result,
          content: content
        });
      }
    });
  }
}
```

#### Subscription
```typescript
class AgentManager {
  async assignTasksToWorkers(): Promise<void> {
    const tasks = await this.memoryManager.getReadyTasks();
    
    for (const task of tasks) {
      const worker = this.roleManager.getWorker(task.assigned_role);
      
      // Subscribe to taskComplete event
      worker.events.once('taskComplete', (data) => {
        logger.info('Task completed', {
          taskId: task.id,
          content: data.content
        });
        
        // Update memory
        this.memoryManager.updateTask(task.id, {
          status: 'completed',
          output_data: data.content
        });
        
        // Mark prerequisites
        this.memoryManager.markPrerequisiteComplete(task.id);
        
        // Assign next tasks
        this.assignTasksToWorkers();
      });
      
      // Execute task (non-blocking)
      worker.execute(task);
    }
  }
}
```

## Event Flow

### Complete Event Lifecycle

```
1. Task Enqueued
   AgentWorker.execute(task)
   └─▶ taskQueue.enqueue(task)

2. Task Processed
   taskQueue.processNext()
   └─▶ executeTask(task)
       └─▶ callAgent(input, thread_id)
           └─▶ agent.invoke(...)

3. Event Emitted
   callback(result)
   └─▶ events.emit('taskComplete', data)

4. Event Handled
   AgentManager receives event
   └─▶ updateMemory()
       └─▶ assignNextTasks()
```

### Sequence Diagram

```
AgentManager         AgentWorker          TaskQueue           Agent
     │                    │                    │                 │
     │──assignTask──────▶ │                    │                 │
     │                    │──enqueue────────▶  │                 │
     │                    │                    │──process──────▶ │
     │                    │                    │                 │
     │                    │                    │ ◀──response──── │
     │                    │ ◀──callback─────── │                 │
     │ ◀──taskComplete─── │                    │                 │
     │──updateMemory──▶   │                    │                 │
     │                    │                    │                 │
```

## Subscription Patterns

### Once: Single-Use Listener

Use `.once()` for one-time events:

```typescript
worker.events.once('taskComplete', (data) => {
  // Handles only the next taskComplete event
  // Automatically removed after execution
  this.handleTaskComplete(task, data);
});

worker.execute(task);
```

**Benefits**:
- Automatic cleanup
- No memory leaks
- Perfect for per-task subscriptions

### On: Persistent Listener

Use `.on()` for multiple events:

```typescript
worker.events.on('taskComplete', (data) => {
  // Handles all taskComplete events
  // Remains registered until removed
  this.handleAllCompletions(data);
});

// Execute multiple tasks
worker.execute(task1);
worker.execute(task2);
worker.execute(task3);
```

**When to Use**:
- Global monitoring
- Logging/metrics
- Multi-task scenarios

**Cleanup Required**:
```typescript
// Remove when done
worker.events.removeListener('taskComplete', handler);

// Or remove all
worker.events.removeAllListeners('taskComplete');
```

### Off: Remove Listener

```typescript
const handler = (data) => {
  logger.info('Task complete', data);
};

// Add listener
worker.events.on('taskComplete', handler);

// Remove listener
worker.events.off('taskComplete', handler);
```

## Non-Blocking Execution

### Why Non-Blocking?

AgentWorker.execute() returns immediately without waiting for completion:

```typescript
async assignTasksToWorkers(): Promise<void> {
  const tasks = await this.memoryManager.getReadyTasks();
  
  for (const task of tasks) {
    const worker = this.getWorker(task.assigned_role);
    
    // Subscribe first
    worker.events.once('taskComplete', (data) => {
      this.handleComplete(task, data);
    });
    
    // Execute (non-blocking - returns immediately)
    worker.execute(task);
    
    // ✅ Continues to next task without waiting
  }
  
  // All tasks executing in parallel (each serialized internally)
}
```

### Blocking vs Non-Blocking

#### ❌ Blocking (Bad)
```typescript
for (const task of tasks) {
  const result = await worker.executeAndWait(task);  // Waits
  this.handleResult(task, result);
  // Next task only starts after this completes
}
// Total time: Sum of all task times
```

#### ✅ Non-Blocking (Good)
```typescript
for (const task of tasks) {
  worker.events.once('taskComplete', (data) => {
    this.handleResult(task, data);
  });
  
  worker.execute(task);  // Returns immediately
  // Next task starts immediately
}
// Total time: Max of all task times (if parallel workers)
```

## Event-Driven Benefits

### 1. Decoupling
```
AgentManager           AgentWorker
     │                      │
     │  (knows nothing  ────│──── (emits events)
     │   about events)      │
     │                      │
     └──── subscribes ──────┘
     
No tight coupling between components
```

### 2. Scalability
```typescript
// Add more subscribers without changing worker
worker.events.on('taskComplete', logger.log);
worker.events.on('taskComplete', metrics.track);
worker.events.on('taskComplete', notifier.send);
```

### 3. Flexibility
```typescript
// Change behavior without modifying worker
if (config.enableNotifications) {
  worker.events.on('taskComplete', notify);
}

if (config.enableLogging) {
  worker.events.on('taskComplete', log);
}
```

### 4. Testability
```typescript
// Easy to test
const spy = jest.fn();
worker.events.on('taskComplete', spy);

await worker.execute(task);

expect(spy).toHaveBeenCalledWith(
  expect.objectContaining({ input: task.input })
);
```

## Error Handling

### Error Events

Emit errors as events:

```typescript
class AgentWorker extends EventEmitter {
  async execute(task: Task): Promise<void> {
    this.taskQueue.enqueue({
      id: task.id,
      input: task.input,
      thread_id: task.thread_id,
      callback: (result) => {
        this.events.emit('taskComplete', { result });
      },
      errorCallback: (error) => {
        // Emit error event
        this.events.emit('taskError', {
          taskId: task.id,
          error: error.message,
          stack: error.stack
        });
      }
    });
  }
}
```

### Handle Errors

```typescript
worker.events.once('taskError', (data) => {
  logger.error('Task failed', {
    taskId: data.taskId,
    error: data.error
  });
  
  // Update memory
  this.memoryManager.updateTask(data.taskId, {
    status: 'failed',
    error: data.error
  });
  
  // Retry or skip
  this.handleTaskFailure(data.taskId);
});
```

### Unhandled Errors

Catch unhandled event emitter errors:

```typescript
worker.events.on('error', (error) => {
  logger.error('Unhandled worker error', error);
});
```

## Event Data Extraction

### Content Extraction

```typescript
private extractContent(result: any): string {
  if (!result) {
    return '';
  }
  
  // Try structured response
  if (result.structuredResponse) {
    return JSON.stringify(result.structuredResponse);
  }
  
  // Try content field
  if (result.content) {
    return result.content;
  }
  
  // Fallback to stringify
  return JSON.stringify(result);
}
```

### Robust Extraction

```typescript
private extractContent(result: any): string {
  try {
    if (!result) {
      return '';
    }
    
    if (result.structuredResponse) {
      if (typeof result.structuredResponse === 'object') {
        return JSON.stringify(result.structuredResponse, null, 2);
      }
      return String(result.structuredResponse);
    }
    
    if (result.content) {
      return String(result.content);
    }
    
    if (typeof result === 'string') {
      return result;
    }
    
    return JSON.stringify(result);
  } catch (error) {
    logger.error('Failed to extract content', error);
    return '[Error extracting content]';
  }
}
```

## Event Monitoring

### Log All Events

```typescript
worker.events.on('taskComplete', (data) => {
  logger.info('Task completed', {
    input: data.input.substring(0, 100),
    contentLength: data.content.length,
    timestamp: Date.now()
  });
});
```

### Metrics Collection

```typescript
const metrics = {
  tasksCompleted: 0,
  totalProcessingTime: 0,
  errors: 0
};

worker.events.on('taskComplete', (data) => {
  metrics.tasksCompleted++;
  metrics.totalProcessingTime += data.duration || 0;
});

worker.events.on('taskError', () => {
  metrics.errors++;
});

// Report metrics
setInterval(() => {
  logger.info('Worker metrics', metrics);
}, 60000);
```

### Event Tracing

```typescript
const EventEmitter = require('events');

class TracedEventEmitter extends EventEmitter {
  emit(event: string, ...args: any[]): boolean {
    logger.trace('Event emitted', {
      event,
      args: args.length,
      listeners: this.listenerCount(event)
    });
    
    return super.emit(event, ...args);
  }
}

class AgentWorker extends TracedEventEmitter {
  // ... automatically traces all events
}
```

## Memory Leaks Prevention

### Problem: Forgotten Listeners

```typescript
// BAD: Listener never removed
for (let i = 0; i < 1000; i++) {
  worker.events.on('taskComplete', (data) => {
    // Handler
  });
}
// Memory leak: 1000 listeners registered
```

### Solution 1: Use .once()

```typescript
// Good: Auto-removed after one invocation
worker.events.once('taskComplete', (data) => {
  // Handler
});
```

### Solution 2: Remove After Use

```typescript
const handler = (data) => {
  // Handle event
  
  // Remove self
  worker.events.off('taskComplete', handler);
};

worker.events.on('taskComplete', handler);
```

### Solution 3: Cleanup on Completion

```typescript
async processTask(task: Task): Promise<void> {
  const handler = (data) => {
    this.handleComplete(task, data);
  };
  
  try {
    worker.events.on('taskComplete', handler);
    worker.execute(task);
  } finally {
    // Cleanup even if error
    worker.events.off('taskComplete', handler);
  }
}
```

### Monitor Listener Count

```typescript
const MAX_LISTENERS = 10;

if (worker.events.listenerCount('taskComplete') > MAX_LISTENERS) {
  logger.warn('Too many listeners', {
    count: worker.events.listenerCount('taskComplete')
  });
}

// Or set max
worker.events.setMaxListeners(MAX_LISTENERS);
```

## Testing

### Test Event Emission

```typescript
test('emits taskComplete on completion', async () => {
  const worker = new AgentWorker('test', config);
  const spy = jest.fn();
  
  worker.events.on('taskComplete', spy);
  
  await worker.execute({
    id: '1',
    input: 'test',
    thread_id: 'thread-1'
  });
  
  // Wait for async execution
  await new Promise(resolve => setTimeout(resolve, 100));
  
  expect(spy).toHaveBeenCalled();
  expect(spy).toHaveBeenCalledWith(
    expect.objectContaining({
      input: 'test',
      content: expect.any(String)
    })
  );
});
```

### Test Event Data

```typescript
test('includes correct data in event', async () => {
  const worker = new AgentWorker('test', config);
  
  const eventData = await new Promise((resolve) => {
    worker.events.once('taskComplete', resolve);
    
    worker.execute({
      id: '1',
      input: 'test input',
      thread_id: 'thread-1'
    });
  });
  
  expect(eventData).toMatchObject({
    input: 'test input',
    result: expect.anything(),
    content: expect.any(String)
  });
});
```

### Test Event Timing

```typescript
test('emits event after task completes', async () => {
  const worker = new AgentWorker('test', config);
  const events: string[] = [];
  
  worker.events.on('taskComplete', () => {
    events.push('complete');
  });
  
  events.push('before');
  worker.execute(task);
  events.push('after');
  
  await worker.taskQueue.waitUntilEmpty();
  
  expect(events).toEqual(['before', 'after', 'complete']);
});
```

## Best Practices

### 1. Use .once() for Single Tasks

```typescript
worker.events.once('taskComplete', handler);  // Auto-cleanup
```

### 2. Remove Persistent Listeners

```typescript
worker.events.on('taskComplete', handler);
// ... use handler ...
worker.events.off('taskComplete', handler);  // Cleanup
```

### 3. Handle Errors

```typescript
worker.events.on('taskError', errorHandler);
worker.events.on('error', uncaughtHandler);
```

### 4. Extract Content Safely

```typescript
const content = this.extractContent(result) || '[Empty response]';
```

### 5. Log Event Activity

```typescript
worker.events.on('taskComplete', (data) => {
  logger.debug('Task complete event', { input: data.input });
});
```

## Related Documentation

- [Events Reference](./events.md) - Detailed event types
- [Subscription Patterns](./subscription-patterns.md) - Advanced patterns
- [AgentWorker Overview](../README.md)
