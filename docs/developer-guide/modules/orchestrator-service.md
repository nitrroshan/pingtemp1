# OrchestratorService

## Purpose

OrchestratorService is the LLM-powered planning engine. It manages a conversational interface for requirement gathering, delegates plan creation to a PlanBuilder agent, handles plan approval, and coordinates task dispatch and completion cascading. It maintains a state machine that tracks the workflow from idle through planning to execution.

## Source Files

- `src/worker/orchestrator/OrchestratorService.ts` — Main class (~925 lines)
- `src/worker/orchestrator/types.ts` — OrchestratorState, OrchestratorConfig, OrchestratorContext
- `src/worker/orchestrator/schemas.ts` — AgentPlanOutput Zod schema
- `src/worker/orchestrator/tools/` — createPlan, approvePlan, getContext, getStatus

## State Machine

```
idle ──(user message)──► gathering ──(createPlan tool called)──► awaiting_approval
                                                                       │
                                                         (approvePlan called)
                                                                       │
                                                                       ▼
                                                                  executing ──(all tasks done)──► idle
```

- **idle**: No active workflow
- **gathering**: Orchestrator agent is conversing with user, collecting requirements
- **awaiting_approval**: Plan generated, waiting for user to approve
- **executing**: Tasks queued and being dispatched to workers

## Key Fields

```typescript
class OrchestratorService {
  private state: OrchestratorState;               // "idle" | "gathering" | "awaiting_approval" | "executing"
  private pendingPlan: AgentPlanOutput | null;     // plan awaiting approval
  private autoExecute: boolean;                    // false by default
  private dispatchChain: Promise<void>;            // serializes task dispatch

  // Agents
  private orchestratorAgent: IAgent | null;        // tool mode, conversational
  private planBuilderAgent: IAgent | null;         // structured output mode
  private agentFactory: AgentFactory | null;

  // Plan persistence
  private planStore: PlanStore;                    // file-based, goalId-scoped
  private currentGoalId: string | null;

  // Dependencies
  private memoryManager: MemoryManager;
  private workerPool: WorkerPool;
  private events: EventEmitter;
}
```

## Configuration

```typescript
interface OrchestratorConfig {
  teamId: string;
  teamRoles: string[];         // available roles for task assignment
  memoryManager: MemoryManager;
  workerPool: WorkerPool;
  events: EventEmitter;
  autoExecute?: boolean;       // default: false
}
```

## Public API

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize()` | `Promise<void>` | Create agents, inject tools, subscribe to events, load stored plan |
| `handleMessage(content)` | `Promise<string>` | Process user message, return orchestrator response |
| `approvePlan()` | `Promise<{ success, tasksQueued?, error? }>` | Approve pending plan, add tasks to MemoryManager |
| `getState()` | `OrchestratorState` | Current state |
| `getPendingPlan()` | `TaskPlan \| null` | Pending plan if awaiting approval |
| `setAutoExecute(enabled)` | `void` | Toggle auto-execution mode |
| `getAutoExecute()` | `boolean` | Current auto-execute setting |
| `resetPlan()` | `Promise<{ deleted, planId? }>` | Archive plan, reset to idle |
| `interruptPlan()` | `Promise<void>` | Mark plan as interrupted (for graceful shutdown) |
| `dispose()` | `void` | Cleanup listeners, reset state |

## Two Internal Agents

### Orchestrator Agent (Tool Mode)

- Loaded from YAML: `orchestrator` definition in `src/worker/agent/agents/`
- Conversational — user messages go through this agent
- Has tools injected: `createPlan`, `approvePlan`, `getContext`, `getStatus`
- System prompt is customized at runtime to include available team roles

### PlanBuilder Agent (Structured Output Mode)

- Loaded from YAML: `plan-builder` definition
- Returns typed `AgentPlanOutput` via Zod schema
- Called by the `createPlan` tool (not directly by users)

### Plan Output Schema

```typescript
interface AgentPlanOutput {
  planId: string;
  goal?: string;
  tasks: Array<{
    id: string;
    title: string;
    description: string;
    assignedRole: string;        // must be lowercase
    priority: number;
    dependencies: string[];      // other task IDs
    complexity?: string;
    expectedOutput?: string;
    context?: { notes?: string; files?: string[]; artifacts?: string[] };
  }>;
}
```

## Initialization Flow

1. Create `AgentFactory` pointing to agents directory
2. Create PlanBuilder agent (structured output mode)
3. Create Orchestrator agent (tool mode)
4. Customize orchestrator's system prompt with team roles
5. Initialize orchestrator agent
6. Create `OrchestratorContext` (closure-based dependency injection for tools)
7. Create and inject tools into orchestrator
8. Subscribe to task lifecycle events on `memoryManager.taskQueue`
9. Subscribe to `task:agent-complete` on `workerPool.events`
10. Load active plan from disk (restart recovery)

## Auto-Execute vs Manual Mode

### Manual Mode (default: `autoExecute = false`)

When a task becomes available via `task:available`:
1. `wakeWorker()` is called
2. Emits `task:pending_approval` event
3. Task waits for user to call `AgentManager.startTaskExecution(taskId)`

### Auto-Execute Mode (`autoExecute = true`)

When a task becomes available:
1. `wakeWorker()` chains dispatch via `dispatchChain`
2. Tasks execute **sequentially** (not concurrently)
3. Sequential dispatch prevents concurrent git workspace operations that would corrupt the shared repo

```typescript
// Each task awaits the previous one before starting
this.dispatchChain = this.dispatchChain
  .then(() => this.executeAutoDispatch(taskId, role))
  .catch(error => { /* log */ });
```

## Task Lifecycle Handlers

### `wakeWorker(taskId, role)` — Task Available

Called when RoleTaskQueue emits `task:available`. Routes to either manual pending or auto-dispatch.

### `executeAutoDispatch(taskId, role)` — Auto-Execute

Builds `TaskWithContext` from MemoryManager, updates status to `in_progress`, calls `WorkerPool.runTask()`, emits `task:response`.

### `handleAgentTaskComplete(data)` — Agent Self-Completion

Called when an agent calls the `complete_task` tool:
1. Publishes workspace artifacts via `workspace.publish()`
2. Merges branch to main via `workerPool.mergeAndCleanup()`
3. Calls `memoryManager.completeTask()` — returns newly-ready tasks
4. Emits `task:update` for each newly-ready task

### `handleTaskComplete(taskId, output)` — Task Queue Completion

Called on `task:complete` from RoleTaskQueue:
1. Emits `task:update` with completed status
2. Checks if all tasks done via `memoryManager.isComplete()`
3. If complete: transitions to `idle`, updates plan status to `completed`, emits `execution:complete`

## Plan Approval Flow

When `approvePlan()` is called:

1. Dispose all existing workers (prevent stale workers from previous plan)
2. Clear all existing tasks from MemoryManager
3. Build reverse dependency map (dependants)
4. For each planned task: create MemoryManager task with prerequisites, context (notes, expectedOutput, goal)
5. Set state to `executing`
6. Set goal context on WorkerPool (for artifact/collab scoping)
7. Save plan to disk with `approved` status, then update to `executing`
8. Emit `plan:approved` and `orchestrator:progress` events

## Plan Persistence & Recovery

Plans are stored to disk via `PlanStore` (goalId-scoped):

| Status | Meaning |
|--------|---------|
| `approved` | Plan approved but not yet executing |
| `executing` | Tasks are in progress |
| `completed` | All tasks finished |
| `interrupted` | Graceful shutdown during execution |
| `archived` | Plan was reset/replaced |

On restart, `loadActivePlan()` checks for `executing` or `approved` plans and restores state.

## Events Emitted

| Event | Payload | When |
|-------|---------|------|
| `plan:proposed` | `{ planId, teamId, plan }` | createPlan tool generates plan |
| `plan:approved` | `{ planId, teamId, tasksQueued }` | Plan approved |
| `orchestrator:progress` | `{ teamId, state, message }` | State transitions |
| `task:pending_approval` | `{ taskId, role }` | Task ready but autoExecute=false |
| `task:response` | `{ taskId, role, output }` | Worker first response (auto-dispatch) |
| `task:update` | `{ taskId, status, role }` | Task status changed |
| `task:error` | `{ taskId, role, error }` | Task failed |
| `execution:complete` | `{ teamId }` | All tasks finished |

## Integration Points

- **Created by**: `AgentManager.initializeOrchestrator()` — passed MemoryManager, WorkerPool, events
- **AgentManager**: Calls `handleMessage()`, `approvePlan()`, `setAutoExecute()`, `getState()`, `getPendingPlan()`, `resetPlan()`
- **MemoryManager**: OrchestratorService subscribes to `taskQueue` events. Calls `addTask()` during plan approval.
- **WorkerPool**: OrchestratorService subscribes to `task:agent-complete`. Calls `runTask()` during auto-dispatch.
- **PlanStore**: Persists plans to disk for restart recovery. Scoped by goalId.
