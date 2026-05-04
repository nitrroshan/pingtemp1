# Conversation Persistence v1.1 — Full-Fidelity ModelMessage Storage

> **Parent:** [feature_architecture.md](../feature_architecture.md)  
> **Status:** ✅ Implemented  
> **Branch:** `user/nitrroshan/fixplans`  
> **Depends on:** v1.0 ✅  
> **FF Flag:** `FF_ENABLE_CONVERSATION_PERSISTENCE` (existing)

## Scope

Store full AI SDK `ModelMessage[]` (including tool calls/results) for **all agent types** — workers, ChatAgents, and planner. On restore, provide complete LLM context — not just text summaries.

- **Workers**: per-task context. Enables task retry with full history, debugging, review.
- **ChatAgents**: per-exchange conversation snapshot. Enables session restore with tool call history.
- **Planner**: per-exchange conversation snapshot. Same as ChatAgent.

## Approach: Option B — Save via `getMessages()` at each save point

AiSdkAgent exposes `getMessages()` (pure read). Callers persist at their existing save points. Agent stays persistence-agnostic (SRP). Stream stays pure rendering (ISP). Aligns with AI SDK's official `onFinish({ response }) → save messages` pattern.

## Implementation Steps

- [x] **Step 1: Add `contextMessages` field to storage**  
  Files: `ChatMessage.ts`, `SqliteChatService.ts` (schema + migration), `ChatMessageSchema.ts` (MongoDB), `MongoChatService.ts`  
  Change: New optional `contextMessages?: string` column/field  
  Lines: ~12

- [x] **Step 2: Add `getMessages()` to AiSdkAgent + upgrade `loadMessages()`**  
  Files: `AiSdkAgent.ts`  
  Change:  
  - Add `getMessages(): ModelMessage[]` — public getter, returns copy of `this.messages`  
  - Update `loadMessages()` to accept full `ModelMessage[]` (detect format: if first element's `content` is an array → full format, else simplified)  
  Lines: ~15

- [x] **Step 3: Add `getWorkerContext()` + `getChatAgentContext()` to AgentManager**  
  Files: `AgentManagerV2.ts`, `WorkerPool.ts`  
  Change:  
  - `WorkerPool.getAgentMessages(taskId): ModelMessage[] | null` — accesses `this.workers.get(taskId)?.getMessages()`  
  - `AgentManager.getWorkerContext(taskId): string | null` — calls workerPool, serializes  
  - `AgentManager.getChatAgentContext(role): string | null` — calls chatAgent's agent, serializes  
  Lines: ~20

- [x] **Step 4: Save contextMessages at each save point in SocketServerV2**  
  Files: `SocketServerV2.ts`  
  Change:  
  - **Worker/Planner `onStream(finish)` handler**: After existing `addMessage()`, call `manager.getWorkerContext(taskId)` and include `contextMessages` in the save.  
  - **ChatAgent `handleChatAgentMessage()`**: After for-await loop + existing accumulator save, call `manager.getChatAgentContext(role)` and include `contextMessages`.  
  Lines: ~15

- [x] **Step 5: Update `loadConversation` callback to prefer `contextMessages`**  
  Files: `AgentManagerRegistry.ts`  
  Change: In the `loadConversation` callback, fetch the latest assistant message. If it has `contextMessages`, parse and return `ModelMessage[]`. Else fall back to simplified `{ role, content }[]`.  
  Lines: ~8

- [x] **Step 6: Build + verify**  
  Verify: All 3 packages build. Manual test:
  - Worker executes task with tool calls → check DB has `contextMessages` with tool-call/tool-result
  - ChatAgent conversation → restart → follow-up message → LLM has tool call context
  - Old messages without `contextMessages` → simplified restore still works

## Testing

- Unit: `JSON.stringify(ModelMessage[])` → `JSON.parse` → valid (already proven JSON-safe)
- Integration: Worker calls `workspace_write_file` → DB entry has `contextMessages` with tool call
- Integration: ChatAgent calls `get_my_tasks` → restart → ChatAgent knows what tools it called
- Backward compat: Messages without `contextMessages` → v1.0 simplified restore path

## Rollback

`contextMessages` is optional and additive. If broken:
- Clear the field — v1.0 simplified restore still works as fallback
- Remove the `context_snapshot` yield from AiSdkAgent — no other code changes needed
- No migration needed to roll back

## Size Considerations

- Worker task (20 tool calls): ~30KB per snapshot
- ChatAgent (10-turn with tools): ~50KB per snapshot
- Only latest snapshot matters for restore
- SQLite TEXT: no practical limit. MongoDB String: 16MB document limit (sufficient)
- `context_snapshot` is NOT sent to frontend — no network overhead

## Estimated Total: ~70 lines across 6 files
