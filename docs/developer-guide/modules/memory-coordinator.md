# MemoryCoordinator

## Purpose

MemoryCoordinator is the plug-and-play coordinator for Ping's three memory layers. Each layer (L1, L2, L3) is a standalone plugin that can be registered independently. The coordinator manages their lifecycle and provides typed access via `.L1`, `.L2`, `.L3` getters.

## Source Files

- `src/worker/memory/MemoryCoordinator.ts` — Main coordinator (~191 lines)
- `src/worker/memory/types/plugins.ts` — IMemoryPlugin, IL1WorkspacePlugin, IL2CollaborationPlugin, IL3KnowledgePlugin
- `src/worker/memory/L1/workspace/WorkspaceManager.ts` — Git workspace management
- `src/worker/memory/L1/workspace/AgentWorkspace.ts` — Per-task workspace with file ops
- `src/worker/memory/L2/L2CollaborationPlugin.ts` — CRDT collaboration via Hocuspocus/Yjs
- `src/worker/memory/L2/collaboration/PlanStore.ts` — Plan persistence
- `src/worker/memory/L3/L3KnowledgePlugin.ts` — MongoDB knowledge base

## Plugin Architecture

All plugins implement the base `IMemoryPlugin` interface:

```typescript
type MemoryLayerId = "L1" | "L2" | "L3";

interface IMemoryPlugin {
  readonly layerId: MemoryLayerId;
  readonly name: string;
  readonly isReady: boolean;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}
```

Plugins are created externally and registered with the coordinator. MemoryCoordinator never imports any layer implementation directly — it only depends on the interfaces.

## MemoryCoordinator Class

### Configuration

```typescript
interface MemoryCoordinatorConfig {
  teamId: string;
  memoryManager: MemoryManager;
}
```

### Public API

| Method | Signature | Description |
|--------|-----------|-------------|
| `registerPlugin(plugin)` | `void` | Register a layer plugin (replaces existing for same layer) |
| `unregisterPlugin(layerId)` | `Promise<void>` | Dispose and remove plugin |
| `getPlugin<T>(layerId)` | `T \| null` | Get typed plugin by layer |
| `hasLayer(layerId)` | `boolean` | Check if layer is registered and ready |
| `initializeAll()` | `Promise<void>` | Initialize all non-ready plugins |
| `disposeAll()` | `Promise<void>` | Dispose all plugins and clear registry |
| `getTaskContext(taskId)` | `Promise<{ knowledgeContext? }>` | Query L3 for task-relevant knowledge |
| `completeTask(taskId, output)` | `Promise<void>` | Delegates to MemoryManager.completeTask() |

### Typed Layer Access

```typescript
coordinator.L1  // IL1WorkspacePlugin | null
coordinator.L2  // IL2CollaborationPlugin | null
coordinator.L3  // IL3KnowledgePlugin | null
```

## Memory Layers

### L1: Workspace (Git Branch Isolation)

**Plugin**: `IL1WorkspacePlugin`
**Implementation**: `WorkspaceManager` + `AgentWorkspace`

Each task gets an isolated git branch. File operations happen within the branch, preventing cross-task interference.

**Branch lifecycle**: create → edit → commit → publish → merge

**Key operations**:

| Interface Method | Description |
|------------------|-------------|
| `createWorkspace(agentId, taskId)` | Create branch-isolated workspace |
| `getWorkspace(taskId)` | Get existing workspace |
| `createTools(workspace)` | Generate LangChain tools for file ops |
| `initializeWorkspace()` | Initialize git repository |

**Agent tools provided**:
- `workspace_create_file`, `workspace_write_file`, `workspace_read_file`
- `workspace_list_files`, `workspace_delete_file`, `workspace_file_exists`
- `workspace_grep`, `workspace_glob`, `workspace_keyword_search`
- `workspace_search_and_replace`
- `workspace_commit`, `workspace_publish`
- `workspace_status`, `workspace_info`, `workspace_get_history`

### L2: Collaboration (CRDT via Hocuspocus/Yjs)

**Plugin**: `IL2CollaborationPlugin`
**Implementation**: `L2CollaborationPlugin` with `CollaborationSpace`, `PlanStore`, `GroupChatManager`

Provides real-time shared state for team collaboration. Documents are Yjs CRDTs that all agents and humans can read and write simultaneously.

**Key operations**:

| Interface Method | Description |
|------------------|-------------|
| `getOrCreateSpace(goalId)` | Get/create collaboration space for a goal |
| `archiveSpace(goalId)` | Archive space (data persists) |
| `getGroupChatManager(goalId)` | Get group chat manager |
| `planStore` | Access plan persistence |
| `getOutputManifest(repoPath, taskId)` | Read output manifest |
| `getAllManifests(repoPath)` | List all output manifests |
| `createTools(space, agentRole, repoPath)` | Create unified collab tool |

**Agent tool (collab) actions**:

| Action | Description |
|--------|-------------|
| `discover` | Browse categories: `crdt`, `plans`, `outputs` |
| `list` | See keys in a document |
| `read` | Fetch structured JSON value from Y.Map |
| `read-block` | Read collaborative editor content (text written by humans/agents) |
| `write` | Set structured JSON data (for agent-statuses, configs) |
| `write-block` | Insert rich text into collaborative editor (for reports, research) |

**When to use which**:
- `write` → structured data: agent-statuses, API contracts, configs
- `write-block` → human-readable content: reports, specs, summaries
- `read` → structured data lookups
- `read-block` → read the shared document

### L3: Knowledge (MongoDB + Vector Embeddings)

**Plugin**: `IL3KnowledgePlugin`
**Implementation**: `L3KnowledgePlugin`

Provides RAG-based knowledge retrieval — relevant documents, role-specific skills, and runbooks.

**Key operations**:

| Interface Method | Description |
|------------------|-------------|
| `relevantDocs(query, limit?)` | Semantic search for documents |
| `roleSkills(role)` | Get role-specific skills |
| `roleRunbooks(role)` | Get role-specific runbooks |
| `createTools(agentId, taskId)` | Create knowledge query tools |

**Requires**: `MONGODB_URI` environment variable. If not set, L3 is not registered.

## Task Context API

`getTaskContext(taskId)` queries L3 if available:

```typescript
const context = await coordinator.getTaskContext(taskId);
// Returns:
{
  knowledgeContext?: {
    relevantDocs: Array<{ document: { title, content } }>;
    roleSkills: Array<{ title, content }>;
    roleRunbooks: Array<{ title, content }>;
  }
}
```

Used by `AgentManager.startTaskExecution()` to inject knowledge into agent prompts.

## Integration Points

- **Created by**: `AgentManager.initializeOrchestrator()` — creates coordinator, registers L2 and optionally L3 plugins
- **WorkerPool**: Receives coordinator via `setMemoryCoordinator()`. Uses `.L2` for collab tools and agent status CRDT. Uses `.L3` for knowledge tools.
- **AgentManager**: Calls `getTaskContext()` during `startTaskExecution()` for knowledge injection. Calls `completeTask()` during `completeTaskByUser()`.
- **OrchestratorService**: Indirectly via WorkerPool for workspace publish/merge during task completion.

## Example: Plugin Registration

```typescript
const coordinator = new MemoryCoordinator({ teamId, memoryManager });

// Register L2 collab
const l2 = new L2CollaborationPlugin({
  teamId,
  collabStorageDir: `${repoPath}/.ping/collab`,
  repoPath,
});
coordinator.registerPlugin(l2);

// Register L3 knowledge (optional, requires MongoDB)
if (process.env.MONGODB_URI) {
  const l3 = new L3KnowledgePlugin({ mongoUri: process.env.MONGODB_URI });
  coordinator.registerPlugin(l3);
}

// Initialize all
await coordinator.initializeAll();

// Use typed accessors
const space = coordinator.L2?.getOrCreateSpace("goal-123");
const docs = await coordinator.L3?.relevantDocs("AI agents");
```
