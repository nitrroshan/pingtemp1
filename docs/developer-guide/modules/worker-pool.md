# WorkerPool

## Purpose

WorkerPool is the registry and lifecycle manager for active agent instances. It caches agent definitions by role, creates InternalAgent workers on demand, injects the full tool chain (workspace, collaboration, knowledge, lifecycle tools), and bridges the agent's `AsyncGenerator` stream to an `EventEmitter` for Socket.IO consumption.

## Source File

- `src/worker/services/WorkerPool.ts` (~519 lines)

## Key Fields

```typescript
class WorkerPool {
  private definitions: Map<string, AgentDefinition>;  // cached by lowercase role
  private workers: Map<string, InternalAgent>;        // active workers by taskId
  private workspaces: Map<string, AgentWorkspace>;    // workspaces by taskId
  private workspaceManager: WorkspaceManager | null;
  private memoryCoordinator: MemoryCoordinator | null;
  private workerRoles: Map<string, string>;           // taskId → role
  private lastResponses: Map<string, any>;            // taskId → last output

  public readonly events: EventEmitter;               // for Socket.IO subscription
}
```

## Public API

### Definition Management

| Method | Description |
|--------|-------------|
| `registerDefinitions(definitions[])` | Cache definitions by lowercase role |
| `getDefinition(role)` | Get a role's definition |
| `hasRole(role)` | Check if role is registered |

### Configuration

| Method | Description |
|--------|-------------|
| `setMemoryCoordinator(coordinator)` | Inject MemoryCoordinator for L2/L3 tool access |
| `setGoalContext(teamId, goalId)` | Scope collab/artifact context to a goal |
| `enableWorkspace(repoPath)` | Enable L1 git branch isolation |

### Task Execution

| Method | Signature | Description |
|--------|-----------|-------------|
| `runTask` | `(taskId, role, message): Promise<any>` | **Chat mode** — simple params |
| `runTask` | `(task: TaskWithContext): Promise<any>` | **Queue mode** — includes dependency context |

### Cleanup

| Method | Description |
|--------|-------------|
| `dispose(taskId)` | Stop agent, remove from maps |
| `disposeAll()` | Dispose all workers, clear workspace cache |
| `mergeAndCleanup(taskId)` | Merge task's branch to main, cleanup workspace |

### Status

| Method | Description |
|--------|-------------|
| `getWorkspace(taskId)` | Get AgentWorkspace for inspection |
| `getLastResponse(taskId)` | Get last agent output |
| `getActiveWorkers()` | List active workers with role and status |
| `workerCount` / `roleCount` | Number of active workers / registered roles |

## Task Execution Flow (`runTask`)

When `runTask` is called with a `TaskWithContext`:

1. **Resolve role** — normalize to lowercase, look up definition
2. **Create or reuse worker** — if no existing worker for this taskId:
   - Override model config with environment defaults (LLM-generated deployments don't exist)
   - Create new `InternalAgent` from definition
   - Call `agent.initialize()`
3. **Inject tools** in this order:
   ```
   1. report_status       — emit status updates to orchestrator
   2. complete_task        — agent signals task completion
   3. workspace tools      — if L1 enabled (workspace_create_file, workspace_read_file, etc.)
   4. collab tool          — if L2 plugin available (discover, list, read, write, write-block)
   5. knowledge tools      — if L3 plugin available (relevantDocs, roleSkills, roleRunbooks)
   ```
   Then call `agent.setTools([...existing, ...additional])`
4. **Update CRDT status** — set agent status to "working" in L2 agent-statuses doc
5. **Execute** — call `agent.execute(input)`, iterate `AsyncGenerator`
6. **Stream events** — emit each `AgentEvent` as `worker:event` on the EventEmitter
7. **Capture output** — on `done` event, store response and emit `worker:done`
8. **Handle errors** — emit `worker:error`, set CRDT status to "error"

## Default Model Config

WorkerPool overrides any definition's model config with environment-based defaults:

```typescript
const DEFAULT_MODEL_CONFIG = {
  provider: "azure-openai",
  deployment: process.env.AZURE_OPENAI_DEPLOYMENT || "gpt-4o-2",
  temperature: 0.7,
  maxTokens: 4096,
};
```

This prevents LLM-generated deployment names from causing Azure API errors.

## Context Building

For queue mode (`TaskWithContext`), `buildMessageWithContext()` constructs the agent's input:

```
[task description]

## Context from previous tasks:
### Task task-1:
{ output from dependency }

## Available artifacts:
artifact-1
artifact-2
```

## Events Emitted

| Event | Payload | When |
|-------|---------|------|
| `worker:event` | `{ taskId, event: AgentEvent }` | Every streaming event from agent execution |
| `worker:done` | `{ taskId, role, output }` | Agent finished (done event received) |
| `worker:error` | `{ taskId, error: string }` | Agent execution error |
| `task:agent-complete` | `{ taskId, role, summary, deliverables?, nextSteps? }` | Agent called complete_task tool |

## CRDT Agent Status Updates

WorkerPool automatically updates agent status in L2 CRDT (`agent-statuses` doc):

```typescript
// On task start:  { status: "working", currentTask: taskId }
// On task done:   { status: "idle", lastTask: taskId }
// On error:       { status: "error", error: msg }
```

This is non-fatal — CRDT write failures don't break task execution.

## Integration Points

- **Created by**: `AgentManager` constructor (owned as `this.workerPool`)
- **AgentManager**: Registers definitions, injects MemoryCoordinator, enables workspace, calls `runTask()`
- **OrchestratorService**: Subscribes to `events` for `task:agent-complete`. Calls `runTask()` during auto-dispatch.
- **SocketServerV2**: Subscribes to `events` for `worker:event`, `worker:done`, `worker:error` to broadcast to frontend.
