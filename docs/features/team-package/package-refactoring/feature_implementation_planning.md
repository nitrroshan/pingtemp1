# Package Refactoring — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Approach:** Option A — Plugin Architecture (Claude Code Model)  
**Branch:** `feature/package-refactoring`

---

## Scope

Decouple the backend monolith into `@ping/agent-manager` + `@ping/teams` using the Claude Code plugin model. Wrap existing code in plugin interfaces — minimal rewrite, mostly structural.

## Implementation Steps

### Step 1: Define Core Interfaces

**Create:** `packages/backend/plugin/types.ts`

```
IPlugin         { id, name, initialize, dispose, getMcpServers, getSkills, getStorage? }
IMcpServer      { id, name, getTools(context: ToolContext) }
ISkill          { id, name, description, loadMode, getInstructions, allowedTools? }
ToolContext      { consumer: 'planner' | 'worker', role?, taskId? }
SkillContext     { role, taskId, goalId }
IPluginStorage  { }  (marker interface — plugins define their own shape)
IPlanStore      { savePlan, loadPlan, listPlans, archivePlan }
ITaskStore      { addTask, getTask, updateStatus, getReadyTasks }
```

**Create:** `packages/backend/plugin/FilePlanStore.ts` — JSON-on-disk plan persistence  
**Create:** `packages/backend/plugin/FileTaskStore.ts` — JSON-on-disk task persistence  
**Create:** `packages/backend/plugin/PluginRegistry.ts` — register/get/list plugins, resolve tools per context

**Exit:** Interfaces compile. `FilePlanStore` read/write works. PluginRegistry can register and lookup plugins.

---

### Step 2: Split SkillResolver → SkillResolver + McpResolver

**Modify:** `packages/backend/skills/SkillResolver.ts`

Current `resolveOne()` handles 3 types:
- `"tool"` → creates AI SDK `tool()` → **becomes on-demand skill** (ISkill with `loadMode: 'on-demand'`)
- `"mcp"` → returns system prompt text → stays as ISkill with `loadMode: 'always'`
- `"instruction"` → returns system prompt text → stays as ISkill with `loadMode: 'always'`

**Create:** `packages/backend/skills/McpResolver.ts`  
- Resolve MCP server IDs → `AiSdkTool[]`  
- Initially wraps the existing `skillRegistry` for tool-type skills  
- Later: connects to actual MCP servers via protocol  

**Modify:** `packages/backend/skills/SkillResolver.ts`  
- `resolve(skillIds)` now returns `{ instructions: string[], onDemandTools: AiSdkTool[] }`
- For `always` mode: full instructions go into `instructions[]` (injected into system prompt)
- For `on-demand` mode: short description goes into `instructions[]` ("Available skill: deep-research — invoke when you need...") + a thin `invoke_skill` tool goes into `onDemandTools[]` (agent calls it, gets full instructions back)
- Remove `createToolSkill()` — replaced by on-demand invoke tool

**On-demand skill loading pattern:**
```typescript
// Agent always sees this in system prompt (tiny):
"Available skill: deep-research — Thorough research methodology. 
 Use invoke_skill('deep-research') when you need detailed research guidance."

// When agent calls invoke_skill('deep-research'), it gets full instructions:
"When researching, always verify from 3+ sources. Start with..."
```

This mirrors Claude Code exactly: skill descriptions always in context, full content loads on invoke.

**Exit:** `SkillResolver.resolve()` returns instructions (always) + on-demand tools. `McpResolver.resolve()` returns executable tools. Agent always knows what skills are available.

---

### Step 3: Wrap L1 as WorkspacePlugin

**Create:** `packages/backend/plugin/plugins/WorkspacePlugin.ts`

```typescript
class WorkspacePlugin implements IPlugin {
  getMcpServers() → [WorkspaceMcpServer]
  getSkills()     → [WorkspaceGuideSkill]
  getStorage()    → { manager: WorkspaceManager }
}

class WorkspaceMcpServer implements IMcpServer {
  getTools(ctx) {
    if (ctx.consumer === 'planner') return [];  // planner doesn't need workspace tools
    const workspace = this.plugin.getStorage().manager.createWorkspace(ctx.role, ctx.taskId);
    return createWorkspaceTools(workspace);  // ← existing function, unchanged
  }
}
```

**Existing files unchanged:**
- `memory/L1/L1WorkspacePlugin.ts` — still works, WorkspacePlugin delegates to it
- `memory/L1/workspace/tools/workspace-tools.ts` — all 31 tools unchanged
- `memory/L1/workspace/WorkspaceManager.ts` — unchanged

**Exit:** `WorkspacePlugin` registers and provides tools via `getMcpServers()`. Existing L1 code untouched.

---

### Step 4: Wrap L2 as CollaborationPlugin

**Create:** `packages/backend/plugin/plugins/CollaborationPlugin.ts`

L2 is the **differentiator** — real-time shared workspace where discussions don't block work. Unlike competitors (CrewAI: message-passing, AutoGen: turn-based chat), Ping agents work AND discuss in parallel on shared CRDT documents that humans can co-edit.

**L2 = shared CRDT workspace + collaboration tools + search/indexing.** The base is a Hocuspocus CRDT server. Agents get filesystem-like tools (read, write, list, grep, search) plus collaboration-specific tools (group chat, publish, status). Search is powered by the Hocuspocus Search Extension (MiniSearch auto-indexed on CRDT changes).

```
L1 (per-agent workspace):           L2 (shared team workspace):
───────────────────────              ──────────────────────────────
workspace_read                  →    collab_read (cat)
workspace_write                 →    collab_write
workspace_list                  →    collab_list (ls)
workspace_grep                  →    collab_grep (regex search)
workspace_keyword_search        →    collab_search (MiniSearch BM25 + fuzzy)
workspace_file_stats            →    collab_stat (who, when, size)
  —                             →    collab_query (JSONPath on live CRDT — unique to L2)
  —                             →    collab_whatsnew (changelog since timestamp)
  —                             →    group_chat_start / send / read
  —                             →    publish_artifact / list_artifacts
  —                             →    update_status / get_team_status
```

**Architecture — single Hocuspocus server, four MCP servers:**

```typescript
class CollaborationPlugin implements IPlugin {
  private collabServer: CollabServer;  // Hocuspocus CRDT + Search Extension

  getMcpServers() {
    return [
      // ── Shared Docs (filesystem-like, mirrors L1 patterns) ──────────
      new CollabDocsMcpServer(this.collabServer),
      //   collab_read      — read any shared doc (wraps /cat)
      //   collab_write     — write/update shared doc (sets owner on create, owner-checked on update)
      //   collab_list      — list all docs (wraps /ls)
      //   collab_grep      — regex search across docs (wraps /grep)
      //   collab_search    — keyword search via MiniSearch (wraps /search)
      //   collab_query     — JSONPath on live CRDT state (wraps /query)
      //   collab_stat      — doc metadata: author, owner, updated, size (wraps /stat)
      //   collab_whatsnew   — what changed since timestamp (wraps /whatsnew)
      //
      //   Agents use the same patterns as L1:
      //     collab_grep('API design') → finds discussions mentioning it
      //     collab_search('authentication') → BM25 ranked results
      //     collab_query('$.tasks[?(@.status=="ready")]') → structured plan query
      //     collab_whatsnew({ since: '10m' }) → what happened in last 10 min

      // ── Group Chat (time-boxed discussions → outcomes → tasks) ──────
      new GroupChatMcpServer(this.collabServer),
      //   group_chat_start — initiate discussion (topic, participants, time limit)
      //   group_chat_send  — post message in active discussion
      //   group_chat_read  — read discussion history + outcome
      //   (outcomes auto-extracted by LLM → become new tasks in DAG)

      // ── Publish (output manifests for review) ──────────────────────
      new PublishMcpServer(this.collabServer),
      //   publish_artifact  — publish deliverable for review
      //   list_artifacts    — list published artifacts + status
      //   review_artifact   — approve/reject/comment on artifact

      // ── Status (real-time team progress board) ─────────────────────
      new StatusMcpServer(this.collabServer),
      //   update_status    — update own progress (% complete, blockers)
      //   get_team_status  — see all agents' current status
    ];
  }

  getSkills() {
    return [new CollabGuideSkill()];
    // → "BEFORE starting any task:
    //    1. collab_search to find relevant shared context
    //    2. publish_artifact('pre-task-review/task-{id}', {
    //         gathered_context: '...',
    //         my_understanding: '...',
    //         open_questions: ['...'],
    //         planned_approach: '...'
    //       })
    //    3. If open questions exist → create sub-tasks:
    //       - assign to the agent/role who likely knows the answer
    //       - or assign to 'human' for user input
    //       - these sub-tasks resolve before your main task continues
    //    4. THEN start executing the task with resolved context
    //
    //    DURING task: update_status with progress, collab_write findings
    //    AFTER task: publish_artifact with deliverables for final review
    //    Use group_chat for decisions that need multi-party discussion."
  }

  getStorage() {
    return {
      crdt: this.collabServer,
      planStore: new CrdtPlanStore(this.collabServer),
      taskStore: new CrdtTaskStore(this.collabServer),
    };
  }
}
```

**How agents discover and navigate (solved by search tools):**

```
Agent starts task "Write API documentation":

  1. collab_search('API design')        → BM25 results:
       discussions/api-review (score: 0.92, by: designer+writer, 10min ago)
       shared/decisions-log (score: 0.71, updated: 3min ago)

  2. collab_grep('endpoint.*POST')      → regex matches:
       shared/api-spec:L42 — "POST /api/teams/:id/goals"
       artifacts/draft-v1:L15 — "POST endpoint for creating..."

  3. collab_whatsnew({ since: '30m' })   → recent activity:
       designer updated shared/wireframes (25min ago)
       writer created artifacts/draft-v1 (5min ago)
       researcher completed group_chat/approach-debate (12min ago)

  4. collab_query('$.tasks[?(@.assigned_role=="writer")]')  → structured:
       [{ id: 'task-002', status: 'completed', output: 'draft-v1' }]

  5. collab_read('discussions/approach-debate')  → reads the full discussion

  6. collab_write('artifacts/api-docs-v1', content)  → publishes work
       → SearchExtension auto-re-indexes (2s debounce)
       → other agents see it via collab_search or collab_whatsnew
```

**No special registry needed.** Search + grep + whatsnew gives agents full discoverability using the same patterns they use on L1 workspaces.

**Document ownership:** Every L2 doc has an `owner` field (set on create, stored in CRDT metadata). Ownership rules TBD — for now just tracked. Future: owner-based write permissions (only owner can edit, others can comment/suggest), ownership transfer, shared ownership for collaborative docs.

**Future MCP servers (just add to the list):**
- `ReviewMcpServer` — structured code review workflows
- `DebateMcpServer` — structured agent debates for decision-making
- `HandoffMcpServer` — explicit task handoff with context packaging
- Semantic search (Tier 3) — add embedding-based search to CollabDocsMcpServer

**Depends on:** L2 Search & Indexing feature ([l2-search-indexing/](../l2-search-indexing/feature_architecture.md)) — Hocuspocus Search Extension, MiniSearch, HTTP endpoints `/search`, `/grep`, `/ls`, `/cat`, `/stat`, `/query`, `/whatsnew`. Build in parallel or before this step.

**Existing files reused (not rewritten):**
- `memory/L2/L2CollaborationPlugin.ts` — CollaborationPlugin delegates to it
- `memory/L2/collaboration/PlanStore.ts` — exposed via CrdtPlanStore
- `memory/L2/collaboration/GroupChatManager.ts` — wrapped by GroupChatMcpServer
- `memory/L2/collaboration/CollaborationSpace.ts` — wrapped by CollabDocsMcpServer
- `memory/L2/collaboration/HocuspocusServer.ts` — core CRDT server
- `memory/L2/tools/index.ts` — existing `createCollabTool()` can be refactored into CollabDocsMcpServer

**Exit:** L2 is a shared CRDT workspace with search/indexing. Agents navigate via grep/search/whatsnew (same patterns as L1). Group chat, publish, status are separate MCP servers on the same CRDT. New collaboration patterns = new MCP server, same CRDT.

---

### Step 5: Wrap L3 as KnowledgePlugin

**Create:** `packages/backend/plugin/plugins/KnowledgePlugin.ts`

```typescript
class KnowledgePlugin implements IPlugin {
  getMcpServers() → [KnowledgeMcpServer]
  getSkills()     → [KnowledgeGuideSkill]
  getStorage()    → { kb: KnowledgeBase }
}

class KnowledgeMcpServer implements IMcpServer {
  getTools(ctx) {
    if (ctx.consumer === 'planner') return [];
    return this.l3.createTools(ctx.role, ctx.taskId);
  }
}
```

**Existing files unchanged:** `memory/L3/L3KnowledgePlugin.ts`, `memory/L3/knowledge/KnowledgeBase.ts`

**Exit:** `KnowledgePlugin` registers and provides knowledge tools.

---

### Step 6: Refactor WorkerPool — Plugin-Based Tool Assembly

**Modify:** `packages/backend/services/WorkerPool.ts`

**Remove these imports:**
```
- import { createWorkspaceTools } from "../memory/L1/workspace/tools/workspace-tools.js";
- import { createCollabTool } from "../memory/L2/tools/index.js";
- import { skillResolver } from "../skills/SkillResolver.js";
- import { WorkspaceManager } from "../memory/L1/workspace/WorkspaceManager.js";
- import { AgentWorkspace } from "../memory/L1/workspace/AgentWorkspace.js";
```

**Add:** `import { PluginRegistry } from "../plugin/PluginRegistry.js";`

**Replace tool assembly in `runTask()` (lines ~212-249):**

Before: 5 hard-coded tool factory calls  
After:
```typescript
// Collect tools from all active plugins for this role
const pluginTools = this.pluginRegistry.getToolsForRole(roleKey, taskId, teamPlugins, rolePlugins);
// Collect skills from all active plugins
const pluginSkills = this.pluginRegistry.getSkillsForRole(roleKey, teamPlugins, rolePlugins);
// Inject skills into system prompt
agent.appendSystemPrompt(pluginSkills);
// Base tools (report_status, complete_task) still created directly
const tools = [...baseTools, ...pluginTools];
```

**Replace `refreshSkillTools()` (lines ~490-560):**

Before: calls `skillResolver.resolve()` directly  
After:
```typescript
// Per-role MCP tools (from DB assignments)
const mcpTools = await mcpResolver.resolve(roleMcpServerIds);
// Per-role skills (from DB assignments)  
const skills = await skillResolver.resolve(roleSkillIds);
agent.appendSystemPrompt(skills);
await agent.setTools([...baseTools, ...pluginTools, ...mcpTools]);
```

**Exit:** WorkerPool has zero imports from `memory/` or `skills/`. Gets tools from PluginRegistry + McpResolver.

---

### Step 7: Add System Prompt Injection to AiSdkAgent

**Modify:** `packages/backend/agent/internal/AiSdkAgent.ts`

**Add method:**
```typescript
appendSystemPrompt(additions: string[]): void {
  if (additions.length === 0) return;
  const extra = additions.join('\n\n');
  this.definition.systemPrompt = (this.definition.systemPrompt || '') + '\n\n' + extra;
}
```

**Exit:** Skills (prompt playbooks) can inject instructions into agent system prompt at runtime.

---

### Step 8: Refactor AgentManagerV2 — Plugin Registry

**Modify:** `packages/backend/agentManager/AgentManagerV2.ts`

**Remove these imports:**
```
- import { MemoryCoordinator } from "../memory/MemoryCoordinator.js";
- import { L2CollaborationPlugin } from "../memory/L2/L2CollaborationPlugin.js";
- import { L3KnowledgePlugin } from "../memory/L3/L3KnowledgePlugin.js";
```

**Add:**
```
+ import { PluginRegistry } from "../plugin/PluginRegistry.js";
+ import { FilePlanStore } from "../plugin/FilePlanStore.js";
+ import { FileTaskStore } from "../plugin/FileTaskStore.js";
```

**Replace `initializeOrchestrator()` (lines ~100-250):**

Before: directly creates L2, L3, MemoryCoordinator, WorkspaceManager  
After:
```typescript
async initializeOrchestrator(teamId, teamRoles, config?) {
  // Core persistence (default: file-based)
  this.planStore = config?.planStore ?? new FilePlanStore(teamId);
  this.taskStore = config?.taskStore ?? new FileTaskStore(teamId);

  // Initialize registered plugins
  await this.pluginRegistry.initializeAll();

  // Auto-upgrade persistence if L2 provides planStore/taskStore
  const l2Storage = this.pluginRegistry.getPluginStorage('L2');
  if (l2Storage?.planStore) this.planStore = l2Storage.planStore;
  if (l2Storage?.taskStore) this.taskStore = l2Storage.taskStore;

  // Inject PluginRegistry into WorkerPool (instead of MemoryCoordinator)
  this.workerPool.setPluginRegistry(this.pluginRegistry);

  // Create OrchestratorService with core planStore
  this.orchestrator = new OrchestratorService({
    planStore: this.planStore,
    ...
  });
}
```

**Exit:** AgentManagerV2 no longer imports L2/L3/MemoryCoordinator directly. Uses PluginRegistry.

---

### Step 9: Decouple OrchestratorService from L2 Imports

**Modify:** `packages/backend/orchestrator/OrchestratorService.ts`

**Remove:**
```
- import { PlanStore, toGoalId } from "../memory/L2/collaboration/PlanStore.js";
```

**Change constructor to accept `IPlanStore`:**
```typescript
constructor(config: OrchestratorConfig) {
  this.planStore = config.planStore;  // injected, not imported
}
```

**Modify:** `packages/backend/orchestrator/tools/createPlan.ts`
- Remove: `import { toGoalId } from "../../memory/L2/collaboration/PlanStore.js";`
- Move `toGoalId()` utility function into `@ping/agent-manager` core (it's just a string hash — no L2 dependency)

**Modify:** `packages/backend/orchestrator/tools/getContext.ts`
- Remove: `import type { OutputManifest } from "../../memory/L2/collaboration/types/output-manifest.types.js";`
- Define a generic `IOutputManifest` type in core, or accept `any` and let the plugin provide the shape

**Modify:** `packages/backend/orchestrator/types.ts`
- Remove: `import type { PlanStore } from "../memory/L2/collaboration/PlanStore.js";`
- Replace with: `import type { IPlanStore } from "../plugin/types.js";`
- Remove: `import type { MemoryManager } from "../memory/MemoryManager.js";`
- Replace with: `import type { MemoryManager } from "../MemoryManager.js";` (after move to agent-manager)

**Exit:** OrchestratorService + all its tools have zero dependency on `memory/L2/`. PlanStore injected via config. `toGoalId()` in core. OutputManifest type generalized.

---

### Step 10: Wire Backend Startup

**Modify:** `packages/backend/api/AgentManagerAPI.ts` (or wherever teams are initialized)

```typescript
// Create manager
const manager = new AgentManager();

// Register plugins
manager.registerPlugin(new WorkspacePlugin(l1Config));
manager.registerPlugin(new CollaborationPlugin(l2Config));
manager.registerPlugin(new KnowledgePlugin(l3Config));

// Initialize with team
await manager.initializeOrchestrator(teamId, roles);
```

**Exit:** Backend starts with all plugins registered. Golden path works end-to-end.

---

## Testing Strategy

After each step:
1. `bun run build:backend` — compiles without errors
2. `bun run dev:backend && bun run dev:frontend` — golden path works:
   - Submit goal → plan streams → approve → tasks execute → results shown
3. After Step 6 (main refactor): verify all 31 workspace tools, collab tool, knowledge tools still work

## Rollback Plan

Each step is independently committable. If a step breaks:
- Revert that step's commit
- Old import paths still work (plugin wrappers delegate to existing code)

## Complexity

Medium-High — 3-4 weeks total.
- Steps 1-5: additive (new files, 1 week)
- Step 6: key refactor — WorkerPool decoupling (3-4 days)
- Steps 7-9: cleanup (2-3 days)
- Step 10: wiring (1 day)
- Steps 11-15: package extraction (1-1.5 weeks)

---

## Package Extraction (Steps 11-15)

After Steps 1-10, the code is decoupled but still in `packages/backend/`. These steps move files into separate publishable packages.

### Step 11: Create `@ping/agent-manager` Package

**Create:** `packages/agent-manager/package.json`
```json
{
  "name": "@ping/agent-manager",
  "version": "0.1.0",
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "dependencies": {
    "ai": "...",
    "@ai-sdk/azure": "...",
    "zod": "...",
    "tslog": "..."
  }
}
```

**Create:** `packages/agent-manager/tsconfig.json`

**Move from `packages/backend/` → `packages/agent-manager/src/`:**

| What | From | To |
|---|---|---|
| AgentManager | `agentManager/AgentManagerV2.ts` | `src/AgentManager.ts` |
| WorkerPool | `services/WorkerPool.ts` | `src/WorkerPool.ts` |
| OrchestratorService | `orchestrator/OrchestratorService.ts` | `src/OrchestratorService.ts` |
| Orchestrator tools | `orchestrator/tools/*` | `src/orchestrator/tools/*` |
| Orchestrator types/schemas | `orchestrator/types.ts`, `schemas.ts` | `src/orchestrator/` |
| AiSdkAgent | `agent/internal/AiSdkAgent.ts` | `src/agent/AiSdkAgent.ts` |
| AgentFactory | `agent/AgentFactory.ts` | `src/agent/AgentFactory.ts` |
| BaseAgent | `agent/BaseAgent.ts` | `src/agent/BaseAgent.ts` |
| Agent YAML definitions | `agent/agents/*.yaml` | `src/agent/agents/*.yaml` |
| ModelProvider | `agent/providers/ModelProvider.ts` | `src/agent/ModelProvider.ts` |
| SmoothStream | `agent/streaming/smoothStream.js` | `src/agent/smoothStream.js` |
| Base tools | `agent/internal/tools/*` | `src/tools/*` |
| Agent schemas | `agent/internal/schemas/*` | `src/agent/schemas/*` |
| Agent types | `agent/types.ts` | `src/agent/types.ts` |
| MemoryManager | `memory/MemoryManager.ts` | `src/MemoryManager.ts` |
| Task types | `memory/types/Task.types.ts` | `src/types/Task.ts` |
| RoleTaskQueue | `util/RoleTaskQueue.ts` | `src/RoleTaskQueue.ts` |
| Plugin interfaces | `plugin/types.ts` | `src/plugin/types.ts` |
| PluginRegistry | `plugin/PluginRegistry.ts` | `src/plugin/PluginRegistry.ts` |
| FilePlanStore | `plugin/FilePlanStore.ts` | `src/persistence/FilePlanStore.ts` |
| FileTaskStore | `plugin/FileTaskStore.ts` | `src/persistence/FileTaskStore.ts` |

**Create:** `packages/agent-manager/src/index.ts` — barrel exports:
```typescript
export { AgentManager } from './AgentManager.js';
export { WorkerPool } from './WorkerPool.js';
export { OrchestratorService } from './OrchestratorService.js';
export { AiSdkAgent } from './agent/AiSdkAgent.js';
export { AgentFactory } from './agent/AgentFactory.js';
export { MemoryManager } from './MemoryManager.js';
export { PluginRegistry } from './plugin/PluginRegistry.js';
export { FilePlanStore } from './persistence/FilePlanStore.js';
export { FileTaskStore } from './persistence/FileTaskStore.js';
export type { IPlugin, IMcpServer, ISkill, ToolContext, IPlanStore, ITaskStore } from './plugin/types.js';
export type { AgentDefinition, AgentEvent, AgentInput } from './agent/types.js';
export type { Task, TaskStatus } from './types/Task.js';
```

**Add to root `package.json` workspaces:** `"packages/agent-manager"`

**Exit:** `@ping/agent-manager` builds independently. `bun run build` in `packages/agent-manager/` produces `dist/`. No imports from `memory/L1`, `memory/L2`, `memory/L3`, `skills/`, or `team/`.

---

### Step 12: Create `@ping/teams` Package

**Create:** `packages/teams/package.json`
```json
{
  "name": "@ping/teams",
  "version": "0.1.0",
  "type": "module",
  "dependencies": {
    "@ping/agent-manager": "workspace:*",
    "mongoose": "..."
  }
}
```

**Move from `packages/backend/` → `packages/teams/src/`:**

| What | From | To |
|---|---|---|
| TeamService | `team/TeamService.ts` | `src/TeamService.ts` |
| Team models | `team/models.ts` | `src/models.ts` |
| Team types | `team/types/*` | `src/types/*` |
| Team errors | `team/errors.ts` | `src/errors.ts` |
| SkillResolver | `skills/SkillResolver.ts` | `src/skills/SkillResolver.ts` |
| McpResolver | `skills/McpResolver.ts` | `src/skills/McpResolver.ts` |
| SkillRegistry service | `skills/services/*` | `src/skills/services/*` |
| Skill types | `skills/types/*` | `src/skills/types/*` |

**Create:** `packages/teams/src/index.ts` — barrel exports:
```typescript
export { TeamService } from './TeamService.js';
export { SkillResolver } from './skills/SkillResolver.js';
export { McpResolver } from './skills/McpResolver.js';
export type { Team, TeamWithAgents, Agent, CreateTeamParams } from './types/index.js';
```

**Exit:** `@ping/teams` builds independently. Depends on `@ping/agent-manager` (workspace link). Has mongoose for DB access.

---

### Step 13: Extract Plugins as Packages

Each plugin is a separate package — consumed by backend, not by `@ping/agent-manager`.

**Create:** `packages/workspace/package.json` (`@ping/workspace`)
```json
{
  "name": "@ping/workspace",
  "dependencies": {
    "@ping/agent-manager": "workspace:*"
  }
}
```

**Move from `packages/backend/` → `packages/workspace/src/`:**

| What | From | To |
|---|---|---|
| WorkspacePlugin wrapper | `plugin/plugins/WorkspacePlugin.ts` | `src/WorkspacePlugin.ts` |
| L1WorkspacePlugin | `memory/L1/L1WorkspacePlugin.ts` | `src/L1WorkspacePlugin.ts` |
| WorkspaceManager | `memory/L1/workspace/WorkspaceManager.ts` | `src/workspace/WorkspaceManager.ts` |
| AgentWorkspace | `memory/L1/workspace/AgentWorkspace.ts` | `src/workspace/AgentWorkspace.ts` |
| All 31 workspace tools | `memory/L1/workspace/tools/*` | `src/tools/*` |
| Code intel | `memory/L1/workspace/codeintel/*` | `src/codeintel/*` |
| Search index | `memory/L1/workspace/search/*` | `src/search/*` |
| Scratchpad, Identity, etc. | `memory/L1/workspace/*.ts` | `src/workspace/*.ts` |

**Create:** `packages/collaboration/package.json` (`@ping/collaboration`)
```json
{
  "name": "@ping/collaboration",
  "dependencies": {
    "@ping/agent-manager": "workspace:*",
    "@hocuspocus/server": "...",
    "yjs": "..."
  }
}
```

**Move from `packages/backend/` → `packages/collaboration/src/`:**

| What | From | To |
|---|---|---|
| CollaborationPlugin wrapper | `plugin/plugins/CollaborationPlugin.ts` | `src/CollaborationPlugin.ts` |
| L2CollaborationPlugin | `memory/L2/L2CollaborationPlugin.ts` | `src/L2CollaborationPlugin.ts` |
| HocuspocusServer | `memory/L2/collaboration/HocuspocusServer.ts` | `src/collaboration/HocuspocusServer.ts` |
| CollaborationSpace | `memory/L2/collaboration/CollaborationSpace.ts` | `src/collaboration/CollaborationSpace.ts` |
| PlanStore | `memory/L2/collaboration/PlanStore.ts` | `src/collaboration/PlanStore.ts` |
| GroupChatManager | `memory/L2/collaboration/GroupChatManager.ts` | `src/collaboration/GroupChatManager.ts` |
| Collab tools | `memory/L2/tools/*` | `src/tools/*` |
| Collab types | `memory/L2/collaboration/types/*` | `src/types/*` |

**Create:** `packages/knowledge/package.json` (`@ping/knowledge`)
```json
{
  "name": "@ping/knowledge",
  "dependencies": {
    "@ping/agent-manager": "workspace:*"
  }
}
```

**Move from `packages/backend/` → `packages/knowledge/src/`:**

| What | From | To |
|---|---|---|
| KnowledgePlugin wrapper | `plugin/plugins/KnowledgePlugin.ts` | `src/KnowledgePlugin.ts` |
| L3KnowledgePlugin | `memory/L3/L3KnowledgePlugin.ts` | `src/L3KnowledgePlugin.ts` |
| KnowledgeBase | `memory/L3/knowledge/KnowledgeBase.ts` | `src/knowledge/KnowledgeBase.ts` |

**Exit:** Three plugin packages, each depends only on `@ping/agent-manager` for plugin interfaces. No cross-plugin imports.

---

### Step 14: Update Backend to Import from Packages

**Modify:** `packages/backend/package.json`
```json
{
  "dependencies": {
    "@ping/agent-manager": "workspace:*",
    "@ping/teams": "workspace:*",
    "@ping/workspace": "workspace:*",
    "@ping/collaboration": "workspace:*",
    "@ping/knowledge": "workspace:*"
  }
}
```

**Modify:** `packages/backend/api/AgentManagerAPI.ts` and all backend files:
```typescript
// Before: import { AgentManager } from "../agentManager/AgentManagerV2.js";
// After:
import { AgentManager } from "@ping/agent-manager";
import { TeamService } from "@ping/teams";
import { WorkspacePlugin } from "@ping/workspace";
import { CollaborationPlugin } from "@ping/collaboration";
import { KnowledgePlugin } from "@ping/knowledge";
```

**Delete:** old source files from `packages/backend/` that were moved to packages (agentManager/, orchestrator/, services/, agent/, memory/, skills/, plugin/)

**Keep in backend:** `api/`, `cli/`, `db/`, `server.ts` — the thin API layer + startup wiring.

**Exit:** Backend is a thin API layer. All logic lives in packages. `bun install` resolves workspace deps. Golden path works.

---

### Step 15: Update Root Workspace + Verify

**Modify:** root `package.json`:
```json
{
  "workspaces": [
    "packages/agent-manager",
    "packages/teams",
    "packages/workspace",
    "packages/collaboration",
    "packages/knowledge",
    "packages/backend",
    "packages/frontend",
    "packages/registry"
  ]
}
```

**Modify:** root `tsconfig.json` — add project references for new packages.

**Verify:**
```
bun install                  → all workspace deps resolve
bun run build               → all packages build
bun run dev:backend         → golden path works
bun run dev:frontend        → streaming works
```

**Verify dependency graph is clean:**
```
@ping/agent-manager  → ai, zod (no @ping/* deps)
@ping/teams          → @ping/agent-manager, mongoose
@ping/workspace      → @ping/agent-manager
@ping/collaboration  → @ping/agent-manager, @hocuspocus/server, yjs
@ping/knowledge      → @ping/agent-manager
packages/backend     → @ping/teams, @ping/workspace, @ping/collaboration, @ping/knowledge
```

No circular deps. Each package publishable independently.

**Exit:** 8 workspace packages. Clean dependency DAG. Golden path works end-to-end.
