# Task 001: Enforce goalId on all chat messages

**Status:** `done`
**Assignee:**
**Branch:** `feature/team-ownership-v1.0`

## Description

Chat messages must always have a `goalId` — goal-less messages cannot be restored on reload and break conversation isolation between goals. This task enforced goalId across all persistence paths.

### Resolution (May 6, 2026)

All three paths are now enforced:

1. **`onStream` callback type** — `goalId: string` (required) in both `AgentManagerV2.ts` and `orchestrator/types.ts`. No optional goalId anywhere in the stream contract.
2. **API boundary rejection** — `SocketMessageHandler` rejects non-orchestrator messages without `goalId` at the socket boundary (returns error to client). Orchestrator messages are exempt because they generate goalId server-side.
3. **WorkerPool guard** — `WorkerPool.executeTask` only fires `onStream` when `taskGoalId` is defined. Tasks without goalId produce a log warning but never emit stream events.
4. **SocketEventBroadcaster** — skip-and-warn on missing `streamGoalId` as a defense-in-depth layer. Should never fire after the boundary check.
5. **Frontend** — `AgentServiceV2.sendToChatAgent()` signature changed from `goalId?: string` to `goalId: string`. The `|| null` fallback removed from socket emit.

### Acceptance Criteria (all met)

- [x] `onStream` callback type changed to `goalId: string` (required)
- [x] `WorkerPool.executeTask` only fires `onStream` when `taskGoalId` is defined
- [x] `SocketEventBroadcaster` skips persistence when `streamGoalId` is missing (defense-in-depth)
- [x] `SocketMessageHandler` rejects non-orchestrator messages without `clientGoalId` at the boundary
- [x] No chat message is persisted without `goalId` (enforced at API entry point)
- [x] Frontend `sendToChatAgent` requires `goalId: string`

## Files Changed

| File | Change |
|------|--------|
| `packages/agent-manager/src/AgentManagerV2.ts` | `onStream` callback: `goalId: string` (required) |
| `packages/agent-manager/src/orchestrator/types.ts` | `OrchestratorCallbacks.onStream`: `goalId: string` (required) |
| `packages/agent-manager/src/services/WorkerPool.ts` | Guard: only fires `onStream` when `taskGoalId` is defined |
| `packages/backend/api/SocketMessageHandler.ts` | Rejects non-orchestrator messages without goalId |
| `packages/backend/api/SocketEventBroadcaster.ts` | Skip-and-warn on missing `streamGoalId` |
| `packages/frontend/services/AgentServiceV2.ts` | `sendToChatAgent(role, content, goalId: string)` — required |

## Notes

- Orchestrator messages (`manager`/`orchestrator`) don't require goalId from the client — the server generates one via `randomUUID()` before any persistence
- Existing messages with `goalId: null` in MongoDB are historical — no backfill needed since they predate goal isolation
- The `ChatMessageSchema` still has `goalId` as optional at the MongoDB level for backward compatibility with existing documents, but no new documents are created without it
