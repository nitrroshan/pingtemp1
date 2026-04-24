# Conversation Persistence — Implementation Planning

> **Parent:** [feature_architecture.md](./feature_architecture.md)  
> **Status:** Planning  
> **Branch:** `feature/conversation-persistence`  
> **Phase:** 2 in the [Parallel Plans roadmap](../parallel-plans/feature_architecture.md#cross-feature-dependency-map)  
> **Depends on:** Chat Agent Layer Step 1 (Phase 1)  
> **FF Flag:** `FF_ENABLE_CONVERSATION_PERSISTENCE`

## Key Design Point

Only **session agents** (Planner, ChatAgent) have conversations. Workers don't — their output is captured as task artifacts (OutputManifest + workspace files), not as chat history.

## What Already Exists

| Component | Status | Gap |
|---|---|---|
| `IChatService` + `MongoChatService` | ✅ Built | Uses flat `content: string` — needs `parts[]` |
| `ChatMessage` type | ✅ Built | Missing `agentLayer`, structured parts |
| Message persistence in SocketServerV2 | ✅ Built | Saves on stream finish — works |
| MongoDB indexes | ✅ Built | Has `{teamId, agentId}` — sufficient |
| `goalId` on ChatMessage | ✅ Built | Ready for parallel plans |
| Session restore endpoint | ✅ Stubbed | `/api/v2/sessions/:teamId/restore` — needs implementation |

## Implementation Steps

- [ ] **Step 1: Conversation model + IConversationService**  
  Files: NEW `packages/backend/services/contracts/IConversationService.ts`, NEW `packages/backend/services/mongo/MongoConversationService.ts`, NEW `packages/backend/services/file/FileConversationService.ts`  
  Types: `Conversation { id, teamId, agentId, agentLayer, userId, goalId?, title?, status }`, `Message { id, conversationId, role, parts: MessagePart[], timestamp }`  
  `MessagePart` = `text | tool-call | tool-result | reasoning`  
  Methods: `getOrCreateConversation(teamId, agentId, userId, goalId?)`, `addMessage(conversationId, msg)`, `getMessages(conversationId, { limit, before? })`, `restoreAgentContext(teamId, agentId, limit?)`  
  Two storage backends: MongoDB (cloud) and JSONL (local)  
  FF gate: when `FF_ENABLE_CONVERSATION_PERSISTENCE=false`, `addMessage` is a no-op, `getMessages` returns empty  
  Effort: 2 days

- [ ] **Step 2: Wire SocketServerV2 — scope by conversation**  
  Files: EDIT `packages/backend/api/SocketServerV2.ts`  
  Current: `handleMessage()` saves flat `ChatMessage` via `IChatService`  
  Target: Create/get `Conversation` on first message, save structured `Message` with `parts[]`  
  Worker streams: continue saving as `ChatMessage` (existing path) — NOT as conversations  
  Planner/ChatAgent responses: save as `Message` with tool-call parts preserved  
  Effort: 1.5 days

- [ ] **Step 3: Session restore endpoint**  
  Files: EDIT `packages/backend/api/HttpServer.ts`  
  Implement `/api/v2/sessions/:teamId/restore`:  
  Returns: `{ conversations: [{ agentId, lastMessages[] }], workerMessages: ChatMessage[], plan?, tasks[] }`  
  Session agent conversations: structured `Message` with `parts[]`  
  Worker messages: existing `ChatMessage` records from `IChatService.getMessages()` (already saved with `streamParts`)  
  Scope: last 7 days of worker messages (configurable via `WORKER_MESSAGE_TTL_DAYS`)  
  FF gate: returns empty when flag off  
  Effort: 1 day

- [ ] **Step 4: Frontend — load from server on reload**  
  Files: EDIT `packages/frontend/hooks/useChat.ts`, `packages/frontend/hooks/useOrchestration.ts`  
  On connect/reconnect: call restore endpoint → populate:  
  - Session agent chats (planner, ChatAgents) from `conversations[]`  
  - Worker stream history from `workerMessages[]` — render with `StreamMessage` component (tool cards, reasoning)  
  Worker messages keyed by `taskId` for thread grouping  
  Replace localStorage as source of truth → server is authoritative  
  Effort: 2 days

- [ ] **Step 5: Agent context injection on restart**  
  Files: EDIT `packages/agent-manager/src/agent/internal/AiSdkAgent.ts`, EDIT `packages/agent-manager/src/orchestrator/OrchestratorService.ts`  
  On backend restart: load planner's last N messages from `IConversationService` → deserialize `parts[]` back into AI SDK `ModelMessage[]` format → inject into `AiSdkAgent.messages`  
  `loadActivePlan()` already exists — extend to load conversation too  
  Only for session-mode agents (planner, future ChatAgents). Workers don't need this.  
  Effort: 1.5 days

## Testing

- Unit: Conversation creation, message with parts[], JSONL serialization
- Integration: Send planner message → restart backend → planner has context
- Integration: Worker stream is NOT saved as conversation (only as task output)
- E2E: Frontend reconnect → session agent chats restored, worker streams from task output

## Rollback

`FF_ENABLE_CONVERSATION_PERSISTENCE=false` → `addMessage` no-op, restore returns empty, agents start fresh on restart. Existing `IChatService` + `ChatMessage` path unchanged for backward compat.

## Estimated Total: 8.5 days

## Note: Worker Message Retention

Worker messages are already saved via `IChatService.addMessage()` in `SocketServerV2` (with `streamParts` JSON). They just aren't loaded by the frontend on reconnect. The restore endpoint returns them, scoped to recent days. Old messages cleaned up by TTL (configurable, default 7 days). This is NOT a new persistence mechanism — it's making the existing data accessible on reload.
