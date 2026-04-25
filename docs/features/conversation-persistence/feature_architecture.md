# Conversation Persistence — Architecture

**Status:** v1.0 implemented, v1.1 planned  
**Date:** April 12, 2026 (revised April 25, 2026)  
**Phase:** 2 in the [Parallel Plans roadmap](../parallel-plans/feature_architecture.md#cross-feature-dependency-map)  
**Depends on:** Chat Agent Layer (Phase 1) ✅

---

## Problem

1. **No conversation persistence** — planner and future ChatAgent conversations lost on restart
2. **No separation between chat and task streams** — everything is one flat message list
3. **No user isolation** — two users chatting with same team see each other's messages
4. **Frontend uses localStorage** — stale after DB reset, grows infinitely

---

## Key Insight: Two Types of Conversations

With the three-layer model (Planner → ChatAgent → Worker), there are **two fundamentally different** conversation types:

| Type | Who | Lifetime | Persistence | User interacts? |
|---|---|---|---|---|
| **Session Chat** | Planner, ChatAgent | Long-lived, multi-turn | **Must persist** (survive restarts) | Yes — user chats with them |
| **Task Stream** | Worker | Short-lived, single-task | **Captured as output** (OutputManifest) | No — user watches, doesn't chat |

Workers don't have "conversations" — they execute tasks and stream results. The stream is captured as task output, not as a conversation to resume.

### What Gets Persisted Where

```
Planner conversation      → Conversation store (MongoDB/JSONL)
  "Build a REST API" → plan → approve → "all tasks done"
  
ChatAgent conversation    → Conversation store (MongoDB/JSONL)  
  "What did you build?" → "I created 3 endpoints..." → "Can you add pagination?"

Worker task stream         → Task output (OutputManifest + workspace files)
  [tool: write_file] → [tool: commit] → [complete_task: "API endpoints created"]
  NOT a conversation — captured as artifacts, not chat history
```

---

## Data Model

```
Conversation {
  id: string
  teamId: string
  agentId: string         // "planner" | "backend" | "frontend" | etc.
  agentLayer: "planner" | "chat-agent"   // only session agents have conversations
  userId: string
  goalId?: string         // planner conversations scoped to goal (for parallel plans)
  title?: string          // auto-generated from first message
  status: "active" | "archived"
  createdAt: string
  updatedAt: string  
}

Message {
  id: string
  conversationId: string
  role: "user" | "assistant" | "system"
  parts: MessagePart[]
  timestamp: string
}

MessagePart =
  | { type: "text", text: string }
  | { type: "tool-call", toolCallId: string, toolName: string, args: any }
  | { type: "tool-result", toolCallId: string, result: any }
  | { type: "reasoning", text: string }
```

### Scoping

```
Planner:    userId + teamId + "planner" + goalId  = conversation scope
ChatAgent:  userId + teamId + roleId              = conversation scope
Worker:     NO conversation — task output only
```

---

## What Already Exists

| Component | Status | Notes |
|---|---|---|
| `IChatService` + `MongoChatService` | ✅ Built | `ChatMessage` with `content`, `streamParts`, `agentLayer` |
| `ChatMessage.goalId` | ✅ Built | Already on schema |
| `ChatMessage.agentLayer` | ✅ Built (v1.0) | Tags messages as planner/chat-agent/worker |
| `getSessionMessages()` | ✅ Built (v1.0) | Returns messages grouped by layer for restore |
| Message persistence in SocketServerV2 | ✅ Built (v1.0) | User + assistant messages saved with full accumulator pattern |
| ChatAgent response persistence | ✅ Fixed (v1.0) | Was saving stub, now saves actual text + tool calls |
| `AiSdkAgent.loadMessages()` | ✅ Built (v1.0) | Accepts simplified `{ role, content }[]` — **no tool calls** |
| Frontend `restoreFromServer()` | ✅ Built (v1.0) | Single API call on team select |
| `FF_ENABLE_CONVERSATION_PERSISTENCE` | ✅ Built (v1.0) | Dev: true, Prod: false |

## What's Missing (v2.0)

| Component | Needed |
|---|---|
| Socket.IO auth middleware | Validate better-auth cookie, extract userId |
| HTTP auth middleware | Protect `/api/v2/*`, inject `req.userId` |
| Real `sessionId` in services | Replace `"default"` with authenticated user ID |
| Goal lifecycle | Save on approve, update on completion/failure |
| User-scoped restore | Filter conversations by userId |

## Known Bugs

| Bug | Severity | Fix Version |
|---|---|---|
| [BUG-001](bugs/bug-001-addgoal-missing-sessionid.md): `addGoal()` missing sessionId | CRITICAL | v2.0 Step 5 |
| [BUG-002](bugs/bug-002-auth-identity-not-threaded.md): Auth identity not threaded | HIGH | v2.0 Steps 1-4 |
| [BUG-003](bugs/bug-003-goal-status-never-updated.md): Goal status never updated | MEDIUM | v2.0 Step 6 |

## Versions

| Version | Scope | Status |
|---|---|---|
| **v1.0** | `agentLayer` tagging, session restore, simplified context injection, ChatAgent response fix | ✅ Complete |
| **v1.1** | Full-fidelity ModelMessage[] storage — tool calls/results preserved in DB, restored to LLM context | ✅ Complete |
| **v2.0** | Session identity threading (auth → socket → HTTP → services), goal lifecycle, user-scoped conversations | [Planned](v2.0/feature_implementation_planning.md) |
| **v2.0** | `Conversation` entity, `Message.parts[]`, user isolation, goal-scoped planner conversations | Future |

---

## Query Patterns

| Query | Use case |
|---|---|
| `getActiveConversation(teamId, agentId, userId, goalId?)` | Load current chat with a session agent |
| `getMessages(conversationId, { limit, before? })` | Paginated message loading |
| `addMessage(conversationId, message)` | Save message with structured parts |
| `restoreAgentContext(teamId, agentId)` | Load last N messages for LLM context injection |

---

## Storage

### Local mode (JSONL)
```
data/conversations/{teamId}/{agentId}/{conversationId}.jsonl
```

### Cloud mode (MongoDB)
```
Collection: conversations
  { _id, teamId, agentId, agentLayer, userId, goalId?, title, status }
  Index: (teamId, agentId, userId)

Collection: messages  
  { _id, conversationId, role, parts[], timestamp }
  Index: (conversationId, timestamp)
```

---

## What Changes from Current

| Current | After |
|---|---|
| `ChatMessage.content` (flat string) | `Message.parts[]` (structured) |
| All agents treated the same | Only session agents (planner, ChatAgent) have conversations |
| Worker streams saved as messages | Worker streams captured as task output only |
| `sessionId: "default"` always | Real `conversationId` per agent per user |
| Agent context lost on restart | Session agent conversations resumable |
| localStorage as source of truth | Backend is source of truth |
- Agent continues with full context (tool calls + results preserved)

---

## v1.1: Full-Fidelity ModelMessage Storage

### Problem (v1.0 gap)

v1.0 stores `content: string` + `streamParts: JSON` in the database. On restore, `loadMessages()` injects simplified `{ role, content }[]` into the LLM — tool calls and results are **lost**. The LLM loses track of what tools it already called, may re-query unnecessarily, and loses multi-step reasoning context.

### Key Finding: ModelMessage[] Is JSON-Safe

AI SDK `ModelMessage[]` is 100% JSON-serializable. No functions, class instances, or symbols. `JSON.stringify/parse` round-trips cleanly. AI SDK exports `modelMessageSchema` (Zod) for validation.

Typical in-memory shape after a tool round-trip:

```json
[
  { "role": "user", "content": "What tasks are assigned?" },
  { "role": "assistant", "content": [
    { "type": "text", "text": "Let me check." },
    { "type": "tool-call", "toolCallId": "call_abc", "toolName": "get_my_tasks", "input": {} }
  ]},
  { "role": "tool", "content": [
    { "type": "tool-result", "toolCallId": "call_abc", "toolName": "get_my_tasks",
      "output": { "type": "text", "value": "[completed] task-1: DB schema" } }
  ]},
  { "role": "assistant", "content": "You have 1 task: 'DB schema' which is completed." }
]
```

### Two Formats — Different Purposes

| Format | Purpose | Consumer |
|---|---|---|
| `streamParts` (existing) | Frontend rendering — tool cards, reasoning sections | `useChat.processStreamPart()` |
| `contextMessages` (new) | LLM context — full conversation with tool call/result pairing | `AiSdkAgent.loadMessages()` |

Both are needed. `streamParts` drives the UI. `contextMessages` drives the LLM.

### Architecture Options

#### Option A: Thread messages through WorkerPool callbacks

Add `getMessages()` to AiSdkAgent. In `WorkerPool.runTask()`, after the generator loop completes, call `agent.getMessages()` and include it in the `onDone` callback data. Thread through OrchestratorService → AgentManager → SocketServerV2.

**Pros:** Unified path — works for all agent types through the same callback chain.  
**Cons:** Threading a potentially large `ModelMessage[]` through 4 callback layers. Every callback signature needs updating.  
**SOLID:** ✅ SRP — agent doesn't know about persistence.

#### Option B: Save via `getMessages()` at each save point (Recommended)

Add `getMessages()` to AiSdkAgent (pure read — returns copy of `ModelMessage[]`). Each save point calls it after the stream finishes:
- **Workers**: SocketServerV2 `onStream(finish)` → `manager.getWorkerContext(taskId)` → save
- **ChatAgents**: SocketServerV2 after `handleChatAgentMessage()` loop → `manager.getChatAgentContext(role)` → save
- **Planner**: SocketServerV2 `onStream(finish)` → same pattern

**Pros:** Clean SRP — agent only exposes data, caller decides when to persist. Same pattern for all agent types. No stream pollution.  
**Cons:** Need `getAgentContext()` method on AgentManager to bridge SocketServerV2 → agent.  
**SOLID:** ✅ SRP (agent is persistence-agnostic), ✅ ISP (stream stays pure rendering), ✅ DIP (persistence is caller's concern).

#### Option C: Emit `context_snapshot` as final stream event

AiSdkAgent emits `{ type: "context_snapshot", messages: ModelMessage[] }` at end of `executeToolMode()`.

**Pros:** Zero callback changes. All agent types emit automatically.  
**Cons:** Mixes persistence data into the rendering stream. Agent takes on persistence responsibility. SocketServerV2 must filter it out before broadcasting.  
**SOLID:** ❌ SRP (agent emits persistence events), ❌ ISP (stream mixes rendering + persistence), ❌ DIP (agent knows about persistence).

### Recommendation

**Option B** — save via `getMessages()` at each save point.

Why:
- **SOLID-compliant** — AiSdkAgent stays a pure execution engine. `getMessages()` is a read-only getter, not a persistence action.
- **Aligns with AI SDK official pattern** — AI SDK's own `onFinish` callback gives `response.messages` for the caller to save. We do the same: agent produces messages, caller persists.
- **Stream stays clean** — no `context_snapshot` events mixed into the rendering pipeline. ISP respected.
- **All agent types covered** — workers (per-task), ChatAgents (per-exchange), planner (per-exchange). Same `getMessages()` API, different save points.
- **Full fidelity** — `ModelMessage[]` includes tool calls, tool results, reasoning, multi-step history. 100% JSON-serializable.

### Data Flow

```
Save (Workers — via SocketServerV2 onStream finish handler):
  AiSdkAgent.executeToolMode() → stream parts → finish event
  SocketServerV2.onStream(finish):
    → saves content + streamParts (existing)
    → calls manager.getWorkerContext(taskId) → workerPool.getAgentMessages(taskId)
      → agent.getMessages() → ModelMessage[]
    → JSON.stringify → saves as contextMessages on ChatMessage

Save (ChatAgents — via SocketServerV2 handleChatAgentMessage):
  ChatAgent.handleUserMessage() → stream parts → finish
  SocketServerV2 for-await loop ends:
    → saves content + streamParts (existing accumulator)
    → calls manager.getChatAgentContext(role) → chatAgent → agent.getMessages()
    → JSON.stringify → saves as contextMessages

Save (Planner — same as Workers):
  Planner stream → finish → same onStream handler

Restore (ChatAgent):
  ChatAgent.ensureAgent() → loadConversation()
  → IChatService.getAgentMessages(teamId, agentId, { limit: 1 })
  → latest message has contextMessages → JSON.parse → ModelMessage[]
  → agent.loadMessages(parsed)
  → LLM has full tool call history

Restore (Worker — task retry/review):
  → IChatService messages with taskId → contextMessages → JSON.parse
```

### Storage: New `contextMessages` field on ChatMessage

```typescript
// ChatMessage — one new optional field
contextMessages?: string;  // JSON.stringify(ModelMessage[]) — full AI SDK conversation snapshot
```

- **Workers**: saved per-task on `finish`. Keyed by `taskId`. Contains full tool call history for that task execution.
- **ChatAgents**: saved per-exchange on `finish`. Latest snapshot contains full conversation history.
- **Planner**: saved per-exchange on `finish`. Same pattern.
- On restore, only the **latest** `contextMessages` blob is loaded — it contains the full history up to that point.
- SQLite + MongoDB: new nullable TEXT/String column.

### Scope by Agent Type

| Agent | Scope | Save Trigger | Restore Use Case |
|---|---|---|---|
| **Worker** | Per-task | `onStream(finish)` → `getWorkerContext(taskId)` | Task retry, debugging, review |
| **ChatAgent** | Per-exchange (full conversation) | After stream loop → `getChatAgentContext(role)` | Session restore on restart |
| **Planner** | Per-exchange (full conversation) | `onStream(finish)` → same pattern | Session restore on restart |
