# AI SDK Migration — Implementation Log

## Branch
`feature/ai-sdk-migration` (merged into `copilot/vscode-mnhy8kz9-z3jv`)

## Key Changes

### New Files
- `packages/backend/agent/providers/ModelProvider.ts` — Unified AI SDK model creation for azure-openai, anthropic, openai
- `packages/backend/agent/internal/AiSdkAgent.ts` — AI SDK-based agent using `streamText()` / `generateObject()`

### Modified Files
- `packages/backend/agent/AgentFactory.ts` — Routes to `AiSdkAgent` when `AGENT_RUNTIME=aisdk`, `InternalAgent` when `langgraph` (default)
- `packages/backend/services/WorkerPool.ts` — Uses `agentRuntime` flag to select agent constructor

## Feature Flag
- `AGENT_RUNTIME=langgraph` (default) — keeps LangGraph `InternalAgent`
- `AGENT_RUNTIME=aisdk` — uses new `AiSdkAgent` with AI SDK `streamText()`

## Deviations from Plan
- Tool definition uses `inputSchema` (AI SDK v4) instead of `parameters` (v3)
- Memory uses simple message array instead of LangGraph `MemorySaver` (no graph rebuild needed)
- MCP tools still use `@langchain/mcp-adapters` in LangGraph mode; AI SDK mode accepts tools via `setTools()`

## Status
Core implementation complete. LangGraph path unchanged. `AGENT_RUNTIME=aisdk` activates new path.
