# Agentic Streaming — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Implementation Log:** [Feature Implementation](feature_implementation.md)  
**ID:** A2  
**Approach:** Option A — AI SDK `streamText` + Socket.IO Bridge with Data Stream Protocol format

---

## Phase 1: Real-Time Streaming (✅ Complete — April 6, 2026)

### Branch
- `pr/copilot-swe-agent/9`

### Scope
Real-time token streaming, tool call lifecycle events, reasoning traces, and step progression from AI SDK to frontend via Socket.IO. Single `stream` event channel with typed payloads using AI SDK Data Stream Protocol format.

## Implementation Steps

### Step 1: Define Stream Protocol Types
**Files to create:**
- `packages/backend/api/types/streamTypes.ts` — TypeScript types for all stream part types: `start`, `finish`, `abort`, `text-start/delta/end`, `reasoning-start/delta/end`, `tool-input-start/delta/available`, `tool-output-available`, `start-step`, `finish-step`, `source-url`, `source-document`, `file`, `error`

**Exit criteria:** All AI SDK Data Stream Protocol types defined, exported

### Step 2: Build StreamBridge
**Files to create:**
- `packages/backend/agent/streaming/StreamBridge.ts` — Iterate `result.fullStream` from AI SDK `streamText()`, map each `TextStreamPart` to our typed Socket.IO event payload, emit on single `stream` channel

**Key mapping:**
- `text-delta` → `{ type: 'text-delta', id, delta }`
- `tool-call` → `{ type: 'tool-input-available', toolCallId, toolName, input }`
- `tool-result` → `{ type: 'tool-output-available', toolCallId, output }`
- `reasoning` → `{ type: 'reasoning-delta', id, delta }`

**Exit criteria:** StreamBridge converts fullStream to typed events

### Step 3: Add Ping-Specific Extensions
**Files to modify:**
- `packages/backend/api/types/streamTypes.ts` — Add Ping notification types: `task-started`, `task-completed`, `task-failed`, `artifact-state`, `plan-proposed`, `plan-approved`

**Exit criteria:** Planner/orchestrator events map to notification stream parts

### Step 4: Wire StreamBridge into Worker Execution
**Files to modify:**
- `packages/backend/agent/internal/InternalAgent.ts` — Use `streamText()` instead of `generateText()`, return `StreamTextResult`
- `packages/backend/services/WorkerPool.ts` — Pass StreamBridge to worker execution, connect to Socket.IO room

**Exit criteria:** Worker task execution streams events to subscribed clients

### Step 5: Add Smooth Streaming Transform
**Files to create:**
- `packages/backend/agent/streaming/smoothStream.ts` — Word-boundary chunking for UX-friendly text delivery. Buffer tokens until word boundary, then emit.

**Exit criteria:** Text arrives at word boundaries, no single-character jitter

### Step 6: Wire Orchestrator Events
**Files to modify:**
- `packages/backend/orchestrator/OrchestratorService.ts` — Emit `notification` stream parts for task lifecycle events (started, completed, failed)
- `packages/backend/api/SocketServerV2.ts` — Forward orchestrator notifications on `stream` channel

**Exit criteria:** Task lifecycle events appear in stream alongside agent output

### Step 7: Add Usage Capture Hook
**Files to modify:**
- `packages/backend/agent/streaming/StreamBridge.ts` — After stream completes, capture `result.usage` and `result.steps` for token tracking (consumed by cost-tracking feature later)

**Exit criteria:** Token usage captured per streamText call

## Testing Strategy
- Unit test: StreamBridge correctly maps AI SDK events to protocol types
- Integration test: full stream from agent → Socket.IO → verify event sequence
- Test: tool call lifecycle (start → args streaming → execute → result)
- Test: smooth streaming delivers word-boundary chunks

## Complexity
Medium — 2-3 weeks (overlaps with A1 migration).

---

## Phase 2: Autonomous Agent Loop (✅ Complete — April 10, 2026)

### Branch
- `user/sahuroshan/setupforcollabration-production`

### Scope
Make agents work like Claude Code / Copilot / OpenCode — autonomous tool-use loops with no artificial step limits, extended thinking, context management, and token budget safety.

### Implementation Steps

- [x] **Step 1: Replace stop condition** — `stepCountIs(10)` → `[isLoopFinished(), stepCountIs(200)]`
  - File: `packages/agent-manager/src/agent/internal/AiSdkAgent.ts`
  - Import `isLoopFinished` from `ai`, build `StopCondition[]` array
  - `maxSteps = 0` means autonomous mode (default), `> 0` means explicit limit
  - Exit criteria: Agent loops until model naturally stops or hits 200-step safety cap

- [x] **Step 2: Add extended thinking/reasoning** — Multi-provider support
  - File: `packages/agent-manager/src/agent/internal/AiSdkAgent.ts` (new `buildProviderOptions()`)
  - File: `packages/agent-manager/src/agent/types.ts` (`InternalConfig.thinking`)
  - Anthropic: `providerOptions.anthropic.thinking` with `budgetTokens`
  - OpenAI/Azure: `providerOptions.openai.reasoningEffort` (low/medium/high)
  - Auto-detects provider from `ModelConfig.provider`
  - Exit criteria: Reasoning tokens stream via existing `reasoning-start/delta/end` events

- [x] **Step 3: Add `prepareStep` for context management**
  - File: `packages/agent-manager/src/agent/internal/AiSdkAgent.ts`
  - Trims messages when conversation > 50 (keeps first + last 30)
  - Prevents context window overflow on long-running autonomous tasks
  - Exit criteria: Agent can run 100+ steps without context overflow

- [x] **Step 4: Add lifecycle callbacks for observability**
  - File: `packages/agent-manager/src/agent/internal/AiSdkAgent.ts`
  - `experimental_onToolCallStart` — logs tool invocation
  - `experimental_onToolCallFinish` — logs duration + success/failure
  - `onStepFinish` — logs finish reason + token usage
  - Exit criteria: Tool execution timing visible in logs

- [x] **Step 5: Add `InternalConfig` types**
  - File: `packages/agent-manager/src/agent/types.ts`
  - `maxSteps?: number` (0 = unlimited, default)
  - `maxTotalTokens?: number` (500,000 default)
  - `thinking?: { enabled, budgetTokens, reasoningEffort }`
  - Exit criteria: All agent loop config is typed, not `(config as any)`

### Testing
- Compile check: `npx tsc --noEmit` passes
- Manual: Agent with tools runs > 10 steps without stopping
- Manual: Anthropic agent shows reasoning tokens in stream

### Complexity
Low — 1 day. All features are AI SDK v6 built-ins, just needed wiring.

---

## Phase 3: Multi-Model Provider Support (✅ Complete — April 11, 2026)

### Branch
- `user/sahuroshan/setupforcollabration-production`

### Scope
Support all major LLM providers (10 total) so agents can run on any model — cloud APIs, local Ollama, or any OpenAI-compatible endpoint. Zero new dependencies.

### Implementation Steps

- [x] **Step 1: Expand `ModelConfig.provider` type**
  - File: `packages/agent-manager/src/agent/types.ts`
  - Added: `ollama`, `google`, `groq`, `mistral`, `deepseek`, `xai`, `openai-compatible`
  - Added: `baseUrl?: string` for custom endpoints
  - Exit criteria: TypeScript accepts all 10 provider values

- [x] **Step 2: Implement all providers in `ModelProvider.ts`**
  - File: `packages/agent-manager/src/agent/providers/ModelProvider.ts`
  - Strategy: Ollama/Groq/DeepSeek/xAI/Mistral/Google all use `@ai-sdk/openai` with custom `baseURL`
  - Zero new npm dependencies — reuses existing `@ai-sdk/openai`
  - Default model per provider via `PROVIDER_DEFAULTS` const
  - Exit criteria: `getModel({ provider: 'ollama', model: 'llama3.1' })` returns valid model

- [x] **Step 3: Verify Ollama local workflow**
  - Config: `{ provider: "ollama" }` — defaults to `llama3.1` at `localhost:11434`
  - No API key needed (dummy `"ollama"` passed to satisfy SDK)
  - `baseUrl` override via config or `OLLAMA_BASE_URL` env var
  - Exit criteria: TypeScript compiles, model instance created

### Provider Reference

| Provider | Env Var | Default Model | Extra Dep? |
|----------|---------|--------------|------------|
| `anthropic` | `ANTHROPIC_API_KEY` | `claude-sonnet-4-20250514` | No (installed) |
| `openai` | `OPENAI_API_KEY` | `gpt-4o` | No (installed) |
| `azure-openai` | `AZURE_OPENAI_API_KEY` | `gpt-4o-2` | No (installed) |
| `ollama` | None | `llama3.1` | No |
| `google` | `GOOGLE_GENERATIVE_AI_API_KEY` | `gemini-2.5-flash` | No |
| `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` | No |
| `mistral` | `MISTRAL_API_KEY` | `mistral-large-latest` | No |
| `deepseek` | `DEEPSEEK_API_KEY` | `deepseek-chat` | No |
| `xai` | `XAI_API_KEY` | `grok-3` | No |
| `openai-compatible` | `OPENAI_COMPATIBLE_API_KEY` | (required) | No |

### Testing
- Compile check: `npx tsc --noEmit` passes
- Manual: Configure agent with `provider: ollama` and verify model creation

### Complexity
Low — 1 day. All providers use the OpenAI-compatible pattern.

---

## Files Changed (All Phases)

| File | Phase | What Changed |
|------|-------|-------------|
| [AiSdkAgent.ts](../../../packages/agent-manager/src/agent/internal/AiSdkAgent.ts) | 1, 2 | Stream lifecycle, autonomous loop, prepareStep, thinking, callbacks |
| [ModelProvider.ts](../../../packages/agent-manager/src/agent/providers/ModelProvider.ts) | 3 | 10-provider support, PROVIDER_DEFAULTS |
| [types.ts](../../../packages/agent-manager/src/agent/types.ts) | 2, 3 | InternalConfig (maxSteps, thinking), ModelConfig (10 providers, baseUrl) |
| [copilot-instructions.md](../../../.github/copilot-instructions.md) | 2, 3 | Updated provider docs, autonomous loop docs |
| [feature_architecture.md](feature_architecture.md) | 2 | Status updated to Phase 2 |
| [feature_implementation.md](feature_implementation.md) | 2, 3 | Phase 2 + Phase 3 implementation logs |

## Related Features

- [Task Orchestration](../task-orchestration/feature_architecture.md) — Task DAG, parallel dispatch (uses the agent loop)
- [Skills Integration](../skills-integration/) — Skills loaded per-request into agent tools
- [Cost Tracking](../cost-tracking/) — Will consume `maxTotalTokens` + `onStepFinish` usage data
