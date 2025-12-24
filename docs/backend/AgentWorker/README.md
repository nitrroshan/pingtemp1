# AgentWorker - Task Execution Engine

## Overview
AgentWorker is the execution engine that wraps LangGraph agents, manages task queues, maintains conversation history, and emits completion events.

## Location
`src/worker/AgentWorker/AgentWorker.ts`

## Architecture

```
AgentWorker
├── Agent/           # LangGraph AI agent instance
├── TaskQueue/       # Serialized task execution
├── Messages/        # Conversation history
└── EventEmitter/    # Event-driven communication
```

## Core Components

### [Agent](./Agent/README.md)
The LangGraph-based AI agent that processes tasks and generates responses.

**Key Features**:
- Asynchronous initialization
- LangGraph integration with MemorySaver
- Structured response format
- Error handling

**Documentation**:
- [Agent Overview](./Agent/README.md)
- [Initialization](./Agent/initialization.md)
- [LangGraph Integration](./Agent/langgraph-integration.md)
- [Error Handling](./Agent/error-handling.md)

### [TaskQueue](./TaskQueue/README.md)
Manages serial task execution to maintain context consistency.

**Key Features**:
- Prevents concurrent execution
- Maintains conversation context
- Avoids state conflicts

**Documentation**:
- [TaskQueue Overview](./TaskQueue/README.md)
- [Queue Management](./TaskQueue/queue-management.md)
- [Execution Patterns](./TaskQueue/execution-patterns.md)

### [Messages](./Messages/README.md)
Maintains conversation history across multiple task invocations.

**Key Features**:
- Message format standardization
- History accumulation
- Context persistence

**Documentation**:
- [Messages Overview](./Messages/README.md)
- [History Management](./Messages/history-management.md)
- [Context Persistence](./Messages/context-persistence.md)

### [EventEmitter](./EventEmitter/README.md)
Provides event-driven communication for task completion.

**Key Features**:
- `taskComplete` event emission
- Subscription patterns
- Event data structure

**Documentation**:
- [EventEmitter Overview](./EventEmitter/README.md)
- [Events Reference](./EventEmitter/events.md)
- [Subscription Patterns](./EventEmitter/subscription-patterns.md)

## Constructor

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

## Key Methods

### createTask()
Public method to queue a new task.

```typescript
async createTask(input: string): Promise<void>
```

**Behavior**:
- Enqueues task in TaskQueue
- Returns immediately (non-blocking)
- Actual execution happens asynchronously

### getMessages()
Returns conversation history.

```typescript
getMessages(): any[]
```

## Quick Start

### Basic Usage
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

## Integration with AgentManager

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

### 3. Clean Up Listeners
```typescript
// Remove listener when done
worker.events.off('taskComplete', handler);

// Or use once() for automatic cleanup
worker.events.once('taskComplete', handler);
```

## Performance Considerations

### Serial Execution
Tasks execute one at a time per worker. For parallelism, create multiple workers.

### Memory Growth
Message history grows indefinitely. Consider implementing history pruning for long conversations.

### Thread ID Management
Currently hardcoded to `"1"`. Parameterize for multiple conversation threads.

## Testing

```typescript
describe('AgentWorker', () => {
  it('should execute task and emit event', async () => {
    const agent = new Agent(agentConfig);
    const worker = new AgentWorker(agent);
    
    const eventPromise = new Promise((resolve) => {
      worker.events.once('taskComplete', resolve);
    });
    
    await worker.createTask('Test task');
    
    const result = await eventPromise;
    expect(result.content).toBeDefined();
  });
});
```

## Troubleshooting

### Agent Not Initializing
- Check Azure OpenAI credentials
- Verify deployment name matches
- Ensure API version is correct

### Missing thread_id Error
- Ensure all `agent.invoke()` calls include `{ configurable: { thread_id } }`

### Tasks Not Completing
- Check event subscriptions are set up correctly
- Verify agent is properly initialized
- Review logs for errors

## Related Documentation

- [AgentManager](../agentManager.md)
- [RoleManager](../roleManager.md)
- [MemoryManager](../memoryManager.md)
- [Backend Overview](../README.md)
