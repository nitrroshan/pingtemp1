# Ping MCP Server — Feature Architecture

**Status:** Architecture — Research & SDK Verified  
**Date:** April 11, 2026 (verified May 3, 2026)  
**ID:** A11  
**Depends on:** A7 (External Agent Invocation), A3 (Tools as MCP)  
**Feeds into:** B3 (Team Stacking), Team Registry (external agent integration)

---

## Overview

Ping exposes a **single MCP server** that any external tool can install to become a worker in a Ping team. Instead of building custom adapters for each tool (Claude Code, Cursor, Windsurf, OpenClaw), Ping speaks MCP — the industry standard protocol. One integration point for everything.

```
Claude Code  → installs Ping MCP → becomes a team worker
Cursor       → installs Ping MCP → same
Windsurf     → installs Ping MCP → same
OpenClaw     → installs Ping MCP → same
Another Ping → installs Ping MCP → same (team stacking)
```

### Config for any MCP client

```json
{ "ping": { "type": "http", "url": "http://localhost:3002/mcp" } }
```

One line. That's it.

---

## Why MCP Server First (Not Plugin)

The plugin system (`IPlugin` → `PluginRegistry`) already works for **internal** agents — WorkspacePlugin, CollaborationPlugin, SkillPlugin, KnowledgePlugin all provide tools to AiSdkAgent workers. The gap is **external agent integration**.

| Approach | What | Verdict |
|----------|------|---------|
| **MCP Server (this feature)** | Streamable HTTP endpoint at `/mcp`. External agents connect and receive Ping coordination tools via MCP protocol. | **Start here** — immediate value |
| **Plugin (IPlugin)** | Internal tool-provider abstraction via `IMcpServer` interface. | Already done — existing plugins cover this. |
| **Tools as MCP (A3)** | Break collab/knowledge/skills into separate `@ping/mcp-*` packages as standalone MCP servers. | Later — requires more infra, less urgent. |

The existing `IMcpServer` interface in `plugin/types.ts` is a **local tool-provider abstraction** — it is NOT an MCP protocol server. `SkillMcpServer` implements `IMcpServer` to return AI SDK-compatible tools filtered by `ToolContext`, not to speak the MCP wire protocol.

---

## Current Codebase State (Verified May 3, 2026)

| Item | Status |
|------|--------|
| MCP server running | **None** — 0% implemented |
| MCP SDK v2 packages | **Installed**: `@modelcontextprotocol/server`, `/node`, `/express` (all `^2.0.0-alpha.2`) — verified importable |
| Zod v4 | **Available**: `zod@3.25.76` exports `zod/v4` subpath (MCP SDK requires Standard Schema) — verified working |
| `packages/backend/mcp/` dir | **Exists** with empty `auth/` and `tools/` subdirs — ready for implementation |
| `IMcpServer` interface | Exists in `@ping/agent-manager` — local tool abstraction, NOT MCP protocol |
| `SkillMcpServer` | Implements `IMcpServer` (local), returns AI SDK tools — not MCP protocol |
| `fastmcp` | In `packages/backend/package.json` but **unused** — can remove |
| HttpServer `/mcp` route | Not mounted — planned behind feature flag |

---

## Design Principles

### 1. Complement, Don't Replace

External agents (Claude Code, Cursor) already have **superior workspace tools** (Read, Write, Bash, Edit, Grep, LSP). Ping doesn't replace those — it provides what they don't have:

- **Coordination** — report_status, complete_task (task lifecycle)
- **Collaboration** — collab_read, collab_write (team shared state)
- **Context** — get_context, get_capabilities (task dependencies, team info)
- **Skills** — invoke_skill (Ping knowledge base)

```
Claude Code (external)
├── Uses its OWN tools:              ← Superior, already has
│   Read, Write, Bash, Edit, Grep, Glob, LSP, computer use
│
└── Uses PING MCP tools:            ← Doesn't have natively
    report_status, complete_task,    (coordination)
    collab_read, collab_write,       (collaboration)
    get_context, invoke_skill        (context + skills)
```

```
Internal AiSdkAgent
├── Uses Ping-provided tools:        ← Doesn't have its own
│   workspace_read_file, workspace_write_file, workspace_commit
│
└── Uses same coordination tools:    ← Same interface
    report_status, complete_task,
    collab_read, collab_write,
    get_context, invoke_skill
```

### 2. Capability Negotiation

Ping detects what the external agent already has and only serves what's missing:

- **v1.0**: Check agent's `tools` field in frontmatter at load time
- **v2.0**: MCP `initialize` handshake — client sends `capabilities` in `clientInfo`, Ping filters `tools/list` response

```
Claude Code connects → has [Read, Write, Bash, Edit, Grep, LSP]
  → Ping serves: coordination + collaboration + context + skills only

Lightweight bot connects → has nothing
  → Ping serves: ALL tools (workspace + coordination + collab + skills)
```

### 3. Same Bounds as Internal Agents

External agents operate under the **same constraints**:
- Same `maxTurns` limit
- Same tool permissions (via `tools` / `disallowedTools` from agent .md)
- Same hooks (PreToolUse/PostToolUse validation)
- Same streaming protocol (AgentEvent stream)
- Same task DAG (prerequisites must be met before task is assigned)
- Same trust levels (untrusted external agents run in sandbox — see A10)

### 4. Workers, Not Tools

External agents are **workers** assigned tasks by the orchestrator — not tools called by other agents. The UI doesn't know if work is done by an internal AiSdkAgent or by Claude Code.

---

## MCP Tools Exposed

| Category | Tool | Input | Output |
|----------|------|-------|--------|
| **Task Lifecycle** | `report_status` | `{ status, summary, progress? }` | `{ ok: true }` |
| | `complete_task` | `{ summary, deliverables[], nextSteps[] }` | `{ ok: true }` |
| **Collaboration** | `collab_discover` | `{ path? }` | CRDT doc listing |
| | `collab_read` | `{ doc, key }` | Value |
| | `collab_write` | `{ doc, key, value }` | `{ ok: true }` |
| | `collab_read_block` | `{ doc }` | Block content |
| | `collab_write_block` | `{ doc, blocks[] }` | `{ ok: true }` |
| **Context** | `get_context` | `{ taskId? }` | Task context, prerequisites, shared memory |
| | `get_capabilities` | `{}` | Team/role capabilities |
| **Skills** | `invoke_skill` | `{ skillId }` | Skill content (prompt injection text) |
| **Workspace** (optional) | `workspace_read_file` | `{ path }` | File content |
| | `workspace_write_file` | `{ path, content }` | `{ ok: true }` |
| | `workspace_create_file` | `{ path, content }` | `{ ok: true }` |
| | `workspace_delete_file` | `{ path }` | `{ ok: true }` |
| | `workspace_list_files` | `{ dir? }` | File listing |
| | `workspace_commit` | `{ message }` | Commit hash |
| | `workspace_status` | `{}` | Branch, changes, stats |
| | `workspace_info` | `{}` | Workspace ID, branch, task |
| | `workspace_publish` | `{ manifest }` | `{ ok: true }` |

---

## Team Stacking

Same MCP server, reverse direction. A child Ping team exposes itself → parent team's agent connects as MCP client:

```
Product Team (parent)
  └── "Build auth system" → ExternalAgent → MCP client
       └── connects to Engineering Team's MCP endpoint
           └── Engineering Team orchestrates internally
               ├── backend-developer
               ├── frontend-developer
               └── qa-engineer
           └── Returns: AgentEvent stream → parent
```

---

## Integration with Team Registry

External agents defined in agent `.md` frontmatter:

```markdown
---
name: claude-code-backend
type: external
role: backend
description: Backend developer using Claude Code
tools: [Read, Write, Bash, Edit, Grep, Glob]    # ← Agent's own tools
mcpServers:
  - ping:
      type: http
      url: "http://localhost:3002/mcp"
---
```

Plugin loader sees `type: external` → creates `ExternalAgent` instead of `AiSdkAgent`. Capability negotiation uses the `tools` field to determine what Ping MCP serves.

---

## Security

- **Authentication**: MCP supports bearer tokens. Stored in env, injected at connection time
- **Trust levels**: External agents default to `untrusted` (see A10). Registered/allowlisted agents can be `trusted`
- **Output validation**: Responses validated before forwarding to orchestrator
- **Rate limiting**: Per-endpoint configurable
- **Timeout**: Per-agent via `ExternalConfig.timeout` (default 5 min)

---

## SDK & Technology Decision (Verified)

### MCP TypeScript SDK v2 — Already Installed

All three packages are in `packages/backend/package.json` and verified importable:

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/server` | `McpServer` class — register tools, resources, prompts |
| `@modelcontextprotocol/node` | `NodeStreamableHTTPServerTransport` — HTTP transport for Node.js |
| `@modelcontextprotocol/express` | `createMcpExpressApp()` — Express middleware with DNS rebinding protection |

**Key SDK v2 API:**

```typescript
import { McpServer } from '@modelcontextprotocol/server';
import { NodeStreamableHTTPServerTransport } from '@modelcontextprotocol/node';
import { createMcpExpressApp } from '@modelcontextprotocol/express';
import * as z from 'zod/v4';

const server = new McpServer(
  { name: 'ping', version: '1.0.0' },
  { instructions: 'Use report_status for progress. Use complete_task when done.' }
);

server.registerTool('report_status', {
  description: 'Report task progress to the orchestrator',
  inputSchema: z.object({
    status: z.enum(['in_progress', 'blocked', 'ready_for_review']),
    summary: z.string(),
    progress: z.number().min(0).max(100).optional(),
  }),
}, async ({ status, summary, progress }) => {
  return { content: [{ type: 'text', text: JSON.stringify({ ok: true }) }] };
});

// Transport: Streamable HTTP (stateful sessions per external agent)
const transport = new NodeStreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),  // stateful
});
await server.connect(transport);
```

**Why v2 over v1:** Cleaner API (`registerTool` with Zod), split packages, Express middleware helper, built-in DNS rebinding protection, Streamable HTTP transport (replaces deprecated HTTP+SSE). v2 was targeting stable Q1 2026 — timeline aligns with our implementation.

**Why not `fastmcp`:** Already unused in codebase. The official SDK is actively maintained and has Express/Hono middleware adapters. `fastmcp` would be a third-party wrapper adding indirection.

### Transport: Streamable HTTP

MCP defines two transports — **stdio** (local process) and **Streamable HTTP** (remote). We use Streamable HTTP because:

- Ping runs as a server process, not spawned per-client
- Multiple external agents connect simultaneously (Claude Code, Cursor, etc.)
- Supports stateful sessions via `Mcp-Session-Id` header
- Supports SSE streaming for server→client notifications
- Standard HTTP auth (bearer tokens)

**Wire protocol:** Client sends JSON-RPC 2.0 requests via HTTP POST to `/mcp`. Server responds with `application/json` or opens `text/event-stream` for streaming. Client can also GET `/mcp` for server-initiated SSE.

---

## Integration Points

```
PingMcpServer
├── WorkerPool         → task lifecycle callbacks (report_status, complete_task)
├── TaskStore          → task context, dependencies, status
├── CollaborationPlugin → CRDT read/write (collab_* tools)
├── PluginRegistry     → skill loading (invoke_skill)
├── OrchestratorService → goal/plan context (get_context)
└── HttpServer.ts      → mount at `/mcp` behind feature flag
```

### Mounting on Express (HttpServer.ts)

```typescript
// In HttpServer.ts or AgentManagerAPI.ts
if (process.env.PING_MCP_SERVER_ENABLED === 'true') {
  const mcpApp = createMcpExpressApp(); // DNS rebinding protection auto-enabled
  // Wire MCP routes: POST /mcp, GET /mcp, DELETE /mcp
  app.use('/mcp', mcpApp);
}
```

Current HttpServer routes (`/health`, `/api/v2/*`, `/api/registry/*`, `/api-docs`) are unaffected. The `/mcp` endpoint is independent.

---

## Feature Flag

| Flag | Default | What it controls |
|------|---------|-----------------|
| `PING_MCP_SERVER_ENABLED` | `false` | MCP server endpoint at `/mcp` |

---

## Version Roadmap

| Version | What |
|---------|------|
| **v1.0** | MCP server with coordination + collab + context + skills tools. Capability detection from agent frontmatter |
| **v1.1** | Workspace tools (optional). Trust level integration (A10) |
| **v2.0** | MCP `initialize` capability negotiation. Team stacking (child Ping as MCP server) |
