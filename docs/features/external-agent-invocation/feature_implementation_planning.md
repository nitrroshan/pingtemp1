# External Agent Invocation — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** Parked (after Phase 5 — needs MCP ecosystem)  
**ID:** A7

---

## Branch
- `feature/external-agent-invocation`

## Scope (v1.0)
`ExternalAgent` class implementing `IAgent` via MCP Streamable HTTP. Registry query for capability discovery. Same `AgentEvent` stream as internal agents.

## Implementation Steps

### Step 1: Create MCP Streamable HTTP Transport
**Files to create:**
- `packages/backend/agent/external/McpTransport.ts` — MCP client using Streamable HTTP spec (2025-03-26). POST requests, SSE response streaming, session management via `Mcp-Session-Id`, resumable via `Last-Event-ID`.

**Dependencies:** `@mastra/mcp` or custom fetch-based implementation  
**Exit criteria:** Can connect to any MCP Streamable HTTP server, receive SSE streams

### Step 2: Create ExternalAgent Class
**Files to create:**
- `packages/backend/agent/external/ExternalAgent.ts` — Extends `BaseAgent`. Uses McpTransport to call remote MCP server's `execute_task` tool. Normalizes SSE events to `AgentEvent` stream (same interface as `InternalAgent`).

**Exit criteria:** `ExternalAgent.execute(task)` yields `AgentEvent` stream identical to internal agents

### Step 3: Register ExternalAgent in AgentFactory
**Files to modify:**
- `packages/backend/agent/AgentFactory.ts` — Register `external` agent type: `agentConstructors.set('external', ExternalAgent)`

**Agent YAML:**
```yaml
type: external
config:
  mcpEndpoint: "https://remote-server/mcp"
  auth: { type: bearer, tokenEnvVar: EXTERNAL_TOKEN }
  timeout: 300000
```

**Exit criteria:** YAML with `type: external` creates ExternalAgent instances

### Step 4: Wire into OrchestratorService
**Files to modify:**
- `packages/backend/orchestrator/OrchestratorService.ts` — Allow external agents in WorkerPool. Orchestrator assigns tasks to external workers identically to internal.

**Exit criteria:** Orchestrator dispatches tasks to external agents transparently

### Step 5: Registry Integration (v1.1)
**Files to modify:**
- `packages/registry/` — Add query endpoint for capability search
- `packages/backend/orchestrator/tools/knowledgeTools.ts` — Planner's `search_agents` tool queries registry

**Exit criteria:** Planner discovers external agents by capability during research phase

### Step 6: Security & Validation
**Files to create:**
- `packages/backend/agent/external/ResponseValidator.ts` — Validate response schema from external agents. Malformed → task failed. Rate limiting per endpoint. Auth token management via Azure Key Vault.

**Exit criteria:** External agent responses validated, malformed responses don't crash system

## Testing Strategy
- Unit test: McpTransport connects and streams SSE
- Integration test: ExternalAgent yields same AgentEvent types as InternalAgent
- Test: registry query returns matching external agents
- Test: malformed response → task failed gracefully
- Test: timeout enforcement

## Research Notes
- **MCP Streamable HTTP** (spec 2025-03-26) is the right choice — supports SSE streaming, session management, resumability
- **A2A protocol** monitored but not adopted — too new, limited ecosystem
- Industry converging on MCP: Claude Code, Cursor, Windsurf, Cline all support it

## Complexity
Medium — 2-3 weeks for v1.0 + v1.1.
