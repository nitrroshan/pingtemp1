# Tools & MCP — Feature Architecture

**Status:** New  
**Date:** March 30, 2026  
**ID:** A3 (merged with F2: MCP Integration)  
**Depends on:** A1 (Mastra/AI SDK Migration)  
**Absorbs:** F2 (MCP Integration), Tools Integration

---

## Overview

All tools become **packages**. High-frequency local operations stay **in-process** (imported via `npm`). Shared, external, and memory layer tools become **MCP servers** (connected via protocol). Memory plugins become swappable packages that teams configure.

One doc covers the full picture: what stays in-process, what becomes MCP, the package structure, and the memory layer extraction.

### The Split Principle

```
IN-PROCESS (AI SDK tool() — fast, local, high-frequency):
  File operations         — read, write, list, grep, glob
  Git operations          — commit, status, history, branch
  Workspace search        — BM25 keyword search (MiniSearch)
  Scratchpad              — scratch_note, scratch_todo, promote
  Agent lifecycle         — report_status, complete_task

  WHY: Called 10-100x per task. 0.1ms vs 15ms matters 
  at this frequency. These are the agent's "hands" — 
  they need to be instant.

MCP PACKAGES (shared, external, low-frequency):
  L2 Collaboration        — CRDT docs, plans, group chat
  L3 Knowledge            — knowledge base, semantic search
  Skills                  — skill discovery, script execution
  Web Search              — Brave Search, Tavily
  Docker                  — container management (sandboxing)
  GitHub                  — repo/issue/PR management
  Database                — structured data queries

  WHY: Called 1-5x per task. 15ms overhead is invisible.
  These need to be shared across CLI, external agents,
  and different teams. MCP makes them universal.
```

---

## What Stays In-Process

These are the agent's core workspace tools — high-frequency, local, latency-sensitive:

### Workspace Tools (21 tools — in-process)

From [workspace-tools.ts](../../packages/backend/memory/L1/workspace/tools/workspace-tools.ts):

| Tool | Calls/Task | Why In-Process |
|---|---|---|
| `workspace_read_file` | 10-50x | Most called tool. 0.1ms vs 15ms × 50 = 750ms saved |
| `workspace_write_file` | 5-20x | Frequent writes during code/content creation |
| `workspace_create_file` | 2-10x | File creation during task execution |
| `workspace_list_files` | 5-15x | Directory browsing while working |
| `workspace_grep` | 3-10x | Searching through workspace files |
| `workspace_glob` | 2-5x | Finding files by pattern |
| `workspace_file_exists` | 3-10x | Checking before read/write |
| `workspace_delete_file` | 1-3x | Cleanup |
| `workspace_commit` | 1-3x | Git commits |
| `workspace_get_history` | 1-2x | Reviewing past commits |
| `workspace_status` | 2-5x | Checking workspace state |
| `workspace_info` | 1-2x | Metadata |
| `workspace_publish` | 1x | End of task |
| `workspace_reactivate` | 0-1x | Resume work |
| `workspace_discard` | 0-1x | Abandon branch |
| `workspace_log_activity` | 3-10x | Logging during work |
| `scratch_note` | 2-5x | Quick notes |
| `scratch_todo` | 1-3x | Task reminders |
| `scratch_remember` | 1-3x | Key facts |
| `scratch_file` | 1-3x | Temp files |
| `promote_to_workspace` | 1-3x | Move scratch → workspace |

### Agent Lifecycle Tools (2 tools — in-process)

From [agent/internal/tools/](../../packages/backend/agent/internal/tools/):

| Tool | Why In-Process |
|---|---|
| `report_status` | Emits events directly to orchestrator — needs in-process event bus |
| `complete_task` | Same — signals task completion via events |

These stay in `@ping/agent-manager` as part of the core runtime.

---

## What Becomes MCP Packages

These are shared/external tools — low-frequency, benefit from being universal:

### `@ping/mcp-collab` (L2 — CRDT Collaboration)

| MCP Tool | Calls/Task | Why MCP |
|---|---|---|
| `discover_docs` | 1-2x | Shared across all agents in team |
| `list_docs` | 1-3x | Team-wide document listing |
| `read_doc` | 1-5x | Reading shared CRDT documents |
| `write_doc` | 1-3x | Writing to shared documents |
| `list_plans` | 1x | Shared plan store |
| `read_plan` | 1-2x | Reading shared plans |
| `group_chat_start` | 0-1x | Inter-agent collaboration |
| `group_chat_message` | 0-5x | Group chat turns |

**Why MCP:** L2 is the shared collaboration layer. CLI, external agents, and multiple teams need access. Running as a standalone server (Hocuspocus) is already the architecture — MCP makes it universal.

### `@ping/mcp-knowledge` (L3 — Knowledge Base)

| MCP Tool | Calls/Task | Why MCP |
|---|---|---|
| `relevant_docs` | 1-3x | Semantic search across knowledge base |
| `role_skills` | 1x | Role-specific knowledge |
| `add_knowledge` | 0-1x | Adding to shared knowledge |
| `search_knowledge` | 1-3x | Full-text search |

**Why MCP:** Knowledge base is team/org-wide. Needs to be queryable by any consumer.

### `@ping/mcp-skills` (Skill Discovery)

| MCP Tool | Calls/Task | Why MCP |
|---|---|---|
| `list_available_skills` | 0-1x | Skill browsing |
| `search_skills` | 0-1x | Semantic skill search |
| `read_skill` | 0-1x | Reading skill instructions |
| `read_skill_file` | 0-1x | Skill documentation |
| `run_skill_script` | 0-1x | Script execution |

**Why MCP:** Skills are a shared registry. CLI, UI, and agents all need access.

### Third-Party MCP Servers

| Server | Package | Calls/Task |
|---|---|---|
| **Brave Search** | `@anthropic/mcp-brave-search` | 1-5x |
| **Docker** | `@modelcontextprotocol/server-docker` | 1-3x |
| **GitHub** | `@anthropic/mcp-github` | 1-5x |
| **PostgreSQL** | `@modelcontextprotocol/server-postgres` | 1-5x |

---

## Package Structure

Everything is a package — the difference is **how** it's consumed (import vs MCP):

```
packages/
  workspace-tools/            ← @ping/workspace-tools (npm package, in-process)
    src/
      tools/
        file-tools.ts           read, write, create, delete, list, grep, glob
        git-tools.ts            commit, status, history, publish, discard
        scratchpad-tools.ts     scratch_note, scratch_todo, promote
        activity-tools.ts       log_activity, workspace_status, workspace_info
      index.ts                  export { createWorkspaceTools }
    package.json

  lifecycle-tools/            ← @ping/lifecycle-tools (npm package, in-process)
    src/
      report-status.ts          report_status tool
      complete-task.ts          complete_task tool
      index.ts                  export { createLifecycleTools }
    package.json

  mcp-collab/                 ← @ping/mcp-collab (MCP server)
    src/
      server.ts                 fastmcp server
      tools/                    discover, list, read, write CRDT docs
    package.json

  mcp-knowledge/              ← @ping/mcp-knowledge (MCP server)
    src/
      server.ts
      tools/                    relevant_docs, search_knowledge
    package.json

  mcp-skills/                 ← @ping/mcp-skills (MCP server)
    src/
      server.ts
      tools/                    list, search, read, run skills
    package.json

  agent-manager/              ← @ping/agent-manager (consumes all of the above)
  teams/                      ← @ping/teams
  backend/                    ← thin API layer
  cli/                        ← imports workspace-tools + connects to MCP servers
```

### All Packages, Two Consumption Modes

| Package | Type | How Backend Uses It | How CLI Uses It | How External Uses It |
|---|---|---|---|---|
| `@ping/workspace-tools` | npm (in-process) | `import` → AI SDK `tool()` | `import` → same | `import` → same |
| `@ping/lifecycle-tools` | npm (in-process) | `import` → AI SDK `tool()` | `import` → same | `import` → same |
| `@ping/mcp-collab` | MCP server | connect via MCP | connect via MCP | connect via MCP |
| `@ping/mcp-knowledge` | MCP server | connect via MCP | connect via MCP | connect via MCP |
| `@ping/mcp-skills` | MCP server | connect via MCP | connect via MCP | connect via MCP |
| Third-party MCP | MCP server | connect via MCP | connect via MCP | connect via MCP |

**Everything is a package.** The distinction is import vs protocol — not packaged vs not-packaged.

### How AgentManager Loads Both

```typescript
import { createWorkspaceTools } from '@ping/workspace-tools';
import { createLifecycleTools } from '@ping/lifecycle-tools';

class AgentManager {
  async createWorker(role: string, task: Task): Promise<void> {
    // 1. In-process tools — imported from packages, fast
    const inProcessTools = {
      ...createWorkspaceTools(task.workspaceConfig),
      ...createLifecycleTools(this.orchestrator),
    };

    // 2. MCP tools — from configured servers
    const mcpTools = await this.mcpClient.getTools([
      '@ping/mcp-collab',
      '@ping/mcp-knowledge',
      ...this.teamConfig.mcpServers,  // Brave Search, GitHub, etc.
    ]);

    // 3. Skill tools — from skill config
    const skillTools = await SkillResolver.resolve(role.skills);

    // All tools passed to streamText()
    await streamText({
      model,
      messages,
      tools: { ...inProcessTools, ...mcpTools, ...skillTools },
    });
  }
}
```

---

## Decision Criteria: When to Use Each

| Criteria | In-Process | MCP |
|---|---|---|
| **Calls per task** | >5 (high frequency) | <5 (low frequency) |
| **Latency sensitivity** | Yes — tight loops | No — called occasionally |
| **Shared across consumers** | No — backend only | Yes — CLI, external agents, teams |
| **State** | Local to worker (files, git) | Shared (CRDT, knowledge, skills) |
| **External service** | No | Yes (Brave Search, Docker, GitHub) |
| **Needs standalone deployment** | No | Yes — can run as separate process |

**Rule of thumb:** If the agent calls it more than 5 times per task, or if it touches local files, keep it in-process. If it's shared state or an external service, make it MCP.

---

## Memory Plugins → Swappable Packages

The 3 memory plugins currently registered via `MemoryCoordinator` become independent packages:

| Current Plugin | Package | What It Provides | Can Swap? |
|---|---|---|---|
| `L1WorkspacePlugin` | `@ping/workspace-tools` | Git workspace, file ops, scratchpad | Yes — could replace with S3-based workspace |
| `L2CollaborationPlugin` | `@ping/mcp-collab` | CRDT docs, plans, group chat | Yes — could replace with a simpler store |
| `L3KnowledgePlugin` | `@ping/mcp-knowledge` | Knowledge base, semantic search | Yes — could replace with vector DB provider |

### Why Packages, Not Plugins

```
❌ Plugins (current — in-process, tightly coupled):
   L1WorkspacePlugin registered in MemoryCoordinator
   Can't use outside the backend process
   Can't version independently
   Can't swap implementations without changing backend code

✅ Packages (target — independent, composable):
   @ping/workspace-tools and @ping/mcp-collab are npm packages
   Backend imports them (in-process or MCP depending on type)
   CLI uses them directly
   Teams configure which packages to enable
   Can version, publish, swap independently
   Third-party can build compatible packages
```

### Team Configuration

Teams choose which packages to enable:

```typescript
const team = await TeamManager.create({
  name: 'Marketing Team',
  roles: ['researcher', 'writer'],
  
  // Memory packages — plug and play
  memory: {
    l1: '@ping/workspace-tools',         // or a custom workspace package
    l2: '@ping/mcp-collab',              // or '@acme/collab-server'
    l3: '@ping/mcp-knowledge',           // or null (no knowledge base)
  },
  
  // Additional MCP servers — third-party or custom
  mcpServers: [
    '@anthropic/mcp-brave-search',       // web search
    '@anthropic/mcp-github',             // GitHub integration
    './custom-servers/internal-api',      // company-specific tools
  ],
});
```

---

## Third-Party MCP Servers

Teams can add standard MCP servers alongside Ping's own packages:

| Server | Package | What It Adds |
|---|---|---|
| **Brave Search** | `@anthropic/mcp-brave-search` | Web search capability |
| **Docker** | `@modelcontextprotocol/server-docker` | Container management (sandboxing) |
| **GitHub** | `@anthropic/mcp-github` | Repo/issue/PR management |
| **Filesystem** | `@modelcontextprotocol/server-filesystem` | Direct file system access |
| **PostgreSQL** | `@modelcontextprotocol/server-postgres` | Database queries |

These slot in alongside `@ping/mcp-*` packages — same protocol, same configuration.

---

## MCP Server Implementation Pattern

Each MCP package uses `fastmcp` (already in dependencies) to expose tools:

```typescript
// packages/mcp-collab/src/server.ts
import { FastMCP } from 'fastmcp';

const server = new FastMCP({ name: '@ping/mcp-collab' });

server.addTool({
  name: 'discover_docs',
  description: 'Find what CRDT documents exist in this team',
  parameters: z.object({ teamId: z.string() }),
  execute: async ({ teamId }) => {
    return collabSpace.discover(teamId);
  },
});
// ... more tools

export { server };
// Run standalone: npx @ping/mcp-collab --port 3010
```

---

## Migration Path

| Step | What | From | To |
|---|---|---|---|
| 1 | Extract workspace tools | `memory/L1/workspace/tools/` | `packages/workspace-tools/` |
| 2 | Extract lifecycle tools | `agent/internal/tools/` | `packages/lifecycle-tools/` |
| 3 | Extract L2 collab as MCP | `memory/L2/` | `packages/mcp-collab/` |
| 4 | Extract L3 knowledge as MCP | `memory/L3/` | `packages/mcp-knowledge/` |
| 5 | Extract skill tools as MCP | `skills/tools/` | `packages/mcp-skills/` |
| 6 | Update AgentManager | Direct imports | Import from packages |
| 7 | Update MemoryCoordinator | Plugin registration | Package imports, configurable per team |
| 8 | Add third-party MCP servers | — | Configure Brave Search, Docker, GitHub |
| 9 | CLI integration | — | CLI imports workspace-tools + connects to MCP servers |

**Effort:** Medium (3-4 weeks for all packages)
