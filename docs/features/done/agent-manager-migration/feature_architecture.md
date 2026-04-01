# AgentManager Migration Architecture

**Date:** January 26, 2026  
**Status:** ✅ Complete  
**Goal:** Unify agent systems and implement clean orchestration layer

---

## Overview

This migration unifies two parallel agent systems (OLD: `RoleManager` → `Agent` → `AgentWorker` and NEW: `AgentFactory` → `InternalAgent`) into a single, clean orchestration path.

---

## Target Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              AgentManager                                    │
│  ┌──────────────────┐  ┌─────────────┐  ┌─────────────┐                     │
│  │ DefinitionBuilder│  │ WorkerPool  │  │   Events    │                     │
│  └────────┬─────────┘  └──────┬──────┘  └──────┬──────┘                     │
└───────────┼───────────────────┼────────────────┼────────────────────────────┘
            │                   │                │
            ▼                   ▼                ▼
   ┌─────────────────┐ ┌─────────────────┐ ┌──────────────┐
   │ InternalAgent   │ │ InternalAgent   │ │ Socket.IO    │
   │ (structured)    │ │ (tool mode)     │ │ Frontend     │
   └─────────────────┘ └─────────────────┘ └──────────────┘
```

**Simplified Flow (No TaskQueue for now):**
- DefinitionBuilder: One-shot LLM call → outputs `AgentDefinition[]` directly
- WorkerPool: Manages active workers
- AgentManager: Orchestrates workflow + events

---

## Components

### 1. DefinitionBuilder (`services/DefinitionBuilder.ts`)

**One-shot LLM agent** that analyzes a task and outputs complete `AgentDefinition[]`.

Replaces: `RoleBuilder` + `ConfigBuilder` (combined into single call)

```typescript
interface DefinitionBuilder {
  // One-shot: task → AgentDefinition[]
  generateDefinitions(task: string): Promise<AgentDefinition[]>;
}
```

**How it works:**
- Uses InternalAgent in structured output mode
- Schema: `AgentDefinitionListSchema` (array of AgentDefinition)
- Single LLM call analyzes task and outputs all needed agent definitions

**Output Example:**
```typescript
[
  {
    id: "developer",
    name: "Developer",
    type: "internal",
    role: "developer",
    systemPrompt: "You are a senior developer...",
    config: {
      model: { provider: "azure-openai" },
      tools: []  // WorkerPool adds workspace tools
    }
  },
  {
    id: "reviewer", 
    name: "Code Reviewer",
    type: "internal",
    role: "reviewer",
    systemPrompt: "You are a code reviewer...",
    config: { model: { provider: "azure-openai" } }
  }
]
```

### 2. WorkerPool (`services/WorkerPool.ts`)

Simple registry for managing active workers (agents assigned to tasks).

```typescript
interface WorkerPool {
  // Definition cache
  registerDefinition(definition: AgentDefinition): void;
  
  // Worker lifecycle
  createWorker(taskId: string, role: string): Promise<InternalAgent>;
  getWorker(taskId: string): InternalAgent | undefined;
  disposeWorker(taskId: string): Promise<void>;
  
  // Execution
  executeTask(taskId: string, input: AgentInput): Promise<ExecutionResult>;
  
  // Status
  activeWorkerCount: number;
  events: EventEmitter;
}
```

**Key Features:**
- `Map<taskId, InternalAgent>` for active workers
- `Map<role, AgentDefinition>` for cached definitions
- Bridges AsyncGenerator events to EventEmitter for Socket.IO

### 3. Updated AgentManager (`agentManager/AgentManager.ts`)

Orchestrates the full workflow with multi-turn support.

```typescript
class AgentManager {
  // Dependencies
  private definitionBuilder: DefinitionBuilder;
  private workerPool: WorkerPool;
  private memoryManager: MemoryManager;
  public events: EventEmitter;
  
  // Workflow
  configureNewWorkflow(task: string): Promise<AgentDefinition[]>;
  
  // Multi-turn
  processTask(taskId: string, role: string, input: string): Promise<any>;
  continueTask(taskId: string, message: string): Promise<any>;
  
  // Completion
  completeTask(taskId: string, result: any): Promise<void>;
  failTask(taskId: string, error: string): Promise<void>;
}
```

---

## Data Flow

### Task Execution Flow

```
1. User submits task
   │
   ▼
2. AgentManager.configureNewWorkflow(task)
   ├── DefinitionBuilder.generateDefinitions(task) → AgentDefinition[]
   └── WorkerPool.registerDefinition(def) for each
   │
   ▼
3. For each task/role:
   AgentManager.processTask(taskId, role, input)
   ├── WorkerPool.createWorker(taskId, role)
   └── WorkerPool.executeTask(taskId, input)
       └── InternalAgent.execute() yields events
   │
   ▼
4. Events stream to Socket.IO → Frontend
   │
   ▼
5. Multi-turn (optional):
   AgentManager.continueTask(taskId, userMessage)
   └── Same worker, same thread_id
   │
   ▼
6. Completion:
   AgentManager.completeTask(taskId, result)
   └── WorkerPool.disposeWorker(taskId)
```

### Event Flow (Direct Subscription)

Socket.IO subscribes directly to WorkerPool events - no relay through AgentManager.

```
InternalAgent.execute()          WorkerPool.events         Socket.IO
      │                              │                         │
      │─── yield { thinking } ──────▶│                         │
      │                              │── emit('agent:*') ─────▶│
      │                              │                         │
      │─── yield { tool_start } ────▶│                         │
      │                              │── emit('agent:*') ─────▶│
      │                              │                         │
      │─── yield { message } ───────▶│                         │
      │                              │── emit('agent:*') ─────▶│
      │                              │                         │
      │─── yield { done } ──────────▶│                         │
      │                              │── emit('agent:done') ──▶│
```

**Setup:**
```typescript
// SocketServer subscribes directly to WorkerPool
socketServer.subscribeToWorkerPool(agentManager.workerPool);

// Inside SocketServer
subscribeToWorkerPool(pool: WorkerPool) {
  pool.events.on('agent:message', ({ taskId, content }) => {
    this.io.to(taskId).emit('agent:message', { taskId, content });
  });
  // ... other events
}
```

**Benefits:**
- 2 hops instead of 3
- Less boilerplate
- AgentManager focuses on orchestration, not event relay

---

## Thread ID Strategy

Each task uses its ID as the LangGraph `thread_id`:

```typescript
// In WorkerPool.executeTask()
const thread_id = taskId;  // Task ID = Thread ID

// This enables:
// 1. Conversation continuity within a task
// 2. Resume after failure (LangGraph checkpoints)
// 3. No cross-task memory pollution
```

---

## Migration Path

### Phase 1: Create WorkerPool
- Simple registry with Map storage
- Event bridging from AsyncGenerator
- No breaking changes

### Phase 2: Create DefinitionBuilder  
- One-shot InternalAgent (structured output mode)
- Outputs `AgentDefinition[]` directly
- Replaces RoleBuilder + ConfigBuilder

### Phase 3: Update AgentManager
- Inject DefinitionBuilder + WorkerPool
- Add multi-turn API
- Subscribe to WorkerPool events

### Phase 4: Deprecate Old Classes
- Mark with @deprecated
- Keep functional for rollback
- Remove in v2.0

---

## Files Summary

| File | Action | Phase |
|------|--------|-------|
| `services/types.ts` | CREATE | 1 |
| `services/WorkerPool.ts` | CREATE | 1 |
| `services/DefinitionBuilder.ts` | CREATE | 2 |
| `agent/internal/schemas/AgentDefinitionSchema.ts` | CREATE | 2 |
| `agentManager/AgentManager.ts` | UPDATE | 3 |
| `roleManager/RoleManager.ts` | DEPRECATE | 4 |
| `AgentWorker/AgentWorker.ts` | DEPRECATE | 4 |
| `agentManager/Agent.ts` | DEPRECATE | 4 |

---

## Success Criteria

1. ✅ Single path for all agent creation (InternalAgent)
2. ✅ Multi-turn conversation support (startTask/continueTask)
3. ✅ Clean event streaming to frontend (WorkerPool.events → Socket.IO)
4. ✅ No breaking changes to existing API (compatibility methods)
5. ✅ All existing tests pass
6. ✅ Deprecated classes marked but functional (@deprecated JSDoc)
