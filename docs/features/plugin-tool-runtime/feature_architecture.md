# Plugin Tool Runtime — Feature Architecture

**Date:** May 6, 2026
**Status:** Architecture
**Priority:** P1 — Enables MCP, agents-as-tools, dynamic tool control for all agent types
**Depends on:** [agent-stream-bus](../agent-stream-bus/feature_architecture.md) (AgentFactory), [plugin-taxonomy](../plugin-taxonomy/feature_architecture.md) (IPlugin refactor)
**Related:** [plugin-ecosystem](../plugin-ecosystem/feature_architecture.md) (format), [tools-as-mcp](../tools-as-mcp/feature_architecture.md) (split decision)

---

## Problem

Three gaps in how agents receive tools at runtime:

1. **No real MCP support.** `IMcpServer` is an internal naming convention — not actual Model Context Protocol. External MCP servers (GitHub Copilot tools, Claude plugins, community servers) can't connect.
2. **ChatAgent has no plugin access.** It gets hardcoded read-only tools. Workers and planners get tools via PluginRegistry, but chat agents are excluded — all three should use the same path.
3. **No runtime tool control.** All tools are loaded once at task start. No per-step filtering (`activeTools`), no human-in-the-loop approval (`needsApproval`), no dynamic tool discovery.

### What Mastra Teaches Us

Mastra is a thin orchestration layer built on AI SDK. Every Mastra feature maps to an AI SDK primitive we can use directly:

| Mastra Feature | AI SDK Primitive | Our Implementation |
|---|---|---|
| `createTool()` | `tool()` from `ai` | Already using via `toAiSdkTool()` |
| `agents: { writer }` (agents-as-tools) | `tool()` wrapping `.generate()` | AgentFactory creates the delegate tool |
| `workflows: { research }` (workflows-as-tools) | `tool()` wrapping workflow execution | Wrap plan execution in a tool |
| MCP integration | `@ai-sdk/mcp` (`createMCPClient`) | Native AI SDK — same package Mastra uses |
| `activeTools` filtering | `activeTools` on `streamText()` | Via `prepareStep` callback |
| `toolChoice` control | `toolChoice` on `streamText()` | Already available |
| Dynamic tool search | `prepareStep` + `activeTools` | Filter large tool sets per-step |
| Tool approval | `needsApproval: true` on `tool()` | Route approval through Socket.IO |

**Decision: Use AI SDK directly.** Adding `@mastra/core` would create a competing Agent abstraction alongside our `AiSdkAgent`. We adopt the patterns, not the dependency.

---

## Architecture Options

### Option A: MCP-Only — Add `@ai-sdk/mcp` to PluginRegistry

**Implementation:** Create an `McpPlugin` that wraps `@ai-sdk/mcp`'s `createMCPClient()`. Each configured MCP server becomes a client connection. Tools auto-discovered via MCP protocol and merged into agent toolset through existing PluginRegistry.

```typescript
// New: McpPlugin implements IPlugin
class McpPlugin implements IPlugin {
  private clients: Map<string, McpClient> = new Map();

  async initialize() {
    for (const server of this.config.servers) {
      const client = await createMCPClient({
        transport: server.transport === "sse"
          ? { type: "sse", url: server.url }
          : { type: "stdio", command: server.command, args: server.args }
      });
      this.clients.set(server.id, client);
    }
  }

  getMcpServers(): IMcpServer[] {
    return [...this.clients.entries()].map(([id, client]) => ({
      id, name: id,
      getTools: () => Object.values(client.tools()),  // Real MCP tools
    }));
  }
}
```

**Pros:**
- Minimal change — 1 new plugin class, fits existing PluginRegistry
- Real MCP protocol — connects to any MCP server (GitHub, filesystem, databases)
- AI SDK handles schema discovery, typed outputs, tool conversion
- `@ai-sdk/mcp` supports HTTP, SSE, stdio transports

**Cons:**
- Only adds MCP. No agents-as-tools, no dynamic tool control, no approval.
- ChatAgent still excluded (separate issue from MCP)
- No per-step tool filtering

**Effort:** 2-3 days

---

### Option B: Full Tool Runtime — MCP + Agents-as-Tools + Dynamic Control

**Implementation:** Extends Option A with three additional capabilities powered by AI SDK primitives:

```
AgentFactory.create({ consumer, goalId, ... })
  │
  ├── 1. Builtin tools (per consumer type — Strategy pattern)
  │     PlannerToolStrategy  → create_plan, approve_plan, get_status, get_context
  │     WorkerToolStrategy   → report_status, complete_task, bounce_task, request_task
  │     ChatToolStrategy     → dispatch_goal, notify_user
  │
  ├── 2. Plugin tools (universal — PluginRegistry)
  │     pluginRegistry.getTools({ consumer, role, goalId })
  │     ├── WorkspacePlugin  → 32 file/git tools
  │     ├── CollabPlugin     → CRDT collab tool
  │     ├── SkillPlugin      → per-role skill tools
  │     └── McpPlugin (NEW)  → external MCP server tools
  │
  ├── 3. Agents-as-tools (NEW — team delegation)
  │     For supervisor/chat agents:
  │     tool({ name: "delegate_to_team", execute: async ({ teamId, goal }) => {
  │       const agent = await factory.create({ consumer: "worker", ... });
  │       return agent.generate(goal);
  │     }})
  │
  └── 4. Runtime control (NEW — via prepareStep)
        prepareStep: ({ toolCallsInStep }) => ({
          activeTools: filterByRelevance(allTools, currentContext),
          toolChoice: step > 10 ? "none" : "auto",
        })
```

**Agents-as-tools:** A ChatAgent or supervisor can invoke another Ping team as a tool. Same pattern as Mastra's `agents: { writer }` — the agent becomes a callable tool that runs `.generate()` and returns results.

**Dynamic tool control:** AI SDK's `prepareStep` callback fires before each LLM call. We can:
- Filter `activeTools` based on current step context (reduce noise for large tool sets)
- Force `toolChoice: "none"` after N steps to prevent infinite loops
- Temporarily disable expensive tools when budget is low

**Tool approval:** AI SDK's `needsApproval: true` pauses execution and returns a `tool-call` event. We route the approval request through Socket.IO → frontend dialog → `tool-result` continuation.

```typescript
// Approval flow
tool({
  description: "Delete production database",
  needsApproval: true,  // AI SDK native
  inputSchema: z.object({ dbName: z.string() }),
  execute: async ({ dbName }) => { /* ... */ },
})
// When called: agent pauses → bus emits approval_request → Socket.IO → frontend dialog
// User approves → send tool-result back → agent continues
```

**Pros:**
- Complete solution — MCP + delegation + dynamic control + approval
- All from AI SDK primitives — no new dependencies beyond `@ai-sdk/mcp`
- AgentFactory is the single assembly point (already designed in stream-bus feature)
- ChatAgent gets full plugin access (same factory path as worker/planner)
- `prepareStep` enables cost-aware tool filtering (future cost-tracking integration)

**Cons:**
- Larger scope — touches AgentFactory, PluginRegistry, AiSdkAgent, Socket.IO
- Agents-as-tools requires cross-team invocation (authorization, isolation)
- Tool approval requires new Socket.IO event type + frontend dialog component

**Effort:** 1.5-2 weeks (after AgentFactory exists from stream-bus feature)

---

### Option C: Mastra as Runtime — Replace AiSdkAgent with Mastra Agent

**Implementation:** Add `@mastra/core` as dependency. Replace `AiSdkAgent` with Mastra's `Agent` class. Get agents-as-tools, workflows-as-tools, MCP, tool search, channels all built-in.

```typescript
import { Agent } from "@mastra/core/agent";

const worker = new Agent({
  id: "backend-dev",
  model: "azure-openai/gpt-4o",
  tools: { ...workspaceTools, ...collabTools },
  agents: { reviewer: reviewerAgent },      // agents-as-tools
  workflows: { deploy: deployWorkflow },     // workflows-as-tools
});
```

**Pros:**
- Everything built-in — MCP, agents-as-tools, workflows, tool search, channels
- Active community + Mastra Studio for debugging
- Model router supports all providers

**Cons:**
- **Competing Agent abstraction.** We have AiSdkAgent with streaming pipeline, `prepareStep`, `stopWhen`, context trimming. Mastra Agent is a different class with its own streaming API. Both wrap AI SDK `streamText()` but with incompatible interfaces.
- **Migration cost.** Our AgentStreamBus, streaming observers, WorkerPool generator iteration — all designed for AiSdkAgent's `AsyncGenerator<AgentEvent>`. Mastra uses its own stream format.
- **Lose control.** Our `stopWhen`, `buildProviderOptions()`, `prepareStep` customizations would need Mastra equivalents. Some don't exist.
- **Bundle size.** `@mastra/core` pulls in its own dependency tree.

**Effort:** 3-4 weeks (rewrite agent layer + streaming pipeline)

---

## Recommendation: Option B — Full Tool Runtime on AI SDK

Option B gives us the complete Mastra feature set without the Mastra dependency:

1. **MCP via `@ai-sdk/mcp`** — same package Mastra uses internally. Real protocol, multiple transports.
2. **Agents-as-tools** — 20 lines of code. `tool()` wrapping `factory.create().generate()`. No framework needed.
3. **Dynamic tool control** — AI SDK's `prepareStep` is already in our `AiSdkAgent`. We just need to wire `activeTools` filtering.
4. **Tool approval** — AI SDK's `needsApproval` + Socket.IO for human-in-the-loop.
5. **Unified via AgentFactory** — all agents (planner, worker, chat) get tools from the same PluginRegistry path. Adding a new tool source = add to PluginRegistry once.

Option A is too narrow (MCP only). Option C creates a competing abstraction and 3-4 week migration for features we can build in 1.5 weeks on AI SDK directly.

### Dependency

This feature depends on AgentFactory from the [agent-stream-bus](../agent-stream-bus/feature_architecture.md) feature. The factory provides the unified creation path where tool assembly happens. Without it, we'd be adding MCP/delegation/approval in three scattered locations.

**Implementation order:**
1. Agent Stream Bus (AgentFactory + observers) — Week 1
2. Plugin Tool Runtime (MCP + agents-as-tools + dynamic control) — Week 2-3

**Decision: Option B chosen** (May 7, 2026). Full Tool Runtime on AI SDK primitives.
