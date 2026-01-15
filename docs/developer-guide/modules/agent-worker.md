# AgentWorker - Task Execution Engine

## Overview
AgentWorker is the execution engine that wraps LangGraph agents, manages task queues, maintains conversation history, and emits completion events.

## Location
`src/worker/AgentWorker/AgentWorker.ts`

## Architecture

```
AgentWorker
├── Agent (LangGraph)     # AI agent instance
├── TaskQueue             # Serialized task execution
├── Messages[]            # Conversation history
└── EventEmitter          # Event-driven communication
```

## Responsibilities

### 1. Agent Initialization
Awaits agent readiness before processing tasks.

### 2. Task Queue Management
Ensures tasks execute serially to maintain context consistency.

### 3. Message History
Maintains conversation context across multiple task invocations.

### 4. Event Emission
Emits `taskComplete` events when tasks finish.

### 5. Error Handling
Gracefully handles agent initialization and invocation failures.

## Key Components

### Constructor
```typescript
constructor(agentInstance: Agent)
```

**Process**:
1. Starts agent initialization (async)
2. Creates empty task queue
3. Initializes message history
4. Sets up event emitter

**Example**:
```typescript
const agent = new Agent(agentConfig);
const worker = new AgentWorker(agent);
```

### Agent Initialization
Agent initialization is asynchronous:

```typescript
private isAgentReady: Promise<any>
this.isAgentReady = agentInstance.initAgent();
```

Agent is awaited lazily on first `callAgent()` invocation.

## Key Methods

### createTask()
Public method to queue a new task.

**Signature**:
```typescript
async createTask(input: string): Promise<void>
```

**Behavior**:
- Enqueues task in TaskQueue
- Returns immediately (non-blocking)
- Actual execution happens asynchronously

**Example**:
```typescript
await worker.createTask("Research AI trends");
// Returns immediately, task executes in background
```

### getMessages()
Returns conversation history.

**Signature**:
```typescript
getMessages(): any[]
```

**Usage**:
```typescript
const history = worker.getMessages();
console.log(history);
// [{ role: 'user', content: '...' }, { role: 'assistant', content: '...' }]
```

### callAgent() (Private)
Core execution method that invokes the LangGraph agent.

**Signature**:
```typescript
private async callAgent(input: string, thread_id: string): Promise<any>
```

**Process**:
```typescript
async callAgent(input: string, thread_id: string): Promise<any> {
  // 1. Wait for agent initialization
  if (!this.agent) {
    this.agent = await this.isAgentReady;
  }
  
  // 2. Add user message to history
  this.messages.push({
    role: 'user',
    content: JSON.stringify(input)
  });
  
  // 3. Invoke agent with full message history
  const response = await this.agent.invoke(
    { messages: this.messages },
    { configurable: { thread_id: thread_id } }
  );
  
  // 4. Extract structured response
  const result = {
    type: response.structuredResponse.type,
    content: response.structuredResponse.content
  };
  
  // 5. Emit completion event
  this.events.emit('taskComplete', {
    input: input,
    result: response,
    content: result.content
  });
  
  return result;
}
```

## Task Queue

AgentWorker uses `TaskQueue` to serialize task execution:

```typescript
import { TaskQueue } from '../util/TaskQueue';

class AgentWorker {
  private taskQueue: TaskQueue;
  
  constructor(agentInstance: Agent) {
    this.taskQueue = new TaskQueue();
  }
  
  async createTask(input: string): Promise<void> {
    await this.taskQueue.enqueue(async () => 
      await this.callAgent(input, "1")
    );
  }
}
```

**Benefits**:
- Prevents concurrent execution per worker
- Maintains conversation context
- Avoids LangGraph state conflicts

**Note**: `thread_id` is hardcoded to `"1"` currently. For multiple conversation threads, parameterize this.

## Event System

### taskComplete Event
Emitted when agent finishes processing a task.

**Event Data**:
```typescript
{
  input: string,        // Original task input
  result: any,          // Full agent response
  content: string       // Extracted content
}
```

**Subscription Example**:
```typescript
worker.events.on('taskComplete', (data) => {
  console.log('Task completed:', data.content);
});
```

**One-time Subscription**:
```typescript
worker.events.once('taskComplete', (data) => {
  memoryManager.completeTask(taskId, data.content);
});
```

## Message History Management

### Message Format
```typescript
{
  role: 'user',
  content: string  // JSON stringified input
}
```

### History Accumulation
Messages accumulate across task invocations:

```typescript
// Task 1
worker.createTask("Hello");
// messages = [{ role: 'user', content: '"Hello"' }]

// Task 2
worker.createTask("How are you?");
// messages = [
//   { role: 'user', content: '"Hello"' },
//   { role: 'user', content: '"How are you?"' }
// ]
```

### Context Persistence
Full message history is sent to agent on each invocation:

```typescript
await this.agent.invoke(
  { messages: this.messages },  // All accumulated messages
  { configurable: { thread_id: thread_id } }
);
```

**Implication**: Agent has full conversation context.

**Future Enhancement**: Implement message history pruning for long conversations.

## Integration with LangGraph

### Thread ID Requirement
LangGraph with MemorySaver requires `thread_id`:

```typescript
await this.agent.invoke(
  { messages: this.messages },
  { configurable: { thread_id: "1" } }  // Required!
);
```

**Without thread_id**: Checkpoint errors occur.

### Structured Response
Agent returns structured response per AgentConfig:

```typescript
response = {
  structuredResponse: {
    type: 'result',      // or 'delegate', 'question', etc.
    content: '...'       // Main response content
  },
  // ... other metadata
}
```

## Error Handling

### Agent Initialization Failure
```typescript
if (!this.agent) {
  try {
    this.agent = await this.isAgentReady;
  } catch (initErr) {
    logger.error("Agent initialization failed:", initErr);
    return { error: `Agent initialization failed: ${initErr}` };
  }
}
```

### Agent Invocation Failure
```typescript
try {
  response = await this.agent.invoke(...);
} catch (invokeErr) {
  logger.error("Agent invoke failed:", invokeErr);
  return { 
    error: `Invocation failed: ${invokeErr}` 
  };
}
```

### Invalid Response
```typescript
if (!response) {
  logger.warn("Agent returned undefined/null response");
  return { error: "No response from agent" };
}
```

## Usage Examples

### Basic Task Execution
```typescript
const agentConfig = {
  role: "Researcher",
  goal: "Research topics thoroughly",
  systemPrompt: "You are a research specialist...",
  responseFormat: z.object({
    type: z.enum(['result', 'question']),
    content: z.string()
  })
};

const agent = new Agent(agentConfig);
const worker = new AgentWorker(agent);

// Subscribe to completion
worker.events.on('taskComplete', (data) => {
  console.log('Task completed:', data.content);
});

// Execute task
await worker.createTask("Research AI trends in 2024");
```

### Multiple Tasks with Context
```typescript
const worker = new AgentWorker(agent);

// Task 1
await worker.createTask("What is machine learning?");

// Task 2 (has context from Task 1)
await worker.createTask("Give me an example");

// Agent sees both messages in history
```

### Integration with AgentManager
```typescript
class AgentManager {
  async assignTasksToWorkers(tasks: Task[]): Promise<void> {
    for (const task of tasks) {
      const worker = this.roleManager.roleWorkers[task.assigned_role];
      
      // Subscribe to completion
      worker.events.once('taskComplete', (data) => {
        this.memoryManager.completeTask(task.id, data.content);
      });
      
      // Execute (non-blocking)
      worker.createTask(task.description);
    }
  }
}
```

## Best Practices

### 1. Subscribe Before Execution
```typescript
// ✅ Correct
worker.events.once('taskComplete', handler);
worker.createTask(task);

// ❌ Wrong (may miss event)
worker.createTask(task);
worker.events.once('taskComplete', handler);
```

### 2. Use Once for One-time Events
```typescript
// One task = one completion
worker.events.once('taskComplete', handler);

// Multiple tasks = multiple completions
worker.events.on('taskComplete', handler);
```

### 3. Handle Errors Gracefully
```typescript
worker.events.on('taskComplete', (data) => {
  if (data.result.error) {
    logger.error('Task failed:', data.result.error);
    memoryManager.updateTaskStatus(taskId, 'failed');
  } else {
    memoryManager.completeTask(taskId, data.content);
  }
});
```

### 4. Clean Up Listeners
```typescript
// Remove listener when done
worker.events.off('taskComplete', handler);

// Or use once() for automatic cleanup
worker.events.once('taskComplete', handler);
```

## Testing

### Unit Test Example
```typescript
describe('AgentWorker', () => {
  it('should execute task and emit event', async () => {
    const agentConfig = { /* ... */ };
    const agent = new Agent(agentConfig);
    const worker = new AgentWorker(agent);
    
    const eventPromise = new Promise((resolve) => {
      worker.events.once('taskComplete', (data) => {
        resolve(data);
      });
    });
    
    await worker.createTask('Test task');
    
    const result = await eventPromise;
    expect(result.content).toBeDefined();
  });
  
  it('should maintain message history', async () => {
    const worker = new AgentWorker(agent);
    
    await worker.createTask('First message');
    expect(worker.getMessages()).toHaveLength(1);
    
    await worker.createTask('Second message');
    expect(worker.getMessages()).toHaveLength(2);
  });
});
```

## Debugging

### Enable Verbose Logging
```typescript
import { Logger } from 'tslog';
const logger = new Logger({ name: "AgentWorker", minLevel: "debug" });
```

### Inspect Message History
```typescript
const messages = worker.getMessages();
console.log('Message history:', messages);
```

### Monitor Events
```typescript
worker.events.on('taskComplete', (data) => {
  console.log('Task completed:', {
    input: data.input,
    type: data.result.structuredResponse?.type,
    contentLength: data.content?.length
  });
});
```

### Check Agent Status
```typescript
// After first task
console.log('Agent initialized:', !!worker['agent']);
console.log('Queue length:', worker['taskQueue']['queue'].length);
```

## Performance Considerations

### Serial Execution
Tasks execute one at a time per worker:
```typescript
worker.createTask('Task 1');  // Starts immediately
worker.createTask('Task 2');  // Waits for Task 1
worker.createTask('Task 3');  // Waits for Task 2
```

**For Parallelism**: Create multiple workers.

### Memory Growth
Message history grows indefinitely:
```typescript
// After 100 tasks
worker.getMessages().length === 100
```

**Solution**: Implement history pruning:
```typescript
private pruneHistory(maxMessages: number = 50): void {
  if (this.messages.length > maxMessages) {
    this.messages = this.messages.slice(-maxMessages);
  }
}
```

### Thread ID Management
Currently hardcoded to `"1"`. For multiple contexts:
```typescript
async createTask(input: string, threadId?: string): Promise<void> {
  const tid = threadId || this.defaultThreadId;
  await this.taskQueue.enqueue(async () => 
    await this.callAgent(input, tid)
  );
}
```

## Future Enhancements

1. **Configurable Thread IDs**: Support multiple conversation threads
2. **Message Pruning**: Limit history to prevent memory growth
3. **Streaming Responses**: Real-time output streaming
4. **Task Cancellation**: Abort running tasks
5. **Retry Logic**: Automatic retry on failure
6. **Task Priority**: Execute high-priority tasks first
7. **Timeout Handling**: Fail tasks that exceed time limit
8. **Metrics Collection**: Track execution time, success rate, etc.

## Related Files

- [Agent](./agent.md)
- [AgentConfig](./agentConfig.md)
- [TaskQueue](./util/taskQueue.md)
- [AgentManager](./agentManager.md)
- [IAgentWorker Interface](../../src/worker/AgentWorker/IAgentWorker.ts)
