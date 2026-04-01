# Agentic Streaming — Implementation Plan

**Parent:** [Feature Architecture](feature_architecture.md)  
**Phase:** 2 (Real-Time Experience)  
**ID:** A2  
**Approach:** Option A — AI SDK `streamText` + Socket.IO Bridge with Data Stream Protocol format

---

## Branch
- `feature/agentic-streaming`

## Scope
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
