# Mastra Migration — Feature Architecture

**Status:** Planning  
**Date:** March 29, 2026  
**Prior Art:** [MASTRA_MIGRATION_ANALYSIS.md](../../architecture/MASTRA_MIGRATION_ANALYSIS.md)

---

## Overview

Replace LangChain/LangGraph agent layer with **Vercel AI SDK + Mastra** for model routing, streaming, tools, memory, and evals. Keep our custom orchestration (AgentManagerV2, OrchestratorService, MemoryManager).

## Architecture Options

### Option A: Full Mastra Framework Adoption

**Implementation:** Replace entire agent layer with `@mastra/core`. Use Mastra's Agent class, workflow engine, memory, MCP, and observability. Keep Express/Socket.IO API, call Mastra agents as library.

**Pros:**
- Unified framework — one dependency tree for agents, memory, evals, RAG
- Built-in Studio for dev/debug
- 4-tier memory (message history, working memory, semantic recall, observational)
- First-class MCP client + server

**Cons:**
- Full rewrite of agent layer (~5-8 weeks)
- Mastra 1.0 only ~2 months old — stability risk
- No equivalent for our dynamic plan generation (LLM-generated plans vs pre-defined workflows)
- Lose LangGraph's battle-tested checkpointing

**Effort:** High (5-8 weeks)

### Option B: Vercel AI SDK Core + Selective Mastra (Recommended)

**Implementation:** Use **Vercel AI SDK** (`ai` package) directly for `generateText`/`streamText`, tool calling, and model routing. Use **`@mastra/mcp`** for MCP tools. Use **`@mastra/evals`** for scoring. Keep our orchestration, workspace, and memory systems.

**Pros:**
- AI SDK is mature (v6, widely adopted, battle-tested)
- Incremental — swap agent internals without rewriting orchestration
- `streamText` gives us real agentic streaming (tool calls, text deltas, reasoning) immediately
- Azure OpenAI via `@ai-sdk/azure` — proven provider
- Can adopt Mastra memory/evals independently later
- Keeps our unique dynamic planning intact

**Cons:**
- Two ecosystems (AI SDK + selective Mastra packages)
- Must rewrite `InternalAgent.ts` and `BaseAgent.ts` against AI SDK patterns
- LangGraph MemorySaver checkpoint pattern needs replacement (simpler via AI SDK message arrays)

**Effort:** Medium (3-4 weeks for core, incremental thereafter)

### Option C: Stay on LangChain, Add Streaming

**Implementation:** Keep LangChain/LangGraph. Add streaming via LangChain's streaming APIs. Build evals ourselves.

**Pros:**
- No migration risk
- Known patterns

**Cons:**
- LangChain streaming is complex (callback-based, not native async iterable)
- Must build evals, memory tiers, and observability from scratch
- LangChain TypeScript lags behind Python — fewer updates

**Effort:** Medium-High (3-4 weeks for streaming alone, ongoing for evals/memory)

## Recommendation

**Option B** — Vercel AI SDK Core + selective Mastra packages. The AI SDK is the mature foundation; Mastra packages add MCP and evals as opt-in. This preserves our orchestration while unlocking native streaming, tool lifecycle hooks, and model routing.

**Decision Required:** Please choose Option A, B, or C.

---

## Package Swap Map

| Current | Replacement | Notes |
|---|---|---|
| `@langchain/openai` | `@ai-sdk/azure` + `ai` | Model router: `"azure/deployment-name"` |
| `@langchain/anthropic` | `@ai-sdk/anthropic` | `"anthropic/claude-..."` |
| `@langchain/core` | `ai` (AI SDK Core) | `generateText`, `streamText`, `tool` |
| `@langchain/langgraph` | **Remove** | Replace with AI SDK multi-step + our orchestration |
| `@langchain/mcp-adapters` | `@mastra/mcp` | First-class MCP client |
| `langchain` | **Remove** | Base framework no longer needed |
| `deepagents` | **Evaluate** | AI SDK has structured output via Zod |

## Key Integration Points

- `packages/backend/agent/internal/InternalAgent.ts` → rewrite to AI SDK `generateText`/`streamText`
- `packages/backend/agent/BaseAgent.ts` → adapt event emitter to AI SDK lifecycle callbacks
- `packages/backend/api/SocketServerV2.ts` → wire `fullStream` events to Socket.IO
- `packages/backend/orchestrator/OrchestratorService.ts` → keep, agents now use AI SDK
- `packages/backend/services/WorkerPool.ts` → keep, workers call AI SDK agents
