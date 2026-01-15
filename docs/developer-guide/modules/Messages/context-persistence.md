# Context Persistence

## Overview
How AgentWorker maintains conversation context across invocations using LangGraph's checkpointing system and in-memory message history.

## Two Context Systems

### 1. In-Memory Messages (AgentWorker)
```typescript
class AgentWorker {
  private messages: Message[] = [];
  
  // Maintained in worker instance
  // Lost on restart
  // Fast access
}
```

### 2. LangGraph Checkpoints (Persisted)
```typescript
const checkpointer = new MemorySaver();

await agent.invoke(
  { messages: this.messages },
  { configurable: { thread_id: '123' } }  // Saved to checkpoint
);
```

## Architecture

```
┌──────────────────────────────────────┐
│         AgentWorker                  │
│                                      │
│  messages: Message[]                 │
│  - In-memory                         │
│  - Fast access                       │
│  - Lost on restart                   │
└──────────┬───────────────────────────┘
           │
           ▼
    agent.invoke({ messages })
           │
           ▼
┌──────────────────────────────────────┐
│      LangGraph Checkpointing         │
│                                      │
│  checkpoint[thread_id] = {           │
│    messages: [...],                  │
│    state: {...}                      │
│  }                                   │
│  - Persisted (MemorySaver)           │
│  - Survives restarts                 │
│  - Slower access                     │
└──────────────────────────────────────┘
```

## thread_id: The Key to Context

### What is thread_id?
A unique identifier that associates messages with a specific conversation thread.

```typescript
const thread_id = '123';

// First invocation
await agent.invoke(
  { messages: [{ role: 'user', content: 'Hello' }] },
  { configurable: { thread_id } }
);
// Checkpoint saved: checkpoint['123'] = { messages: [...] }

// Second invocation (same thread_id)
await agent.invoke(
  { messages: [
    { role: 'user', content: 'Hello' },
    { role: 'ai', content: 'Hi!' },
    { role: 'user', content: 'How are you?' }
  ]},
  { configurable: { thread_id } }
);
// Checkpoint updated: checkpoint['123'] = { messages: [...] }
```

### thread_id Generation
```typescript
import { v4 as uuidv4 } from 'uuid';

// Option 1: UUID
const thread_id = uuidv4();  // '550e8400-e29b-41d4-a716-446655440000'

// Option 2: Task-based
const thread_id = `task-${task.id}`;  // 'task-123'

// Option 3: Role + Timestamp
const thread_id = `${role}-${Date.now()}`;  // 'researcher-1234567890'

// Option 4: User + Session
const thread_id = `${userId}-${sessionId}`;  // 'user1-sess42'
```

### thread_id Best Practices

#### ✅ Do:
```typescript
// Use consistent thread_id for conversation continuity
const thread_id = task.thread_id || generateThreadId();

// Store thread_id with task
task.thread_id = thread_id;

// Log thread_id for debugging
logger.debug('Invoking agent', { thread_id });
```

#### ❌ Don't:
```typescript
// Don't generate new thread_id each time
const thread_id = uuidv4();  // Lost context!

// Don't reuse across different conversations
const thread_id = 'global';  // Mixes contexts!

// Don't use undefined
await agent.invoke(messages, {});  // Error!
```

## Checkpoint Storage

### MemorySaver (Default)
```typescript
import { MemorySaver } from '@langchain/langgraph';

const checkpointer = new MemorySaver();
```

**Characteristics**:
- Stores checkpoints in memory (Map)
- Fast read/write
- **Lost on process restart**
- Good for development

**When to Use**:
- Development/testing
- Short-lived processes
- Non-critical conversations

### Persistent Storage (Production)

For production, use persistent checkpointer:

```typescript
// Example: File-based (hypothetical)
import { FileCheckpointer } from '@langchain/langgraph';

const checkpointer = new FileCheckpointer('./checkpoints');
```

**Characteristics**:
- Persists to disk/database
- Survives restarts
- Slower than memory
- Good for production

**Options**:
- File system
- Redis
- PostgreSQL
- MongoDB

## Context Synchronization

### Problem: Two Sources of Truth

```
AgentWorker.messages:      [msg1, msg2, msg3]
Checkpoint[thread_id]:     [msg1, msg2]
                           ⬆ Out of sync!
```

### Solution: Explicit Synchronization

```typescript
private async callAgent(input: string, thread_id: string): Promise<any> {
  // 1. Update in-memory messages
  this.messages.push({ role: 'user', content: input });
  
  // 2. Invoke agent (automatically updates checkpoint)
  const response = await this.agent.invoke(
    { messages: this.messages },
    { configurable: { thread_id } }
  );
  
  // 3. Update in-memory messages with response
  this.messages.push({ role: 'ai', content: response.content });
  
  // Now synchronized:
  // - AgentWorker.messages: [msg1, msg2, msg3, msg4]
  // - Checkpoint[thread_id]: [msg1, msg2, msg3, msg4]
  
  return response;
}
```

## Checkpoint Recovery

### Restore After Restart

```typescript
class AgentWorker {
  private messages: Message[] = [];
  private checkpointer: Checkpointer;
  
  async restoreContext(thread_id: string): Promise<void> {
    try {
      // Get checkpoint from storage
      const checkpoint = await this.checkpointer.get({
        configurable: { thread_id }
      });
      
      if (!checkpoint) {
        logger.warn('No checkpoint found', { thread_id });
        return;
      }
      
      // Restore messages from checkpoint
      if (checkpoint.channel_values?.messages) {
        this.messages = checkpoint.channel_values.messages;
        
        logger.info('Context restored', {
          thread_id,
          messageCount: this.messages.length
        });
      }
    } catch (error) {
      logger.error('Failed to restore context', {
        thread_id,
        error: error.message
      });
    }
  }
}
```

### Usage
```typescript
// After restart
const worker = new AgentWorker(role, config);

// Restore previous conversation
if (existingThreadId) {
  await worker.restoreContext(existingThreadId);
}

// Continue conversation
await worker.execute(newTask);
```

## Context Lifecycle

### 1. Context Creation
```
New Task → Generate thread_id → Initialize messages → First invoke
                                       ↓
                                 Checkpoint created
```

### 2. Context Growth
```
User Input → Add to messages → Invoke agent → Add response → Update checkpoint
             (in-memory)                        (in-memory)    (persisted)
```

### 3. Context Pruning
```
Too many messages → Prune messages → Invoke agent → Checkpoint updated
                    (in-memory)                      (with pruned)
```

### 4. Context Restoration
```
Process restart → Load checkpoint → Restore messages → Continue
                                    (to memory)
```

### 5. Context Deletion
```
Task complete → Clear checkpoint → Reset messages
                (optional)          (in-memory)
```

## Context Management Patterns

### Pattern 1: Task-Scoped Context
```typescript
class AgentWorker {
  private taskContexts: Map<string, Message[]> = new Map();
  
  execute(task: Task): void {
    const thread_id = task.id;
    
    // Get or create context for this task
    if (!this.taskContexts.has(thread_id)) {
      this.taskContexts.set(thread_id, [{
        role: 'system',
        content: this.systemPrompt
      }]);
    }
    
    // Use task-specific context
    const messages = this.taskContexts.get(thread_id)!;
    // ... invoke agent with messages ...
  }
  
  clearTaskContext(taskId: string): void {
    this.taskContexts.delete(taskId);
  }
}
```

### Pattern 2: Session-Scoped Context
```typescript
class AgentWorker {
  private sessionContext: Message[] = [];
  
  startSession(): string {
    const sessionId = uuidv4();
    this.sessionContext = [{
      role: 'system',
      content: this.systemPrompt
    }];
    return sessionId;
  }
  
  endSession(): void {
    this.sessionContext = [];
  }
}
```

### Pattern 3: Global Context
```typescript
// Single shared context (not recommended)
class AgentWorker {
  private messages: Message[] = [];  // Shared across all tasks
  
  execute(task: Task): void {
    // All tasks share same context
    // Can lead to confusion
  }
}
```

## Checkpoint Operations

### Get Checkpoint
```typescript
async getCheckpoint(thread_id: string): Promise<Checkpoint | null> {
  return await this.checkpointer.get({
    configurable: { thread_id }
  });
}
```

### List Checkpoints
```typescript
async listCheckpoints(): Promise<string[]> {
  // Implementation depends on checkpointer
  // MemorySaver doesn't provide this
  // Custom implementation:
  return Array.from(this.checkpointer.storage.keys());
}
```

### Clear Checkpoint
```typescript
async clearCheckpoint(thread_id: string): Promise<void> {
  await this.checkpointer.delete({
    configurable: { thread_id }
  });
  
  logger.info('Checkpoint cleared', { thread_id });
}
```

### Update Checkpoint Manually
```typescript
// Not recommended - let LangGraph handle it
// But possible if needed:
async updateCheckpoint(thread_id: string, messages: Message[]): Promise<void> {
  await this.checkpointer.put({
    configurable: { thread_id }
  }, {
    channel_values: { messages },
    version: Date.now()
  });
}
```

## Context Isolation

### Per-Worker Isolation
```typescript
// Each worker has isolated context
const worker1 = new AgentWorker('researcher', config);
const worker2 = new AgentWorker('developer', config);

worker1.execute(task1);  // Context isolated to worker1
worker2.execute(task2);  // Context isolated to worker2
```

### Per-Thread Isolation
```typescript
// Same worker, different threads
const worker = new AgentWorker('researcher', config);

worker.execute({ ...task1, thread_id: 'thread-1' });
worker.execute({ ...task2, thread_id: 'thread-2' });

// Contexts are isolated by thread_id
```

## Troubleshooting

### Context Not Persisting

**Problem**:
```typescript
// Restart process
const worker = new AgentWorker(role, config);
await worker.execute(task);
// Context lost!
```

**Solution**:
```typescript
// Use persistent checkpointer
const checkpointer = new FileCheckpointer('./checkpoints');

// Restore context on restart
await worker.restoreContext(thread_id);
```

### Context Corruption

**Problem**:
```
Concurrent invocations with same thread_id
→ Race condition
→ Checkpoint corrupted
```

**Solution**:
```typescript
// Use TaskQueue to serialize invocations
this.taskQueue.enqueue(task);  // Serialized execution
```

### Context Drift

**Problem**:
```
AgentWorker.messages !== Checkpoint[thread_id].messages
```

**Solution**:
```typescript
// Always invoke with current messages
await this.agent.invoke(
  { messages: this.messages },  // Current state
  { configurable: { thread_id } }
);

// Update messages after response
this.messages.push(response);
```

### Missing thread_id

**Problem**:
```
Error: configurable.thread_id is required
```

**Solution**:
```typescript
// Always provide thread_id
const thread_id = task.thread_id || generateThreadId();

await this.agent.invoke(
  { messages },
  { configurable: { thread_id } }  // Required!
);
```

## Best Practices

### 1. Always Use thread_id
```typescript
const thread_id = task.thread_id || generateThreadId();
await agent.invoke(messages, { configurable: { thread_id } });
```

### 2. Consistent thread_id Within Conversation
```typescript
// Store thread_id with task
task.thread_id = thread_id;

// Reuse for entire conversation
await agent.invoke(msg1, { configurable: { thread_id } });
await agent.invoke(msg2, { configurable: { thread_id } });
```

### 3. Restore Context After Restart
```typescript
if (task.thread_id) {
  await worker.restoreContext(task.thread_id);
}
```

### 4. Clear Context When Done
```typescript
async completeTask(task: Task): Promise<void> {
  // Execute task
  await this.execute(task);
  
  // Clear checkpoint
  if (task.thread_id) {
    await this.clearCheckpoint(task.thread_id);
  }
}
```

### 5. Log Context State
```typescript
logger.debug('Agent invocation', {
  thread_id,
  messageCount: this.messages.length,
  lastMessage: this.messages[this.messages.length - 1]
});
```

## Testing Context Persistence

### Test Checkpoint Creation
```typescript
test('creates checkpoint on invoke', async () => {
  const worker = new AgentWorker('test', config);
  const thread_id = 'test-thread';
  
  await worker['callAgent']('Hello', thread_id);
  
  const checkpoint = await worker['checkpointer'].get({
    configurable: { thread_id }
  });
  
  expect(checkpoint).toBeDefined();
  expect(checkpoint.channel_values.messages).toHaveLength(3);
});
```

### Test Context Restoration
```typescript
test('restores context from checkpoint', async () => {
  const thread_id = 'test-thread';
  
  // Create context
  const worker1 = new AgentWorker('test', config);
  await worker1['callAgent']('Hello', thread_id);
  
  // Simulate restart
  const worker2 = new AgentWorker('test', config);
  await worker2.restoreContext(thread_id);
  
  expect(worker2['messages'].length).toBeGreaterThan(1);
});
```

## Related Documentation

- [Messages Overview](./README.md)
- [History Management](./history-management.md)
- [Agent LangGraph Integration](../Agent/langgraph-integration.md)
