# Workspace Lifecycle — Feature Architecture

**Status: ✅ Complete**

## Problem Statement

The workspace lifecycle (create → tools → publish → merge → cleanup) was fragmented across 3 packages:

1. **Stub merge** — `WorkerPool.mergeAndCleanup()` was a no-op. Branches never merged.
2. **Dual caches** — `WorkerPool.workspaces` Map vs `WorkspaceManager.workspaces` Map.
3. **Workspace tools missing** — `getWorkspace()` called but `createWorkspace()` never called. Agents only got collab tools.
4. **SOLID violations** — WorkerPool reached into plugin internals (`getStorage().manager`), coupling it to workspace plugin shape.

## Solution: Plugin Lifecycle Hooks (SOLID)

Added `onTaskComplete` and `onTaskFailed` lifecycle methods to `IPlugin` interface. WorkerPool and OrchestratorService depend only on `IPlugin` abstraction — never touch plugin internals.

### SOLID Compliance

| Principle | How |
|-----------|-----|
| **S** (Single Responsibility) | WorkerPool manages workers only. Workspace lifecycle is WorkspacePlugin's job. |
| **O** (Open/Closed) | Any plugin can hook into `onTaskComplete`/`onTaskFailed` without modifying WorkerPool. |
| **L** (Liskov) | All IPlugin implementations are interchangeable — lifecycle methods are optional. |
| **I** (Interface Segregation) | Only 2 optional methods added. No plugin is forced to implement unneeded lifecycle. |
| **D** (Dependency Inversion) | OrchestratorService depends on `PluginRegistry` (abstraction), not `WorkspaceManager` (concrete). |

### Changes

| Component | Before | After |
|-----------|--------|-------|
| `IPlugin` | No lifecycle hooks | `prepareForTask?`, `onTaskComplete?`, `onTaskFailed?` |
| `PluginRegistry` | Only `getTools`/`getSkillInstructions` | + `prepareForTask`, `onTaskComplete`, `onTaskFailed` |
| `WorkspacePlugin` | Tool provider only | Implements all 3 lifecycle hooks (create, publish+merge, fail) |
| `OrchestratorService` | Manual `workspace.publish()` + `workerPool.mergeAndCleanup()` | `pluginRegistry.onTaskComplete()` |
| `AgentManagerV2` | Same manual workspace ops in `completeTaskByUser` | `pluginRegistry.onTaskComplete()` |
| `WorkerPool` | Had `mergeAndCleanup()`, `getWorkspace()`, `getWorkspaceManager()` | All removed — no workspace knowledge |

### Data Flow

```
Worker created:
  WorkerPool.runTask()
    → pluginRegistry.prepareForTask()          → WorkspacePlugin creates workspace via L1
    → pluginRegistry.getTools()                → WorkspaceMcpServer returns 32 tools

Worker completes (agent calls complete_task):
  OrchestratorService.onWorkerDone()
    → pluginRegistry.onTaskComplete(taskId)    → WorkspacePlugin.onTaskComplete()
      → workspace.publish()                      (publish outputs)
      → manager.mergeAndCleanup()                (merge branch to main)
    → taskStore.completeTask()

Worker completes (user-initiated):
  AgentManagerV2.completeTaskByUser()
    → pluginRegistry.onTaskComplete(taskId)    → same flow as above
    → taskStore.completeTask()

Task fails:
  → pluginRegistry.onTaskFailed(taskId)        → WorkspacePlugin keeps branch for debugging
```

### Key Design Decisions

- **`getTaskWorkspace()` stays on AgentManagerV2** — CLI/HTTP inspection is a read-only query, acceptable to go through plugin storage via `pluginRegistry.get("workspace").getStorage().manager`.
- **`isWorkspaceEnabled()` stays on WorkerPool** — just checks `pluginRegistry !== null`, no workspace coupling.
- **`onTaskFailed` keeps branches** — failed task branches are retained for debugging. `WorkspaceManager.cleanupFailed()` can be called later.
