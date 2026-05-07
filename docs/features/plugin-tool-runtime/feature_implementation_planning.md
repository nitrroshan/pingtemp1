# Plugin Tool Runtime — Implementation Plan

**Date:** May 7, 2026
**Status:** Ready to implement (after agent-stream-bus Step 0)
**Architecture:** [feature_architecture.md](./feature_architecture.md)
**Depends on:** [agent-stream-bus](../agent-stream-bus/feature_implementation_planning.md) Step 0 (AgentFactory must exist first)
**Effort:** 1.5 weeks (8 working days)

---

## Scope — Option B: Full Tool Runtime

Four capabilities, all built on AI SDK primitives:

1. **MCP Client Plugin** — `@ai-sdk/mcp` integration. Connect to external MCP servers (stdio/SSE). Tools auto-discovered and merged via PluginRegistry.
2. **Agents-as-Tools** — Any agent can delegate to another Ping team/role. `tool()` wrapping `factory.create().generate()`.
3. **Dynamic Tool Control** — `prepareStep` returns `activeTools` to filter tools per-step. Reduces noise for agents with 30+ tools.
4. **Tool Approval** — `needsApproval: true` on sensitive tools. Pauses agent, routes to frontend via Socket.IO for human decision.

**Net change:** ~6 new files (~450 lines), 5 modified files, 1 new dependency (`@ai-sdk/mcp`).

---

## Implementation Steps

### Step 1: Install `@ai-sdk/mcp` + extend ToolContext (Day 1)

**What:** Add the AI SDK MCP client package. Extend `ToolContext` to support `"chat"` consumer type (currently only `"planner" | "worker"`).

**Files modified:**
- `packages/agent-manager/package.json` — add `@ai-sdk/mcp` dependency
- `packages/agent-manager/src/plugin/types.ts` — `ToolContext.consumer` → `"planner" | "worker" | "chat"`

**Entry criteria:** `@ai-sdk/mcp` available on npm, types.ts accessible
**Exit criteria:** `bun install` succeeds, `ToolContext` accepts `"chat"`, type check passes

---

### Step 2: Create McpClientPlugin (Day 1-2)

**What:** New `IPlugin` implementation that wraps `@ai-sdk/mcp`'s `createMCPClient()`. Each configured MCP server becomes a client connection. Tools auto-discovered via MCP protocol and exposed through existing `getMcpServers()` interface.

**New file:** `packages/agent-manager/src/plugin/McpClientPlugin.ts` (~100 lines)

```typescript
import { experimental_createMCPClient as createMCPClient } from 'ai';

interface McpServerConfig {
  id: string;
  name: string;
  transport: 'stdio' | 'sse';
  // stdio
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  // sse
  url?: string;
  headers?: Record<string, string>;
}

class McpClientPlugin implements IPlugin {
  readonly id = 'mcp-client';
  readonly name = 'MCP Client';
  private clients: Map<string, McpClient> = new Map();

  constructor(private servers: McpServerConfig[]) {}

  async initialize() {
    for (const server of this.servers) {
      const transport = server.transport === 'sse'
        ? { type: 'sse' as const, url: server.url! }
        : { type: 'stdio' as const, command: server.command!, args: server.args };
      const client = await createMCPClient({ transport });
      this.clients.set(server.id, client);
    }
  }

  async dispose() {
    for (const client of this.clients.values()) await client.close();
  }

  getMcpServers(): IMcpServer[] {
    return [...this.clients.entries()].map(([id, client]) => ({
      id, name: id,
      getTools: (_ctx: ToolContext) => Object.values(client.tools()),
    }));
  }

  getSkills(): ISkill[] { return []; }
}
```

**Key decisions:**
- MCP tools from `client.tools()` are already AI SDK format — no `toAiSdkTool()` conversion needed
- Client lifecycle: created in `initialize()`, closed in `dispose()`
- Server configs come from team configuration (stored in PG, loaded at team startup)
- All MCP tools available to all consumers initially — per-consumer filtering via `activeTools` in Step 5

**Entry criteria:** Step 1 complete
**Exit criteria:** McpClientPlugin can connect to a stdio MCP server (e.g., `@modelcontextprotocol/server-filesystem`), discover tools, return them via `getTools()`

---

### Step 3: MCP server configuration + registration (Day 2-3)

**What:** Store MCP server configs per team. Load at team startup. Register `McpClientPlugin` in PluginRegistry alongside existing plugins.

**Files modified:**
- `packages/agent-manager/src/AgentManagerV2.ts` — register `McpClientPlugin` from team config during `initializeTeam()`
- `packages/backend/db/schema.ts` — add `mcp_servers` JSONB column to `agent_teams` table (nullable, default null)
- `packages/backend/api/routes/teamRoutes.ts` — add `PUT /api/v2/teams/:teamId/mcp-servers` endpoint for CRUD

**New file:** `packages/backend/api/routes/mcpRoutes.ts` (~60 lines) — MCP server management endpoints:
- `GET /api/v2/teams/:teamId/mcp-servers` — list configured servers
- `PUT /api/v2/teams/:teamId/mcp-servers` — update server list (full replace)
- `POST /api/v2/teams/:teamId/mcp-servers/test` — test connection to a server config

**Schema addition:**
```sql
ALTER TABLE agent_teams ADD COLUMN mcp_servers JSONB DEFAULT NULL;
-- Format: [{ id, name, transport, command?, args?, url?, headers? }]
```

**Entry criteria:** Step 2 complete, McpClientPlugin works
**Exit criteria:** Team can store MCP server configs in PG. On team startup, configs are loaded and `McpClientPlugin` is registered. Workers get MCP tools automatically via existing `getTools()` flow.

---

### Step 4: Agents-as-Tools (Day 3-4)

**What:** Create a tool factory function that wraps an agent invocation as a callable tool. A ChatAgent or supervisor can delegate work to another role by calling the tool — which creates a worker via AgentFactory and runs `.generate()`.

**New file:** `packages/agent-manager/src/agent/tools/agentAsTool.ts` (~60 lines)

```typescript
import { tool } from 'ai';
import { z } from 'zod';

interface AgentAsToolConfig {
  roleKey: string;
  roleName: string;
  roleDescription: string;
  factory: AgentFactory;
  goalId: string;
}

function createAgentAsTool(config: AgentAsToolConfig) {
  return tool({
    description: `Delegate a task to ${config.roleName}: ${config.roleDescription}`,
    inputSchema: z.object({
      task: z.string().describe('The task to delegate'),
      context: z.string().optional().describe('Additional context'),
    }),
    execute: async ({ task, context }) => {
      const agent = await config.factory.create({
        consumer: 'worker',
        goalId: config.goalId,
        role: config.roleKey,
        // No task lifecycle — this is a one-shot delegation
      });
      const result = await agent.generate(`${task}${context ? `\n\nContext: ${context}` : ''}`);
      return { role: config.roleName, response: result.text };
    },
  });
}
```

**Where injected:** AgentFactory adds delegation tools when `consumer: "chat"` — ChatAgent gets one `delegate_to_<role>` tool per available team role. Planner and workers do NOT get delegation tools (they use the task system instead).

**Files modified:**
- AgentFactory (from stream-bus feature) — add delegation tool assembly for chat consumer

**Entry criteria:** AgentFactory exists (stream-bus Step 0)
**Exit criteria:** ChatAgent can call `delegate_to_backend_dev({ task: "fix the login bug" })` → creates a worker, runs it, returns result as tool output

---

### Step 5: Dynamic Tool Control via prepareStep (Day 4-5)

**What:** Extend the existing `prepareStep` callback in AiSdkAgent to return `activeTools` — filtering which tools the LLM sees on each step based on context.

**File modified:** `packages/agent-manager/src/agent/internal/AiSdkAgent.ts`

**Current `prepareStep`** (L297-L306):
```typescript
prepareStep: async ({ stepNumber, messages }) => {
  if (messages.length > 50) {
    const first = messages[0]!;
    const recent = messages.slice(-30);
    return { messages: [first, ...recent] as ModelMessage[] };
  }
  return {};
},
```

**New `prepareStep`:**
```typescript
prepareStep: async ({ stepNumber, messages, toolCallsInStep }) => {
  const result: any = {};

  // Existing context trimming
  if (messages.length > 50) {
    const first = messages[0]!;
    const recent = messages.slice(-30);
    result.messages = [first, ...recent] as ModelMessage[];
  }

  // NEW: Tool filtering via toolFilter callback (if provided)
  if (this.toolFilter) {
    const activeToolNames = this.toolFilter({
      stepNumber,
      totalTools: Object.keys(this.loadedTools).length,
      recentToolCalls: toolCallsInStep,
    });
    if (activeToolNames) {
      result.activeTools = activeToolNames;
    }
  }

  return result;
},
```

**New interface on AiSdkAgent:**
```typescript
type ToolFilterFn = (ctx: {
  stepNumber: number;
  totalTools: number;
  recentToolCalls: string[];
}) => string[] | undefined;  // undefined = all tools

setToolFilter(fn: ToolFilterFn): void;
```

**Default filter strategies (in AgentFactory):**
- **Workers with >20 tools:** After step 5, exclude workspace-read tools if agent hasn't used them in last 3 steps
- **Chat agents:** Always show delegation tools + read tools, hide lifecycle tools
- **Planners:** No filter (always need all planning tools)

These are initial strategies — the `setToolFilter()` API allows customization per agent config.

**Entry criteria:** Steps 1-4 complete, AiSdkAgent `prepareStep` accessible
**Exit criteria:** Agent with 30 tools only sees ~15 relevant tools after step 5. Verified by logging `activeTools` count in `onStepFinish`.

---

### Step 6: Tool Approval via Socket.IO (Day 5-7)

**What:** Support AI SDK's `needsApproval` flag on tools. When the agent calls an approval-required tool, execution pauses and a request is sent to the frontend via Socket.IO. The user approves/denies, and the agent continues.

This is the most complex step — it requires a round-trip:

```
Agent calls tool(needsApproval: true)
  → AI SDK pauses, yields tool-call with requiresApproval flag
  → AiSdkAgent.executeToolMode() detects approval-needed
  → Bus emits { type: "approval_request", toolName, args, executionId }
  → Socket.IO → Frontend dialog
  → User clicks Approve/Deny
  → Socket.IO → Backend resumes execution
  → Agent continues with tool result (or denial message)
```

**Files modified:**
- `packages/agent-manager/src/agent/internal/AiSdkAgent.ts` — detect `tool-call` events with approval flag, yield `approval_request` event, wait for resolution
- `packages/backend/api/SocketServerV2.ts` — new `approval:respond` Socket.IO event handler
- `packages/frontend/types.ts` — `ApprovalRequest` type
- `packages/frontend/components/` — new `ApprovalDialog` component

**New file:** `packages/agent-manager/src/agent/tools/approvalBridge.ts` (~50 lines)

```typescript
// Wraps a tool with approval support
function withApproval(baseTool: AiSdkTool, config: { reason: string }): AiSdkTool {
  return {
    ...baseTool,
    needsApproval: true,
    // AI SDK handles the pause — we just mark the tool
  };
}
```

**Socket.IO events:**
- Server emits: `approval:request` → `{ executionId, agentKey, toolName, args, reason }`
- Client emits: `approval:respond` → `{ executionId, approved: boolean, message?: string }`

**Frontend component:** `ApprovalDialog` — modal with tool name, args preview, approve/deny buttons. Renders inside `ChatArea` when `approval:request` arrives.

**Entry criteria:** Steps 1-5 complete, Socket.IO infrastructure exists
**Exit criteria:** Agent calls an approval-required tool → frontend shows dialog → user approves → agent continues. User denies → agent gets "Tool call denied: {reason}" as tool result.

---

### Step 7: ChatAgent plugin access (Day 7)

**What:** Wire ChatAgent through the same PluginRegistry path as workers. Currently ChatAgent has only 3 hardcoded read-only tools. After this step, it gets plugin tools (workspace read, collab, skills) + delegation tools (from Step 4).

**Files modified:**
- AgentFactory (from stream-bus) — `consumer: "chat"` path calls `pluginRegistry.getTools({ consumer: "chat", role, goalId })`
- `packages/agent-manager/src/plugin/types.ts` — already updated in Step 1 (`"chat"` consumer)
- Individual plugins may need to handle `consumer: "chat"` — e.g., WorkspacePlugin should give chat agents read-only tools (no write_file, no git_commit)

**Per-plugin chat behavior:**
| Plugin | Chat Agent Gets | Excluded |
|--------|----------------|----------|
| WorkspacePlugin | `read_file`, `list_files`, `search_files` | `write_file`, `create_file`, `git_commit`, `git_push` |
| CollabPlugin | `get_plan`, `get_task_detail` | `update_plan` (planner-only) |
| SkillPlugin | All on-demand skills (role-filtered) | Executable skills (`run.sh`) |
| McpClientPlugin | All MCP tools | None (MCP tools are generally safe) |

**Entry criteria:** Step 4 complete (delegation tools), PluginRegistry `consumer: "chat"` type works
**Exit criteria:** ChatAgent can read workspace files, browse tasks, invoke skills, delegate to workers — all via PluginRegistry. No hardcoded tool list in ChatAgent class.

---

### Step 8: Integration test + cleanup (Day 8)

**What:** End-to-end verification of all four capabilities. Remove any leftover LangChain MCP references.

**Tests:**
1. **MCP integration:** Start a filesystem MCP server via stdio → team connects → worker uses `read_file` tool from MCP → verify tool output
2. **Agents-as-tools:** ChatAgent delegates to worker role → worker executes → result returned to chat conversation
3. **Active tools:** Agent with 30+ tools → verify `prepareStep` reduces visible tools after step 5 → agent still completes task
4. **Tool approval:** Mark workspace `delete_file` as `needsApproval` → agent calls it → Socket.IO sends approval request → approve → file deleted

**Files modified:**
- `packages/backend/package.json` — remove unused `@langchain/mcp-adapters` dependency
- `packages/backend/package.json` — remove unused `fastmcp` dependency (server framework, we're a client)

**Entry criteria:** Steps 1-7 complete
**Exit criteria:** All 4 test scenarios pass. `bun run build:backend` succeeds. Type check passes. No unused MCP packages.

---

## File Summary

### New Files (~450 lines)
| File | Lines | Step |
|------|-------|------|
| `plugin/McpClientPlugin.ts` | ~100 | 2 |
| `api/routes/mcpRoutes.ts` | ~60 | 3 |
| `agent/tools/agentAsTool.ts` | ~60 | 4 |
| `agent/tools/approvalBridge.ts` | ~50 | 6 |
| `frontend: ApprovalDialog.tsx` | ~80 | 6 |
| DB migration for `mcp_servers` column | ~20 | 3 |

### Modified Files
| File | Change | Step |
|------|--------|------|
| `plugin/types.ts` | `ToolContext.consumer` add `"chat"` | 1 |
| `agent/internal/AiSdkAgent.ts` | Extend `prepareStep` + `toolFilter` + approval detection | 5, 6 |
| `AgentManagerV2.ts` | Register McpClientPlugin | 3 |
| `SocketServerV2.ts` | `approval:respond` handler | 6 |
| `frontend/types.ts` | `ApprovalRequest` type | 6 |

### Removed Dependencies
| Package | Why |
|---------|-----|
| `@langchain/mcp-adapters` | Replaced by `@ai-sdk/mcp` |
| `fastmcp` | Server framework — we're a client, not a server |

---

## Testing Strategy

- **Unit:** McpClientPlugin with mock transport, agentAsTool with mock factory, toolFilter with synthetic tool lists
- **Integration:** Full team startup with MCP server config → worker gets MCP tools → executes task
- **Manual:** Frontend approval dialog flow via dev tools

## Rollback

Each step is independently deployable:
- Steps 1-3 (MCP): revert McpClientPlugin registration, drop `mcp_servers` column
- Step 4 (delegation): remove delegation tools from factory
- Step 5 (activeTools): remove `toolFilter` callback, `prepareStep` reverts to context-trim only
- Steps 6 (approval): remove approval event handlers, `needsApproval` flags
- Step 7 (chat plugins): revert ChatAgent to hardcoded tools
