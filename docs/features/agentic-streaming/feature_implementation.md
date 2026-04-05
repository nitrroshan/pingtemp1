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
