# Task 001: Enforce goalId on all chat messages

**Status:** `in-progress` (warnings added, strict enforcement deferred)
**Assignee:**
**Branch:** `feature/team-ownership-v1.0`

## Description

Chat messages can currently be saved without a `goalId`, which makes it impossible to separate conversations between goals. Three code paths allow `goalId` to be `undefined`. All must be fixed so `goalId` is always present when a message is persisted.

### Current State (May 5, 2026)

- `logger.warn()` added at both persistence paths (SocketMessageHandler + SocketEventBroadcaster) when goalId is missing — makes the issue visible in logs
- Production path (plan → approve → execute) always has goalId because GoalManager sets it on every task
- Edge case: legacy "chat mode" (direct worker send without a plan) can still omit goalId
- Making the types strict (`goalId: string` required) is deferred — requires changes across agent-manager + backend interfaces

## Problem

The architecture doc states `goalId` is required on all chat messages, but three runtime code paths still allow it to be undefined:

### Path 1: Worker stream save (`SocketEventBroadcaster`)

**File:** `packages/backend/api/SocketEventBroadcaster.ts` ~L116

```typescript
goalId: streamGoalId || undefined,
```

`streamGoalId` comes from `onStream` callback's `goalId` param, which is typed as optional (`goalId?: string`). If the task in `TaskStore` somehow lacks a `goalId`, this saves a message with no goal scope.

### Path 2: Non-orchestrator user messages (`SocketMessageHandler`)

**File:** `packages/backend/api/SocketMessageHandler.ts` ~L80

```typescript
goalId: clientGoalId || undefined,
```

For non-orchestrator user messages (direct worker or chat-agent sends), `clientGoalId` comes from the client payload. If the client doesn't send it, the message has no goal scope.

### Path 3: WorkerPool task execution

**File:** `packages/agent-manager/src/services/WorkerPool.ts` ~L241, ~L252

```typescript
taskGoalId = storedTask?.goalId;  // can be undefined
```

`taskGoalId` is read from `TaskStore.get(taskId)?.goalId`. If the task is missing from the store or has no `goalId`, all stream events from this worker execution have no goal scope.

## Root cause

The `onStream` callback type declares `goalId` as optional:

```typescript
// packages/agent-manager/src/AgentManagerV2.ts L40
onStream?: (data: { taskId: string; agentId: string; part: any; goalId?: string }) => void;
```

This cascades to `WorkerPool` and `OrchestratorService` types.

## Acceptance Criteria

- [ ] `onStream` callback type changed to `goalId: string` (required)
- [ ] `WorkerPool.executeTask` throws or logs error if `taskGoalId` is undefined — never passes undefined to `onStream`
- [ ] `SocketEventBroadcaster` saves `goalId` as required field, never `undefined`
- [ ] `SocketMessageHandler` non-orchestrator user messages require `clientGoalId` — reject or resolve from context if missing
- [ ] No chat message is ever persisted to MongoDB without `goalId`
- [ ] Existing `ChatMessageSchema` updated: `goalId` changed from `default: null` to `required: true`

## Implementation Notes

- Files to modify:
  - `packages/agent-manager/src/AgentManagerV2.ts` — `StreamCallbacks.onStream` type
  - `packages/agent-manager/src/orchestrator/types.ts` — same type
  - `packages/agent-manager/src/services/WorkerPool.ts` — guard `taskGoalId`, L241 and L252
  - `packages/backend/api/SocketEventBroadcaster.ts` — remove `|| undefined` fallback on L116
  - `packages/backend/api/SocketMessageHandler.ts` — require `clientGoalId` for non-orchestrator messages, L80
  - `packages/backend/services/mongo/schemas/ChatMessageSchema.ts` — make `goalId` required
- The orchestrator path (`handleOrchestratorMessage`) is already correct: it generates `resolvedGoalId = goalId || randomUUID()` server-side before any message is saved
- `TaskStore.createTask` already validates `goalId` is present — so `storedTask.goalId` should never actually be undefined if the task was created properly. The fix is a defensive guard + error log.

## Testing

- Unit test: Attempt to save a chat message without `goalId` — should throw or be rejected
- Integration test: Send a worker message through the full pipeline — verify `goalId` is present in MongoDB
- Edge case: Worker with a task whose `goalId` is missing from TaskStore — should log error, not save orphan message

## Notes

- This is a data integrity fix, not a feature. Once enforced, session restore and goal-scoped queries will be reliable.
- Migration note: existing messages with `goalId: null` in MongoDB need a backfill strategy (separate task or migration script).
