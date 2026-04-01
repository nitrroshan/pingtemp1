# Task 005: Chat Mode + UI Integration

**Status:** `completed`
**Assignee:** Copilot
**Estimated:** 2 days
**Priority:** 🔵 Normal
**Branch:** `feature/chat-mode-ui`

## Description

Implement direct agent chat capability and integrate with the frontend. Users can select an agent from the team and have a direct conversation, separate from goal-driven orchestration.

## Context

The documented architecture supports two modes:
- **Chat Mode**: User ↔ Agent direct conversation
- **Goal Mode**: User gives goal, Orchestrator coordinates team

## Current State (2026-02-11)

**Fully Implemented:**
- ✅ Direct agent chat via WebSocket (`agent:message` event)
- ✅ Frontend agent selection and chat UI
- ✅ Conversation continuity via `taskId` (thread management)
- ✅ Chat/Tasks view mode toggle in UI

## Acceptance Criteria

- [x] Implement `AgentManager.chatWithAgent(agentId, message, threadId)` — Done via `startTask()`/`continueTask()` with taskId
- [x] Add WebSocket event handler for `chat:message` in SocketServer — Done as `agent:message` handler
- [x] Add `subscribeToAgentChat(agentId)` for frontend subscription — Done via `subscribeToAgent(agentRole)`
- [x] Emit `agent:chatMessage` events during conversation — Done as `agent:message`, `agent:done`, `agent:error`
- [x] Support conversation memory via `threadId` — Done via `taskId` stored in `AgentManagerService.taskIds` Map
- [x] Frontend: Add agent selection for direct chat — Done in Sidebar + App.tsx
- [x] Frontend: Show chat history per agent/thread — Done in ChatArea with MessageList
- [x] Frontend: Distinguish chat mode from goal mode UI — Done via `viewMode` toggle ('chat' vs 'tasks')

## Implementation Notes

**Backend files to create/modify:**
- Modify: `src/worker/api/SocketServer.ts` - Add chat event handlers
- Modify: `src/worker/api/agentManagerHandler.ts` - Add chat routes
- Add: `src/worker/api/ChatHandler.ts` (optional, for separation)

**Frontend files to modify:**
- Modify: `src/AgentChat/services/AgentManagerService.ts` - Add chat methods
- Modify: `src/AgentChat/App.tsx` - Add agent selection for chat
- Modify: `src/AgentChat/components/ChatArea.tsx` - Show chat mode

**WebSocket events:**
```typescript
// Client → Server
socket.emit('chat:subscribe', { agentId });
socket.emit('chat:message', { agentId, message, threadId });

// Server → Client
socket.emit('agent:chatMessage', { agentId, content, timestamp });
socket.emit('agent:chatEvent', { agentId, event }); // thinking, tool_start, etc.
```

**Backend handler:**
```typescript
// In SocketServer.ts
socket.on('chat:message', async ({ agentId, message, threadId }) => {
  const generator = agentManager.chatWithAgent(agentId, message, threadId);
  for await (const event of generator) {
    socket.emit('agent:chatEvent', { agentId, event });
  }
});
```

**Dependencies:**
- Task-001: InternalAgent (agent execution)
- Task-004: AgentManager Redesign (chatWithAgent method)

## Code TODOs

_To be added when implementation begins_

## Testing

**Unit tests:**
- Chat message routing to correct agent
- Thread ID creates/continues conversation
- Event emission during chat

**Integration tests:**
- Full chat roundtrip via WebSocket
- Multiple users chatting with same agent
- Conversation memory persistence

**E2E tests:**
- Frontend agent selection
- Message send/receive
- Chat history display

## Blockers

- Depends on Task-001 (InternalAgent)
- Depends on Task-004 (AgentManager Redesign)

## Notes

This completes the user-facing experience. After this task:
- Users can chat directly with any team agent
- Users can give goals for team orchestration
- Clear separation of interaction modes

The frontend changes should clearly distinguish between:
- "Chat with Agent" (direct conversation)
- "New Goal" (team orchestration)

---

**Related Tasks:**
- Task-001: InternalAgent (prerequisite)
- Task-004: AgentManager Redesign (prerequisite)
