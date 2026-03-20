# Task 2: TaskQueue Architecture

## Overview

Central task queue where Orchestrator plans tasks via multi-turn user conversation, assigns them to roles, and agents poll for their tasks.

## Current System (Post-Migration)

| Component | Location | Role |
|-----------|----------|------|
| **AgentManagerV2** | `agentManager/AgentManagerV2.ts` | Orchestrator |
| **WorkerPool** | `services/WorkerPool.ts` | Worker registry, creates InternalAgent |
| **InternalAgent** | `agent/internal/InternalAgent.ts` | Executes tasks |
| **RoleTaskQueue** | `util/RoleTaskQueue.ts` | ✅ Exists, ❌ Not integrated |

## Desired Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    PLANNING PHASE                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  User ◄──── Multi-turn ────► Orchestrator (AgentManagerV2) │
│              conversation         │                         │
│                                   ▼                         │
│                          PlanBuilder Agent                  │
│                                   │                         │
│                                   ▼                         │
│                          Task Plan Created                  │
│                          [task1, task2, task3]              │
│                          each with assigned_role            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    QUEUING PHASE                            │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  Orchestrator calls:                                        │
│    RoleTaskQueue.queueTask(task)  ─── for each ready task   │
│                                                             │
│  RoleTaskQueue emits:                                       │
│    'task:available' { role, taskId }                        │
│                                                             │
│  Queue Structure:                                           │
│    ┌─────────────────────────────────────────────┐         │
│    │ writer:   [task-1] [task-4]                 │         │
│    │ reviewer: [task-2]                          │         │
│    │ tester:   [task-3]                          │         │
│    └─────────────────────────────────────────────┘         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│                    EXECUTION PHASE                          │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  WorkerPool listens to 'task:available'                     │
│         │                                                   │
│         ▼                                                   │
│  Worker polls:  queue.poll(role) → TaskWithContext          │
│         │                                                   │
│         ▼                                                   │
│  InternalAgent.execute(task)                                │
│         │                                                   │
│         ▼                                                   │
│  On complete: queue.completeTask(taskId, output)            │
│         │                                                   │
│         ▼                                                   │
│  Emit 'task:complete' → Orchestrator updates dependencies   │
│         │                                                   │
│         ▼                                                   │
│  Queue next dependent task if ready                         │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

## Key Design Decisions

### 1. Worker Lifecycle for Multi-Turn
- Worker stays alive for entire task duration
- Same `threadId` maintains conversation state (via MemorySaver)
- Multi-turn flow: `executeTask()` → `continueTask()` × N → `finishTask()`
- Worker disposed only when user confirms task complete

### 2. One Worker Per Role (Current)
- Each role has one worker polling its queue
- Tasks processed serially per role
- Simple, predictable execution

### 3. Multiple Workers Per Role (Future)
- Spin up N workers for same role
- Parallel task processing
- Worker pool scaling based on queue depth

### 4. Orchestrator Owns the Queue
- AgentManagerV2 creates RoleTaskQueue
- Orchestrator queues tasks after planning
- Orchestrator handles dependency resolution

### 5. Polling vs Push
- Workers poll (not pushed)
- Decoupled: queue doesn't know about workers
- Easy to add/remove workers dynamically

### 6. Human Approval Gate
- Before executing a task, user must approve
- User sees the next priority task and can:
  - **Approve** → Execute it
  - **Skip** → Move to next task in queue
  - **Pick** → Choose a different task from queue
- Enables human control over execution order

---

## Approval Flow

```
┌─────────────────────────────────────────────────────────────┐
│                    APPROVAL PHASE                           │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  RoleTaskQueue has tasks ready                              │
│         │                                                   │
│         ▼                                                   │
│  Orchestrator peeks highest priority task                   │
│         │                                                   │
│         ▼                                                   │
│  ┌─────────────────────────────────────────────┐           │
│  │  PENDING APPROVAL                           │           │
│  │                                             │           │
│  │  Next Task: "Write login component"         │           │
│  │  Role: frontend-developer                   │           │
│  │  Priority: 1 (high)                         │           │
│  │                                             │           │
│  │  Queue for this role:                       │           │
│  │    1. Write login component ← current       │           │
│  │    2. Add form validation                   │           │
│  │    3. Style with CSS                        │           │
│  │                                             │           │
│  │  [Approve] [Skip] [Pick Different]          │           │
│  └─────────────────────────────────────────────┘           │
│         │                                                   │
│         ├── Approve → Poll & Execute                        │
│         ├── Skip → Move to back of queue, show next         │
│         └── Pick → Show full queue, user selects            │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### Approval States

```typescript
type ApprovalState = 
  | 'pending'      // Waiting for user decision
  | 'approved'     // User approved, ready to execute
  | 'skipped'      // User skipped, moved to back
  | 'executing';   // Currently running

interface PendingApproval {
  taskId: string;
  task: TaskWithContext;
  role: string;
  queuePosition: number;
  totalInQueue: number;
}
```

### Orchestrator API for Approval

```typescript
// AgentManagerV2.ts
class AgentManager {
  private pendingApprovals = new Map<string, PendingApproval>();
  
  /**
   * Get next task pending approval for a role
   * Called by frontend to show approval UI
   */
  getPendingApproval(role: string): PendingApproval | null {
    const task = this.taskQueue.peek(role);
    if (!task) return null;
    
    return {
      taskId: task.id,
      task,
      role,
      queuePosition: 1,
      totalInQueue: this.taskQueue.getQueueSize(role),
    };
  }
  
  /**
   * Get all tasks in queue for a role (for "Pick Different")
   */
  getQueuedTasks(role: string): TaskWithContext[] {
    return this.taskQueue.peekAll(role);
  }
  
  /**
   * User approves the current task
   */
  async approveTask(taskId: string): Promise<void> {
    const task = this.taskQueue.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    
    // Poll and execute
    this.taskQueue.poll(task.assigned_role);
    await this.workerPool.executeTask(task);
  }
  
  /**
   * User skips the current task (move to back of queue)
   */
  skipTask(taskId: string): void {
    const task = this.taskQueue.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    
    // Remove from front, add to back with lower priority
    this.taskQueue.poll(task.assigned_role);
    task.priority = task.priority + 100; // Lower priority
    this.taskQueue.queueTask(task);
  }
  
  /**
   * User picks a specific task to execute
   */
  async pickTask(taskId: string): Promise<void> {
    const task = this.taskQueue.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    
    // Update priority to make it highest
    this.taskQueue.updatePriority(taskId, -1); // Highest priority
    
    // Now poll (it will be first) and execute
    this.taskQueue.poll(task.assigned_role);
    await this.workerPool.executeTask(task);
  }
}
```

### Socket Events for Approval UI

```typescript
// SocketServer events
interface ApprovalEvents {
  // Server → Client: New task needs approval
  'approval:pending': PendingApproval;
  
  // Server → Client: Task started executing
  'approval:executing': { taskId: string };
  
  // Client → Server: User decisions
  'approval:approve': { taskId: string };
  'approval:skip': { taskId: string };
  'approval:pick': { taskId: string };
}
```

### Auto-Approve Mode (Optional)

```typescript
class AgentManager {
  private autoApprove = false;
  
  setAutoApprove(enabled: boolean): void {
    this.autoApprove = enabled;
  }
  
  private onTaskAvailable({ role, taskId }: TaskAvailableEvent): void {
    if (this.autoApprove) {
      // Skip approval, execute immediately
      this.approveTask(taskId);
    } else {
      // Emit to frontend for user approval
      this.events.emit('approval:pending', this.getPendingApproval(role));
    }
  }
}
```

## Current WorkerPool Implementation

```typescript
// services/WorkerPool.ts - Current State
class WorkerPool {
  /** Cached definitions by role */
  private definitions = new Map<string, AgentDefinition>();

  /** Active workers by task ID (not role!) */
  private workers = new Map<string, InternalAgent>();

  /** Event emitter for Socket.IO */
  public readonly events = new EventEmitter();

  // Definition management
  registerDefinitions(definitions: AgentDefinition[]): void;
  getDefinition(role: string): AgentDefinition | undefined;
  hasRole(role: string): boolean;

  // Task execution - creates worker per taskId, reuses for same taskId
  async runTask(taskId: string, role: string, message: string): Promise<any>;

  // Cleanup
  async dispose(taskId: string): Promise<void>;
  async disposeAll(): Promise<void>;
}
```

### Current Behavior:
- Workers cached by **taskId** (not role)
- Same taskId reuses worker (conversation continuity)
- New taskId creates new worker
- Workers NOT auto-disposed after task completion
- Events: `worker:event`, `worker:done`, `worker:error`

---

## Integration Plan

### Phase 1: Wire RoleTaskQueue into AgentManagerV2

```typescript
// AgentManagerV2.ts
class AgentManager {
  private taskQueue = new RoleTaskQueue();
  
  // After planning, queue tasks
  async executeAllTasks(): Promise<void> {
    for (const task of this.plan.tasks) {
      if (this.dependenciesSatisfied(task)) {
        this.taskQueue.queueTask({
          id: task.id,
          description: task.description,
          assigned_role: task.assignedRole,
          priority: task.priority,
          context: { previousOutputs: [], artifacts: [] },
          status: 'queued',
          createdAt: Date.now(),
        });
      }
    }
  }
}
```

### Phase 2: WorkerPool.runTask() Overloading

Add function overloading to `runTask()` - one function, two signatures:

```typescript
// services/WorkerPool.ts

import type { TaskWithContext } from "../util/RoleTaskQueue.types.js";

export class WorkerPool {
  // ... existing fields ...

  // =========================================================================
  // Function Overloads
  // =========================================================================

  /**
   * Signature 1: Simple params (chat mode)
   */
  async runTask(taskId: string, role: string, message: string): Promise<any>;

  /**
   * Signature 2: TaskWithContext (queue mode)
   */
  async runTask(task: TaskWithContext): Promise<any>;

  /**
   * Implementation handles both signatures
   */
  async runTask(
    taskIdOrTask: string | TaskWithContext,
    role?: string,
    message?: string
  ): Promise<any> {
    let taskId: string;
    let roleKey: string;
    let finalMessage: string;

    if (typeof taskIdOrTask === "string") {
      // Chat mode: simple params
      taskId = taskIdOrTask;
      roleKey = role!.toLowerCase();
      finalMessage = message!;
    } else {
      // Queue mode: TaskWithContext
      const task = taskIdOrTask;
      taskId = task.id;
      roleKey = task.assigned_role.toLowerCase();
      finalMessage = this.buildMessageWithContext(task);
    }

    // Get or create worker (existing logic)
    let agent = this.workers.get(taskId);
    if (!agent) {
      const definition = this.definitions.get(roleKey);
      if (!definition) {
        throw new Error(`Role not registered: ${roleKey}`);
      }
      // ... create agent with DEFAULT_MODEL_CONFIG override ...
      agent = new InternalAgent(fixedDefinition);
      await agent.initialize();
      this.workers.set(taskId, agent);
    }

    // Execute and emit events (existing logic)
    const input: AgentInput = {
      message: finalMessage,
      threadId: taskId,
    };

    let output: any = null;
    for await (const event of agent.execute(input)) {
      this.events.emit("worker:event", { taskId, event });
      if (event.type === "done") {
        output = event.output;
        this.events.emit("worker:done", { taskId, output });
      }
      if (event.type === "error") {
        this.events.emit("worker:error", { taskId, error: event.error });
      }
    }

    return output;
  }

  /**
   * Build message with context from dependency outputs
   */
  private buildMessageWithContext(task: TaskWithContext): string {
    let msg = task.description;

    if (task.context.previousOutputs.length > 0) {
      msg += "\n\n## Context from previous tasks:\n";
      for (const prev of task.context.previousOutputs) {
        msg += `\n### Task ${prev.taskId}:\n`;
        msg += JSON.stringify(prev.output, null, 2) + "\n";
      }
    }

    if (task.context.artifacts.length > 0) {
      msg += `\n\n## Available artifacts:\n${task.context.artifacts.join("\n")}`;
    }

    return msg;
  }
}
```

**Usage:**
```typescript
// Chat mode (current - unchanged)
await workerPool.runTask("task-123", "writer", "Write a blog post");

// Queue mode (new - with context injection)
await workerPool.runTask(taskWithContext);
```

**Benefits:**
- Single function, two signatures
- Backward compatible (existing calls unchanged)
- Context injection handled in WorkerPool (not AgentManager)
- Type-safe overloading

### Phase 3: AgentManager Uses Queue Mode

```typescript
// AgentManagerV2.ts
class AgentManager {
  private taskQueue = new RoleTaskQueue();
  private workerPool: WorkerPool;

  /**
   * Execute a task from the queue (NON-BLOCKING)
   * Returns immediately, completion handled via events
   */
  executeQueuedTask(task: TaskWithContext): void {
    // Fire-and-forget - don't await
    this.workerPool.runTask(task)
      .then((output) => {
        this.taskQueue.completeTask(task.id, output);
        // Event already emitted by WorkerPool ('worker:done')
      })
      .catch((error) => {
        this.taskQueue.failTask(task.id, error.message);
        // Event already emitted by WorkerPool ('worker:error')
      });
    
    // Returns immediately - UI can show "executing" state
    // Completion notified via 'worker:done' / 'task:complete' events
  }

  /**
   * Execute and WAIT for result (for programmatic use)
   */
  async executeQueuedTaskSync(task: TaskWithContext): Promise<any> {
    const output = await this.workerPool.runTask(task);
    this.taskQueue.completeTask(task.id, output);
    return output;
  }

  /**
   * Continue multi-turn conversation (uses simple signature)
   */
  async continueTask(taskId: string, message: string): Promise<any> {
    const role = this.taskRoles.get(taskId);
    if (!role) throw new Error(`Unknown task: ${taskId}`);
    
    // Same taskId = same worker = conversation continues
    return this.workerPool.runTask(taskId, role, message);
  }

  /**
   * Finish task and dispose worker
   */
  async finishTask(taskId: string): Promise<void> {
    this.taskRoles.delete(taskId);
    await this.workerPool.dispose(taskId);
  }
}
```

**Two patterns:**
| Method | Blocking | Use Case |
|--------|----------|----------|
| `executeQueuedTask()` | No | UI approval flow - returns immediately |
| `executeQueuedTaskSync()` | Yes | Programmatic batch execution |

**Event flow for non-blocking:**
```
User clicks Approve
    → executeQueuedTask(task) returns immediately
    → UI shows "Executing..."
    → WorkerPool emits 'worker:event' (streaming) with { taskId, event }
    → WorkerPool emits 'worker:done' with { taskId, output }
    → UI shows completion
    → Frontend can call continueTask(taskId, message) for multi-turn
```

### TaskId Flow to Frontend

**Queue mode (approval flow):**
```typescript
// 1. Frontend requests pending approval
const pending = agentManager.getPendingApproval(role);
// pending = { taskId: "task-123", task, role, queuePosition, totalInQueue }

// 2. Frontend shows approval UI (already has taskId)

// 3. User approves → Socket event
socket.emit('approval:approve', { taskId: pending.taskId });

// 4. Server executes, emits events WITH taskId
// 'worker:event' { taskId: "task-123", event }
// 'worker:done' { taskId: "task-123", output }

// 5. Frontend can continue multi-turn
socket.emit('task:continue', { taskId: "task-123", message: "..." });
```

**Chat mode (direct):**
```typescript
// Frontend calls startTask → gets taskId in response
const { taskId, response } = await agentManager.startTask(role, message);
// taskId = "task-1737999123456"

// Frontend uses taskId for continuation
const response2 = await agentManager.continueTask(taskId, "follow up");
```

**Key:** All events include `taskId` for correlation.

### Phase 4: Approval Flow

```typescript
// AgentManagerV2.ts - approval methods
class AgentManager {
  async approveTask(taskId: string): Promise<void> {
    const task = this.taskQueue.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    
    // Emit that we're starting (frontend already has taskId)
    this.events.emit('task:executing', { taskId });
    
    // Poll from queue and execute (uses overloaded runTask)
    this.taskQueue.poll(task.assigned_role);
    this.executeQueuedTask(task); // Non-blocking, taskId in events
  }
  
  skipTask(taskId: string): void {
    const task = this.taskQueue.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    
    // Remove from front, add back with lower priority
    this.taskQueue.poll(task.assigned_role);
    task.priority += 100;
    this.taskQueue.queueTask(task);
  }
  
  async pickTask(taskId: string): Promise<void> {
    // Update priority to highest, then approve
    this.taskQueue.updatePriority(taskId, -1);
    await this.approveTask(taskId);
  }
}
```

### Phase 5: Dependency Chain

```typescript
// AgentManagerV2.ts
private setupCompletionHandler(): void {
  this.taskQueue.on('task:complete', ({ taskId, output }) => {
    // Store output for dependent tasks
    this.taskOutputs.set(taskId, output);
    
    // Queue tasks that were waiting on this one
    for (const task of this.plan.tasks) {
      if (task.dependencies.includes(taskId)) {
        if (this.dependenciesSatisfied(task)) {
          this.queueWithContext(task);
        }
      }
    }
  });
}
```

---

## Data Structures

### TaskWithContext (exists in RoleTaskQueue.types.ts)

```typescript
interface TaskWithContext {
  id: string;
  description: string;
  assigned_role: string;
  priority: number;
  context: {
    previousOutputs: Array<{ taskId: string; output: any }>;
    artifacts: string[];
  };
  status: 'queued' | 'in_progress' | 'completed' | 'failed';
  createdAt: number;
}
```

### PlannedTask (from plan builder)

```typescript
interface PlannedTask {
  id: string;
  title: string;
  description: string;
  assignedRole: string;
  priority: number;
  dependencies: string[];  // taskIds this depends on
}
```

---

## Components Summary

| Component | Responsibility |
|-----------|---------------|
| **AgentManagerV2** | Orchestration, planning, dependency resolution |
| **RoleTaskQueue** | Central queue, events, metrics |
| **WorkerPool** | Worker lifecycle, listens to queue, executes |
| **InternalAgent** | Actual task execution |

---

## Future: Multi-Worker Scaling

```typescript
// WorkerPool with multiple concurrent workers per role
class WorkerPool {
  private activeWorkers = new Map<string, InternalAgent>(); // taskId -> worker
  private workerCounts = new Map<string, number>(); // role -> active count
  private maxWorkersPerRole = 3;
  
  scaleRole(role: string, maxWorkers: number): void {
    this.maxWorkersPerRole = maxWorkers;
  }
  
  private async onTaskAvailable({ role }: { role: string }): Promise<void> {
    const activeCount = this.workerCounts.get(role) || 0;
    
    // Can we spin up another worker for this role?
    if (activeCount < this.maxWorkersPerRole) {
      const task = this.taskQueue.poll(role);
      if (task) {
        this.executeTask(task); // Don't await - run concurrently
      }
    }
    // If at max workers, task stays in queue until one completes
  }
  
  private async executeTask(task: TaskWithContext): Promise<void> {
    const role = task.assigned_role;
    
    // Track active worker count
    this.workerCounts.set(role, (this.workerCounts.get(role) || 0) + 1);
    
    try {
      // Create ephemeral worker
      const worker = new InternalAgent(this.getDefinition(role));
      await worker.initialize();
      this.activeWorkers.set(task.id, worker);
      
      // Execute
      const output = await worker.run(task.description);
      this.taskQueue.completeTask(task.id, output);
      
    } catch (error) {
      this.taskQueue.failTask(task.id, error.message);
    } finally {
      // Dispose worker after completion
      const worker = this.activeWorkers.get(task.id);
      if (worker) {
        await worker.stop();
        this.activeWorkers.delete(task.id);
      }
      
      // Decrement count
      this.workerCounts.set(role, (this.workerCounts.get(role) || 1) - 1);
      
      // Check if more tasks waiting for this role
      if (this.taskQueue.hasTasksFor(role)) {
        this.onTaskAvailable({ role, taskId: '' });
      }
    }
  }
}
```

**Key Points:**
- Workers are **ephemeral** - created per task, disposed after completion
- No idle workers sitting around
- `maxWorkersPerRole` controls parallelism (1 = serial, N = parallel)
- After completion, check queue for more tasks

---

## Status

- [x] RoleTaskQueue implemented
- [x] PriorityQueue implemented
- [x] WorkerPool.runTask(taskId, role, msg) exists
- [ ] Add WorkerPool.runTask(task) overload + buildMessageWithContext()
- [ ] Add executeQueuedTask() to AgentManagerV2
- [ ] Add approval flow (approve/skip/pick)
- [ ] Wire dependency handler (task:complete)
- [ ] Tests for integration

---

## Verified API Signatures (Not Hallucinated)

**InternalAgent.execute() ✅**
```typescript
async *execute(input: AgentInput): AsyncGenerator<AgentEvent>
```

**AgentInput (actual types.ts:131) ✅**
```typescript
interface AgentInput {
  message: string;
  threadId: string;
  taskId?: string;
  context?: {
    files?: FileReference[];
    artifacts?: ArtifactReference[];
    teamId?: string;
  };
}
```

**AgentEvent types ✅**
- `thinking`, `planning`, `tool_start`, `tool_result`
- `message`, `message_delta`, `artifact`, `done`, `error`

**RoleTaskQueue methods ✅**
- `queueTask(task)`, `poll(role)`, `peek(role)`, `peekAll(role)`
- `completeTask(taskId, output)`, `failTask(taskId, error)`
- `getTask(taskId)`, `hasTasksFor(role)`, `updatePriority(taskId, newPriority)`

**Gap: Context Type Mismatch**

`AgentInput.context` has:
```typescript
{ files?, artifacts?, teamId? }
```

`TaskContext` (RoleTaskQueue) has:
```typescript
{ previousOutputs[], artifacts[], requirements? }
```

**Resolution:** Inject `previousOutputs` into `message` string via function overloading.

---

## Implementation Checklist

| Component | Status | File | Notes |
|-----------|--------|------|-------|
| RoleTaskQueue | ✅ Exists | util/RoleTaskQueue.ts | All methods verified |
| PriorityQueue | ✅ Exists | util/PriorityQueue.ts | Min-heap implementation |
| WorkerPool.runTask(taskId, role, msg) | ✅ Exists | services/WorkerPool.ts | Chat mode |
| InternalAgent.execute() | ✅ Exists | agent/internal/InternalAgent.ts | AsyncGenerator<AgentEvent> |
| **WorkerPool.runTask(task)** | ❌ Add overload | services/WorkerPool.ts | Queue mode + context injection |
| **buildMessageWithContext()** | ❌ Add to WorkerPool | services/WorkerPool.ts | Private helper |
| executeQueuedTask() | ❌ Needs impl | agentManager/AgentManagerV2.ts | Calls runTask(task) |
| Approval flow | ❌ Needs impl | agentManager/AgentManagerV2.ts | approve/skip/pick |
| Dependency handler | ❌ Needs impl | agentManager/AgentManagerV2.ts | Queue deps on complete |

**Key Change:** Add function overload to `WorkerPool.runTask()`:
- `runTask(taskId, role, message)` - Chat mode (existing)
- `runTask(task: TaskWithContext)` - Queue mode (new overload)

