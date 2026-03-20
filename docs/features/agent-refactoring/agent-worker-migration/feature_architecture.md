# Agent/AgentWorker Migration Architecture

**Date:** January 25, 2026  
**Status:** Planning  
**Blocking:** Task-002 Phase 3 (RoleTaskQueue Integration)

---

## Problem Statement

The codebase has **two parallel agent systems** that need unification:

| System | Path | Used For |
|--------|------|----------|
| **NEW** | `AgentFactory` → `InternalAgent` | Builders (structured output) |
| **OLD** | `RoleManager` → `Agent` → `AgentWorker` | Workers (task execution) |

This creates:
- Duplicated initialization logic
- Inconsistent event patterns
- Cannot inject `RoleTaskQueue` into workers
- Maintenance burden

---

## Current Architecture Analysis

### OLD Path (Workers)

```
RoleManager.startRoleWorkers()
    ↓
Agent (agentManager/Agent.ts)
    - Uses createAgent() directly
    - Initializes AzureChatOpenAI
    - MCP tools inline
    ↓
AgentWorker (AgentWorker/AgentWorker.ts)
    - Wraps Agent
    - Has internal TaskQueue (per-worker)
    - EventEmitter for messages
    - callAgent() for execution
```

**Key characteristics:**
- `Agent` class: ~90 lines, initialization only
- `AgentWorker`: ~170 lines, task queue + execution
- Per-worker `TaskQueue` (not centralized)
- Config via `AgentConfig` interface

### NEW Path (Builders)

```
AgentFactory.create(definition)
    ↓
InternalAgent (agent/internal/InternalAgent.ts)
    - Mode detection (tool vs structured)
    - createModel() for provider abstraction
    - loadTools() for MCP
    - execute() with AsyncGenerator streaming
    - run() for simple execution
```

**Key characteristics:**
- `InternalAgent`: ~600 lines, full execution engine
- YAML-based `AgentDefinition`
- Two modes: tool (workers) and structured (builders)
- Event streaming via AsyncGenerator
- Already supports tool mode

---

## Gap Analysis

| Feature | OLD (AgentWorker) | NEW (InternalAgent) | Resolution |
|---------|-------------------|---------------------|------------|
| Initialization | `Agent.initAgent()` | `initialize()` | ✅ Similar - WorkerPool calls at create |
| Execution | `callAgent()` | `execute()` | ✅ Both exist |
| Task Queue | Per-worker `TaskQueue` | None | ✅ RoleTaskQueue (centralized) |
| Polling | None | None | ✅ WorkerPool polling loop |
| Events | `EventEmitter` | `AsyncGenerator` | ✅ WorkerPool bridges |
| Config | `AgentConfig` interface | `AgentDefinition` | ✅ DefinitionBuilder outputs AgentDefinition |
| Workspace | `AgentWorkspace` | None | ✅ WorkerPool creates per-worker workspace |
| MCP Tools | Inline | `loadTools()` | ✅ Similar |
| Streaming | None | Yes | ✅ Better in new |
| Message History | `this.messages[]` | `MemorySaver` | ✅ LangGraph handles via thread_id |
| Agent Status | None | `setStatus()` | ✅ InternalAgent tracks idle/busy |
| Dispose | N/A | `dispose()` | ✅ Added - cleans up MCP, tools, history, agent |
| Clear History | N/A | `clearConversation()` | ✅ Added - prevents memory leaks if reusing |

---

## Technical Details

### Thread ID Strategy & State Persistence

Each task has a unique `thread_id` for LangGraph checkpointing:

```typescript
// WorkerPool.executeTask()
const thread_id = task.id;  // Task ID = Thread ID
await agent.execute(input, { configurable: { thread_id } });
// LangGraph MemorySaver checkpoints state after each step
```

**How it enables resume:**
1. Worker executes task with `thread_id = task.id`
2. LangGraph `MemorySaver` checkpoints state after each graph step
3. If task fails/interrupts → state preserved with `thread_id`
4. Resume: new worker + same `thread_id` → MemorySaver loads checkpoint
5. Execution continues from last checkpoint

**Why task.id:** 
- Independent conversations per task
- No cross-task memory pollution
- Natural key for checkpoint lookup

### Agent Status Tracking

InternalAgent already has status tracking:

```typescript
// InternalAgent.ts line 128
this.setStatus("idle");  // After initialization
this.setStatus("busy");  // During execution
```

---

## Multi-Turn Conversation: Complete Event Flow

### Scenario: User asks agent to write and review code

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           TASK LIFECYCLE                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  RoleTaskQueue emits 'task:available' for role 'writer'                      │
│    │                                                                         │
│    ▼                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ TURN 1: Write code                                                    │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ AgentManager.processTask(taskId, 'writer')                            │   │
│  │   ├── workerPool.createWorker(taskId, 'writer')                       │   │
│  │   │     ├── AgentFactory.create(definition)                           │   │
│  │   │     └── agent.initialize()                                        │   │
│  │   └── executeTurn(taskId, task.input)                                 │   │
│  │         └── workerPool.executeTask(taskId, input)                     │   │
│  │                                                                        │   │
│  │ InternalAgent.execute({ message, threadId: taskId })                  │   │
│  │   │                                                                    │   │
│  │   ├── yield { type: 'thinking', content: 'Writer is processing...' } │   │
│  │   │     └── WorkerPool.events.emit('thinking', {taskId, ...event})    │   │
│  │   │                                                                    │   │
│  │   ├── yield { type: 'tool_start', tool: 'writeFile', args: {...} }   │   │
│  │   │     └── WorkerPool.events.emit('tool_start', {taskId, ...event})  │   │
│  │   │                                                                    │   │
│  │   ├── yield { type: 'tool_result', tool: 'writeFile', result: '...' }│   │
│  │   │     └── WorkerPool.events.emit('tool_result', {taskId, ...event}) │   │
│  │   │                                                                    │   │
│  │   ├── yield { type: 'message', content: 'Login function created' }   │   │
│  │   │     └── WorkerPool.events.emit('message', {taskId, ...event})     │   │
│  │   │                                                                    │   │
│  │   └── yield { type: 'done', output: { response, toolCalls } }        │   │
│  │         └── WorkerPool.events.emit('done', {taskId, ...event})        │   │
│  │                                                                        │   │
│  │ AgentManager.executeTurn completes:                                   │   │
│  │   └── AgentManager.events.emit('turn:complete', {taskId, output})     │   │
│  │                                                                        │   │
│  │ Worker stays alive in WorkerPool (Map<taskId, agent>)                 │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│    │                                                                         │
│    ▼                                                                         │
│  USER: "Add error handling"                                                  │
│    │                                                                         │
│    ▼                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ TURN 2: Add error handling (same worker)                              │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ AgentManager.continueTask(taskId, "Add error handling")               │   │
│  │   └── executeTurn(taskId, message)                                    │   │
│  │         └── workerPool.executeTask(taskId, message)  // Same agent!   │   │
│  │                                                                        │   │
│  │ InternalAgent.execute({ message, threadId: taskId })  ← SAME thread   │   │
│  │   │                                                                    │   │
│  │   ├── yield { type: 'thinking', content: 'Writer is processing...' } │   │
│  │   ├── yield { type: 'tool_start', tool: 'readFile', args: {...} }    │   │
│  │   ├── yield { type: 'tool_result', tool: 'readFile', result: '...' } │   │
│  │   ├── yield { type: 'tool_start', tool: 'writeFile', args: {...} }   │   │
│  │   ├── yield { type: 'tool_result', tool: 'writeFile', result: '...' }│   │
│  │   ├── yield { type: 'message', content: 'Added try-catch blocks' }   │   │
│  │   └── yield { type: 'done', output: { response, toolCalls } }        │   │
│  │                                                                        │   │
│  │ AgentManager.events.emit('turn:complete', {taskId, output})           │   │
│  │                                                                        │   │
│  │ Worker stays alive (same thread_id, LangGraph memory preserved)       │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│    │                                                                         │
│    ▼                                                                         │
│  USER: "Looks good, complete the task"                                       │
│    │                                                                         │
│    ▼                                                                         │
│  ┌──────────────────────────────────────────────────────────────────────┐   │
│  │ TASK COMPLETE                                                         │   │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ AgentManager.completeTask(taskId, finalResult)                        │   │
│  │   ├── taskQueue.completeTask(taskId, result)                          │   │
│  │   │     └── RoleTaskQueue.emit('task:completed', {taskId, result})    │   │
│  │   ├── workerPool.disposeWorker(taskId)                                │   │
│  │   │     └── agent.dispose()                                           │   │
│  │   └── AgentManager.events.emit('task:completed', {taskId, result})    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Error Scenario: Turn fails but task continues

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  TURN 3: Error occurs                                                        │
│  ├──────────────────────────────────────────────────────────────────────┤   │
│  │ AgentManager.continueTask(taskId, message)                            │   │
│  │   └── executeTurn(taskId, message)                                    │   │
│  │         └── workerPool.executeTask(taskId, message)                   │   │
│  │                                                                        │   │
│  │ InternalAgent.execute({ message, threadId: taskId })                  │   │
│  │   │                                                                    │   │
│  │   ├── yield { type: 'thinking', content: 'Writer is processing...' } │   │
│  │   ├── yield { type: 'tool_start', tool: 'writeFile', args: {...} }   │   │
│  │   │                                                                    │   │
│  │   │ ❌ Error occurs in tool execution                                  │   │
│  │   │                                                                    │   │
│  │   ├── yield { type: 'error', error: 'Permission denied', recoverable }│   │
│  │   │     └── WorkerPool.events.emit('error', {taskId, ...event})       │   │
│  │   │                                                                    │   │
│  │   └── throw error                                                      │   │
│  │                                                                        │   │
│  │ AgentManager.executeTurn catches error:                               │   │
│  │   └── AgentManager.events.emit('turn:error', { taskId, error })       │   │
│  │                                                                        │   │
│  │ Worker stays alive (user can retry or give different instruction)    │   │
│  └──────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  Options for caller:                                                         │
│    A) Retry: AgentManager.continueTask(taskId, "Try again with sudo")       │
│    B) Fail task: AgentManager.failTask(taskId, error)                       │
│         ├── taskQueue.failTask(taskId, error)                               │
│         │     └── RoleTaskQueue.emit('task:failed', {taskId, error})        │
│         └── workerPool.disposeWorker(taskId)                                │
└─────────────────────────────────────────────────────────────────────────────┘
```

### Event Summary

| Event | Source | When | Listener |
|-------|--------|------|----------|
| `thinking` | InternalAgent (yield) | Turn starts | WorkerPool → Socket.IO → Frontend |
| `tool_start` | InternalAgent (yield) | Tool execution begins | WorkerPool → Socket.IO → Frontend |
| `tool_result` | InternalAgent (yield) | Tool execution complete | WorkerPool → Socket.IO → Frontend |
| `message_delta` | InternalAgent (yield) | Streaming text chunk | WorkerPool → Socket.IO → Frontend |
| `message` | InternalAgent (yield) | Final message | WorkerPool → Socket.IO → Frontend |
| `done` | InternalAgent (yield) | Turn complete | WorkerPool → AgentManager |
| `error` | InternalAgent (yield) | Turn error | WorkerPool → AgentManager |
| `turn:complete` | AgentManager | After turn finishes | Socket.IO, Orchestration |
| `turn:error` | AgentManager | After turn fails | Socket.IO, Orchestration |
| `task:completed` | AgentManager | User completes task | Database, Orchestration |
| `task:failed` | AgentManager | Task abandoned | Database, Orchestration |

### State Diagram

```
                    ┌─────────────┐
                    │   IDLE      │
                    │  (no task)  │
                    └──────┬──────┘
                           │ processTask()
                           ▼
                    ┌─────────────┐
        ┌──────────▶│  EXECUTING  │◀──────────┐
        │           │  (turn N)   │           │
        │           └──────┬──────┘           │
        │                  │                  │
        │    ┌─────────────┼─────────────┐    │
        │    ▼             ▼             ▼    │
        │ ┌─────┐    ┌──────────┐    ┌─────┐ │
        │ │done │    │  error   │    │done │ │
        │ │event│    │  event   │    │event│ │
        │ └──┬──┘    └────┬─────┘    └──┬──┘ │
        │    │            │             │     │
        │    ▼            ▼             ▼     │
        │ ┌──────┐   ┌─────────┐   ┌────────┐│
        │ │WAIT  │   │WAIT     │   │COMPLETE││
        │ │INPUT │   │DECISION │   │TASK    ││
        │ └──┬───┘   └────┬────┘   └───┬────┘│
        │    │            │            │      │
        │    │continue    │retry/fail  │      │
        │    │Task()      │            │      │
        └────┘            │            ▼      │
              ┌───────────┘     ┌──────────┐  │
              │                 │ DISPOSED │  │
              │                 │ (cleanup)│  │
              │                 └──────────┘  │
              │                               │
              └───────────────────────────────┘
                      failTask()
```

### Error Handling Strategy

Simple error handling in AgentManager:

```typescript
// AgentManager.executeTurn()
private async executeTurn(taskId: string, input: string): Promise<void> {
  try {
    for await (const event of this.workerPool.executeTask(taskId, input)) {
      // Forward events to socket, logging, etc.
    }
    this.events.emit('turn:complete', { taskId });
  } catch (error) {
    this.events.emit('turn:error', { taskId, error });
    // Don't auto-fail - let caller decide (retry or failTask)
  }
}
```

**No retry logic** - errors emit `turn:error`, caller decides to retry or fail.

### Task Completion API

RoleTaskQueue needs completion methods (add in Phase 1):

```typescript
// RoleTaskQueue additions
completeTask(taskId: string, result: any): void {
  const task = this.taskIndex.get(taskId);
  if (task) {
    task.status = 'completed';
    task.result = result;
    this.emit('task:completed', { taskId, result });
  }
}

failTask(taskId: string, error: Error): void {
  const task = this.taskIndex.get(taskId);
  if (task) {
    task.status = 'failed';
    task.error = error;
    this.emit('task:failed', { taskId, error });
  }
}
```

### Workspace Access

Workspace tools injected in WorkerPool.createWorker():

```typescript
// WorkerPool.createWorker()
async createWorker(taskId: string, role: string): Promise<InternalAgent> {
  const definition = this.definitions.get(role);
  const workerDefinition = { ...definition };
  
  if (this.workspaceConfig) {
    const workspace = new AgentWorkspace(this.workspaceConfig, role);
    const workspaceTools = createWorkspaceTools(workspace);
    workerDefinition.tools = [...(workerDefinition.tools || []), ...workspaceTools];
  }
  
  const agent = await AgentFactory.create(workerDefinition);
  await agent.initialize();
  this.workers.set(taskId, agent);
  return agent;
}
```

**Why tools:** InternalAgent already has `loadTools()` - workspace tools integrate naturally.

### Event Pattern Resolution

**Problem:** EventEmitter (push/fire-forget) vs AsyncGenerator (pull/backpressure)

**Solution:** WorkerPool bridges AsyncGenerator to EventEmitter, AgentManager consumes both:

```typescript
// WorkerPool.executeTask - bridges patterns
async *executeTask(taskId: string, input: string): AsyncGenerator<AgentEvent> {
  const agent = this.workers.get(taskId);
  for await (const event of agent.execute({ message: input, threadId: taskId })) {
    this.events.emit(event.type, { ...event, taskId });  // EventEmitter for Socket.IO
    yield event;  // AsyncGenerator for AgentManager
  }
}

// AgentManager.executeTurn - consumes AsyncGenerator
private async executeTurn(taskId: string, input: string): Promise<void> {
  for await (const event of this.workerPool.executeTask(taskId, input)) {
    // Can process events here if needed
  }
  this.events.emit('turn:complete', { taskId });
}
```

**Pattern Usage:**
| Consumer | Pattern | Why |
|----------|---------|-----|
| AgentManager | AsyncGenerator | Control flow, error handling |
| Socket.IO | EventEmitter (WorkerPool.events) | Push to multiple clients |
| SSE/Streaming API | AsyncGenerator | Backpressure, memory control |
| Orchestration | AgentManager.events | task:completed, turn:complete |

---

## Architecture Decision: WorkerPool as Registry ✅

**Decision:** WorkerPool is a simple registry. AgentManager owns polling and orchestration.

### Separation of Concerns

| Component | Responsibility |
|-----------|----------------|
| **InternalAgent** | Single conversation lifecycle (multi-turn via LangGraph) |
| **WorkerPool** | Registry (taskId → agent) + execution bridge |
| **AgentManager** | Polling loop + orchestration + task lifecycle |

### WorkerPool (Simple Registry ~50 lines)

```typescript
// services/WorkerPool.ts
export class WorkerPool {
  private workers: Map<string, InternalAgent> = new Map();  // taskId → agent
  private definitions: Map<string, AgentDefinition> = new Map();
  private workspaceConfig?: WorkspaceConfig;
  public events: EventEmitter = new EventEmitter();
  
  constructor(workspaceConfig?: WorkspaceConfig) {
    this.workspaceConfig = workspaceConfig;
  }
  
  // Register role definition (for on-demand creation)
  registerRole(role: string, definition: AgentDefinition): void {
    this.definitions.set(role, definition);
  }
  
  // Create worker for new task
  async createWorker(taskId: string, role: string): Promise<InternalAgent> {
    const definition = this.definitions.get(role);
    if (!definition) throw new Error(`Role '${role}' not registered`);
    
    // Clone and add workspace tools if configured
    const workerDefinition = { ...definition };
    if (this.workspaceConfig) {
      const workspace = new AgentWorkspace(this.workspaceConfig, role);
      const workspaceTools = createWorkspaceTools(workspace);
      workerDefinition.tools = [...(workerDefinition.tools || []), ...workspaceTools];
    }
    
    const agent = await AgentFactory.create(workerDefinition);
    await agent.initialize();
    this.workers.set(taskId, agent);
    return agent;
  }
  
  // Get existing worker
  getWorker(taskId: string): InternalAgent | undefined {
    return this.workers.get(taskId);
  }
  
  // Dispose worker when task complete
  async disposeWorker(taskId: string): Promise<void> {
    const agent = this.workers.get(taskId);
    if (agent) {
      await agent.dispose();
      this.workers.delete(taskId);
    }
  }
  
  // Execute and bridge events (AsyncGenerator → EventEmitter)
  async *executeTask(taskId: string, input: string): AsyncGenerator<AgentEvent> {
    const agent = this.workers.get(taskId);
    if (!agent) throw new Error(`No worker for task: ${taskId}`);
    
    for await (const event of agent.execute({ message: input, threadId: taskId })) {
      this.events.emit(event.type, { ...event, taskId });
      yield event;
    }
  }
  
  // Get active task count
  get activeTaskCount(): number {
    return this.workers.size;
  }
}
```

### AgentManager (Owns Polling + Orchestration)

```typescript
// agentManager/AgentManager.ts (relevant additions)
class AgentManager {
  private taskQueue: RoleTaskQueue;
  private workerPool: WorkerPool;
  public events: EventEmitter = new EventEmitter();
  
  start(): void {
    // AgentManager owns the polling loop
    this.taskQueue.on('task:available', ({ role, taskId }) => {
      this.processTask(taskId, role);
    });
  }
  
  private async processTask(taskId: string, role: string): Promise<void> {
    const task = this.taskQueue.poll(role);
    if (!task) return;
    
    // Create worker for new task
    await this.workerPool.createWorker(taskId, role);
    
    // Execute first turn
    await this.executeTurn(taskId, task.input);
  }
  
  // Continue multi-turn conversation
  async continueTask(taskId: string, message: string): Promise<void> {
    if (!this.workerPool.getWorker(taskId)) {
      throw new Error(`No active task: ${taskId}`);
    }
    await this.executeTurn(taskId, message);
  }
  
  private async executeTurn(taskId: string, input: string): Promise<void> {
    try {
      for await (const event of this.workerPool.executeTask(taskId, input)) {
        // Forward to socket, logging, etc.
      }
      this.events.emit('turn:complete', { taskId });
    } catch (error) {
      this.events.emit('turn:error', { taskId, error });
    }
  }
  
  // User explicitly completes task
  async completeTask(taskId: string, result?: any): Promise<void> {
    this.taskQueue.completeTask(taskId, result);
    await this.workerPool.disposeWorker(taskId);
    this.events.emit('task:completed', { taskId, result });
  }
  
  // Task failed - cleanup
  async failTask(taskId: string, error: Error): Promise<void> {
    this.taskQueue.failTask(taskId, error);
    await this.workerPool.disposeWorker(taskId);
    this.events.emit('task:failed', { taskId, error });
  }
}
```

### Benefits of This Approach

1. **WorkerPool is trivial** (~50 lines) - just a Map with create/get/dispose
2. **All orchestration in AgentManager** - single point of control
3. **Easy to pause/resume** - AgentManager controls the polling loop
4. **Easy to test** - WorkerPool is just Map operations + delegation
5. **InternalAgent unchanged** - handles multi-turn naturally via LangGraph

---

## Why This Pattern Works

1. **InternalAgent handles multi-turn naturally** - LangGraph + thread_id = state preserved
2. **WorkerPool is just a registry** - Map<taskId, InternalAgent> with create/get/dispose
3. **AgentManager owns orchestration** - polling, task lifecycle, events
4. **Clear separation** - each component has single responsibility
5. **Easy testing** - mock WorkerPool returns stub agents

### Worker Lifecycle: Create → Execute (multi-turn) → Dispose

```
AgentManager receives task:available event for role "writer"
    ↓
AgentManager.processTask(taskId, role)
    ├── workerPool.createWorker(taskId, 'writer')
    │     ├── AgentFactory.create(definition)
    │     └── agent.initialize()
    └── executeTurn(taskId, input)
          └── workerPool.executeTask(taskId, input)
    ↓
Turn 1 complete → events.emit('turn:complete')
    ↓
User sends more input
    ↓
AgentManager.continueTask(taskId, message)
    └── executeTurn(taskId, message)
          └── workerPool.executeTask(taskId, message)  // Same agent!
    ↓
Turn 2 complete → events.emit('turn:complete')
    ↓
... more turns (same agent, same thread_id) ...
    ↓
User says "complete task"
    ↓
AgentManager.completeTask(taskId)
    ├── taskQueue.completeTask(taskId, result)
    ├── workerPool.disposeWorker(taskId)
    └── events.emit('task:completed')
```

**Key insight:** InternalAgent naturally handles multi-turn via:
- Same agent instance across `execute()` calls
- Same `thread_id` → LangGraph MemorySaver preserves state
- `_conversationHistory` persists between turns

**Resume incomplete task:**
```typescript
// If system restarts, recreate worker with same taskId (= thread_id)
await workerPool.createWorker(taskId, role);
// LangGraph MemorySaver loads checkpoint → continues from last turn
for await (const event of workerPool.executeTask(taskId, input)) { ... }
```

---

## Migration Plan

### Phase 1: Create WorkerPool (Registry)
- Create `services/WorkerPool.ts` (~50 lines)
- Simple registry: `Map<taskId, InternalAgent>`
- Methods: `registerRole()`, `createWorker()`, `getWorker()`, `disposeWorker()`
- `executeTask()` - bridges AsyncGenerator → EventEmitter
- Workspace tools injected at worker creation

### Phase 2: Create DefinitionBuilder
- Create `DefinitionBuilder` (replaces ConfigBuilder)
- Output schema: `AgentDefinition` instead of `AgentConfig`
- Add `mode: 'tool'` for workers, `mode: 'structured'` for builders
- Map: `systemMessage` → `systemPrompt`, add `id` from role

### Phase 3: Create RoleService
- Extract role discovery from RoleManager
- `suggestRoles()` → RoleBuilder
- `generateDefinitions()` → DefinitionBuilder (outputs AgentDefinition)
- Stateless service, no worker registry

### Phase 4: Update AgentManager
- Create single `RoleTaskQueue` instance
- Create `WorkerPool` with `WorkspaceConfig`
- **Own the polling loop**: subscribe to `task:available`
- Add multi-turn API: `continueTask()`, `completeTask()`, `failTask()`
- Use `RoleService` for role discovery
- Subscribe to WorkerPool events for socket forwarding

### Phase 5: Deprecate Old Classes
- Mark `RoleManager` as deprecated
- Mark `Agent` as deprecated
- Mark `AgentWorker` as deprecated
- Remove after validation

---

## RoleManager Future

### Current Responsibilities

| Responsibility | Method | Still Needed? |
|----------------|--------|---------------|
| Role Discovery | `suggestRoles()` → RoleBuilder | ✅ Yes |
| Config Generation | `getRoles()` → ConfigBuilder | ✅ Yes |
| Worker Creation | `startRoleWorkers()` | ⚠️ Moves to WorkerPool |
| Worker Registry | `roleWorkers` map | ⚠️ Moves to WorkerPool |

### Current Migration: Stateless RoleService

For this migration, RoleManager becomes a **stateless service**:

```typescript
// services/RoleService.ts
class RoleService {
  private roleBuilder: RoleBuilder;
  private definitionBuilder: DefinitionBuilder;  // Replaces ConfigBuilder
  
  async suggestRoles(task: string): Promise<AgentRole[]>;
  async generateDefinitions(roles: AgentRole[]): Promise<AgentDefinition[]>;
}
```

**What moves where:**
| From RoleManager | To |
|------------------|-----|
| `suggestRoles()` | RoleService (uses RoleBuilder) |
| `getRoles()` / config generation | RoleService (uses DefinitionBuilder → AgentDefinition) |
| `startRoleWorkers()` | WorkerPool |
| `roleWorkers` registry | WorkerPool |

### Future Vision: TeamBuilder Orchestrator

RoleManager will evolve into a **TeamBuilder** - an orchestrator that uses agents to create team role templates:

```
TeamBuilder (future RoleManager evolution)
    ↓ orchestrates agents to create
    ├── Team templates (predefined role combinations)
    ├── Role templates (reusable role definitions)
    └── Dynamic team composition based on task
```

**Future capabilities (not in this migration):**
- Create team templates (e.g., "Frontend Team", "Data Pipeline Team")
- Store/retrieve role templates
- Suggest optimal team composition for complex tasks
- Manage role dependencies and interactions

**Current scope:** Only extract to stateless RoleService. TeamBuilder evolution is a separate future feature.

---

## Blockers

| Blocker | Impact | Resolution |
|---------|--------|------------|
| ~~AgentConfig vs AgentDefinition~~ | ~~Config format mismatch~~ | ✅ DefinitionBuilder outputs AgentDefinition directly |
| EventEmitter vs AsyncGenerator | Different event patterns | WorkerPool bridges to EventEmitter |
| ~~Workspace support~~ | ~~InternalAgent lacks workspace~~ | ✅ WorkerPool creates AgentWorkspace per worker (branch per role) |
| RoleManager coupling | Tightly coupled to old Agent | Update to use AgentFactory |

---

## Success Criteria

- [ ] Single path for all agents (Factory → InternalAgent/WorkerAgent)
- [ ] RoleTaskQueue injectable into workers
- [ ] Workspace support preserved
- [ ] All existing tests pass
- [ ] Old classes deprecated with migration guide

---

## Files Affected

| File | Change |
|------|--------|
| `services/WorkerPool.ts` | CREATE (agents + polling + events) |
| `services/RoleService.ts` | CREATE (from RoleManager) |
| `services/types.ts` | CREATE |
| `agentBuilder/DefinitionBuilder.ts` | CREATE (replaces ConfigBuilder, outputs AgentDefinition) |
| `agentManager/agentManager.ts` | UPDATE (use services, create RoleTaskQueue) |
| `roleManager/RoleManager.ts` | DEPRECATE |
| `AgentWorker/AgentWorker.ts` | DEPRECATE |
| `agentManager/Agent.ts` | DEPRECATE |
| `agentBuilder/ConfigBuilder.ts` | DEPRECATE (replaced by DefinitionBuilder) |
