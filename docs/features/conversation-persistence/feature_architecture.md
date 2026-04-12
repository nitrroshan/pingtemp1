# Conversation Persistence -- Architecture

**Status:** Planned
**Date:** April 12, 2026
**Related:** [Task Orchestration](../../task-orchestration/markdown-tasks/feature_architecture.md)

---

## Problem

1. **No conversation threading** -- all messages for a team pile into one flat list
2. **Agent conversations not saved** -- tool calls, results, reasoning lost on restart
3. **No user isolation** -- if two users chat with the same agent, messages mix
4. **Frontend uses localStorage** -- stale data after DB reset, grows infinitely

---

## Research: How Platforms Scope Conversations

| Platform | Scope model |
|----------|------------|
| **OpenAI** | `conversation_id` -> messages (one thread per chat) |
| **Claude.ai** | `org` -> `project` -> `conversation` -> messages |
| **Claude Code** | `project/{hash}/{sessionId}/transcript.jsonl` + `subagents/agent-{id}.jsonl` |
| **AI SDK** | `chatId` -> `UIMessage[]` (saved as complete array on `onFinish`) |

---

## Design: Per-Agent Conversations

Every conversation is **user <-> agent**. A team is just a group of agents.
The user can chat with the planner, the backend dev, the QA engineer -- each is a separate conversation.

```
User
 ├── Conversation with Planner (Engineering Team)
 │    ├── user: "Build a REST API"
 │    ├── planner: [tool: analyze_requirements] "I'll create a plan..."
 │    └── planner: [tool: submit_plan] "Here's the plan: 3 tasks..."
 │
 ├── Conversation with Backend Dev (Engineering Team)
 │    ├── system: agent identity + skills (from .md file)
 │    ├── user (task): "Design REST API endpoints"
 │    ├── assistant: [tool: workspace_read_file] -> result
 │    ├── assistant: [tool: workspace_write_file] -> result
 │    └── assistant: "API endpoints created"
 │
 └── Conversation with QA Engineer (Engineering Team)
      ├── system: agent identity + skills
      ├── user (task): "Write tests for the API"
      └── assistant: [tool: workspace_write_file] -> result
```

### Data Model

```
Conversation {
  id: string              // UUID
  teamId: string          // which team this agent belongs to
  agentId: string         // planner | backend | qa | etc.
  userId: string          // who is chatting
  title?: string          // auto-generated from first message
  status: "active" | "archived"
  createdAt: string
  updatedAt: string
}

Message {
  id: string
  conversationId: string  // which conversation
  role: "user" | "assistant" | "system"
  parts: MessagePart[]    // complete content with tool calls
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
userId + teamId + agentId = unique conversation scope
```

- One active conversation per user per agent
- User can have multiple conversations with the same agent (history)
- Each conversation has its own message thread
- Frontend selects an agent in sidebar -> loads that agent's conversation

### Relationships

```
User
 └── Team (group of agents)
      ├── Agent: planner
      │    └── Conversation -> [Message, Message, Message...]
      ├── Agent: backend-developer
      │    └── Conversation -> [Message, Message, Message...]
      └── Agent: qa-engineer
           └── Conversation -> [Message, Message, Message...]
```

---

## Query Patterns

| Query | Use case |
|-------|----------|
| `getConversation(teamId, agentId, userId)` | Get active conversation for this user + agent |
| `getConversationHistory(teamId, agentId, userId)` | List past conversations |
| `getMessages(conversationId, { limit })` | Load messages for a conversation |
| `createConversation(teamId, agentId, userId)` | Start new chat with an agent |
| `addMessage(conversationId, message)` | Save message with parts |

---

## Storage

### Local mode (JSONL)
```
data/conversations/
  {teamId}/
    {agentId}/
      {conversationId}.jsonl    # one JSON object per line
```

### Cloud mode (MongoDB)
```
Collection: conversations
  { _id, teamId, agentId, userId, title, status, createdAt }
  Index: (teamId, agentId, userId)

Collection: messages
  { _id, conversationId, role, parts, timestamp }
  Index: (conversationId, timestamp)
```

---

## What Changes from Current

| Current | After |
|---------|-------|
| `ChatMessage.content` (flat string) | `Message.parts[]` (text + tool calls + results) |
| `teamId` as only scope | `teamId + agentId + userId` scope |
| No conversation concept | `Conversation` per user per agent |
| `sessionId: "default"` always | Real `conversationId` |
| Agent LLM context lost on restart | Full thread persisted, resumable |
| localStorage as source of truth | Backend is source of truth |

---

## Implementation Steps

### Step 1: Conversation + Message Models
- `Conversation` type, `Message` type with `parts[]`
- `IConversationService` contract
- File implementation (JSONL per conversation)
- MongoDB implementation

### Step 2: Wire SocketServerV2
- `sendMessage` scoped to `conversationId`
- On `finish` stream part: save complete message with parts
- On user message: create conversation if none exists

### Step 3: Frontend
- Agent selected in sidebar -> load conversation from API
- localStorage is write-through cache only
- Conversation list per agent (future: history sidebar)

### Step 4: Agent Context Resume
- On task resume, load conversation from storage
- Inject as LLM conversation history
- Agent continues with full context (tool calls + results preserved)
