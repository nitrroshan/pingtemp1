# External Agent Invocation — Feature Architecture

**Status:** Architecture Draft  
**Date:** April 1, 2026  
**ID:** A7  
**Depends on:** A3 (Tools as MCP), Team Stacking  
**Feeds into:** Team Stacking (child teams are external agents)

---

## Overview

Enable the **orchestrator** to assign tasks to agents running outside Ping — third-party MCP servers, other Ping teams, or any agent exposing a standard endpoint. External agents are workers, not tools. The orchestrator doesn't know or care whether a worker is internal or external — it assigns a task, gets back an `AgentEvent` stream.

```
Orchestrator (OrchestratorService)
  │
  ├── assigns task → InternalAgent (AI SDK worker, runs in-process)
  │                    └── yields AgentEvent stream
  │
  └── assigns task → ExternalAgent (MCP client to remote server)
                       └── yields AgentEvent stream (same interface)
```

### Current State
- All workers are `InternalAgent` — AI SDK agents running in the same process
- `AgentFactory` has `registerAgentType()` — can register new agent types but only `internal` exists
- `ExternalConfig` type defined in `agent/types.ts` (endpoint, auth, timeout) — unused
- Agent Registry (`packages/registry`) stores agents with `mcpEndpoint` — not queried by orchestrator

### Target State
- `ExternalAgent extends BaseAgent` — connects to remote MCP servers via Streamable HTTP
- Orchestrator assigns tasks to external workers identically to internal workers
- Agent Registry queried during planning to discover available external agents
- Same `AgentEvent` stream regardless of internal/external — UI sees no difference
- Ping teams can be external agents to other Ping teams (→ team stacking)

---

## Core Principle

**Workers don't call agents. The orchestrator assigns tasks to workers.**

```
❌ WRONG:  Worker → calls external agent as a tool
✅ RIGHT:  Orchestrator → assigns task to worker (internal OR external)
```

The external agent IS the worker. It doesn't get "called by" a worker — it gets a task from the orchestrator like any other worker. The `ExternalAgent` class wraps the MCP connection and normalizes the response into `AgentEvent` events.

---

## Architecture: MCP-Only with Streamable HTTP

One protocol for everything. External agents expose MCP servers. Ping connects as an MCP client.

**Why MCP only (no A2A, no custom HTTP):**
- MCP Streamable HTTP (spec 2025-03-26) supports **SSE streaming** — real-time progress events
- Already using MCP for tools — same infrastructure, same auth model
- Industry converging on MCP (Claude Code, Cursor, Windsurf, Cline all support it)
- A2A is too new, limited adoption — worth monitoring, not adopting
- Custom HTTP means N integrations to maintain — MCP means one

**How streaming works:**
```
Orchestrator assigns task to ExternalAgent
  → ExternalAgent POSTs to MCP server (Streamable HTTP)
  ← SSE: { notification: "progress", params: { status: "researching" } }
  ← SSE: { notification: "progress", params: { status: "50% complete" } }
  ← SSE: { result: { content: [{ type: "text", text: "..." }] } }
  → ExternalAgent normalizes each SSE event into AgentEvent
  → Orchestrator/UI receives identical stream as InternalAgent
```

Session management via `Mcp-Session-Id`. Resumable via `Last-Event-ID`.

---

## ExternalAgent Class

```typescript
class ExternalAgent extends BaseAgent {
  private mcpClient: StreamableHttpClient;
  
  async *execute(task: Task): AsyncGenerator<AgentEvent> {
    // Connect to remote MCP server
    const stream = this.mcpClient.callTool('execute_task', {
      description: task.description,
      context: task.context,
      expectedOutput: task.expectedOutput
    });
    
    // Normalize MCP events → AgentEvent stream
    for await (const event of stream) {
      if (event.type === 'progress') {
        yield { type: 'text-delta', content: event.params.status };
      } else if (event.type === 'result') {
        yield { type: 'task-completed', output: event.result };
      }
    }
  }
}
```

**Registered in AgentFactory:**
```typescript
agentConstructors.set('external', ExternalAgent);
// YAML: type: external, endpoint: https://..., auth: { type: bearer, token: ... }
```

---

## Registry Integration

The planner queries the Agent Registry during its research phase to discover what external agents are available:

```
Planner researches goal
  → research_domain tool queries registry: "agents that can do ML prediction"
  → Registry returns: { name: "ml-predictor", mcpEndpoint: "https://...", capabilities: [...] }
  → Planner creates task assigned to "ml-predictor" role
  → Orchestrator looks up "ml-predictor" in worker registry
  → Not found locally → queries Agent Registry → gets mcpEndpoint
  → Creates ExternalAgent on-demand → assigns task
```

---

## Three Flavors of External Agent

| Flavor | What It Is | MCP Server Exposes |
|---|---|---|
| **Third-party agent** | Someone else's MCP server | Their tools — Ping calls them |
| **Child Ping team** | Another Ping instance | `submit_goal`, `get_status`, `get_capabilities` |
| **Specialized service** | ML model, search index, etc. | Domain-specific tools |

All three are `ExternalAgent` under the hood. The orchestrator treats them identically.

---

## Security

- **Auth:** MCP supports bearer tokens, API keys, OAuth. Stored in Azure Key Vault, injected at connection time.
- **Output validation:** ExternalAgent validates response schema before yielding events. Malformed responses → task failed.
- **Timeout:** Per-agent configurable via `ExternalConfig.timeout`. Default 5 minutes.
- **Rate limiting:** Per-endpoint rate limits to prevent runaway costs.

---

## Incremental Delivery

| Version | What | Independently Useful? |
|---|---|---|
| **v1.0** | `ExternalAgent` class + MCP Streamable HTTP transport | Yes — call any MCP agent |
| **v1.1** | Registry integration — planner discovers external agents | Yes — dynamic capability discovery |
| **v2.0** | Team-as-MCP-server — Ping team exposes itself | Yes — enables team stacking |
| **v2.1** | Recursive composition + cycle detection | Yes — teams of teams |

v1.0 is the foundation. Everything else builds on it.
