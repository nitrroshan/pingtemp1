# Package Refactoring — Feature Architecture

**Status:** New  
**Date:** April 6, 2026  
**Parent:** [Team Package Architecture](../feature_architecture.md)  
**Goal:** Decouple the backend monolith so `@ping/agent-manager` and `@ping/teams` can be extracted as independent packages.

---

## Problem

The backend is a single package with 5+ circular cross-dependencies. Package extraction requires decoupling first.

**Current coupling graph (simplified):**

```
AgentManagerV2 ──→ OrchestratorService ──→ MemoryManager
       │                  │                      ↑
       ├──→ WorkerPool ───┤──→ L1/L2 tools ──────┘
       │        │         │
       │        ├──→ AiSdkAgent
       │        ├──→ SkillResolver
       │        └──→ AgentWorkspace
       │
       ├──→ MemoryCoordinator (L1, L2, L3 plugins)
       └──→ L2CollaborationPlugin, L3KnowledgePlugin
```

**Three blocking problems:**

1. **WorkerPool hard-imports tool factories** — `createWorkspaceTools()`, `createCollabTool()`, `SkillResolver` are all relative imports. WorkerPool can't exist without importing the entire memory + skills layer.
2. **OrchestratorService imports PlanStore** from `memory/L2/collaboration/` — plan persistence is tied to the L2 collaboration layer.
3. **AgentManagerV2 is a god object** — directly imports and wires orchestrator, memory coordinator, L2, L3, worker pool.

---

## Design Principles

- **Claude Code model as foundation** — Skills, MCP servers, and Plugins map 1:1 to Claude Code's concepts
- **Plugins** = distribution bundles (skills + MCP servers + agent configs). L1/L2/L3 are plugins.
- **Skills** = prompt playbooks (instructions, NOT executable tools). Like SKILL.md in Claude Code. Two load modes: `always` (inject upfront) or `on-demand` (description in context, full content loads when agent invokes).
- **MCP servers** = tool providers (provide executable functions). External or bundled in plugins.
- **Orchestration state** (plans, tasks) = core responsibility. AgentManager ships with FilePlanStore + FileTaskStore (JSON on disk). L2 can upgrade to CRDT-backed persistence. Backend can inject MongoPlanStore if needed. NOT part of any plugin.
- **L2 is purely collaboration** — shared CRDT workspace with search/indexing. Agents get filesystem-like tools (read, write, list, grep, search, query, whatsnew) plus collaboration tools (group chat, publish, status). Pre-task workflow: search context → publish understanding + open questions → create sub-tasks for answers (assigned to agents or human) → execute with resolved context. L2 also upgrades plan/task persistence from file-based to CRDT-backed (no database needed).
- **Dynamic grouping** = agents get different skill + MCP server combinations at runtime via team config

---

## Claude Code Model (Exact Mapping)

```
Claude Code                              Ping
─────────────────────────────────────────────────────────
MCP server (tool provider)           →   MCP server (tool provider — same)
MCP tool (individual executable fn)  →   Tool (individual executable function)
Skill (SKILL.md prompt playbook)     →   Skill (prompt playbook — instructions for agent)
Plugin (bundles: skills + MCP        →   Plugin (bundles: skills + MCP servers +
  servers + agents + hooks)                 agent configs + storage layer)
Agent (agents/ in plugin)            →   Agent Definition (YAML — role + instructions)
```

### What each thing IS:

**MCP Server** — Provides executable tools. Can be external (Sentry, GitHub, PostgreSQL) or bundled inside a plugin. An MCP server exposes 1+ tools that agents can call.

**Skill** — A prompt playbook (instructions). NOT a tool. Tells an agent HOW to approach a task. Can auto-trigger or be invoked manually. Can restrict which tools the agent uses. Like SKILL.md in Claude Code.

**Plugin** — A distribution bundle that packages together:
- Skills (prompt playbooks)
- MCP servers (tool providers)
- Agent definitions (role configs)
- Storage layer (if applicable — L1 workspace, L2 collab, L3 knowledge)

**Agent Definition** — Role + instructions + model config. Like `agents/` in a Claude Code plugin.

### How they compose:

```
Plugin: @ping/workspace (L1)
├── skills/
│   └── workspace-guide/SKILL.md     ← "When working with files, always..."
├── mcp-servers/
│   └── workspace-tools              ← provides: workspace_read, write, grep, glob, git_*
├── agents/                          ← (optional agent configs)
└── storage: git repos, file system, scratchpad

Plugin: @ping/collaboration (L2)
├── skills/
│   └── collab-guide/SKILL.md        ← pre-task: search → publish context → resolve questions → execute
├── mcp-servers/
│   ├── collab-docs                  ← collab_read, write, list, grep, search, query, stat, whatsnew
│   ├── group-chat                   ← group_chat_start, send, read (outcomes → tasks)
│   ├── publish                      ← publish_artifact, list_artifacts, review_artifact
│   └── status                       ← update_status, get_team_status
└── storage: Hocuspocus CRDT + MiniSearch index + CrdtPlanStore/TaskStore
    (search powered by Hocuspocus Search Extension — auto-indexes on CRDT changes)

Plugin: @ping/knowledge (L3)
├── skills/
│   └── knowledge-guide/SKILL.md     ← "Search knowledge base before starting..."
├── mcp-servers/
│   └── knowledge-tools              ← provides: knowledge_query, knowledge_add, knowledge_search
└── storage: vector embeddings, wiki documents, runbooks
    (team-wide org knowledge — all agents read, controlled write)
```

### Dynamic grouping per agent:

```typescript
// Team config assigns plugins + skills + MCP servers at two levels
const team = await TeamManager.create({
  // Team-level plugins — available to ALL roles
  plugins: ['@ping/workspace', '@ping/knowledge'],  // workspace + wiki for everyone

  roles: [
    {
      name: 'researcher',
      skills: ['deep-research', 'fact-check'],         // prompt playbooks
      mcpServers: [
        'web-search',                                  // general web search
        'academic-search',                             // academic papers
        'product-specs-knowledge',                     // MCP server serving product spec pages
        'api-docs-knowledge',                          // MCP server serving API reference
      ],
      // ↑ Knowledge sources are just MCP servers that serve content
      //   instead of executing actions. Same interface — getTools() returns
      //   tools like: query_product_specs, search_api_docs, get_page
    },
    {
      name: 'writer',
      plugins: ['@ping/collaboration'],                // role-level plugin (collab only for writer)
      skills: ['writing-style-guide', 'seo-best-practices'],
      mcpServers: ['grammar-check', 'plagiarism-detector'],
    },
    {
      name: 'designer',
      skills: ['design-system-guide'],
      mcpServers: ['image-gen', 'figma-export'],
    },
  ],
});
```

**Result at task time:**
```
Researcher gets:
  base tools (report_status, complete_task)        ← always
  + team plugin tools:
      workspace_*, knowledge_*, collab_*           ← all three team plugins
  + team plugin skills:
      workspace-guide, knowledge-guide, collab-guide ← all three team plugins
  + role skills (deep-research, fact-check)        ← per-role prompt playbooks
  + role MCP tools:
      web_search, academic_search                  ← action-oriented MCP servers
      query_product_specs, search_api_docs         ← knowledge MCP servers (books/docs as MCP)

Writer gets:
  base tools + team plugin tools/skills            ← same three plugins
  + role skills (writing-style-guide, seo...)      ← different playbooks
  + role MCP tools (grammar_check, plagiarism...)  ← different providers

Designer gets:
  base tools + team plugin tools/skills            ← same three plugins
  + role skills (design-system-guide)              ← playbook
  + role MCP tools (image_gen, figma_export)       ← tools
```

---

## What Ping Does Beyond Claude Code

Claude Code is single-agent, single-user, terminal-only. Ping adopts its plugin/skill/MCP model but adds multi-agent orchestration on top. These are capabilities Ping already has that extend the Claude Code foundation:

| Capability | Claude Code | Ping (already built) |
|---|---|---|
| **Multi-agent orchestration** | Single agent | Planner creates DAG → parallel workers execute tasks. Multiple agents collaborate on one goal. |
| **Task DAG with dependencies** | None | MemoryManager tracks prerequisites (`Map<string, boolean>`). Tasks auto-become ready when deps complete. Critical path resolution. |
| **Plugin storage layers** | Plugins have no storage concept | Plugins bundle persistent storage: L1 (git workspace), L2 (CRDT collab + search), L3 (vector knowledge). Agents share state across tasks. |
| **Plan approval workflow** | Basic tool approval per-call | User reviews full plan before execution. Approve/reject/edit tasks. Planner revises on rejection. |
| **Pre-task collaboration** | None | Agents publish gathered context + open questions before starting. Open questions become sub-tasks assigned to other agents or human. Work starts only with resolved context. |
| **Real-time multi-client streaming** | Single terminal output | Socket.IO broadcasts `stream_part` events to N browser clients. Multiple users watch agents work simultaneously. |
| **Team-level isolation** | None — one global context | Each team owns one AgentManager. Separate task state, workspace, plugins. Teams can run concurrently without interference. |
| **3-layer memory architecture** | CLAUDE.md flat file | L1 (workspace: git, files, code intel), L2 (collaboration: CRDT, plans, group chat), L3 (knowledge: vectors, wiki). Structured persistence. |
| **Role-based tool assignment** | All tools available to all | Per-role skill + MCP server assignment via team config. Researcher gets different tools than writer. Dynamic at runtime. |
| **Skill auto-discovery** | Description matching in context window | SkillResolver with semantic search (`findSkillForTask()`), vector embeddings for similarity matching. |

### How these map to the plugin architecture:

```
Claude Code model (adopted):
  Skills → prompt playbooks
  MCP servers → tool providers
  Plugins → bundles

Ping extensions (already built, integrate into plugin model):
  Planner (OrchestratorService) → stays in @ping/agent-manager core
  Task DAG (MemoryManager) → stays in @ping/agent-manager core
  WorkerPool → stays in @ping/agent-manager core (consumes plugin tools)
  L1/L2/L3 → become plugins (add storage layer concept Claude Code doesn't have)
  Team isolation → @ping/teams creates AgentManager + registers plugins per team
  Multi-client streaming → backend API layer (Socket.IO) — not in packages
  Plan approval → orchestrator tool (create_plan, approve_plan) — stays in core
```

---

## Architecture Options

### Option A: Plugin Architecture (Claude Code Model)

**Implementation:** AgentManager adopts the exact Claude Code architecture: plugins bundle skills + MCP servers + storage. Skills are prompt playbooks (instructions). MCP servers provide executable tools. Agents get dynamic groupings of skills + MCP servers per-role.

```typescript
// Plugin interface — bundles skills + MCP servers + optional storage
interface IPlugin {
  readonly id: string;
  readonly name: string;
  initialize(): Promise<void>;
  dispose(): Promise<void>;
  /** MCP servers this plugin provides (tool providers) */
  getMcpServers(): IMcpServer[];
  /** Skills this plugin provides (prompt playbooks) */
  getSkills(): ISkill[];
  /** Optional storage layer */
  getStorage?(): IPluginStorage;
}

// MCP server — provides executable tools (like MCP in Claude Code)
interface IMcpServer {
  readonly id: string;
  readonly name: string;
  /** Executable tools this server exposes — context-driven per consumer */
  getTools(context: ToolContext): AiSdkTool[];
}

// ToolContext tells the MCP server WHO is asking for tools
interface ToolContext {
  consumer: 'planner' | 'worker';   // planner vs agent workers get different tools
  role?: string;                     // worker role (e.g., 'researcher')
  taskId?: string;                   // current task
}

// Example: L2 CollabMcpServer returns different tools for planner vs workers
//
//   context.consumer === 'planner':
//     → create_plan, approve_plan, get_status, get_context
//
//   context.consumer === 'worker':
//     → collab_write, collab_read, plan_query

// Skill — prompt playbook (like SKILL.md in Claude Code)
interface ISkill {
  readonly id: string;
  readonly name: string;
  readonly description: string;          // always in context (short — for auto-discovery)
  /** How this skill is loaded (mirrors Claude Code behavior) */
  readonly loadMode: 'always' | 'on-demand';
  // always    → full instructions injected into system prompt upfront
  // on-demand → only description in context; full content loads when agent invokes
  /** Full instructions (loaded upfront or on-demand depending on loadMode) */
  getInstructions(context: SkillContext): string;
  /** Optional: restrict which tools agent can use when skill is active */
  allowedTools?: string[];
}

// Orchestration state — core responsibility, NOT a plugin
// Plans and tasks are the engine's job, not collaboration
interface AgentManagerConfig {
  model: string;
  planStore?: IPlanStore;   // default: FilePlanStore (JSON on disk)
  taskStore?: ITaskStore;   // default: FileTaskStore (JSON on disk)
}

// Built-in defaults (ship with @ping/agent-manager)
class FilePlanStore implements IPlanStore { ... }   // persists to .ping/plans/*.json
class FileTaskStore implements ITaskStore { ... }   // persists to .ping/tasks/*.json
// L2 can upgrade to CrdtPlanStore/CrdtTaskStore when registered
// Backend can inject MongoPlanStore if needed
```

**Plugin structure (mirrors Claude Code):**

```typescript
// L1 Workspace Plugin — bundles MCP servers + skills + storage
class WorkspacePlugin implements IPlugin {
  getMcpServers() {
    return [new WorkspaceMcpServer(this.config)];
    // → workspace_read, workspace_write, grep, glob, git_*, ...  (31 tools)
  }
  getSkills() {
    return [new WorkspaceGuideSkill()];
    // → "When working with files, always use workspace_read first..."
  }
  getStorage() {
    return new WorkspaceStorage(this.config);
    // → git repos, file system, scratchpad
  }
}

// L2 Collaboration Plugin — makes agents collaborate (NOT persistence)
// Without L2: agents work independently, no shared state
// With L2:    agents share drafts, discuss, annotate each other's work
//             ALSO upgrades plan/task persistence from file-based → CRDT-backed
class CollaborationPlugin implements IPlugin {
  getMcpServers() {
    return [new CollabMcpServer(this.config)];
    // workers get: collab_write, collab_read, collab_discover, plan_annotate
  }
  getSkills() {
    return [new CollabGuideSkill()];
    // → "When collaborating, write to shared docs..."
  }
  getStorage() {
    return {
      // Collaboration features
      crdt: new HocuspocusServer(this.config),        // shared CRDT documents
      groupChat: new GroupChatManager(this.config),   // agent-to-agent chat
      manifests: new OutputManifestStore(this.config), // published work products
      // Persistence upgrade — CRDT-backed, no MongoDB needed
      planStore: new CrdtPlanStore(this.crdt),        // plans persisted in CRDT
      taskStore: new CrdtTaskStore(this.crdt),        // tasks persisted in CRDT
    };
  }
}
```

**Dynamic grouping per agent — team config:**

```typescript
const manager = new AgentManager({
  model: 'azure/gpt-4o',
  // Default: FilePlanStore + FileTaskStore (JSON on disk)
  // L2 plugin will auto-upgrade to CrdtPlanStore when registered
});

// ── Register available plugins ─────────────────────────────────────────
manager.registerPlugin(new WorkspacePlugin(l1Config));
manager.registerPlugin(new CollaborationPlugin(l2Config));
manager.registerPlugin(new KnowledgePlugin(l3Config));

// ── Team config: assign plugins at team + role level ───────────────────
const team = await TeamManager.create({
  plugins: ['@ping/workspace', '@ping/collaboration', '@ping/knowledge'],
  // ↑ team-level: all roles get workspace + collab + knowledge

  roles: [
    {
      name: 'researcher',
      skills: ['deep-research', 'fact-check'],
      mcpServers: ['web-search', 'academic-search'],
    },
    {
      name: 'writer',
      skills: ['writing-style-guide', 'seo-best-practices'],
      mcpServers: ['grammar-check', 'plagiarism-detector'],
    },
  ],
});
```

**Three plugin levels:**

```
Core:           AgentManager({ planStore, taskStore })
                → orchestration state (plans, tasks) — NOT a plugin
                → FilePlanStore/FileTaskStore defaults (JSON on disk), upgradeable

Team-level:     team config plugins: ['@ping/workspace', '@ping/collaboration', '@ping/knowledge']
                → ALL roles in this team get tools + skills
                → L1 (workspace) + L2 (collaboration) + L3 (knowledge) typically here
                → L2 enables agents to collaborate — big impact when added

Role-level:     role config plugins: [...]
                → only THIS role gets tools + skills
                → external MCP servers, specialized knowledge sources
```

**Full tool resolution (6 layers):**

```
Planner starts (consumer: 'planner')
  → core planner tools (create_plan, approve_plan, get_status, get_context)
    ← built into AgentManager core — always present
  → plugin planner tools (if any plugin returns tools for consumer: 'planner'):
    ← e.g., L2 could add plan_annotate for collaborative plan editing

Worker starts task for role "researcher" (consumer: 'worker')
  → base tools (report_status, complete_task)                 ← always
  → team plugin tools + skills:
      WorkspacePlugin → workspace_*, grep, git_* + workspace-guide
      CollaborationPlugin → collab_write, collab_read, collab_discover + collab-guide
      KnowledgePlugin → knowledge_query, knowledge_add + knowledge-guide
  → per-role MCP tools (dynamically assigned):
      mcpResolver.resolve(['web-search', 'academic-search', 'product-specs'])
  → per-role skills (injected into system prompt):
      skillResolver.resolve(['deep-research', 'fact-check'])
  → merged tools + system prompt given to AiSdkAgent
```

**CLI usage (bare — default L2 only):**

```typescript
const manager = new AgentManager({ model: 'azure/gpt-4o' });
// Core: FilePlanStore + FileTaskStore (persists to .ping/ on disk)
// No plugins: no workspace, no collab, no knowledge
// Workers get only base tools (report_status, complete_task)
await manager.execute('Summarize this document');
```

**Pros:**
- Exact Claude Code model — skills, MCP servers, plugins map 1:1
- Plugins bundle skills + MCP servers + storage together (like Claude Code plugins)
- Skills are prompt playbooks (not tools) — clear separation
- Per-role dynamic grouping — different agents get different skill + MCP combos
- Orchestration state (plans/tasks) clearly separated with built-in defaults
- CLI works with zero plugins
- Fully testable

**Cons:**
- Largest refactor — current SkillResolver conflates tools with skills (needs split into SkillResolver + McpResolver)
- Plugin interface includes both getMcpServers() and getSkills() — more surface area
- Need to define IMcpServer protocol (simplified version of MCP, not full protocol initially)

**Effort:** 2-3 weeks

---

### Option B: Tool Injection Only (Minimal Decoupling)

**Implementation:** Keep current model. Only decouple tool injection — WorkerPool receives tools as arrays. No plugin/skill/MCP distinction.

**Pros:**
- Smallest change — 1 week
- Backend wiring barely changes

**Cons:**
- No plugin model — can't bundle skills + MCP + storage
- No dynamic grouping per agent
- Doesn't align with Claude Code architecture
- Current SkillResolver conflation stays

**Effort:** 1 week

---

### Option C: Incremental with Re-export Shims

**Implementation:** Bottom-up extraction with shims. Plugin DI added where needed.

**Pros:**
- Zero-risk incremental
- Can stop partway

**Cons:**
- 3-4 weeks, slower
- Needs Option A's plugin interface anyway
- Temporary shim confusion

**Effort:** 3-4 weeks

---

## Recommendation

**Option A (Plugin Architecture — Claude Code Model)** because:

1. **Exact Claude Code mapping** — Skills = prompt playbooks, MCP servers = tool providers, Plugins = bundles. No conceptual mismatch.
2. **Dynamic grouping** — Team config assigns different skills + MCP servers per role. Researcher gets web-search + deep-research. Writer gets grammar-check + style-guide. Runtime configurable.
3. **Plugins = bundles** — L1 plugin bundles workspace MCP server + workspace skill + workspace storage. Single `registerPlugin()` gives everything.
4. **Skills/MCP split** — Current SkillResolver mixes instructions with executable tools. Splitting into SkillResolver (playbooks) + McpResolver (tools) matches Claude Code cleanly.
5. **Built-in defaults** — `FilePlanStore` ships with core. CLI works bare. L2 auto-upgrades to CRDT.

**Key refactoring sequence:**
```
1. Define IPlugin, IMcpServer, ISkill interfaces + IPlanStore/ITaskStore
2. Extract FilePlanStore + FileTaskStore into core (with injectable interface)
3. Split current SkillResolver → SkillResolver (playbooks) + McpResolver (tools)
4. Refactor L1/L2/L3 as plugins: implement getMcpServers() + getSkills() + getStorage()
   — CollaborationPlugin.getStorage() returns CRDT + GroupChat + OutputManifests (NOT plan/task store)
5. Refactor WorkerPool: collect tools from plugin MCP servers + per-role MCP servers
6. Refactor agent prompt building: inject plugin skills + per-role skills into system prompt
7. Refactor AgentManagerV2: plugin registry + injectable planStore/taskStore
8. Extract @ping/agent-manager (core + FilePlanStore/FileTaskStore + plugin interfaces)
9. Extract @ping/teams (TeamService — manages per-role skill/MCP assignments)
10. Wire backend as thin API over @ping/teams
```

**Decision Required:** Please choose Option A, B, or C.
