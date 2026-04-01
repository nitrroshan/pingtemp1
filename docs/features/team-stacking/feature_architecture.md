# Team Stacking — Feature Architecture

**Status:** New  
**Date:** April 1, 2026  
**ID:** B3  
**Depends on:** B1 (Team Package), A3 (Tools as MCP), A7 (External Agent Invocation)

---

## Overview

Teams compose into organizations. A parent team's planner assigns tasks to child teams via `ExternalAgent` — the child team is just another agent. The child team's planner breaks it down, executes independently, and returns results as an `AgentEvent` stream. Recursive to any depth.

```
Parent Team (Product)
├── Planner assigns "Build auth system" to child team
│
└── Child Team: Engineering (exposed as MCP server)
    ├── Planner breaks down → backend, frontend, devops tasks
    ├── Workers execute independently
    └── Returns: AgentEvent stream (progress, artifacts, done)

Child Team: Design (exposed as MCP server)
    ├── Planner breaks down → UX research, wireframes, visual
    └── Returns: artifacts (Figma links, design tokens)
```

### What Exists Today

| Component | Status | Gap |
|---|---|---|
| `IAgent` interface | ✅ All agents share `execute() → AgentEvent` | — |
| `ExternalConfig` type | ✅ endpoint, auth, timeout, retries | No team-specific fields |
| `AgentFactory.registerAgentType()` | ✅ Pluggable agent types | `ExternalAgent` class doesn't exist |
| Agent Registry | ✅ Vector search + `mcpEndpoint` | Nobody queries it. No team registration |
| `OrchestratorService` | ✅ Plans, dispatches to `WorkerPool` | Only talks to `InternalAgent` workers |
| MCP server infrastructure | ❌ Only MCP clients exist | Need team-as-MCP-server |
| `@ping/teams` package | 📋 Designed, not built | Needed for team lifecycle |

---

## Architecture Decision: MCP-Only

**MCP Streamable HTTP (spec 2025-03-26) supports real-time streaming.** This eliminates the need for a separate HTTP/WebSocket protocol between teams.

How it works: Parent POSTs `submit_goal` to child team's MCP server. Server responds with `text/event-stream` (SSE). Child team streams progress events in real-time — the parent doesn't poll. Connection is resumable (via `Last-Event-ID`), supports session management (`Mcp-Session-Id`), and allows server-initiated messages.

```
Parent Planner → ExternalAgent (MCP client)
    → Child Team MCP Server (Streamable HTTP)
        → POST submit_goal("Build auth system")
        ← SSE: { progress: "Planning complete, 4 tasks" }
        ← SSE: { progress: "Task 1/4 started: backend-dev" }
        ← SSE: { progress: "Task 1/4 completed", artifacts: [...] }
        ← SSE: { progress: "Task 2/4 started: frontend-dev" }
        ...
        ← SSE: { result: { status: "completed", outputs: [...] } }
```

**One protocol for everything:**
- Child Ping teams → MCP Streamable HTTP (real-time)
- Third-party agents → MCP Streamable HTTP (same protocol)
- Discovery → MCP `tools/list` (capabilities, roles)
- Registry → finds teams and agents identically

**Why not a separate HTTP/WS protocol?**
Previously considered a hybrid (MCP for discovery + Ping HTTP/WS for execution). But MCP Streamable HTTP gives the same SSE streaming that Socket.IO would, with the added benefit of being a standard protocol. No reason to maintain two transport implementations when one covers both cases.

**ExternalAgent has one transport layer**, not two. Simpler code, simpler debugging, one protocol to test.

---

## Incremental Phases

| Phase | What | Unlocks |
|---|---|---|
| **v1.0** | `ExternalAgent` class + registry query | Call any external MCP agent as a worker |
| **v1.1** | Team-as-MCP-server (Streamable HTTP) | Parent delegates goals to child team with real-time progress |
| **v2.0** | Recursive composition (team of teams) | Full org hierarchy with cycle detection |
| **v2.1** | Cross-team shared docs + dependency resolution | Child team A's output feeds child team B |

### v1.0 — ExternalAgent + Registry (Foundation)

```
New files:
  packages/backend/agent/external/ExternalAgent.ts    — implements IAgent via MCP
  packages/backend/agent/external/McpTransport.ts     — MCP Streamable HTTP client

Modified:
  packages/backend/agent/AgentFactory.ts              — register ExternalAgent
  packages/backend/orchestrator/OrchestratorService.ts — allow external workers
  packages/registry/                                   — team registration endpoint
```

**ExternalAgent contract:**

```typescript
class ExternalAgent extends BaseAgent {
  // Same interface as InternalAgent — parent team doesn't know the difference
  async *execute(input: AgentInput): AsyncGenerator<AgentEvent> {
    // MCP Streamable HTTP — works for child teams AND third-party agents
    const client = this.mcpClient;  // connected to remote MCP server
    const stream = await client.callTool('submit_goal', input);
    for await (const event of stream) {
      yield this.normalizeToAgentEvent(event);  // SSE → AgentEvent
    }
  }
}
```

### v1.1 — Team-as-MCP-Server (Streamable HTTP)

```typescript
// Each team exposes itself as an MCP server with streaming
const server = new FastMCP({
  name: `ping-team-${teamId}`,
  transport: 'streamable-http',  // enables SSE streaming
});

server.addTool({
  name: 'submit_goal',
  description: 'Submit a goal to this team. Streams progress events via SSE.',
  parameters: z.object({ goal: z.string(), context: z.any().optional() }),
  execute: async function* ({ goal, context }) {
    // Stream progress back to parent via SSE
    const orchestrator = getOrchestratorForTeam(teamId);
    for await (const event of orchestrator.executeGoal(goal, context)) {
      yield event;  // each yield = one SSE event to parent
    }
  },
});

server.addTool({
  name: 'get_capabilities',
  description: 'What roles and skills this team has',
  execute: async () => ({ roles: teamRoles, skills: teamSkills }),
});

server.addTool({
  name: 'cancel',
  description: 'Cancel the current goal execution',
  parameters: z.object({ goalId: z.string() }),
  execute: async ({ goalId }) => orchestrator.cancel(goalId),
});
```

### v2.0 — Recursive Composition

Depth limit (configurable, default 3). Each level adds its `teamId` to a delegation chain to prevent cycles. Parent planner sees child team as one "agent" with capabilities = union of child team's roles.

---

## Key Types

```typescript
// Registry: teams register alongside individual agents
interface TeamRegistration {
  teamId: string;
  name: string;
  capabilities: AgentCapability[];  // union of team's role capabilities
  mcpEndpoint: string;               // team's MCP Streamable HTTP URL
  type: 'team';                      // distinguishes from individual agents
}

// ExternalAgent config — one protocol, not two
interface ExternalAgentConfig extends ExternalConfig {
  mcpEndpoint: string;               // MCP server URL (Streamable HTTP)
  teamId?: string;                   // set if this is a child team
  delegationChain?: string[];        // prevents cycles: [grandparent, parent, this]
}
```

---

## Related Features

- [External Agent Invocation](../external-agent-invocation/feature_architecture.md) — v1.0 is essentially this feature
- [Team Package](../team-package/feature_architecture.md) — `@ping/teams` provides team lifecycle management
- [Tools as MCP](../tools-as-mcp/feature_architecture.md) — MCP server patterns, FastMCP usage
- [Teams Integration](../teams-integration/feature_architecture.md) — frontend/CLI wiring for teams
