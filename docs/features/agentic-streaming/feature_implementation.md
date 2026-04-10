# Agentic Streaming — Implementation Log

**Status:** ✅ Complete (April 6, 2026)

## Branch
`pr/copilot-swe-agent/9` (Phase 2 PR)

## What Was Built

### Backend (3-layer streaming pipeline)

1. **AiSdkAgent.executeToolMode()** — Iterates AI SDK `streamText().fullStream`, yields `stream_part` events for each lifecycle event:
   - `start { messageId }` → message container creation
   - `text-delta { id, delta }` → token-by-token text
   - `tool-input-start/delta/available` → tool call args (streaming)
   - `tool-output-available` → tool results
   - `reasoning-start/delta/end` → thinking sections
   - `finish { finishReason }` → stream completion
   - Also yields legacy `tool_start`, `tool_result`, `thinking` for progress panel

2. **WorkerPool + OrchestratorService** — Detect `stream_part` events from agent generator, emit on `worker:stream` channel (separate from legacy `worker:event`)

3. **SocketServerV2** — Declarative `WORKER_EVENT_ROUTES` map routes events to channels. `worker:stream` → Socket.IO `stream` channel. `worker:event` → `progress` channel only. No legacy `message` event for streamed responses.

### Frontend (rich stream rendering)

1. **useChat.processStreamPart()** — Builds `streamParts: RenderedPart[]` on Message objects. Fully immutable updates (React 18 StrictMode safe).

2. **useOrchestration** — Routes Socket.IO `stream` events through `processStreamPart`. Maps role-based `agentId` to MongoDB agent ID via `findAgentByRole()`.

3. **StreamMessage / ToolCard / ReasoningSection** — Pre-existing components, now connected and rendering.

### Files Changed
- `packages/backend/agent/internal/AiSdkAgent.ts` — Full stream lifecycle yields, `toAiSdkTool()` converter, `stepCountIs()`, `Output.object()`, config-driven params
- `packages/backend/agent/providers/ModelProvider.ts` — `useDeploymentBasedUrls: true`, `azure.chat()` for Chat Completions API
- `packages/backend/services/WorkerPool.ts` — `worker:stream` emit, per-request skill loading, `refreshSkillTools()`
- `packages/backend/orchestrator/OrchestratorService.ts` — `stream_part` forwarding, `extractResponse()` JSON parsing
- `packages/backend/api/SocketServerV2.ts` — `WORKER_EVENT_ROUTES` map, `toStreamPart()`, `worker:stream` handler, removed legacy `message` emit
- `packages/frontend/hooks/useChat.ts` — `processStreamPart()`, immutable `.map()` updates
- `packages/frontend/hooks/useOrchestration.ts` — Stream event routing, unknown role filtering
- `packages/frontend/App.tsx` — Wires `processStreamPart` to `subscribeToTeam`

### Files Created
- `packages/backend/api/types/streamTypes.ts` — AI SDK Data Stream Protocol types
- `packages/backend/agent/streaming/StreamBridge.ts` — **Deprecated** — replaced by AgentEvent pipeline

## Stream Protocol
Single `stream` Socket.IO event with typed `StreamPayload { sessionId, taskId, agentId, part, timestamp }`.
Frontend `processStreamPart()` switches on `part.type` to build `RenderedPart[]`.

## Architecture Decision: Why NOT StreamBridge
StreamBridge was originally planned as a direct AI SDK `fullStream` → Socket.IO pipe. It was replaced by the AgentEvent intermediate layer because:
- WorkerPool needs to intercept events for side effects (task status, logging)
- OrchestratorService needs the same event format for planning tools
- Multiple agent types (External, OpenClaw) need a universal protocol
- `AgentEvent` IS the universal protocol — StreamBridge would bypass it

## Architecture Decision: Events vs Direct Calls
Internal EventEmitters (`worker:event`, `worker:stream`, `task:complete`) are scheduled for removal (see `docs/features/task-orchestration/event-refactor/`). Target: AsyncGenerator for streaming, direct callbacks for task lifecycle. Socket.IO stays as the only event bus (frontend delivery).

## Status
✅ End-to-end streaming verified: text tokens, tool call cards, reasoning sections render in frontend. Multi-step tool execution works (up to 10 steps). Skills load per-request from DB.

---

## Phase 2: Autonomous Agent Loop (April 10, 2026)

### Goal
Make agents work like Claude Code / Copilot / OpenCode — autonomous tool-use loops with no artificial step limits, extended thinking, context management, and token budget safety.

### Research Summary (AI SDK v6 capabilities)

AI SDK v6 already handles the full agentic loop internally via `streamText()` + `stopWhen`. The loop continues until:
- Model returns a finish reason other than `tool-calls` (it decides it's done)
- A tool without `execute` is called (termination signal)
- A `stopWhen` condition is met

**Built-in stop conditions:**
- `stepCountIs(N)` — stop after N steps (was our only option, set to 10)
- `hasToolCall('toolName')` — stop when specific tool called
- `isLoopFinished()` — **no limit**, runs until model naturally stops
- Custom `StopCondition` functions — e.g., token budget exceeded

**`prepareStep` callback** — runs before each step, can:
- Switch models mid-loop (cheap → strong)
- Trim context when conversation grows too long
- Control which tools are available per step
- Transform messages (summarize large tool results)

**Lifecycle callbacks:**
- `experimental_onStart` — before first LLM call
- `experimental_onStepStart` — before each step
- `experimental_onToolCallStart` — before each tool execute
- `experimental_onToolCallFinish` — after each tool execute (with `durationMs`)

**`ToolLoopAgent` class** — AI SDK v6 first-class agent abstraction. We don't need to migrate to it since `streamText()` supports all the same features.

### What Was Changed

#### 1. Stop Condition: `stepCountIs(10)` → `isLoopFinished()` + safety cap
- Default: `isLoopFinished()` — agent runs until it naturally stops calling tools
- Safety cap: `stepCountIs(200)` combined via array — prevents runaway loops
- Configurable via `InternalConfig.maxSteps` (0 = unlimited)

#### 2. Extended Thinking / Reasoning (Multi-Provider)
- `InternalConfig.thinking` with `{ enabled, budgetTokens, reasoningEffort }` config
- **Anthropic** (Claude): `providerOptions.anthropic.thinking` with `budgetTokens`
- **OpenAI** (o1, o3, o3-mini, o4-mini): `providerOptions.openai.reasoningEffort` (low/medium/high)
- **Azure OpenAI**: Same as OpenAI via `providerOptions.openai.reasoningEffort`
- Provider auto-detected from `ModelConfig.provider` — correct options sent per provider
- Reasoning tokens stream via existing `reasoning-start/delta/end` events

#### 3. prepareStep: Context Management
- Trims messages when conversation exceeds 50 messages
- Keeps system instructions + latest 30 messages
- Prevents context window overflow on long-running autonomous tasks

#### 4. Lifecycle Callbacks for Observability
- `experimental_onToolCallStart` — logs tool invocation start
- `experimental_onToolCallFinish` — logs duration and success/failure
- `onStepFinish` — logs step number, finish reason, token usage

#### 5. Token Budget Safety
- Custom `StopCondition` tracks cumulative token usage across steps
- Configurable via `InternalConfig.maxTotalTokens` (default: 500,000)
- Logs warning when budget exceeded and stops execution gracefully

### Types Added to `InternalConfig`
```typescript
// Agentic loop config
maxSteps?: number;    // Max tool-use steps (0 = unlimited). Default: 0 (uses isLoopFinished)
maxTotalTokens?: number; // Token budget safety cap. Default: 500000
thinking?: {
  enabled: boolean;
  budgetTokens?: number;       // Anthropic: thinking token budget (default: 10000)
  reasoningEffort?: 'low' | 'medium' | 'high'; // OpenAI/Azure: o-series reasoning effort (default: 'medium')
};
```

### Architecture: Why This Works Like Claude Code

```
User message → streamText({
  tools,
  stopWhen: [isLoopFinished(), stepCountIs(200), tokenBudget()],
  prepareStep: contextManager,
  providerOptions: { anthropic: { thinking } }
})
→ Model decides: call tool or respond
  → If tool: execute → feed result → model decides again
  → If text: done — natural termination
```

The AI SDK's internal loop is identical to Claude Code's outer while-loop:
1. Call model with tools
2. Model returns tool calls → SDK executes them → loops back
3. Model returns text only → loop ends naturally
4. `prepareStep` manages context between iterations

No manual while-loop needed — `streamText` IS the loop.

---

## Phase 3: Multi-Model Provider Support (April 11, 2026)

### Goal
Support all major LLM providers so agents can run on any model — cloud APIs, local Ollama, or any OpenAI-compatible endpoint. Zero extra dependencies for most providers.

### What Was Changed

#### 1. ModelConfig — 10 Providers
`ModelConfig.provider` expanded from 3 to 10 options:

```typescript
provider:
  | "anthropic"          // Claude (cloud)
  | "openai"             // GPT-4o, o3, o4-mini (cloud)
  | "azure-openai"       // Azure-hosted OpenAI models
  | "ollama"             // Local models (llama3, deepseek-coder, etc.)
  | "google"             // Gemini (via AI Studio OpenAI endpoint)
  | "groq"               // Ultra-fast inference (Llama, Mixtral)
  | "mistral"            // Mistral Large, Codestral
  | "deepseek"           // DeepSeek Chat, DeepSeek Coder
  | "xai"                // Grok-3
  | "openai-compatible"  // Any /v1/chat/completions endpoint
```

Added `baseUrl?: string` field for custom endpoints.

#### 2. ModelProvider — Zero-Dependency Strategy
Key insight: most providers (Ollama, Groq, DeepSeek, xAI, Mistral, Google) expose OpenAI-compatible `/v1/chat/completions` endpoints. We use `@ai-sdk/openai` with a custom `baseURL` — **no extra packages needed**.

| Provider | SDK Used | Extra Dependency? | Auth |
|----------|---------|-------------------|------|
| `anthropic` | `@ai-sdk/anthropic` | Already installed | `ANTHROPIC_API_KEY` |
| `openai` | `@ai-sdk/openai` | Already installed | `OPENAI_API_KEY` |
| `azure-openai` | `@ai-sdk/azure` | Already installed | `AZURE_OPENAI_API_KEY` |
| `ollama` | `@ai-sdk/openai` | None | None (dummy key) |
| `google` | `@ai-sdk/openai` | None | `GOOGLE_GENERATIVE_AI_API_KEY` |
| `groq` | `@ai-sdk/openai` | None | `GROQ_API_KEY` |
| `mistral` | `@ai-sdk/openai` | None | `MISTRAL_API_KEY` |
| `deepseek` | `@ai-sdk/openai` | None | `DEEPSEEK_API_KEY` |
| `xai` | `@ai-sdk/openai` | None | `XAI_API_KEY` |
| `openai-compatible` | `@ai-sdk/openai` | None | `OPENAI_COMPATIBLE_API_KEY` or none |

#### 3. Default Models
Each provider has a sensible default so you only need `provider`:

| Provider | Default Model |
|----------|--------------|
| `anthropic` | `claude-sonnet-4-20250514` |
| `openai` | `gpt-4o` |
| `azure-openai` | `gpt-4o-2` |
| `ollama` | `llama3.1` |
| `google` | `gemini-2.5-flash` |
| `groq` | `llama-3.3-70b-versatile` |
| `mistral` | `mistral-large-latest` |
| `deepseek` | `deepseek-chat` |
| `xai` | `grok-3` |

#### 4. Extended Thinking — Provider-Aware
`buildProviderOptions()` auto-detects provider and sends correct options:
- **Anthropic**: `providerOptions.anthropic.thinking` with `budgetTokens`
- **OpenAI/Azure**: `providerOptions.openai.reasoningEffort` (low/medium/high)
- **Others**: Warning logged, no thinking options sent (not supported)

### Agent Definition Examples

**Ollama (local, no API key):**
```yaml
config:
  model:
    provider: ollama
    model: llama3.1
```

**Groq (fastest inference):**
```yaml
config:
  model:
    provider: groq
    model: llama-3.3-70b-versatile
```

**DeepSeek with thinking:**
```yaml
config:
  model:
    provider: deepseek
    model: deepseek-chat
```

**OpenAI-compatible (LM Studio, vLLM, etc.):**
```yaml
config:
  model:
    provider: openai-compatible
    baseUrl: http://localhost:1234/v1
    model: my-local-model
```

### Files Changed
- `packages/agent-manager/src/agent/types.ts` — `ModelConfig.provider` union expanded, `baseUrl` added
- `packages/agent-manager/src/agent/providers/ModelProvider.ts` — Full rewrite with 10 provider cases
- `packages/agent-manager/src/agent/internal/AiSdkAgent.ts` — `buildProviderOptions()` multi-provider

### Status
✅ All providers compile. TypeScript passes (`tsc --noEmit` exit 0). No new dependencies needed.
