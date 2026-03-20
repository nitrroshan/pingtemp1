# Worker & AgentManager Integration Plan

> **Purpose:** Define how the memory system integrates with existing worker architecture  
> **Status:** Planning  
> **Last Updated:** 2025-01-XX

---

## Executive Summary

The memory system must integrate seamlessly with:
1. **AgentManager** - Orchestrates tasks, manages workers
2. **WorkerPool** - Executes tasks via InternalAgent/ExternalAgent
3. **OrchestratorService** - Plans and coordinates work
4. **MemoryManager** - Current task state (to be enhanced, not replaced)

---

## Current Architecture (What Exists)

```
┌─────────────────────────────────────────────────────────────────────────┐
│                     CURRENT FLOW (AgentManagerV2)                        │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                           │
│  AgentManager                                                             │
│       │                                                                   │
│       ├── initializeOrchestrator(teamId, roles)                          │
│       │         │                                                         │
│       │         ├── Creates MemoryManager (✅ task state)                │
│       │         │                                                         │
│       │         ├── Creates MemoryCoordinator (✅ exists!)               │
│       │         │         ├── TaskMemory (wraps MemoryManager)           │
│       │         │         ├── ArtifactRegistry (in-memory)               │
│       │         │         ├── PlanStore (in-memory)                      │
│       │         │         └── KnowledgeBase (MongoDB - if configured)    │
│       │         │                                                         │
│       │         ├── Injects MemoryCoordinator into WorkerPool            │
│       │         │                                                         │
│       │         └── Creates OrchestratorService                          │
│       │                   └── Uses MemoryManager for task flow           │
│       │                                                                   │
│       └── Chat/Execute flow                                              │
│                 │                                                         │
│                 └── WorkerPool.runTask()                                 │
│                           │                                               │
│                           └── InternalAgent.invoke()                     │
│                                                                           │
└─────────────────────────────────────────────────────────────────────────┘
```

### Key Integration Points (Already Exist)

| Component | Current Integration | File |
|-----------|-------------------|------|
| `AgentManager.memoryCoordinator` | Created in `initializeOrchestrator()` | AgentManagerV2.ts:127-140 |
| `WorkerPool.setMemoryCoordinator()` | Called after creation | AgentManagerV2.ts:202 |
| `MemoryCoordinator.tasks` | Wraps MemoryManager | MemoryCoordinator.ts:71 |
| `MemoryCoordinator.knowledge` | MongoDB if configured | MemoryCoordinator.ts:82 |

---

## Integration Gaps

| Gap | Current State | Needed |
|-----|---------------|--------|
| **No persistence** | MemoryManager uses in-memory Map | TaskCheckpointer |
| **No workspace access from workers** | Workers don't have workspace API | WorkspaceManager injection |
| **No artifact persistence** | ArtifactRegistry in-memory | CollabStore |
| **No L2 collab in workers** | CollabMemoryManager exists but unused | Worker collab API |
| **Restart loses everything** | No recovery | Startup recovery flow |

---

## 1. MemoryCoordinator Enhancement

### Current MemoryCoordinator (v1.0)
```typescript
class MemoryCoordinator {
  readonly tasks: TaskMemory;      // ✅ Wraps MemoryManager
  readonly artifacts: ArtifactRegistry;  // ⚠️ In-memory only
  readonly plans: PlanStore;       // ⚠️ In-memory only
  readonly workspaces: IWorkspaceManager | null;  // Not used yet
  readonly collab: CollabMemoryManager | null;    // Created but not integrated
  readonly knowledge: KnowledgeBase | null;       // ✅ MongoDB if configured
}
```

### Enhanced MemoryCoordinator (v1.1+)
```typescript
class MemoryCoordinator {
  // Core (existing)
  readonly tasks: TaskMemory;
  readonly artifacts: ArtifactRegistry;
  readonly plans: PlanStore;
  
  // Persistence (NEW)
  readonly checkpointer: ITaskCheckpointer;    // Session recovery
  readonly collabStore: ICollabStore;          // MongoDB + Object Storage
  
  // Layers (enhanced)
  readonly workspaces: WorkspaceManager;       // Git-based workspaces
  readonly collab: CollabMemoryManager;        // Real-time + persisted
  readonly knowledge: KnowledgeBase;           // MongoDB
  
  // Lifecycle (NEW)
  async initialize(): Promise<void>;           // Connect stores, recover
  async checkpoint(): Promise<void>;           // Save current state
  async close(): Promise<void>;                // Graceful shutdown
}
```

---

## 2. AgentManager Lifecycle Changes

### Current: initializeOrchestrator()
```typescript
async initializeOrchestrator(teamId: string, teamRoles: string[]): Promise<void> {
  this.memoryManager = new MemoryManager();
  this.memoryCoordinator = new MemoryCoordinator({ ... });
  
  if (this.memoryCoordinator.knowledge) {
    await this.memoryCoordinator.knowledge.initialize();
  }
  
  this.workerPool.setMemoryCoordinator(this.memoryCoordinator);
  // ...
}
```

### Enhanced: initializeOrchestrator()
```typescript
async initializeOrchestrator(teamId: string, teamRoles: string[]): Promise<void> {
  // 1. Create persistence layer
  const persistenceConfig = loadPersistenceConfig();
  
  // 2. Create MemoryCoordinator with all stores
  this.memoryCoordinator = new MemoryCoordinator({
    teamId,
    persistence: persistenceConfig,
  });
  
  // 3. Initialize (connects to MongoDB, checks for recovery)
  await this.memoryCoordinator.initialize();
  
  // 4. Check for recovery
  const recoverable = await this.memoryCoordinator.getRecoverableSessions();
  if (recoverable.length > 0) {
    // Option A: Auto-recover
    if (persistenceConfig.checkpoint.autoRecover) {
      await this.memoryCoordinator.recoverSession(recoverable[0].sessionId);
      this.events.emit('session:recovered', { sessionId: recoverable[0].sessionId });
    }
    // Option B: Ask user
    else {
      this.events.emit('session:recovery_available', { sessions: recoverable });
    }
  }
  
  // 5. Get MemoryManager from coordinator (for backward compat)
  this.memoryManager = this.memoryCoordinator.tasks.memoryManager;
  
  // 6. Inject into workers
  this.workerPool.setMemoryCoordinator(this.memoryCoordinator);
  
  // 7. Create orchestrator
  this.orchestrator = new OrchestratorService({
    teamId,
    teamRoles,
    memoryManager: this.memoryManager,
    workerPool: this.workerPool,
    events: this.events,
  });
  
  await this.orchestrator.initialize();
}
```

### NEW: Shutdown handling
```typescript
// In AgentManager
async shutdown(): Promise<void> {
  logger.info('AgentManager shutdown initiated');
  
  // Stop accepting tasks
  this.acceptingTasks = false;
  
  // Wait for in-progress
  await this.workerPool.waitForIdle({ timeoutMs: 30000 });
  
  // Checkpoint and close
  if (this.memoryCoordinator) {
    await this.memoryCoordinator.checkpoint();
    await this.memoryCoordinator.close();
  }
  
  logger.info('AgentManager shutdown complete');
}
```

---

## 3. WorkerPool Memory Access

### Current Flow
```typescript
// WorkerPool.ts (simplified)
class WorkerPool {
  private memoryCoordinator: MemoryCoordinator | null = null;
  
  setMemoryCoordinator(mc: MemoryCoordinator): void {
    this.memoryCoordinator = mc;
  }
  
  async runTask(role: string, input: string): Promise<TaskResult> {
    const worker = this.getOrCreateWorker(role);
    return worker.execute(input);
  }
}
```

Workers currently **don't receive memory context**.

### Enhanced Flow

```typescript
// WorkerPool.ts
class WorkerPool {
  async runTask(taskId: string, role: string, input: string): Promise<TaskResult> {
    const worker = this.getOrCreateWorker(role);
    
    // NEW: Create task context from memory
    const taskContext = await this.memoryCoordinator?.getTaskContext(taskId);
    
    // NEW: Create workspace for task (v1.1)
    let workspace: AgentWorkspace | null = null;
    if (this.memoryCoordinator?.workspaces) {
      workspace = await this.memoryCoordinator.workspaces.createWorkspace(worker.id, taskId);
    }
    
    // Execute with context
    const result = await worker.execute(input, {
      taskContext,
      workspace,
      knowledgeContext: taskContext?.knowledgeContext,
    });
    
    // NEW: Handle workspace artifacts
    if (workspace) {
      const artifacts = await workspace.publish();
      for (const artifact of artifacts) {
        await this.memoryCoordinator?.publishArtifact(artifact);
      }
    }
    
    return result;
  }
}
```

### Worker Context Interface

```typescript
// Types for worker execution context
interface WorkerExecutionContext {
  // Task info
  taskId: string;
  taskDescription: string;
  
  // Prerequisites (from MemoryManager)
  dependencyOutputs: TaskOutput[];
  
  // Workspace (v1.1)
  workspace?: AgentWorkspace;
  
  // Knowledge (v2.0)
  knowledgeContext?: KnowledgeDocument[];
  
  // Collab (v1.2)
  collabSpace?: CollaborationSpace;
}

// InternalAgent enhanced to use context
class InternalAgent {
  async invoke(input: string, context?: WorkerExecutionContext): Promise<string> {
    // Build system prompt with context
    const systemPrompt = this.buildSystemPrompt(
      this.definition.systemPrompt,
      context
    );
    
    // ... existing invoke logic
  }
  
  private buildSystemPrompt(base: string, context?: WorkerExecutionContext): string {
    if (!context) return base;
    
    let enhanced = base;
    
    // Add dependency context
    if (context.dependencyOutputs.length > 0) {
      enhanced += '\n\n## Context from Previous Tasks\n';
      for (const output of context.dependencyOutputs) {
        enhanced += `\n### ${output.taskId}\n${output.output}\n`;
      }
    }
    
    // Add knowledge context
    if (context.knowledgeContext?.length) {
      enhanced += '\n\n## Relevant Knowledge\n';
      for (const doc of context.knowledgeContext) {
        enhanced += `\n### ${doc.title}\n${doc.summary || doc.content}\n`;
      }
    }
    
    return enhanced;
  }
}
```

---

## 4. Event Coordination

### Memory Events

```typescript
// Events emitted by MemoryCoordinator
interface MemoryEvents {
  // Task lifecycle
  'task:ready': { task: Task; teamId: string };
  'task:completed': { taskId: string; output: any };
  
  // Persistence
  'checkpoint:saved': { sessionId: string; timestamp: number };
  'checkpoint:restored': { sessionId: string; tasksCount: number };
  
  // Artifacts
  'artifact:published': { artifact: Artifact; spaceId: string };
  'artifact:promoted': { artifactId: string; docId: string };
  
  // Knowledge
  'knowledge:proposal:new': { proposalId: string; type: string };
  'knowledge:proposal:approved': { proposalId: string; docId: string };
  
  // Collab
  'collab:space:created': { spaceId: string; goalId: string };
  'collab:document:updated': { docId: string; agentId: string };
}
```

### AgentManager Event Forwarding

```typescript
// AgentManager forwards memory events to socket clients
private setupMemoryEventForwarding(): void {
  if (!this.memoryCoordinator) return;
  
  // Forward to main events (for Socket.IO)
  this.memoryCoordinator.on('checkpoint:saved', (data) => {
    this.events.emit('memory:checkpoint:saved', data);
  });
  
  this.memoryCoordinator.on('artifact:published', (data) => {
    this.events.emit('memory:artifact:published', data);
  });
  
  this.memoryCoordinator.on('knowledge:proposal:new', (data) => {
    this.events.emit('memory:knowledge:proposal', data);
  });
}
```

---

## 5. API Exposure

### REST Endpoints (HttpServer)

```typescript
// Memory management endpoints
router.get('/api/memory/sessions', async (req, res) => {
  const sessions = await memoryCoordinator.getRecoverableSessions();
  res.json({ sessions });
});

router.post('/api/memory/recover/:sessionId', async (req, res) => {
  await memoryCoordinator.recoverSession(req.params.sessionId);
  res.json({ success: true });
});

router.get('/api/memory/artifacts', async (req, res) => {
  const { spaceId, taskId } = req.query;
  const artifacts = memoryCoordinator.artifacts.query({ spaceId, taskId });
  res.json({ artifacts });
});

router.get('/api/memory/knowledge/search', async (req, res) => {
  const { query, role } = req.query;
  const results = await memoryCoordinator.knowledge?.search(query, { role });
  res.json({ results });
});
```

### Socket.IO Events

```typescript
// SocketServer additions
socket.on('memory:checkpoint', async () => {
  await agentManager.memoryCoordinator?.checkpoint();
  socket.emit('memory:checkpoint:complete');
});

socket.on('memory:recover', async ({ sessionId }) => {
  await agentManager.memoryCoordinator?.recoverSession(sessionId);
  socket.emit('memory:recover:complete', { sessionId });
});
```

---

## 6. Implementation Sequence

### Phase 1: Persistence Foundation (Week 1)
1. Create `TaskCheckpointer` 
2. Add `initialize()` and `close()` to MemoryCoordinator
3. Update `AgentManager.initializeOrchestrator()` with recovery
4. Add `AgentManager.shutdown()` with graceful checkpoint

### Phase 2: Worker Context (Week 1-2)
1. Define `WorkerExecutionContext` interface
2. Update `WorkerPool.runTask()` to build context
3. Update `InternalAgent.invoke()` to use context
4. Test dependency output injection

### Phase 3: Workspace Integration (Week 2)
1. Implement `WorkspaceManager` with `GitBranchManager`
2. Update `WorkerPool` to create/manage workspaces
3. Implement artifact publishing from workspace
4. Test task isolation

### Phase 4: Collab & Knowledge (Week 3)
1. Wire `CollabMemoryManager` into worker flow
2. Enable knowledge context injection
3. Add API endpoints for memory management
4. Full integration testing

---

## 7. File Changes Summary

### New Files
```
src/worker/memory/persistence/
  TaskCheckpointer.ts
  CollabStore.ts
  ObjectStorageAdapter.ts
  PersistenceConfig.ts
  types/
    checkpoint.types.ts
    collab-store.types.ts
```

### Modified Files
```
src/worker/agentManager/AgentManagerV2.ts
  - Enhanced initializeOrchestrator()
  - Added shutdown()
  - Added memory event forwarding

src/worker/services/WorkerPool.ts
  - Enhanced runTask() with context
  - Added workspace lifecycle

src/worker/agent/internal/InternalAgent.ts
  - Enhanced invoke() with context
  - Added buildSystemPrompt()

src/worker/memory/MemoryCoordinator.ts
  - Added initialize(), checkpoint(), close()
  - Added getRecoverableSessions(), recoverSession()
  - Added persistence integration

src/worker/api/HttpServer.ts
  - Added memory management endpoints

src/worker/api/SocketServer.ts
  - Added memory events
```

---

## 8. Backward Compatibility

### MemoryManager Unchanged
- `MemoryManager` class stays the same
- All existing task operations work
- `TaskMemory` wraps it (no changes needed)

### Graceful Degradation
```typescript
// If persistence not configured, continue working in-memory
if (!persistenceConfig.checkpoint.enabled) {
  logger.warn('Checkpoint disabled - session recovery not available');
}

// If MongoDB not configured, L2/L3 persistence unavailable
if (!persistenceConfig.collaboration.mongodb.uri) {
  logger.warn('MongoDB not configured - artifacts will not persist');
}
```

### Feature Flags
```typescript
// Environment variables for gradual rollout
ENABLE_TASK_CHECKPOINT=true
ENABLE_ARTIFACT_PERSISTENCE=true
ENABLE_WORKSPACE_MANAGER=true
ENABLE_KNOWLEDGE_INJECTION=true
```
