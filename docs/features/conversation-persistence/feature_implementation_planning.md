# Conversation Persistence — Implementation Planning

> **Parent:** [feature_architecture.md](./feature_architecture.md)  
> **Status:** ✅ Implemented  
> **Branch:** `user/nitrroshan/fixplans`  
> **Phase:** 2 in the [Parallel Plans roadmap](../parallel-plans/feature_architecture.md#cross-feature-dependency-map)  
> **Depends on:** Chat Agent Layer Step 1 (Phase 1) ✅  
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

- [x] **Step 1: agentLayer field + storage migration**
  Simplified from original plan: instead of a new `Conversation` entity, added `agentLayer` field to existing `ChatMessage` type. Storage backends (SQLite + MongoDB) updated with migration. `getSessionMessages()` method added to `IChatService` for per-layer retrieval.
  Files: `ChatMessage.ts`, `SqliteChatService.ts`, `MongoChatService.ts`, `ChatMessageSchema.ts`, `IChatService.ts`

- [x] **Step 2: Fix ChatAgent response persistence + tag all messages**
  Critical bug fix: ChatAgent responses were saving a stub string instead of actual content. Now uses same messageAccumulator pattern as worker streams. All messages tagged with `agentLayer` (planner/chat-agent/worker).
  Files: `SocketServerV2.ts` (handleChatAgentMessage, handleMessage, onStream callback)

- [x] **Step 3: Session restore endpoint**
  Enhanced `/api/v2/sessions/:teamId/restore` to return per-agent grouped conversations + worker messages (separated by agentLayer). Returns `{ conversations, workerMessages, goals, plan, tasks }`.
  Files: `HttpServer.ts`

- [x] **Step 4: Frontend session restore**
  Added `restoreFromServer()` to `useChat` — single API call on team select that restores all session agent conversations and worker messages. Replaces per-agent `loadAgentChat` calls. Server is authoritative, localStorage is cache.
  Files: `AgentServiceV2.ts` (restoreSession), `useChat.ts` (restoreFromServer), `App.tsx` (wiring)

- [x] **Step 5: Agent context injection on restart**
  Added `AiSdkAgent.loadMessages()` — public method to inject prior conversation as simplified `{ role, content }[]`. `ChatAgent` accepts `loadConversation` callback in config, calls it during `ensureAgent()`. `AgentManagerRegistry` wires the callback to `IChatService.getAgentMessages()` when persistence flag is on.
  Files: `AiSdkAgent.ts`, `ChatAgent.ts` (ChatAgentConfig + ensureAgent), `AgentManagerV2.ts` (enableChatAgents + getChatAgent), `AgentManagerRegistry.ts`

- [x] **Feature flag added**: `FF_ENABLE_CONVERSATION_PERSISTENCE` (dev: true, prod: false)
  Files: `featureFlags.ts`

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
