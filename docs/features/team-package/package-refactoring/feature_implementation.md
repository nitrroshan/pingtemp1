# Package Refactoring — Implementation Log

**Parent:** [Feature Architecture](feature_architecture.md) | [Implementation Plan](feature_implementation_planning.md)  
**Branch:** `copilot/complete-roadmap-3-frontend-backend`  
**Status:** Steps 1-10 ✅ Complete | Steps 11-15 ✅ Re-export Shims

---

## Completed (Steps 1-10)

### Step 1: Core Interfaces ✅
Created `packages/backend/plugin/types.ts` with:
- `IPlugin`, `IMcpServer`, `ISkill`, `IPluginStorage`, `IPlanStore`, `ITaskStore`
- `ToolContext` (consumer: planner|worker, role, taskId)
- `SkillContext` (role, taskId, goalId)

Created `packages/backend/plugin/PluginRegistry.ts`:
- `register()`, `get()`, `list()`, `initializeAll()`, `disposeAll()`
- `getTools(context, pluginIds?)` — collect tools from MCP servers
- `getSkillInstructions(context, pluginIds?)` — collect skill playbook text
- `getPluginStorage(pluginId)` — access plugin storage (e.g., L2 PlanStore)

Created `packages/backend/plugin/utils.ts`:
- `toGoalId()` moved from `memory/L2/collaboration/PlanStore.ts` to core

### Steps 3-5: L1/L2/L3 Plugin Wrappers ✅
- `WorkspacePlugin` wraps `L1WorkspacePlugin` via `WorkspaceMcpServer`
- `CollaborationPlugin` wraps `L2CollaborationPlugin` via `CollabMcpServer`
- `KnowledgePlugin` wraps `L3KnowledgePlugin` via `KnowledgeMcpServer`
- Each implements `IPlugin` with `getMcpServers()`, `getSkills()`, `getStorage()`
- Zero behavior change — all delegate to existing code

### Step 6: WorkerPool Decoupled ✅
- Added `setPluginRegistry()` method
- Plugin path: `PluginRegistry.getTools(ToolContext)` + `getSkillInstructions()`
- Legacy path preserved: `memoryCoordinator.L2`/`.L3` as fallback
- Fixed: `systemPromptAdditions` from `SkillResolver` now applied via `appendSystemPrompt()`

### Step 7: AiSdkAgent.appendSystemPrompt() ✅
- New method allows runtime system prompt injection
- Used by both PluginRegistry skills and SkillResolver instructions

### Step 8: AgentManagerV2 Uses PluginRegistry ✅
- Creates `CollaborationPlugin`/`KnowledgePlugin` and registers in both PluginRegistry and legacy MemoryCoordinator
- Injects PluginRegistry into WorkerPool
- Passes L2 PlanStore to OrchestratorService via config

### Step 9: OrchestratorService Decoupled ✅
- Accepts `planStore` via config (defaults to `new PlanStore(teamId)` if not provided)
- `toGoalId()` imported from `plugin/utils.ts` (not L2)
- `getContext.ts` imports `OutputManifest` from shared types (not L2)

### Step 10: Backend Startup Wired ✅
- `AgentManagerV2.initializeOrchestrator()` creates plugins, registers them, and injects into WorkerPool + OrchestratorService

## Steps 11-15: Package Extraction — Re-export Shims ✅

Created 4 workspace packages as re-export shims. Each package re-exports from `@ping/backend` (source of truth):

| Package | Path | Exports |
|---|---|---|
| `@ping/agent-manager` | `packages/agent-manager/` | AgentManager, WorkerPool, OrchestratorService, AiSdkAgent, PluginRegistry, MemoryManager, RoleTaskQueue |
| `@ping/workspace` | `packages/workspace/` | WorkspacePlugin, L1WorkspacePlugin, WorkspaceManager, createWorkspaceTools |
| `@ping/collaboration` | `packages/collaboration/` | CollaborationPlugin, L2CollaborationPlugin, PlanStore, createCollabTool |
| `@ping/knowledge` | `packages/knowledge/` | KnowledgePlugin, L3KnowledgePlugin |

**Approach**: Re-export shims (not full file extraction). This is safer — consumers can start importing from package names immediately. Physical file moves happen later when legacy MemoryCoordinator code is fully removed from WorkerPool and AgentManagerV2.

**Verified**: `bun install` resolves all workspace deps. `bun run build:backend` succeeds.

## Key Decisions

**SkillResolver not split** (Step 2 partially deferred): Current SkillResolver already returns `{ tools, systemPromptAdditions }`. The split into SkillResolver + McpResolver is architectural purity that can happen during package extraction. The fix to actually *apply* systemPromptAdditions was more important and is done.
