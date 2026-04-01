# MCP Integration — Feature Architecture

**Status:** Superseded  
**Date:** March 30, 2026  
**ID:** F2  
**Merged into:** [Tools & MCP (A3)](../tools-as-mcp/feature_architecture.md)

> This feature has been merged with A3. The combined doc covers: which tools stay in-process vs become MCP, the package structure, memory plugin extraction, third-party MCP server integration, and the migration path.
>
> See [Tools & MCP (A3)](../tools-as-mcp/feature_architecture.md) for the full architecture.

### Current State
- 29 tools exist across 4 categories — all in-process, tightly coupled to backend
- 3 memory plugins (L1 Workspace, L2 Collaboration, L3 Knowledge) — registered via `MemoryCoordinator`
- `@langchain/mcp-adapters` used for MCP consumption
- `fastmcp` in dependencies (for serving, not yet used)
- No tools exposed as MCP servers
- Memory plugins can't be swapped, configured, or used outside the backend

### Target State
- Each tool group = an MCP server = an npm package
- Each memory layer = an MCP server = an npm package
- Internal agents use them in-process (fast, no network hop)
- External agents/CLI connect via MCP protocol (stdio or HTTP)
- Teams can configure which servers/packages are available
- Third-party MCP servers (Brave Search, Docker, GitHub) slot in alongside ours

---

## Architecture: Everything Is a Package

```
packages/
  mcp-workspace/              ← @ping/mcp-workspace (L1 — 21 tools)
    src/
      server.ts                 MCP server exposing workspace tools
      tools/                    workspace_create_file, workspace_read_file, etc.
    package.json                Standalone MCP server + npm package

  mcp-collab/                 ← @ping/mcp-collab (L2 — CRDT, plans, group chat)
    src/
      server.ts                 MCP server exposing collab tool
      tools/                    discover, list, read, write CRDT docs
    package.json

  mcp-knowledge/              ← @ping/mcp-knowledge (L3 — knowledge base)
    src/
      server.ts                 MCP server exposing relevantDocs, roleSkills
      tools/
    package.json

  mcp-skills/                 ← @ping/mcp-skills (skill discovery — 5 tools)
    src/
      server.ts                 MCP server exposing skill tools
      tools/                    list_available_skills, search_skills, run_skill_script
    package.json

  mcp-orchestration/          ← @ping/mcp-orchestration (agent lifecycle — 2 tools)
    src/
      server.ts                 MCP server exposing report_status, complete_task
      tools/
    package.json

  agent-manager/              ← @ping/agent-manager (consumes MCP packages)
  teams/                      ← @ping/teams (configures which servers per team)
  backend/                    ← thin API layer
  cli/                        ← connects to MCP servers directly
```

### Package Dependency Graph

```
External agents / CLI / other apps
  │
  ├── connect via MCP protocol (stdio/HTTP)
  │
  ▼
┌─────────────────────────────────────────────────┐
│  MCP SERVER PACKAGES (independent, composable)  │
│                                                  │
│  @ping/mcp-workspace     (L1: 21 file/git tools)│
│  @ping/mcp-collab        (L2: CRDT, plans, chat)│
│  @ping/mcp-knowledge     (L3: knowledge base)   │
│  @ping/mcp-skills        (skill discovery)       │
│  @ping/mcp-orchestration (status, completion)    │
│                                                  │
│  Third-party:                                    │
│  @anthropic/mcp-brave-search                     │
│  @anthropic/mcp-docker                           │
│  @anthropic/mcp-github                           │
└──────────────────┬──────────────────────────────┘
                   │
                   │ consumed by
                   ▼
┌─────────────────────────────────────────────────┐
│  @ping/agent-manager                             │
│  (loads tools from MCP packages — in-process     │
│   or over network, configurable per team)        │
└─────────────────────────────────────────────────┘
```

---

## Existing Tools → MCP Packages

### `@ping/mcp-workspace` (L1 — File & Git Operations)

The 21 workspace tools from [workspace-tools.ts](../../packages/backend/memory/L1/workspace/tools/workspace-tools.ts) become an MCP server:

| Tool | MCP Tool Name | Description |
|---|---|---|
| `workspace_create_file` | `create_file` | Create file in workspace |
| `workspace_read_file` | `read_file` | Read file content |
| `workspace_write_file` | `write_file` | Write/update file |
| `workspace_delete_file` | `delete_file` | Delete file |
| `workspace_file_exists` | `file_exists` | Check existence |
| `workspace_list_files` | `list_files` | List directory |
| `workspace_grep` | `grep` | Text search |
| `workspace_glob` | `glob` | Pattern match files |
| `workspace_commit` | `commit` | Git commit |
| `workspace_get_history` | `get_history` | Git log |
| `workspace_publish` | `publish` | Commit + extract artifacts |
| `workspace_reactivate` | `reactivate` | Reactivate published workspace |
| `workspace_discard` | `discard` | Delete branch |
| `workspace_status` | `status` | Branch, changes, activity |
| `workspace_info` | `info` | Workspace metadata |
| `workspace_log_activity` | `log_activity` | Log decisions/observations |
| `scratch_note` | `scratch_note` | Quick note |
| `scratch_todo` | `scratch_todo` | Task reminder |
| `scratch_remember` | `scratch_remember` | Key fact |
| `scratch_file` | `scratch_file` | Temp file |
| `promote_to_workspace` | `promote` | Move scratch → workspace |

```typescript
// packages/mcp-workspace/src/server.ts
import { FastMCP } from 'fastmcp';

const server = new FastMCP({ name: '@ping/mcp-workspace' });

server.addTool({
  name: 'create_file',
  description: 'Create a file in the agent workspace',
  parameters: z.object({ path: z.string(), content: z.string() }),
  execute: async ({ path, content }) => {
    return workspace.createFile(path, content);
  },
});
// ... 20 more tools

export { server };
```

### `@ping/mcp-collab` (L2 — CRDT Collaboration)

The collab tool from [L2/tools/index.ts](../../packages/backend/memory/L2/tools/index.ts) becomes an MCP server. The single `collab` tool with actions expands into proper individual MCP tools:

| Current Action | MCP Tool Name | Description |
|---|---|---|
| `collab({ action: 'discover' })` | `discover_docs` | Find what CRDT documents exist |
| `collab({ action: 'list' })` | `list_docs` | List documents by type |
| `collab({ action: 'read' })` | `read_doc` | Read a CRDT document |
| `collab({ action: 'write' })` | `write_doc` | Write/update a CRDT document |
| — (new) | `list_plans` | List plans in PlanStore |
| — (new) | `read_plan` | Read a specific plan |
| — (new) | `group_chat_start` | Start a group chat session |
| — (new) | `group_chat_message` | Send message in group chat |

### `@ping/mcp-knowledge` (L3 — Knowledge Base)

| MCP Tool Name | Description |
|---|---|
| `relevant_docs` | Semantic search for relevant knowledge documents |
| `role_skills` | Get skills/knowledge for a specific role |
| `add_knowledge` | Add a document to the knowledge base |
| `search_knowledge` | Full-text search across knowledge base |

### `@ping/mcp-skills` (Skill Discovery & Execution)

The 5 skill tools from [SkillTools.ts](../../packages/backend/skills/tools/SkillTools.ts):

| MCP Tool Name | Description |
|---|---|
| `list_available_skills` | List installed skills by category |
| `read_skill` | Read SKILL.md instructions |
| `read_skill_file` | Read supporting documentation |
| `run_skill_script` | Execute skill scripts |
| `search_skills` | Semantic search for skills |

### `@ping/mcp-orchestration` (Agent Lifecycle)

The 2 internal tools from [agent/internal/tools/](../../packages/backend/agent/internal/tools/):

| MCP Tool Name | Description |
|---|---|
| `report_status` | Signal progress (in_progress, blocked, etc.) |
| `complete_task` | Signal task completion with summary/deliverables |

---

## Dual-Mode: In-Process + MCP

Each package works in two modes:

```
MODE 1: IN-PROCESS (fast — for internal agents)
  @ping/agent-manager imports the package directly
  Tools loaded as AI SDK tool() objects — no network hop
  This is the default for Ping's own agents

MODE 2: MCP SERVER (universal — for external consumers)
  Package runs as standalone MCP server (stdio or HTTP)
  Any MCP client connects and discovers tools
  CLI, external agents, third-party apps use this mode
```

```typescript
// packages/mcp-workspace/src/index.ts

// Mode 1: Direct import (in-process)
export { createWorkspaceTools } from './tools';
// → import { createWorkspaceTools } from '@ping/mcp-workspace';
// → Returns AI SDK tool() objects

// Mode 2: MCP server
export { server } from './server';
// → Run as: npx @ping/mcp-workspace --workspace-path ./data/workspace
// → Exposes tools via MCP protocol
```

This means the **same code** serves both modes. No duplication.

---

## Memory Plugins → MCP Packages

The 3 memory plugins become independent packages that teams can compose:

| Current Plugin | Package | What It Provides | Can Swap? |
|---|---|---|---|
| `L1WorkspacePlugin` | `@ping/mcp-workspace` | Git workspace, file ops, scratchpad | Yes — could replace with S3-based workspace |
| `L2CollaborationPlugin` | `@ping/mcp-collab` | CRDT docs, plans, group chat | Yes — could replace with a simpler store |
| `L3KnowledgePlugin` | `@ping/mcp-knowledge` | Knowledge base, semantic search | Yes — could replace with vector DB provider |

### Team Configuration

Teams choose which memory/tool packages to enable:

```typescript
const team = await TeamManager.create({
  name: 'Marketing Team',
  roles: ['researcher', 'writer'],
  
  // Memory packages — plug and play
  memory: {
    l1: '@ping/mcp-workspace',           // or a custom workspace package
    l2: '@ping/mcp-collab',              // or '@acme/collab-server'
    l3: '@ping/mcp-knowledge',           // or null (no knowledge base)
  },
  
  // Additional MCP servers — third-party or custom
  mcpServers: [
    '@anthropic/mcp-brave-search',       // web search
    '@anthropic/mcp-github',             // GitHub integration
    './custom-servers/internal-api',       // company-specific tools
  ],
});
```

### Why Packages, Not Just Plugins

```
❌ Plugins (current — in-process, tightly coupled):
   L1WorkspacePlugin registered in MemoryCoordinator
   Can't use outside the backend process
   Can't version independently
   Can't swap implementations without changing backend code

✅ Packages (target — independent, composable):
   @ping/mcp-workspace is an npm package
   Backend imports it (in-process, fast)
   CLI connects to it (MCP, standalone)
   External agents connect to it (MCP, universal)
   Teams configure which packages to use
   Can version, publish, swap independently
   Third-party can build compatible packages
```

---

## Third-Party MCP Servers

Alongside our own packages, teams can add standard MCP servers:

| Server | Package | What It Adds |
|---|---|---|
| **Brave Search** | `@anthropic/mcp-brave-search` | Web search capability |
| **Docker** | `@modelcontextprotocol/server-docker` | Container management (sandboxing) |
| **GitHub** | `@anthropic/mcp-github` | Repo/issue/PR management |
| **Filesystem** | `@modelcontextprotocol/server-filesystem` | Direct file system access |
| **PostgreSQL** | `@modelcontextprotocol/server-postgres` | Database queries |

These slot in alongside `@ping/mcp-*` packages — same protocol, same configuration.

---

## Migration Path

| Step | What | Action |
|---|---|---|
| 1 | Extract workspace tools | Move from `memory/L1/workspace/tools/` → `packages/mcp-workspace/` |
| 2 | Add MCP server wrapper | Use `fastmcp` to expose as MCP server |
| 3 | Dual export | Package exports both `tool()` objects and MCP server |
| 4 | Update WorkerPool | Import tools from `@ping/mcp-workspace` instead of direct path |
| 5 | Repeat for L2, L3, skills, orchestration | Same pattern for each |
| 6 | Update MemoryCoordinator | Plugins become package imports, configurable per team |
| 7 | Add third-party MCP servers | Configure Brave Search, Docker, etc. |
| 8 | CLI integration | CLI connects to MCP servers directly |

**Effort:** Medium (3-4 weeks for all packages)
