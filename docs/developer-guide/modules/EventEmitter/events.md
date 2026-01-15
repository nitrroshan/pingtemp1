# Event Types and Data Structures

## Overview
Comprehensive reference for all event types emitted by AgentWorker, including event data structures, when they're emitted, and usage examples.

## Event Catalog

### taskComplete

**Description**: Emitted when a task execution completes successfully.

**Timing**: After agent.invoke() returns and content is extracted.

**Frequency**: Once per task execution.

#### Data Structure
```typescript
interface TaskCompleteEventData {
  input: string;          // Original task input
  result: any;            // Raw agent response object
  content: string;        // Extracted content as string
}
```

#### Example Data
```typescript
{
  input: "Create a user registration API endpoint",
  result: {
    structuredResponse: {
      type: "code",
      files: [
        {
          path: "src/api/user.ts",
          content: "export async function registerUser..."
        }
      ]
    },
    content: "I've created the user registration endpoint...",
    raw: { /* LangGraph response */ }
  },
  content: '{"type":"code","files":[{"path":"src/api/user.ts","content":"export async..."}]}'
}
```

#### Emission Code
```typescript
this.taskQueue.enqueue({
  id: task.id,
  input: task.input,
  thread_id: task.thread_id,
  callback: (result) => {
    const content = this.extractContent(result);
    
    this.events.emit('taskComplete', {
      input: task.input,
      result: result,
      content: content
    });
  }
});
```

#### Subscription Example
```typescript
worker.events.once('taskComplete', (data: TaskCompleteEventData) => {
  logger.info('Task completed', {
    inputLength: data.input.length,
    contentLength: data.content.length
  });
  
  // Update memory
  this.memoryManager.updateTask(taskId, {
    status: 'completed',
    output_data: data.content
  });
});
```

### taskError

**Description**: Emitted when a task execution fails.

**Timing**: When agent.invoke() throws an error or callAgent fails.

**Frequency**: Once per task failure.

#### Data Structure
```typescript
interface TaskErrorEventData {
  taskId: string;         // Task identifier
  input: string;          // Original task input
  error: string;          // Error message
  stack?: string;         // Optional stack trace
  timestamp: number;      // Error occurrence time
}
```

#### Example Data
```typescript
{
  taskId: "task-123",
  input: "Create user API",
  error: "Agent initialization failed: API key invalid",
  stack: "Error: Agent initialization failed\n  at AgentWorker.callAgent...",
  timestamp: 1640995200000
}
```

#### Emission Code
```typescript
this.taskQueue.enqueue({
  id: task.id,
  input: task.input,
  thread_id: task.thread_id,
  callback: (result) => {
    // Success handler
  },
  errorCallback: (error) => {
    this.events.emit('taskError', {
      taskId: task.id,
      input: task.input,
      error: error.message,
      stack: error.stack,
      timestamp: Date.now()
    });
  }
});
```

#### Subscription Example
```typescript
worker.events.once('taskError', (data: TaskErrorEventData) => {
  logger.error('Task failed', {
    taskId: data.taskId,
    error: data.error
  });
  
  // Update memory
  this.memoryManager.updateTask(data.taskId, {
    status: 'failed',
    error: data.error
  });
  
  // Retry logic
  if (this.shouldRetry(data.error)) {
    this.retryTask(data.taskId);
  }
});
```

### agentReady

**Description**: Emitted when agent initialization completes.

**Timing**: After lazy initialization succeeds.

**Frequency**: Once per worker lifecycle.

#### Data Structure
```typescript
interface AgentReadyEventData {
  role: string;           // Worker role
  timestamp: number;      // Initialization time
  initDuration: number;   // Time taken to initialize (ms)
}
```

#### Example Data
```typescript
{
  role: "researcher",
  timestamp: 1640995200000,
  initDuration: 1234  // 1.234 seconds
}
```

#### Emission Code
```typescript
private async initializeAgent(): Promise<void> {
  const startTime = Date.now();
  
  this.agent = await createAgent(this.config);
  
  const duration = Date.now() - startTime;
  
  this.events.emit('agentReady', {
    role: this.role,
    timestamp: Date.now(),
    initDuration: duration
  });
}
```

#### Subscription Example
```typescript
worker.events.once('agentReady', (data: AgentReadyEventData) => {
  logger.info('Agent initialized', {
    role: data.role,
    duration: data.initDuration
  });
  
  // Start processing queue
  this.startProcessing();
});
```

### workerIdle

**Description**: Emitted when worker becomes idle (queue empty).

**Timing**: When task queue completes all tasks.

**Frequency**: Each time queue transitions from busy to idle.

#### Data Structure
```typescript
interface WorkerIdleEventData {
  role: string;           // Worker role
  tasksCompleted: number; // Total tasks completed
  timestamp: number;      // Idle transition time
}
```

#### Example Data
```typescript
{
  role: "developer",
  tasksCompleted: 42,
  timestamp: 1640995200000
}
```

#### Emission Code
```typescript
private async processNext(): Promise<void> {
  if (this.queue.length === 0) {
    this.isProcessing = false;
    
    this.events.emit('workerIdle', {
      role: this.role,
      tasksCompleted: this.metrics.tasksCompleted,
      timestamp: Date.now()
    });
    
    return;
  }
  
  // ... process task
}
```

#### Subscription Example
```typescript
worker.events.on('workerIdle', (data: WorkerIdleEventData) => {
  logger.debug('Worker idle', {
    role: data.role,
    completed: data.tasksCompleted
  });
  
  // Assign more tasks
  this.assignTasksToWorker(data.role);
});
```

## Custom Events

### Adding Custom Events

```typescript
// Define event type
interface TaskStartEventData {
  taskId: string;
  input: string;
  timestamp: number;
}

// Emit event
class AgentWorker extends EventEmitter {
  async execute(task: Task): Promise<void> {
    // Emit start event
    this.events.emit('taskStart', {
      taskId: task.id,
      input: task.input,
      timestamp: Date.now()
    } as TaskStartEventData);
    
    // ... execute task
  }
}

// Subscribe
worker.events.on('taskStart', (data: TaskStartEventData) => {
  logger.info('Task started', { taskId: data.taskId });
});
```

### Progress Events

```typescript
interface TaskProgressEventData {
  taskId: string;
  progress: number;  // 0-100
  stage: string;     // Current stage
}

// Emit during execution
this.events.emit('taskProgress', {
  taskId: task.id,
  progress: 50,
  stage: 'Generating code'
});
```

## Event Data Best Practices

### 1. Include Context

Always include enough information for handlers:

```typescript
// ❌ Bad: Not enough context
this.events.emit('taskComplete', { content: 'Done' });

// ✅ Good: Full context
this.events.emit('taskComplete', {
  taskId: task.id,
  input: task.input,
  result: result,
  content: content,
  timestamp: Date.now()
});
```

### 2. Use Typed Interfaces

```typescript
// Define types
interface TaskCompleteEventData {
  input: string;
  result: any;
  content: string;
}

// Use in handler
worker.events.on('taskComplete', (data: TaskCompleteEventData) => {
  // TypeScript knows data structure
  const contentLength = data.content.length;
});
```

### 3. Avoid Large Payloads

```typescript
// ❌ Bad: Large data in event
this.events.emit('taskComplete', {
  input: task.input,
  fullResult: hugeObject,  // Large object
  allMessages: this.messages  // Large array
});

// ✅ Good: Only necessary data
this.events.emit('taskComplete', {
  input: task.input,
  content: extractedContent,  // Just the string
  resultId: result.id  // Reference instead of full object
});
```

### 4. Include Timestamps

```typescript
this.events.emit('taskComplete', {
  input: task.input,
  content: content,
  timestamp: Date.now(),  // Always include timestamp
  duration: Date.now() - startTime
});
```

### 5. Consistent Naming

```
✅ Good:
- taskComplete
- taskError
- taskStart
- agentReady

❌ Bad:
- task_complete (snake_case)
- TaskComplete (PascalCase)
- completedTask (reversed)
```

## Event Data Validation

### Validate Before Emit

```typescript
function emitTaskComplete(data: TaskCompleteEventData): void {
  // Validate
  if (!data.input) {
    throw new Error('Event data missing input');
  }
  if (!data.content) {
    logger.warn('Event data missing content');
  }
  
  // Emit
  this.events.emit('taskComplete', data);
}
```

### Validate in Handler

```typescript
worker.events.on('taskComplete', (data: TaskCompleteEventData) => {
  // Validate received data
  if (!data || typeof data.content !== 'string') {
    logger.error('Invalid event data received');
    return;
  }
  
  // Process
  this.handleComplete(data);
});
```

## Event Data Transformation

### Enrich Event Data

```typescript
worker.events.on('taskComplete', (data: TaskCompleteEventData) => {
  // Enrich with metadata
  const enriched = {
    ...data,
    workerRole: worker.role,
    processedAt: Date.now(),
    contentLength: data.content.length,
    inputLength: data.input.length
  };
  
  // Forward to monitoring
  this.monitoring.trackTaskComplete(enriched);
});
```

### Transform Event Data

```typescript
worker.events.on('taskComplete', (data: TaskCompleteEventData) => {
  // Parse content
  let parsed;
  try {
    parsed = JSON.parse(data.content);
  } catch {
    parsed = { raw: data.content };
  }
  
  // Use parsed data
  this.processResult(parsed);
});
```

## Event Data Serialization

### For Logging

```typescript
worker.events.on('taskComplete', (data: TaskCompleteEventData) => {
  // Serialize for logging
  const logData = {
    input: data.input.substring(0, 100),  // Truncate
    contentLength: data.content.length,
    hasResult: !!data.result,
    timestamp: new Date().toISOString()
  };
  
  logger.info('Task complete', logData);
});
```

### For Storage

```typescript
worker.events.on('taskComplete', (data: TaskCompleteEventData) => {
  // Serialize for database
  const record = {
    task_input: data.input,
    task_output: data.content,
    result_type: typeof data.result,
    created_at: new Date()
  };
  
  await db.tasks.insert(record);
});
```

### For Network Transmission

```typescript
worker.events.on('taskComplete', (data: TaskCompleteEventData) => {
  // Serialize for WebSocket
  const message = JSON.stringify({
    type: 'task_complete',
    data: {
      input: data.input,
      content: data.content
    }
  });
  
  ws.send(message);
});
```

## Event Data Testing

### Test Event Emission

```typescript
test('emits correct event data', async () => {
  const worker = new AgentWorker('test', config);
  
  const eventData = await new Promise((resolve) => {
    worker.events.once('taskComplete', resolve);
    worker.execute(task);
  });
  
  expect(eventData).toMatchObject({
    input: task.input,
    result: expect.any(Object),
    content: expect.any(String)
  });
});
```

### Test Event Data Structure

```typescript
test('event data has required fields', async () => {
  const worker = new AgentWorker('test', config);
  
  const eventData = await new Promise((resolve) => {
    worker.events.once('taskComplete', resolve);
    worker.execute(task);
  });
  
  expect(eventData).toHaveProperty('input');
  expect(eventData).toHaveProperty('result');
  expect(eventData).toHaveProperty('content');
  
  expect(typeof eventData.input).toBe('string');
  expect(typeof eventData.content).toBe('string');
});
```

### Mock Event Data

```typescript
test('handler processes event data correctly', () => {
  const mockData: TaskCompleteEventData = {
    input: 'test input',
    result: { structuredResponse: { type: 'test' } },
    content: '{"type":"test"}'
  };
  
  const handler = jest.fn();
  worker.events.on('taskComplete', handler);
  
  // Emit mock event
  worker.events.emit('taskComplete', mockData);
  
  expect(handler).toHaveBeenCalledWith(mockData);
});
```

## Event Data Documentation

### JSDoc Comments

```typescript
/**
 * Task completion event data
 * 
 * @property {string} input - Original task input text
 * @property {any} result - Raw agent response object from LangGraph
 * @property {string} content - Extracted content as string
 * 
 * @example
 * {
 *   input: "Create API endpoint",
 *   result: { structuredResponse: {...}, content: "..." },
 *   content: '{"type":"code","files":[...]}'
 * }
 */
interface TaskCompleteEventData {
  input: string;
  result: any;
  content: string;
}
```

### README Documentation

Document all event types and their data structures in README or dedicated docs.

## Related Documentation

- [EventEmitter Overview](./README.md)
- [Subscription Patterns](./subscription-patterns.md)
- [AgentWorker](../README.md)
