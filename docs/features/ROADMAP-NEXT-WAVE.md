# Feature Roadmap — Next Wave

**Created:** March 29, 2026  
**Status:** Superseded by [FEATURE-LIST.md](FEATURE-LIST.md)

> **Note:** This file covers only the initial 5 features planned on March 29. See [FEATURE-LIST.md](FEATURE-LIST.md) for the comprehensive 32-feature master list with full dependency graph and phased execution plan.

---

## Features Overview

| # | Feature | Directory | Dependency | Effort |
|---|---|---|---|---|
| 1 | **Mastra/AI SDK Migration** | [mastra-migration](mastra-migration/feature_architecture.md) | None (foundation) | 3-4 weeks |
| 2 | **Agentic Streaming** | [agentic-streaming](agentic-streaming/feature_architecture.md) | Feature 1 | 2-3 weeks |
| 3 | **Tools Integration** | [tools-integration](tools-integration/feature_architecture.md) | Feature 1 | 2 weeks |
| 4 | **L2 Search & Indexing** | [l2-search-indexing](l2-search-indexing/feature_architecture.md) | Independent | 2-3 weeks |
| 5 | **LLM Response Grading** | [llm-response-grading](llm-response-grading/feature_architecture.md) | Feature 1 (for Mastra evals) | 2-3 weeks |

---

## Dependency Graph

```
Feature 1: Mastra/AI SDK Migration (foundation)
    │
    ├──→ Feature 2: Agentic Streaming (needs AI SDK streamText)
    │
    ├──→ Feature 3: Tools Integration (needs AI SDK tool() + @mastra/mcp)
    │
    └──→ Feature 5: LLM Response Grading (needs @mastra/evals)

Feature 4: L2 Search & Indexing (independent — can start in parallel)
```

## Recommended Execution Order

### Phase 1 — Foundation (Weeks 1-4)
**Feature 1: AI SDK Migration** + **Feature 4: L2 Search** (parallel tracks)

- Feature 1 is the foundation — all other AI features depend on it
- Feature 4 is independent, can progress in parallel

### Phase 2 — Streaming + Tools (Weeks 3-6)
**Feature 2: Agentic Streaming** + **Feature 3: Tools Integration**

- Both build on the AI SDK foundation from Phase 1
- Can run in parallel since they touch different parts of InternalAgent
- Streaming = execution model; Tools = capability model

### Phase 3 — Quality (Weeks 5-8)
**Feature 5: LLM Response Grading**

- Benefits from having streaming (can score mid-stream)
- Benefits from having tools (can score tool-call accuracy)
- Evaluates the quality of everything built in prior phases

---

## Recommended Architecture Choices (Summary)

| Feature | Recommended Option | Key Package Additions |
|---|---|---|
| 1. Mastra Migration | **B: AI SDK Core + selective Mastra** | `ai`, `@ai-sdk/azure`, `@ai-sdk/anthropic` |
| 2. Agentic Streaming | **A: AI SDK streamText + Socket.IO** | (included in `ai` package) |
| 3. Tools Integration | **A: AI SDK tools + @mastra/mcp** | `@mastra/mcp` |
| 4. L2 Search | **A: Hocuspocus Search Extension** | `jsonpath-plus` (~13KB) |
| 5. Response Grading | **A: Mastra Evals** | `@mastra/evals` |

### Packages to Add
```
ai                    — Vercel AI SDK Core (generateText, streamText, tool)
@ai-sdk/azure         — Azure OpenAI provider
@ai-sdk/anthropic     — Anthropic provider  
@mastra/mcp           — MCP client + server
@mastra/evals         — Evaluation scorers
jsonpath-plus          — JSONPath queries for L2
```

### Packages to Remove (after migration)
```
@langchain/openai
@langchain/anthropic
@langchain/core
@langchain/langgraph
@langchain/mcp-adapters
langchain
deepagents (evaluate)
```

---

## Next Steps

Each feature has a `feature_architecture.md` with 2-3 options. Decisions needed:

1. **Mastra Migration**: Option A (full Mastra), **B (AI SDK + selective)**, or C (stay LangChain)?
2. **Agentic Streaming**: Option A (streamText + Socket.IO), B (SSE), or C (LangChain streaming)?
3. **Tools Integration**: Option A (AI SDK tools + MCP), B (all MCP), or C (minimal upgrade)?
4. **L2 Search**: Option A (Hocuspocus extension), B (microservice), or C (Atlas Search)?
5. **LLM Response Grading**: Option A (Mastra evals), B (custom engine), or C (third-party)?

After decisions, implementation planning docs will be created for each feature.
