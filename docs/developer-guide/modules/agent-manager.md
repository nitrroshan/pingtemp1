# AgentManager

## Purpose

AgentManager is the top-level orchestrator and public API surface for the Ping backend. It composes OrchestratorService, MemoryManager, WorkerPool, and MemoryCoordinator into a unified workflow. It handles team initialization, plan approval, task lifecycle (approve, start, complete), auto-approve per role, and status reporting.

> **[DEPRECATED]** `USE_ORCHESTRATOR=false` and the legacy API (`configureWorkflow`, `createPlan`, `executeAllTasks`, `run`) are deprecated. The orchestrator flow is the primary path.

## Source File

- `src/worker/agentManager/AgentManagerV2.ts` (~1700 lines)

Note: Despite the filename, the exported class is `AgentManager` (not V2). Accessed via `getAgentManager()` singleton.

## Key Fields

```typescript
class AgentManager {
  private workerPool: WorkerPool;
  private orchestrator: OrchestratorService | null;
  private memoryManager: MemoryManager | null;
  private memoryCoordinator: MemoryCoordinator | null;
  private taskQueue: RoleTaskQueue;               // legacy path
  private definitions: AgentDefinition[];
  private autoApproveRoles: Set<string>;
  private autoApproveAll: boolean;

  public readonly events: EventEmitter;           // forwarded from WorkerPool
}
```

## Initialization

`initializeOrchestrator(teamId, teamRoles)` sets up the full system:

1. Create `MemoryManager`
2. Create `MemoryCoordinator` with L2 (CRDT) and optionally L3 (knowledge) plugins
3. Generate worker `AgentDefinition[]` for each team role (hardcoded system prompts with tool documentation)
4. Register definitions with `WorkerPool`
5. Inject `MemoryCoordinator` into `WorkerPool`
6. Enable L1 workspace (`WorkerPool.enableWorkspace(repoPath)`)
7. Create and initialize `OrchestratorService`

> **[PLANNED]** TeamBuilder will dynamically create worker definitions instead of using hardcoded system prompts. See TODO at `AgentManagerV2.ts:188`.

### Workspace Path

```
${WORKSPACE_BASE_DIR || "./data/workspaces"}/${teamId}
```

## Public API

### Orchestrator API

| Method | Returns | Description |
|--------|---------|-------------|
| `initializeOrchestrator(teamId, teamRoles)` | `void` | Full system setup |
| `orchestratorMessage(content)` | `string` | Send message to orchestrator, get response |
| `approveOrchestratorPlan()` | `{ success, tasksQueued?, autoStarted? }` | Approve pending plan |
| `getOrchestratorState()` | `string \| null` | Current orchestrator state |
| `getOrchestratorPendingPlan()` | `any \| null` | Pending plan if awaiting approval |
| `setAutoExecute(enabled)` | `void` | Toggle auto-execution on OrchestratorService |
| `getAutoExecute()` | `boolean` | Current auto-execute setting |
| `resetPlan()` | `{ deleted, planId? }` | Archive plan, reset orchestrator |
| `dispose()` | `void` | Cleanup resources |

### Auto-Approve API

| Method | Description |
|--------|-------------|
| `setAutoApproveForRole(role, enabled)` | Enable/disable auto-approve for a specific role |
| `setAutoApproveAllRoles(enabled)` | Toggle auto-approve for ALL roles |
| `isAutoApproveEnabled(role)` | Check if role has auto-approve |
| `getAutoApproveRoles()` | List roles with auto-approve enabled |

When auto-approve is enabled for a role, tasks assigned to that role are automatically moved from pending to in_progress after plan approval.

### Task Lifecycle API

| Method | Description |
|--------|-------------|
| `approveTaskForChat(taskId)` | Move task from pending/proposed to `ready` (user can start chatting) |
| `startTaskExecution(taskId)` | Begin agent execution for an approved task |
| `completeTaskByUser(taskId, output?)` | User marks task done — merges workspace, unlocks dependents |

#### Task Lifecycle Flow

```
Plan approved
  → Tasks created as "pending" in MemoryManager
  → Tasks with no dependencies auto-queued as "ready"
  → If autoExecute=true: OrchestratorService dispatches sequentially
  → If autoExecute=false:
      → approveTaskForChat(taskId) → status: "ready"
      → startTaskExecution(taskId) → status: "in_progress"
      → Agent works, calls complete_task OR user calls completeTaskByUser()
      → status: "completed", dependent tasks unlocked
```

### `startTaskExecution` Context Injection

When starting a task, AgentManager combines context from multiple sources:

1. **Basic context** from `MemoryManager.getTaskContext()` — dependency outputs
2. **Knowledge context** from `MemoryCoordinator.getTaskContext()` — relevant docs, role skills, runbooks (L3)
3. **Structured context** from `task.context` — notes, expectedOutput, goal (from PlanBuilder)

### `completeTaskByUser` Flow

1. Merge workspace branch via `WorkerPool.mergeAndCleanup()`
2. Publish workspace artifacts via `workspace.publish()`
3. Complete task via `MemoryCoordinator.completeTask()` (or `MemoryManager.completeTask()` fallback)
4. Emit `task:update` with completed status

### Status API

| Method | Returns | Description |
|--------|---------|-------------|
| `getWorkflowStatus()` | `{ state, pendingTasks, activeTasks, completedTasks }` | Workflow overview |
| `getActiveAgents()` | `Array<{ role, taskId, status }>` | Currently running workers |
| `getStatus()` | `{ state, teamId, agents, tasks }` | Comprehensive status |
| `getTaskStatus(taskId)` | Task summary or null | Single task lookup |

### Team & Agent Management

| Method | Description |
|--------|-------------|
| `discoverRoles(taskDescription)` | Pure function — uses DefinitionBuilder to discover needed roles |
| `registerAgent(definition)` | Add agent to WorkerPool at runtime |
| `unregisterAgent(agentId)` | Remove agent (fails if active tasks exist) |
| `modifyTask(taskId, changes)` | Update pending task's description, priority, or role |
| `discardTask(taskId)` | Remove pending task from queue |

### Accessor Methods

| Method | Returns |
|--------|---------|
| `getMemoryManager()` | `MemoryManager \| null` |
| `getMemoryCoordinator()` | `MemoryCoordinator \| null` |
| `getTaskWorkspace(taskId)` | `AgentWorkspace \| undefined` |
| `isWorkspaceEnabled()` | `boolean` |
| `hasKnowledgeBase()` | `boolean` |
| `isOrchestratorMode` | `boolean` (feature flag) |

## Events

AgentManager forwards all events from WorkerPool and emits additional events:

| Event | Payload | When |
|-------|---------|------|
| `task:approved` | `{ taskId, role }` | Task approved for chat |
| `task:update` | `{ taskId, status, role, output? }` | Task status change |
| `task:modified` | `{ taskId, changes }` | Task properties changed |
| `task:discarded` | `{ taskId, role }` | Task removed |
| `agent:registered` | `{ agentId, role }` | New agent added |
| `agent:unregistered` | `{ agentId, role }` | Agent removed |
| `autoApprove:changed` | `{ role, enabled }` | Auto-approve setting changed |
| `plan:update` | `{ action, tasksQueued }` | Plan approved |

Plus all forwarded events from WorkerPool (`worker:event`, `worker:done`, `worker:error`).

## Integration Points

- **AgentManagerAPI**: Creates AgentManager, passes it to HttpServer and SocketServerV2
- **SocketServerV2**: Calls `orchestratorMessage()`, `approveOrchestratorPlan()`, `startTaskExecution()`, `completeTaskByUser()`, etc. via action handlers
- **HttpServer**: Exposes status endpoints, team management
- **Singleton**: `getAgentManager()` from `src/worker/index.ts`

## Worker Definition Generation

Currently generates hardcoded worker definitions with a comprehensive system prompt documenting all available tools:
- Core workflow tools (report_status, complete_task)
- Workspace tools (workspace_create_file, workspace_read_file, workspace_commit, etc.)
- Scratchpad tools (scratch_note, scratch_todo, scratch_remember)
- Collaboration tools (collab discover/list/read/read-block/write/write-block)
- Identity tools (who_am_i, my_progress, my_tools, my_context)

These are configured in `initializeOrchestrator()` at line 199-295.
