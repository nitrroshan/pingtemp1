# Conversation Persistence — Architecture

**Status:** Planned  
**Date:** April 12, 2026 (revised April 24, 2026)  
**Phase:** 2 in the [Parallel Plans roadmap](../parallel-plans/feature_architecture.md#cross-feature-dependency-map)  
**Depends on:** Chat Agent Layer (Phase 1)

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
| `IChatService` + `MongoChatService` | ✅ Built | Flat `ChatMessage` with `content: string` — needs `parts[]` upgrade |
| `ChatMessage.goalId` | ✅ Built | Already on schema |
| Message persistence in SocketServerV2 | ✅ Built | User + assistant messages saved on stream finish |
| `BaseAgent._conversationHistory` | ✅ Built | Simplified in-memory log — to be replaced by this |

## What's Missing

| Component | Needed |
|---|---|
| `Conversation` entity (scoped by agent + user) | New collection/model |
| `Message.parts[]` (structured, not flat string) | Upgrade from `content: string` |
| Goal-scoped planner conversations | For parallel plans |
| Session restore (load conversation on restart) | Agent context reload |
| Frontend: load from server, not localStorage | Source of truth change |

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
