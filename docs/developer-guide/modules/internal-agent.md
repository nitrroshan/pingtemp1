# InternalAgent

## Purpose

InternalAgent is the unified LangChain/LangGraph execution engine for all internal agents in Ping. It operates in two modes: **tool mode** for workers and the orchestrator (streaming with MCP integration), and **structured output mode** for builders that return typed Zod schemas.

## Source Files

- `src/worker/agent/internal/InternalAgent.ts` — Main implementation (~569 lines)
- `src/worker/agent/BaseAgent.ts` — Base class with common lifecycle
- `src/worker/agent/types.ts` — IAgent, AgentDefinition, AgentInput, AgentEvent, etc.
- `src/worker/agent/internal/schemas/` — Zod schemas (AgentRoleSchema, AgentPlanSchema, etc.)
- `src/worker/agent/internal/tools/` — Built-in tools (completeTaskTool, reportStatusTool)
- `src/worker/agent/AgentFactory.ts` — Creates agent instances from definitions and YAML

## Architecture Decision

> **[DEPRECATED]** The `builder` agent type was removed (Jan 21, 2026). Builders are now `InternalAgent` instances with `config.responseFormat` set. See `agent/types.ts` header comment.

## Dual Mode Operation

### Tool Mode (default)

Used by: **worker agents**, **orchestrator agent**

- Agent has `tools[]` injected by WorkerPool (workspace, collab, knowledge, report_status, complete_task)
- Executes via LangGraph with streaming `AsyncGenerator<AgentEvent>`
- Supports MCP (Model Context Protocol) multi-server tool integration
- Uses `MemorySaver` for conversation checkpointing via `thread_id`

### Structured Output Mode

Used by: **PlanBuilder**, **DefinitionBuilder** (RoleBuilder)

- Triggered when `config.responseFormat` is set (e.g., `"AgentPlanSchema"`)
- Returns parsed Zod schema objects instead of string responses
- Lower temperature (0.3 vs 0.7 default)
- No tool execution — LLM returns structured JSON directly

## Key Interfaces

```typescript
// From agent/types.ts
type AgentType = "internal" | "external" | "agentic-ui";

interface AgentDefinition {
  id: string;
  name: string;
  role: string;
  type: AgentType;
  goal: string;
  systemPrompt?: string;
  config: InternalConfig | ExternalConfig | AgenticUIConfig;
  settings?: AgentSettings;
}

interface InternalConfig {
  model: ModelConfig;
  tools?: ToolConfig[];         // Tools for tool mode
  responseFormat?: string;      // Schema name for structured output mode
  skills?: string[];
  memory?: MemoryConfig;
}

interface ModelConfig {
  provider: "anthropic" | "openai" | "azure-openai";
  model?: string;
  deployment?: string;          // Azure deployment name
  temperature?: number;
  maxTokens?: number;
}

interface AgentInput {
  message: string;
  threadId: string;             // REQUIRED for LangGraph checkpointing
  taskId?: string;
  context?: { files?: FileReference[]; artifacts?: ArtifactReference[]; teamId?: string };
}
```

## Public API

| Method | Signature | Description |
|--------|-----------|-------------|
| `initialize()` | `Promise<void>` | Creates model, loads tools, builds LangGraph agent with `createAgent()` |
| `execute(input)` | `AsyncGenerator<AgentEvent>` | Main entry — routes to tool or structured mode, yields events |
| `run(prompt, threadId?)` | `Promise<any>` | Convenience wrapper — returns final output directly |
| `setTools(tools[])` | `Promise<void>` | Post-init tool injection — rebuilds agent preserving MemorySaver |
| `stop()` | `Promise<void>` | Stop current execution |
| `reset()` | `Promise<void>` | Reset state |

## Agent Events

Events yielded from `execute()`:

```typescript
type AgentEvent =
  | { type: "thinking"; content: string }
  | { type: "planning"; steps: string[] }
  | { type: "tool_start"; tool: string; args: Record<string, any> }
  | { type: "tool_result"; tool: string; result: any; error?: string }
  | { type: "message"; content: string; streaming?: boolean }
  | { type: "message_delta"; delta: string }
  | { type: "artifact"; artifact: any }
  | { type: "error"; error: string; recoverable: boolean }
  | { type: "done"; output?: any; summary?: string };
```

## Model Creation

Supports three providers. Credentials come from environment variables:

| Provider | Config | Environment Variables |
|----------|--------|-----------------------|
| `azure-openai` | `deployment` | `AZURE_OPENAI_API_KEY`, `AZURE_OPENAI_ENDPOINT_URL` |
| `anthropic` | `model` | `ANTHROPIC_API_KEY` |
| `openai` | `model` | `OPENAI_API_KEY` |

## Tool Loading

Tools are loaded in layers:

1. **Definition tools** — from `AgentDefinition.config.tools[]` (builtin, mcp, custom types)
2. **MCP tools** — via `MultiServerMCPClient` for Model Context Protocol servers
3. **Dynamic injection** — via `setTools()` after initialization (workspace, collab, knowledge tools injected by WorkerPool)

When `setTools()` is called, the agent is rebuilt with the new tool list but the existing `MemorySaver` is preserved, maintaining conversation history.

## LangGraph Integration

```typescript
// Critical: thread_id MUST be passed for checkpointing
agent.execute({
  message: "Research AI trends",
  threadId: taskId  // Uses taskId as thread for conversation continuity
});
```

- Uses `createAgent()` from LangChain to build a LangGraph Runnable
- `MemorySaver` stores conversation history keyed by `thread_id`
- Structured output uses `providerStrategy(schema)` to enforce response format

## Integration Points

- **WorkerPool**: Creates `InternalAgent` instances, injects tools via `setTools()`, calls `execute()` for streaming
- **OrchestratorService**: Uses one orchestrator agent (tool mode) and one planBuilder agent (structured output mode)
- **AgentFactory**: Factory pattern for creating agents from YAML definitions or by ID

## YAML Agent Definitions

Agent definitions live in `src/worker/agent/agents/`. Example:

```yaml
id: orchestrator
name: "Orchestrator"
role: system/orchestrator
type: internal
goal: "Coordinate team agents to accomplish user goals"
systemPrompt: |
  You are an orchestration agent...
config:
  model:
    provider: azure-openai
    deployment: gpt-4o-2
    temperature: 0.7
  tools:
    - name: create_plan
      type: builtin
```

The build step copies these YAML files to `dist/` via `copy:agents` script.
