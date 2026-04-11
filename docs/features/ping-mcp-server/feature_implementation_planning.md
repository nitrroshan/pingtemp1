# Ping MCP Server v1.0 — Implementation Plan

**Architecture**: [feature_architecture.md](../feature_architecture.md)  
**Depends on**: A7 (ExternalAgent class), A3 (Tools as MCP)

## Branch
`feature/ping-mcp-server-v1.0`

## Scope — MVP

v1.0 delivers: **MCP server endpoint that external agents connect to for task coordination, collaboration, context, and skills.**

| In scope | Out of scope (v1.1+) |
|----------|---------------------|
| MCP Streamable HTTP server at `/mcp` | Workspace tools (v1.1) |
| Task lifecycle tools (report_status, complete_task) | Trust level integration (v1.1, depends A10) |
| Collaboration tools (collab_*) | MCP initialize capability negotiation (v2.0) |
| Context tools (get_context, get_capabilities) | Team stacking — child Ping as MCP server (v2.0) |
| Skills tool (invoke_skill) | |
| Capability detection from agent frontmatter `tools` field | |
| Bearer token authentication | |
| Feature flag `PING_MCP_SERVER_ENABLED` | |

## Implementation Steps

### Step 1: MCP Server Setup
**Files:** `packages/backend/mcp/PingMcpServer.ts`

Create MCP Streamable HTTP server as Express middleware mounted at `/mcp`.

```typescript
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

class PingMcpServer {
  private server: McpServer;
  
  constructor(private workerPool: WorkerPool, private pluginRegistry: PluginRegistry) {
    this.server = new McpServer({ name: 'ping', version: '1.0.0' });
    this.registerTools();
  }
  
  asMiddleware(): Express.RequestHandler  // Mount at /mcp
}
```

**Depends on:** Nothing  
**Tests:** MCP client connects, `tools/list` returns all tools

---

### Step 2: Task Lifecycle Tools
**Files:** `packages/backend/mcp/tools/taskTools.ts`

Register `report_status` and `complete_task` tools.

```typescript
server.tool('report_status', {
  status: z.enum(['in_progress', 'blocked', 'ready_for_review', 'need_clarification']),
  summary: z.string(),
  progress: z.number().min(0).max(100).optional(),
}, async ({ status, summary, progress }) => {
  // Forward to WorkerPool callbacks (same as createReportStatusTool)
});

server.tool('complete_task', {
  summary: z.string(),
  deliverables: z.array(z.string()),
  nextSteps: z.array(z.string()),
}, async ({ summary, deliverables, nextSteps }) => {
  // Forward to WorkerPool callbacks (same as createCompleteTaskTool)
});
```

**Depends on:** Step 1  
**Tests:** External agent calls report_status → UI shows progress

---

### Step 3: Collaboration Tools
**Files:** `packages/backend/mcp/tools/collabTools.ts`

Register collaboration tools that proxy to existing L2 CRDT operations.

```typescript
server.tool('collab_discover', { path: z.string().optional() }, async ({ path }) => {
  // Proxy to CollaborationPlugin.discover()
});
server.tool('collab_read', { doc: z.string(), key: z.string() }, async ({ doc, key }) => {
  // Proxy to CollaborationPlugin.read()
});
server.tool('collab_write', { doc: z.string(), key: z.string(), value: z.any() }, async ({ doc, key, value }) => {
  // Proxy to CollaborationPlugin.write()
});
// + collab_read_block, collab_write_block
```

**Depends on:** Step 1  
**Tests:** External agent reads/writes shared CRDT state

---

### Step 4: Context Tools
**Files:** `packages/backend/mcp/tools/contextTools.ts`

Register `get_context` and `get_capabilities`.

```typescript
server.tool('get_context', { taskId: z.string().optional() }, async ({ taskId }) => {
  // Return: task description, prerequisites, shared memory, team goal
  // Proxy to TaskStore + OrchestratorService
});

server.tool('get_capabilities', {}, async () => {
  // Return: team name, role, available tools, active mode
});
```

**Depends on:** Step 1  
**Tests:** External agent gets task context including prerequisites

---

### Step 5: Skills Tool
**Files:** `packages/backend/mcp/tools/skillTools.ts`

Register `invoke_skill` — loads SKILL.md content for the external agent.

```typescript
server.tool('invoke_skill', { skillId: z.string() }, async ({ skillId }) => {
  // Read SKILL.md from plugin folder
  // Return body content (prompt injection text)
  // Same as appendSystemPrompt() but returned as tool result
});
```

**Depends on:** Step 1, Team Registry v1.0 (plugin loader for SKILL.md files)  
**Tests:** External agent invokes skill → gets SKILL.md content

---

### Step 6: Authentication
**Files:** `packages/backend/mcp/auth/mcpAuth.ts`

Bearer token authentication middleware for MCP connections.

```typescript
// Validate bearer token from MCP request headers
// Token stored in env: PING_MCP_AUTH_TOKEN
// If no token configured, allow unauthenticated (local dev)
```

**Depends on:** Step 1  
**Tests:** Unauthorized request rejected, valid token accepted

---

### Step 7: Capability Detection
**Files:** `packages/backend/mcp/PingMcpServer.ts` (modify)

Filter exposed tools based on the connecting agent's declared capabilities.

```typescript
// On tools/list request:
// 1. Look up agent by session/token → get agent .md definition
// 2. Check agent's `tools` field in frontmatter
// 3. If agent has [Read, Write, Bash, Edit] → skip workspace_* tools
// 4. Return only the tools the agent needs
```

**Depends on:** Steps 1-5, Team Registry v1.0 (agent definitions)  
**Tests:** Claude Code agent gets only coordination tools, lightweight bot gets all

---

### Step 8: Feature Flag + Startup Wiring
**Files:** `packages/backend/server.ts` or `api/AgentManagerAPI.ts`

```typescript
if (process.env.PING_MCP_SERVER_ENABLED === 'true') {
  const mcpServer = new PingMcpServer(workerPool, pluginRegistry);
  app.use('/mcp', mcpServer.asMiddleware());
}
```

**Depends on:** Steps 1-7  
**Tests:** Server starts with flag → `/mcp` responds, without flag → 404

---

## File Summary

| New files | Purpose |
|-----------|---------|
| `packages/backend/mcp/PingMcpServer.ts` | MCP server setup + middleware |
| `packages/backend/mcp/tools/taskTools.ts` | report_status, complete_task |
| `packages/backend/mcp/tools/collabTools.ts` | collab_discover, read, write, blocks |
| `packages/backend/mcp/tools/contextTools.ts` | get_context, get_capabilities |
| `packages/backend/mcp/tools/skillTools.ts` | invoke_skill |
| `packages/backend/mcp/auth/mcpAuth.ts` | Bearer token auth |

| Modified files | Change |
|---------------|--------|
| `packages/backend/server.ts` | Mount MCP server on `/mcp` |
| `packages/backend/package.json` | Add `@modelcontextprotocol/sdk` |

## Dependencies (npm)

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/sdk` | MCP server implementation |

## Testing Strategy

1. **Unit tests (Steps 2-5):** Each tool individually
2. **Integration test (Step 6-7):** Auth + capability detection
3. **E2E test:** Claude Code .mcp.json → connects → gets task → reports status → completes

## Rollback

- Feature-flagged: `PING_MCP_SERVER_ENABLED=false` (default)
- MCP server is additive — doesn't change any existing endpoints
