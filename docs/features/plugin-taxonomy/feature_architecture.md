# Plugin Architecture — Feature Architecture

> **Status**: Proposal  
> **Last Updated**: 2026-04-24  
> **Goal**: Define a clean, SOLID, extensible plugin model for the agent runtime.

---

## 1. Current State

### 1.1 Today's IPlugin Interface

Source: [packages/agent-manager/src/plugin/types.ts](packages/agent-manager/src/plugin/types.ts)

```typescript
interface IPlugin {
  // Identity (required)
  readonly id: string;
  readonly name: string;

  // Lifecycle (required)
  initialize(): Promise<void>;
  dispose(): Promise<void>;

  // Capabilities (required — return [] if not applicable)
  getMcpServers(): IMcpServer[];
  getSkills(): ISkill[];

  // Optional
  getStorage?(): IPluginStorage;
  prepareForTask?(context: ToolContext): Promise<void>;
  onTaskComplete?(taskId: string, goalId?: string): Promise<{ success: boolean; error?: string }>;
  onTaskFailed?(taskId: string): Promise<void>;
}
```

**6 required members + 4 optional methods = 10 total.** No `scope` field. No capability mixins. No type guards.

### 1.2 Today's PluginRegistry

Source: [packages/agent-manager/src/plugin/PluginRegistry.ts](packages/agent-manager/src/plugin/PluginRegistry.ts)

- **Flat Map** — `Map<string, IPlugin>`. No team/agent distinction.
- `register(plugin)` — single method, replaces if same ID.
- `prepareForTask(ctx)` — calls `plugin.prepareForTask?.(ctx)` via optional chaining.
- `onTaskComplete(taskId, goalId?)` — calls `plugin.onTaskComplete?.(taskId, goalId)` via optional chaining.
- `getTools(ctx, pluginIds?)` — iterates all plugins, calls `getMcpServers()` on each. No type guard — method is required.
- `getSkillInstructions(ctx, pluginIds?)` — iterates all plugins, calls `getSkills()` on each. Same.

### 1.3 Today's 4 Plugins

| Plugin | State | initialize() does | prepareForTask? | onTaskComplete? | onTaskFailed? | MCP Server | Skills |
|--------|-------|-------------------|-----------------|-----------------|---------------|------------|--------|
| `WorkspacePlugin` | `L1WorkspacePlugin` (WorkspaceManager, git branches) | Loads SKILL.md from `@ping/workspace` | ✅ Creates workspace/branch per task | ✅ Merges branch, publishes | ✅ Keeps branch for debug | `WorkspaceMcpServer` (32 tools) | `FileBackedWorkspaceSkill` |
| `CollaborationPlugin` | `L2CollaborationPlugin` (CRDT server, spaces, plan store) | Starts Hocuspocus WebSocket on port 1234 | — | — | — | `CollabMcpServer` (1 unified tool) | `CollabGuideSkill` |
| `SkillPlugin` | Loaded skill entries + roleSkillMap | Scans `registry/plugins/<team>/skills/*/SKILL.md` | — | — | — | `SkillMcpServer` (per-skill tools) | `FileBackedSkill[]` |
| `KnowledgePlugin` | `L3KnowledgePlugin` (KnowledgeBase) | Calls `L3.initialize()` | — | — | — | `KnowledgeMcpServer` (empty stub) | `KnowledgeGuideSkill` |

Only **WorkspacePlugin** uses task lifecycle hooks. The other 3 return `[]` for unused methods.

### 1.4 Today's OrchestratorService

Source: [packages/agent-manager/src/orchestrator/OrchestratorService.ts](packages/agent-manager/src/orchestrator/OrchestratorService.ts)

```typescript
interface OrchestratorServiceConfig {
  teamId: string;
  teamRoles: string[];
  taskStore: TaskStore;              // Required
  workerPool: WorkerPool;           // Required
  dagResolver: DependencyResolver;  // Required
  pluginRegistry?: PluginRegistry;  // Optional
  callbacks?: OrchestratorCallbacks; // Optional
  crdtTaskSync?: CrdtProxy;         // Optional (lazy proxy)
  crdtGoalStore?: CrdtProxy;        // Optional (lazy proxy)
  userInteractionManager?: UserInteractionManager; // Optional
  notificationQueue?: NotificationQueue;           // Optional
  planStore?: any;                   // Optional
  autoExecute?: boolean;             // Optional
}
```

Single config object. Required fields are enforced by TypeScript (no `?`). Optional fields use `?.` correctly.

### 1.5 Today's Tool Resolution Flow

Source: [packages/agent-manager/src/services/WorkerPool.ts](packages/agent-manager/src/services/WorkerPool.ts) — `runTask()`

```
ctx = { consumer: "worker", role: roleKey, taskId }

1. assembleLifecycleTools() → [report_status, complete_task, request_task?, bounce_task?]
2. if (pluginRegistry):
     a. await pluginRegistry.prepareForTask(ctx)    ← calls plugin.prepareForTask?.(ctx) via optional chaining
     b. pluginTools = pluginRegistry.getTools(ctx)   ← calls plugin.getMcpServers() on ALL plugins (flat)
     c. skillInstructions = pluginRegistry.getSkillInstructions({ role, taskId })
     d. append skillInstructions to agent system prompt
3. loadTaskLifecycleSkill() → append to system prompt (always)
4. agent.setTools(lifecycleTools + pluginTools)
5. agent.execute()
6. On success: await pluginRegistry.onTaskComplete(taskId, goalId)
7. On failure: await pluginRegistry.onTaskFailed(taskId)
```

No team/agent distinction. No type guards. All plugins treated equally.

---

## 2. Problems

| # | Problem | Evidence |
|---|---------|----------|
| 1 | The word "plugin" means 5 different things across layers | See taxonomy below |
| 2 | No scope field — all plugins team-scoped singletons | `WorkspacePlugin` does per-task isolation via `prepareForTask`, but can't configure different repo paths per agent role |
| 3 | `getMcpServers()` and `getSkills()` required even when not applicable | `CollaborationPlugin.getSkills()` returns a single hardcoded skill. `KnowledgeMcpServer.getTools()` returns `[]` (stub). Not a crisis, but violates ISP. |
| 4 | `pluginRegistry` is optional in `OrchestratorServiceConfig` | It's critical infrastructure — should be required. Currently guarded with `if (this.pluginRegistry)` checks. |

---

## 3. Plugin Taxonomy — One Table

The codebase has 5 things called "plugin". Only one is actually a runtime plugin.

| # | Name | Layer | Is `IPlugin`? | What it really is |
|---|------|-------|---------------|-------------------|
| ❶ | `registry/plugins/<team>/` | Registry | No | **Team Package** — static folder of YAML/MD definitions |
| ❷ | `WorkspacePlugin`, `CollaborationPlugin`, `KnowledgePlugin`, `SkillPlugin` | Agent Manager | **Yes** | **Runtime Plugin** — the canonical pluggable unit |
| ❸ | `createPlannerTools()` | Orchestrator | No | **Toolkit** — hardcoded factory for plan management |
| ❹ | `assembleLifecycleTools()` | Agent | No | **Agent OS** — always-present infrastructure tools |
| ❺ | `getModel()` | Provider | No | **Factory** — config-driven LLM selection |

**Decision**: Only ❷ is a "plugin" going forward. ❶ becomes "Team Package". ❸/❹/❺ keep their distinct names.

---

## 4. Proposed Changes

### 4.1 Add `scope` field to IPlugin

**Today**: No scope. All plugins in a flat `Map<string, IPlugin>`.  
**Proposed**: Plugins declare their scope. Registry tracks both layers.

```typescript
interface IPlugin {
  // ... existing members
  readonly scope: "team" | "agent";
}
```

```typescript
class PluginRegistry {
  private teamPlugins = new Map<string, IPlugin>();
  private agentPlugins = new Map<string /*role*/, Map<string, IPlugin>>();

  registerTeamPlugin(p: IPlugin): void { /* p.scope must be "team" */ }
  registerAgentPlugin(role: string, p: IPlugin): void { /* p.scope must be "agent" */ }

  /** Old register() becomes alias for registerTeamPlugin (backward compat) */
  register(p: IPlugin): void { this.registerTeamPlugin(p); }

  /** Iterates team plugins + agent plugins matching ctx.role */
  private allPlugins(ctx: ToolContext): IPlugin[] { ... }
}
```

| Scope | Lifetime | Audience | Current plugins |
|-------|----------|----------|-----------------|
| **team** | Team loaded → unloaded | All agents on this team | `CollaborationPlugin`, `SkillPlugin`, `KnowledgePlugin` |
| **agent** | Agent created → disposed | One specific agent role | `WorkspacePlugin` (move from team → agent) |

Task scope stays **inside** plugins via lifecycle hooks — not a separate plugin level.

### 4.2 Make `pluginRegistry` required in OrchestratorService

**Today**: `pluginRegistry?: PluginRegistry` (optional). Guarded with `if (this.pluginRegistry)` in code.  
**Proposed**: Make it a required field. It's critical infrastructure.

```typescript
interface OrchestratorServiceConfig {
  // Required (no ?)
  teamId: string;
  teamRoles: string[];
  taskStore: TaskStore;
  workerPool: WorkerPool;
  dagResolver: DependencyResolver;
  pluginRegistry: PluginRegistry;      // ← was optional, now required

  // Optional (safe to omit)
  callbacks?: OrchestratorCallbacks;
  crdtTaskSync?: CrdtProxy;
  crdtGoalStore?: CrdtProxy;
  userInteractionManager?: UserInteractionManager;
  notificationQueue?: NotificationQueue;
  planStore?: any;
  autoExecute?: boolean;
}
```

### 4.3 (Optional) Capability Mixins

**Today**: `getMcpServers()` and `getSkills()` are required on all plugins, even those that don't provide tools or skills. Optional methods use `?.` in PluginRegistry.

**Proposed**: Extract capabilities into opt-in interfaces. Use type guards instead of optional chaining.

```typescript
// Core — every plugin
interface IPlugin {
  readonly id: string;
  readonly name: string;
  readonly scope: "team" | "agent";
  initialize(): Promise<void>;
  dispose(): Promise<void>;
}

// Opt-in capabilities
interface IToolProvider { getMcpServers(): IMcpServer[]; }
interface ISkillProvider { getSkills(): ISkill[]; }
interface IStorageProvider { getStorage(): IPluginStorage; }
interface ITaskLifecycle {
  onTaskStart(ctx: ToolContext): Promise<void>;              // renamed from prepareForTask
  onTaskComplete(taskId: string, goalId?: string): Promise<TaskResult>;
  onTaskFailed?(taskId: string): Promise<void>;              // optional even within lifecycle
}
```

Type guards replace optional chaining:
```typescript
function isToolProvider(p: IPlugin): p is IPlugin & IToolProvider {
  return "getMcpServers" in p;
}

// PluginRegistry uses guards — no guessing
for (const plugin of this.allPlugins(ctx)) {
  if (isToolProvider(plugin)) {
    tools.push(...plugin.getMcpServers().flatMap(s => s.getTools(ctx)));
  }
}
```

**Trade-off**: The current interface works. `getMcpServers()` returning `[]` is not harmful. This is a cleanliness improvement, not a bug fix. Prioritize §4.1 (scope) and §4.2 (required pluginRegistry) first.

---

## 5. Plugin-by-Plugin — Today vs Proposed

### Today (4 plugins, flat registry)

| Plugin | Scope (implicit) | Tools | Skills | Storage | Task Lifecycle |
|--------|-------------------|-------|--------|---------|----------------|
| `WorkspacePlugin` | per-task (via `prepareForTask`) | ✅ 32 workspace tools | ✅ workspace guide | ✅ WorkspaceManager | ✅ prepareForTask, onTaskComplete, onTaskFailed |
| `CollaborationPlugin` | team (CRDT server shared) | ✅ 1 unified collab tool | ✅ collab guide | ✅ PlanStore, CRDT | — |
| `SkillPlugin` | team (role-filtered) | ✅ per-skill tools | ✅ FileBackedSkill[] | — | — |
| `KnowledgePlugin` | team (shared KB) | ✅ (empty stub) | ✅ KB guide | ✅ KnowledgeBase | — |

### After §4.1 (scope field added)

| Plugin | Scope | Change |
|--------|-------|--------|
| `CollaborationPlugin` | team | None — already team-scoped |
| `SkillPlugin` | team | None — roleSkillMap already handles per-role filtering |
| `KnowledgePlugin` | team | None — shared KB stays team-scoped |
| `WorkspacePlugin` | **agent** | Move to agent scope. Different agents can have different repo paths. |

### Why WorkspacePlugin should be agent-scoped

Today it's registered once per team but does per-task isolation via `prepareForTask` (creates a git branch per task). The problem: all agents share the same `repoPath` config. With agent scope, different roles can configure different repos:

```typescript
manager.registerAgentPlugin("researcher", new WorkspacePlugin({ repoPath: "./docs" }));
manager.registerAgentPlugin("engineer", new WorkspacePlugin({ repoPath: "./src" }));
```

### Future plugin (justified)

| Plugin | Scope | Why it's a plugin |
|--------|-------|-------------------|
| `McpBridgePlugin` | agent | Manages external MCP subprocess — `initialize()` spawns child process, `dispose()` kills it. The tools are stateless but the **process** needs lifecycle management. |

---

## 6. Tool & Skill Resolution

### Today's flow (from WorkerPool.runTask)

```
ctx = { consumer: "worker", role: roleKey, taskId }

1. Lifecycle tools (always — NOT plugins)
   assembleLifecycleTools() → [report_status, complete_task, request_task?, bounce_task?]

2. Plugin preparation (if pluginRegistry exists)
   await pluginRegistry.prepareForTask(ctx)
     → WorkspacePlugin creates git branch for this task
     → Other plugins: no-op (method undefined)

3. Plugin tools
   pluginTools = pluginRegistry.getTools(ctx)
     → Iterates ALL registered plugins (flat, no scope filter)
     → Calls plugin.getMcpServers() on each
     → Each MCP server returns tools filtered by ctx (e.g., planner gets none)

4. Plugin skills
   skillInstructions = pluginRegistry.getSkillInstructions({ role, taskId })
     → "always" skills: full instructions injected
     → "on-demand" skills: discovery text only
   → Appended to agent system prompt

5. System skill (always)
   loadTaskLifecycleSkill() → appended to system prompt

6. Combine + execute
   agent.setTools(lifecycleTools + pluginTools)
   agent.execute()

7. Completion
   if success: await pluginRegistry.onTaskComplete(taskId, goalId)
     → WorkspacePlugin merges branch, publishes outputs
   if failure: await pluginRegistry.onTaskFailed(taskId)
     → WorkspacePlugin keeps branch for debugging
```

### After §4.1 (scope added)

Step 3 changes:

```
3. Plugin tools (scope-aware)
   teamTools = pluginRegistry.getTeamTools(ctx)     ← all team plugins
   agentTools = pluginRegistry.getAgentTools(ctx)    ← only plugins registered for ctx.role
   pluginTools = teamTools + agentTools
```

No other changes needed. The rest of the flow stays identical.

---

## 7. Migration Plan

Each phase is a single PR. Nothing breaks between phases. Each phase cleans up as it goes.

### Phase 1 — Fix the bug + make pluginRegistry required

**Goal**: Eliminate the inconsistency where AgentManagerV2 assumes pluginRegistry exists but OrchestratorService/WorkerPool treat it as optional. Fix the one unguarded crash.

**Files changed (4):**

| File | Change | Risk |
|------|--------|------|
| `packages/agent-manager/src/plugin/types.ts` | No change yet | — |
| `packages/agent-manager/src/orchestrator/OrchestratorService.ts` | `pluginRegistry?: PluginRegistry` → `pluginRegistry: PluginRegistry`. Remove 6 `if (this.pluginRegistry)` guards + 2 optional chains. | None — AgentManagerV2 always passes it. |
| `packages/agent-manager/src/services/WorkerPool.ts` | Remove `if (this.pluginRegistry)` guard (line 277). Remove null check on `hasPlugins()` (line 426). | None — `setPluginRegistry()` is always called before `runTask()`. |
| `packages/backend/api/HttpServer.ts` | Keep `registry?.getPluginStorage?.()` — HttpServer legitimately may not have a registry (standalone mode). | None — stays optional here. |

**Verification**: `bun run build:backend` compiles. Existing behavior unchanged.

---

### Phase 2 — Clean up type-unsafe plugin access

**Goal**: The `typeof (x as any).method === 'function'` pattern appears 5 times. Replace with typed plugin access.

**Today's problem** (6 call sites):
```typescript
// OrchestratorService — 2 sites
const collabPlugin = this.pluginRegistry.get("collaboration");
if (collabPlugin && typeof (collabPlugin as any).setGoalId === 'function') {
  (collabPlugin as any).setGoalId(goalId);
}

// WorkerPool — 1 site
if (wsPlugin && typeof (wsPlugin as any).writeIdentityFile === "function") {
  await (wsPlugin as any).writeIdentityFile({...});
}

// AgentManagerV2 — 3 sites
if (l2Plugin?.getCrdtTaskSync) { ... }
```

**Fix**: Add typed getter methods to PluginRegistry:

```typescript
// In PluginRegistry
getTyped<T extends IPlugin>(id: string): T | undefined {
  return this.plugins.get(id) as T | undefined;
}
```

Then at call sites:
```typescript
const collab = this.pluginRegistry.getTyped<CollaborationPlugin>("collaboration");
collab?.setGoalId(goalId);  // ← typed, no `any` cast
```

**Files changed (3):**

| File | Change |
|------|--------|
| `packages/agent-manager/src/plugin/PluginRegistry.ts` | Add `getTyped<T>()` method |
| `packages/agent-manager/src/orchestrator/OrchestratorService.ts` | Replace 2 `typeof (x as any)` patterns with `getTyped<CollaborationPlugin>()` |
| `packages/agent-manager/src/services/WorkerPool.ts` | Replace 1 `typeof (x as any)` pattern with `getTyped<WorkspacePlugin>()` |

**Verification**: `bun run typecheck`. All `as any` casts in plugin access gone.

---

### Phase 3 — Add `scope` field to IPlugin

**Goal**: Every plugin declares whether it's team-scoped or agent-scoped. No behavior change yet — registry stays flat.

**Step 1** — Add field to interface:
```typescript
// packages/agent-manager/src/plugin/types.ts
interface IPlugin {
  readonly scope: "team" | "agent";  // NEW
  // ... everything else unchanged
}
```

**Step 2** — Each plugin declares its scope:

| Plugin | Scope | Reasoning |
|--------|-------|-----------|
| `CollaborationPlugin` | `team` | CRDT server + plan store shared across all agents |
| `SkillPlugin` | `team` | Skills loaded per-team, filtered by roleSkillMap |
| `KnowledgePlugin` | `team` | Shared knowledge base |
| `WorkspacePlugin` | `team` (for now) | Currently registered once per team. Move to agent in Phase 5. |

**Step 3** — PluginRegistry validates but doesn't split storage yet:
```typescript
register(plugin: IPlugin): void {
  // Log scope for visibility, no behavior change
  logger.debug(`Registering ${plugin.scope}-scoped plugin: ${plugin.id}`);
  this.plugins.set(plugin.id, plugin);
}
```

**Files changed (6):**

| File | Change |
|------|--------|
| `packages/agent-manager/src/plugin/types.ts` | Add `readonly scope` to `IPlugin` |
| `packages/backend/agentManager/plugins/WorkspacePlugin.ts` | Add `readonly scope = "team" as const;` |
| `packages/backend/agentManager/plugins/CollaborationPlugin.ts` | Add `readonly scope = "team" as const;` |
| `packages/backend/agentManager/plugins/SkillPlugin.ts` | Add `readonly scope = "team" as const;` |
| `packages/backend/agentManager/plugins/KnowledgePlugin.ts` | Add `readonly scope = "team" as const;` |
| `packages/agent-manager/src/plugin/PluginRegistry.ts` | Log scope on register. No storage change. |

**Verification**: `bun run build:backend` compiles. All 4 plugins pass scope. Runtime identical.

---

### Phase 4 — Split registry into team + agent maps

**Goal**: PluginRegistry resolves tools/skills by scope. Team plugins serve all agents. Agent plugins serve only their registered role.

**Step 1** — PluginRegistry internal split:
```typescript
class PluginRegistry {
  private teamPlugins = new Map<string, IPlugin>();
  private agentPlugins = new Map<string /*role*/, Map<string, IPlugin>>();

  /** Backward compat — routes to registerTeamPlugin */
  register(plugin: IPlugin): void {
    if (plugin.scope === "agent") {
      throw new Error(`Agent-scoped plugin ${plugin.id} must use registerAgentPlugin(role, plugin)`);
    }
    this.registerTeamPlugin(plugin);
  }

  registerTeamPlugin(plugin: IPlugin): void {
    this.teamPlugins.set(plugin.id, plugin);
  }

  registerAgentPlugin(role: string, plugin: IPlugin): void {
    if (!this.agentPlugins.has(role)) this.agentPlugins.set(role, new Map());
    this.agentPlugins.get(role)!.set(plugin.id, plugin);
  }

  /** Returns team plugins + agent plugins for the given role */
  private allPlugins(ctx: ToolContext): IPlugin[] {
    const result = [...this.teamPlugins.values()];
    if (ctx.role) {
      const rolePlugins = this.agentPlugins.get(ctx.role);
      if (rolePlugins) result.push(...rolePlugins.values());
    }
    return result;
  }
}
```

**Step 2** — Existing registration stays unchanged (all 4 plugins are team-scoped, all use `register()` which routes to `registerTeamPlugin`). Zero changes to `AgentManagerRegistry.ts`.

**Step 3** — `getTools()`, `getSkillInstructions()`, `prepareForTask()`, `onTaskComplete()`, `onTaskFailed()` all use `allPlugins(ctx)` instead of iterating the flat map. Behavior unchanged because all plugins are still team-scoped.

**Step 4** — `initializeAll()` and `disposeAll()` iterate both maps.

**Files changed (1):**

| File | Change |
|------|--------|
| `packages/agent-manager/src/plugin/PluginRegistry.ts` | Split internal storage, add `registerTeamPlugin`/`registerAgentPlugin`, keep `register()` as backward-compat alias. |

**Verification**: `bun run build:backend`. Same 4 plugins, same flat behavior (all team-scoped). No call site changes needed.

---

### Phase 5 — Move WorkspacePlugin to agent scope

**Goal**: Different agent roles can configure different workspace paths.

**Step 1** — Change WorkspacePlugin scope:
```typescript
// WorkspacePlugin.ts
readonly scope = "agent" as const;
```

**Step 2** — Update registration in AgentManagerRegistry:
```typescript
// Before (team):
manager.registerPlugin(new WorkspacePlugin({ repoPath: teamRepoPath }));

// After (per-role):
for (const role of roles) {
  const cfg = agentConfigs.get(role);
  manager.registerAgentPlugin(role, new WorkspacePlugin({
    repoPath: cfg?.repoPath ?? teamRepoPath,
  }));
}
```

**Step 3** — Update `getTyped<WorkspacePlugin>("workspace")` call sites to use context-aware lookup:
```typescript
// Before: pluginRegistry.get("workspace")
// After:  pluginRegistry.getForRole<WorkspacePlugin>("workspace", role)
```

**Files changed (3):**

| File | Change |
|------|--------|
| `packages/backend/agentManager/plugins/WorkspacePlugin.ts` | `scope = "agent"` |
| `packages/backend/agentManager/AgentManagerRegistry.ts` | Register per role instead of once |
| `packages/agent-manager/src/services/WorkerPool.ts` | Use role-aware lookup for `writeIdentityFile` |

**Verification**: `bun run build:backend`. Each agent role gets its own WorkspacePlugin instance. Default `repoPath` unchanged (backward compat).

---

### Phase 6 — Naming cleanup

**Goal**: Stop calling registry team folders "plugins."

| Before | After | Why |
|--------|-------|-----|
| `packages/registry/plugins/` | `packages/registry/teams/` | They're team packages, not plugins |
| `PluginLoader` (if exists) | `TeamPackageLoader` | Same |
| `PluginTeamService` (if exists) | `TeamPackageService` | Same |
| `plugin.json` | `plugin.json` (keep) | Claude Code compatibility |
| `PLUGIN_REGISTRY_DIR` env var | `TEAM_REGISTRY_DIR` (with fallback) | Read both, prefer new name |

**Step 1** — Rename directory: `git mv packages/registry/plugins packages/registry/teams`

**Step 2** — Update `AgentManagerRegistry.ts` path resolution:
```typescript
const pluginsDir = process.env.TEAM_REGISTRY_DIR
  ?? process.env.PLUGIN_REGISTRY_DIR  // backward compat
  ?? join(repoRoot, "packages", "registry", "teams");
```

**Step 3** — Update `SkillPlugin` path scanning to use new directory.

**Step 4** — Update docs, comments, and any hardcoded references.

**Files changed (~5):**

| File | Change |
|------|--------|
| `packages/registry/` | Rename `plugins/` → `teams/` |
| `packages/backend/agentManager/AgentManagerRegistry.ts` | Update path, support both env vars |
| `packages/backend/agentManager/plugins/SkillPlugin.ts` | Update comments |
| `docs/features/plugin-taxonomy/feature_architecture.md` | Update references |
| `.env.example` | Add `TEAM_REGISTRY_DIR`, document deprecation of `PLUGIN_REGISTRY_DIR` |

**Verification**: `bun run build:backend && bun run seed`. Skills load from new path.

---

### Summary

| Phase | PR size | Breaks anything? | What it cleans up |
|-------|---------|-------------------|-------------------|
| 1. Required pluginRegistry | ~20 lines | No | Removes 8+ `if (pluginRegistry)` guards |
| 2. Typed plugin access | ~15 lines | No | Removes 5 `typeof (x as any)` casts |
| 3. Add scope field | ~10 lines | No | Makes implicit scope explicit |
| 4. Split registry maps | ~40 lines | No | Enables agent-scoped plugins |
| 5. WorkspacePlugin → agent | ~20 lines | No | Per-role workspace config |
| 6. Naming cleanup | ~15 lines | No | Correct vocabulary |

Each phase compiles + runs independently. Total: ~120 lines changed across 6 PRs.

---

## 8. Interface ≠ Plugin

Implementing a capability interface does NOT make something a plugin. A plugin needs **meaningful state** and **real lifecycle** (initialize/dispose that actually do something).

Things that should NOT be plugins:

| Concept | Why it's NOT a plugin | How to implement instead |
|---------|----------------------|------------------------|
| Audit logging | No state. No init/dispose. Just a callback. | Callback in `OrchestratorCallbacks` |
| Cost tracking | Counting tokens is a callback, not a subsystem. | Same — callback |
| Team policies | Static text injection. No state, no tools. | Config in `SkillPlugin` (team-scoped SKILL.md) |
| Browser tools | Stateless tool endpoint. | MCP server via `McpBridgePlugin` |
| HTTP client | Stateless tool endpoint. | MCP server via `McpBridgePlugin` |
| Code sandbox | Just a tool (Docker MCP can handle it). | MCP server via `McpBridgePlugin` |

### What is NOT a plugin

**Stateless tool endpoints** (browser automation, HTTP client, code execution, search APIs) are MCP servers. Configure via `McpBridgePlugin` in agent frontmatter:

```yaml
config:
  mcpServers:
    - { command: "npx", args: ["-y", "@mcp/browser-server"] }
    - { command: "npx", args: ["-y", "@mcp/docker-sandbox"] }
```

### The plugin litmus test

| Question | If YES | If NO |
|----------|--------|-------|
| Does it have **state** that persists across calls? | Maybe a plugin | Not a plugin |
| Does `initialize()` do real work (spawn process, connect DB, start server)? | Maybe a plugin | Not a plugin |
| Does it provide **tools** that need that state? | Plugin | Just an MCP |
| Is it just observing events? | Callback, not a plugin | — |
| Is it just injecting text into prompts? | Config / skill file | — |

All three "Maybe/Plugin" rows must be YES for something to be a plugin.

---

## 9. How This Improves Things (SOLID)

These improvements apply **after** the proposed changes (§4), not to today's code:

| Principle | What changes |
|-----------|-------------|
| **SRP** | §4.3 (optional): `IPlugin` handles identity + lifecycle only. Capabilities are separate interfaces. |
| **OCP** | §4.1: New agent-scoped plugins don't require PluginRegistry changes. |
| **ISP** | §4.3 (optional): A tool-only plugin doesn't need `getSkills()`. Today this is minor (returning `[]` is fine). |
| **DIP** | §4.2: OrchestratorService depends on `PluginRegistry` unconditionally, not via optional check. |
