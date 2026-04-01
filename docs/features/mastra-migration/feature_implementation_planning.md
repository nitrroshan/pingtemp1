# Mastra/AI SDK Migration — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 2 (Real-Time Experience)  
**ID:** A1  
**Approach:** Option B — Vercel AI SDK Core + Selective Mastra

---

## Branch
- `feature/ai-sdk-migration`

## Scope
Replace LangChain/LangGraph agent layer with Vercel AI SDK (`ai` + `@ai-sdk/azure`) for model routing, streaming, and tool calling. Adopt `@mastra/mcp` for MCP tools and `@mastra/evals` for scoring (Phase 7). Keep custom orchestration.

## Implementation Steps

### Step 1: Install Dependencies & Remove LangChain
**Files to modify:**
- `packages/backend/package.json` — Add `ai`, `@ai-sdk/azure`, `@ai-sdk/anthropic`, `@mastra/mcp`. Remove `@langchain/openai`, `@langchain/langgraph`, `@langchain/core`, `langchain`.

**Exit criteria:** New deps installed, old deps removed, build succeeds

### Step 2: Create Model Provider Abstraction
**Files to create:**
- `packages/backend/agent/providers/ModelProvider.ts` — Unified model creation from config string (`azure/gpt-4o`, `anthropic/claude-sonnet-4`)
- `packages/backend/agent/providers/azureProvider.ts` — `createAzure()` from `@ai-sdk/azure`
- `packages/backend/agent/providers/anthropicProvider.ts` — `createAnthropic()` from `@ai-sdk/anthropic`

**Exit criteria:** `getModel("azure/gpt-4o")` returns AI SDK model instance

### Step 3: Rewrite InternalAgent
**Files to modify:**
- `packages/backend/agent/internal/InternalAgent.ts` — Replace `agent.invoke()` (LangGraph) with `streamText()` / `generateText()` (AI SDK). Iterate `result.fullStream` for events. Handle multi-step loops via `maxSteps`.

**Key changes:**
- Tools passed as objects per call (hot-swappable, not baked into graph)
- `onStepFinish` callback for logging
- Messages as plain arrays (no LangGraph message types)

**Exit criteria:** Agent executes tasks using AI SDK, streams events

### Step 4: Rewrite BaseAgent Event Bridge
**Files to modify:**
- `packages/backend/agent/BaseAgent.ts` — Adapt event emission to AI SDK lifecycle callbacks (`onChunk`, `onStepFinish`, `onFinish`). Convert `fullStream` parts to `AgentEvent` types.

**Exit criteria:** All agent events (text, tool calls, completion) emit correctly

### Step 5: Replace Checkpoint/Memory Pattern
**Files to modify:**
- `packages/backend/agent/internal/InternalAgent.ts` — Replace LangGraph `MemorySaver` with simple message array persistence. Store conversation history per thread in memory or MongoDB.

**Exit criteria:** Agent conversations resume correctly across calls

### Step 6: Update MCP Tool Loading
**Files to modify:**
- `packages/backend/agent/internal/InternalAgent.ts` — Replace `@langchain/mcp-adapters` with `@mastra/mcp` for MCP client connections

**Exit criteria:** MCP tools load and execute via AI SDK tool interface

### Step 7: Wire Streaming to Socket.IO
**Files to modify:**
- `packages/backend/api/SocketServerV2.ts` — Add `streamToSocket()` bridge: iterate `fullStream`, emit each part as typed Socket.IO event via single `stream` channel
- `packages/backend/agent/internal/InternalAgent.ts` — Return stream result for bridge consumption

**Exit criteria:** Frontend receives typed stream events in real-time

### Step 8: Update Agent Definition Loading
**Files to modify:**
- `packages/backend/agent/AgentFactory.ts` — Update agent creation to use AI SDK model providers instead of LangChain model constructors

**Exit criteria:** All YAML agent definitions load and create AI SDK agents

## Testing Strategy
- Unit test: model provider returns correct instances for each provider string
- Integration test: agent executes task with AI SDK, streams result
- Test: MCP tools work through new adapter
- Test: conversation resume works with message arrays
- Regression: existing agent behaviors preserved

## Rollback Plan
- LangChain code preserved in `agent/legacy/` directory
- `AGENT_RUNTIME=aisdk|langchain` env var for gradual rollout

## Complexity
Medium — 3-4 weeks. Core rewrite of agent execution layer.
