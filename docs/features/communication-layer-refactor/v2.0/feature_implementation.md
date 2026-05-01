# v2.0 — Implementation Tracking

> **Status:** Complete  
> **Planning:** [feature_implementation_planning.md](./feature_implementation_planning.md)  
> **Architecture:** [../feature_architecture.md](../feature_architecture.md) — Layer 1

## Progress — Planned Steps

| Step | Description | Status | Notes |
|------|------------|--------|-------|
| 1 | Create goalSessionStore.ts | Complete | ~800 lines: state + switchGoal + restoreTeam + newGoal + clearGoal + sendUserMessage + processStreamPart + handleStateEvent + all actions |
| 2 | Update App.tsx | Complete | Rewired to goalSessionStore. Removed 3 useEffects. Removed savePlan/sessionStorage. All goal switching via store actions. |
| 3 | Update PlanList.tsx | Complete | Reads plans from goalSessionStore. Removed sessionStorage helpers (getStoredPlans, savePlan). |
| 4 | Update uiStore.ts | Complete | Removed activeGoalId, activePlanId, selectedTaskId. Version bumped to 3. Setters accept function updaters. |
| 5 | Delete old files | Complete | chatStore.ts, orchestrationStore.ts, GoalCoordinator.ts deleted. Zero imports remain. |
| 6 | Update remaining consumers | Complete | PlanViewerPage reads from goalSessionStore. Zero sessionStorage plan references. |

## Additional Fixes — Found During Review (Not In Original Plan)

| # | Issue Found | Fix Applied | Category |
|---|------------|-------------|----------|
| R1 | resetForTeam clears URL-derived planId before restoreTeam runs | restoreTeam() accepts urlPlanId as parameter — no save/restore hack | URL restore |
| R2 | Planner follow-up messages written under wrong chat key (agent.id instead of teamId:goal:goalId) | New sendUserMessage() store action derives chat key internally from context | Chat routing |
| R3 | Restored worker messages use role-based key, live streams use frontend agentId-based key | Both switchGoal and restoreTeam resolve role→agentId via agents list | Key normalization |
| R4 | handleStateEvent merges tasks/state from other goals into active view | Goal-scope guard: checks data.goalId against activeGoalId before mutating visible state | State isolation |
| R5 | App.tsx has multiple direct setActiveGoalId/setActivePlanId writes bypassing switchGoal | Removed setter aliases. Added newGoal(), clearGoal() actions. All transitions through store. | Single write path |
| R6 | PlanViewerPage still reads plans from sessionStorage (getStoredPlans) | Reads from goalSessionStore.plans. Dead getStoredPlans helper deleted. | sessionStorage removal |
| R7 | SessionState type missing 'loading' and 'ready' values | Added to types.ts. goalSessionStore uses shared SessionState type. | Type alignment |
| R8 | mapServerMessage crashes entire restore on malformed streamParts JSON | Wrapped JSON.parse in try/catch with console.warn | Error resilience |
| R9 | Cross-team goal submission sends to old socket team | handleGoalScreenSubmit always calls connect(teamId) — connect() handles team switch | Cross-team safety |
| R10 | DetailPanel and DevCollabButton receive activePlanId instead of activeGoalId for CRDT scoping | Changed props to pass activeGoalId (server-generated UUID) | Collab doc scoping |
| R11 | URL planId→goalId resolution uses goals list (no planId field) instead of allGoalSummaries (has planId) | restoreTeam resolves from allGoalSummaries first, then falls back to goals | URL resolution |
| R12 | Shared types: TaskUpdate.type only allows 6 values, backend emits more (ask_user, thinking, etc.) | TaskUpdate.type widened to string | Contract alignment |
| R13 | Shared types: DiscussionMentionEvent has userId/mentionedBy but backend emits mentions[] array | Restructured to match actual payload (mentions: string[], taskId) | Contract alignment |
| R14 | 5 pre-existing App.tsx boolean setter TS errors (setIsMobileSidebarOpen, setIsPanelOpen, etc.) | uiStore setters accept `boolean \| ((prev: boolean) => boolean)` | Type correctness |
| R15 | Backend state emissions: 4 of 5 StateResponse objects omit goalId (pending-plan, approve, complete, cancel, auto-execute) | All buildStateResponse calls now pass manager.getCurrentGoalId(). All inline StateResponse objects include goalId. | Goal-scoped backend |

## What Changed — Files

| File | Change |
|------|--------|
| `stores/goalSessionStore.ts` | **New** — unified store (~800 lines) |
| `App.tsx` | Major rewrite — goalSessionStore, no setter aliases, no useEffects for goal sync |
| `components/GoalScreen/PlanList.tsx` | Removed sessionStorage helpers, reads from store |
| `components/PlanViewer/PlanViewerPage.tsx` | Removed getStoredPlans, reads from store |
| `stores/uiStore.ts` | Removed goal fields, fixed setter types, version 3 |
| `services/AgentServiceV2.ts` | Added unsubscribeFromGoal, authFetch error handler, typed Socket |
| `types.ts` | Added 'loading' and 'ready' to SessionState |
| `backend/api/SocketServerV2.ts` | All StateResponse objects include goalId. unsubscribeFromGoal handler. Typed Server. |
| `packages/shared/src/events.ts` | Aligned DiscussionMentionEvent with actual payload |
| `packages/shared/src/tasks.ts` | Widened TaskUpdate.type to string |
| `stores/chatStore.ts` | **Deleted** |
| `stores/orchestrationStore.ts` | **Deleted** |
| `lib/GoalCoordinator.ts` | **Deleted** |

## Design Deviations From Original Plan

1. **Kept keyed chatHistories** — Original plan specified flat `messages: Message[]` with selector-derived views. Implementation keeps `Record<string, Message[]>` keyed by chatKey internally. Reason: ChatArea/StreamMessage components expect messages as array props. Keyed storage is an internal detail; the store is still the single owner.

2. **No standalone selectors** — Original plan specified `usePlannerMessages()`, `useTaskMessages()` as exported hooks. Implementation keeps chat key derivation in App.tsx (simpler, same behavior). Chat key logic is centralized in `sendUserMessage()` for writes.

3. **Backend changes included** — Original plan was frontend-only. Implementation also fixed backend StateResponse goal-scoping and shared type alignment. This was necessary because the frontend guard alone (reject unscoped state) is defense-in-depth, not the primary mechanism.

## Verification

- `bun run --filter @ping/frontend build` — passes
- `bun run --filter @ping/backend build` — passes
- Frontend TypeScript: 20 errors (all pre-existing in unrelated files). Zero in any v2-modified file.
- Zero sessionStorage plan references remain
- Zero imports of deleted files remain
- All 5 backend StateResponse objects carry goalId

## Open Issue — GoalScreen Unreachable After Stale URL Reload

### Problem

When a user reloads the browser on a plan URL (`/teams/{teamId}/p/{planId}`), they land in the empty chat view ("Start a conversation") instead of the GoalScreen. There is no UI element to navigate back to GoalScreen.

### Root Cause

The render condition at App.tsx line 732 determines whether to show GoalScreen:

```typescript
const urlHasPlan = currentPath.includes('/p/');
const showGoalScreen = !urlHasPlan && (currentPath === '/' || currentPath.match(/^\/teams\/[^/]+\/?$/));
```

**The condition uses the browser URL, not loaded state.** If the URL contains `/p/`, `showGoalScreen` is `false` regardless of whether the plan is actually loaded. Since v2 removed `activePlanId` from uiStore persist (correctly — goalSessionStore owns it now), the plan state is `null` on reload. But the browser URL still has `/p/{planId}`.

This creates a dead state: URL says "show plan view", store says "no plan loaded", and there's no GoalScreen to start fresh.

### Why Navigation Back Is Blocked

Three potential escape routes, all blocked:

1. **"← Back to goals"** (Sidebar.tsx line 603) — only renders when `activePlanId && isExpanded`. `activePlanId` is null.
2. **PlanSwitcher "New Goal"** (App.tsx line ~1011) — only renders when `activePlanId` is truthy. `activePlanId` is null.
3. **Team click in sidebar** — calls `handleSelectAgent` which pushes `/teams/{teamId}` or `/teams/{teamId}/p/{planId}`. If `activePlanId` is null, it pushes `/teams/{teamId}` — but `currentPath` might already be `/teams/{teamId}/p/{planId}` and `pushRoute` has a `===` guard.

### Long-Term Fix

**Make the render condition depend on loaded state, not stale URLs.**

The `showGoalScreen` condition should check whether a plan is actually loaded in the store, not whether the URL happens to contain `/p/`:

```typescript
// CURRENT (broken): URL-based — stale URLs bypass GoalScreen
const urlHasPlan = currentPath.includes('/p/');
const showGoalScreen = !urlHasPlan && (currentPath === '/' || currentPath.match(/^\/teams\/[^/]+\/?$/));

// FIX: State-based — GoalScreen shown unless a plan is actively loaded
const showGoalScreen = !activePlanId && (currentPath === '/' || currentPath.match(/^\/teams\/[^/]+/));
```

This is the correct fix because:
- **`activePlanId` is the source of truth** — it's set by `switchGoal()`, `newGoal()`, and `restoreTeam()`. If it's null, no plan is loaded.
- **URL becomes a consequence**, not a cause — `switchGoal()` and `newGoal()` push the URL after setting state. The URL follows the state, not the other way around.
- **Stale URLs are harmless** — if the URL has `/p/` but `activePlanId` is null, GoalScreen renders. When `restoreTeam` resolves the URL's planId and calls `switchGoal`, `activePlanId` is set, re-render shows the plan view.
- **"Back to goals" always works** — `clearGoal()` sets `activePlanId = null` → `showGoalScreen = true` regardless of URL.

Additionally, the "← Back to goals" button in the sidebar should always be visible when a team is selected (not gated on `activePlanId`), as a universal escape hatch:

```typescript
// Sidebar.tsx — always show when team is selected, not just when plan is active
{isExpanded && onBackToGoals && (
  <button onClick={onBackToGoals} ...>← Back to goals</button>
)}
```

### Scope

This is a v2 bug introduced by removing `activePlanId` from uiStore persist without updating the render condition to be state-based instead of URL-based. Fix is 2 lines in App.tsx + 1 line in Sidebar.tsx. **Fixed — see R16 above.**

## Open Issue — Stream Parts Not Rendered After Reload

### Problem

After page reload, completed messages show plain text only — no tool cards, no reasoning sections, no notification chips. This affects all agents (planner, workers, chat agents).

### Root Cause

Two incompatible formats for the `streamParts` field stored in the database:

**What backend saves (Format A — raw accumulator):**
```
tool-call, tool-result, tool-input, tool-output, reasoning
```

**What frontend renders (Format B — RenderedPart[]):**
```
text, tool-card, reasoning (with done:true), notification
```

On restore, `JSON.parse(streamParts)` returns Format A. `StreamMessage` tries to render it as `RenderedPart[]` — unrecognized types are silently skipped.

### Complete Event Coverage Audit

| Stream Event | Backend Accumulates | Frontend RenderedPart | Gap |
|---|---|---|---|
| `text-delta` | `acc.text += delta` (raw string) | `{ type: "text", id, text, done: true }` | No text RenderedPart saved |
| `tool-call` | `{ type: "tool-call", toolCallId, toolName, args }` | — | Wrong type name |
| `tool-result` | `{ type: "tool-result", toolCallId, result }` | — | Should merge into tool-card |
| `tool-input-available` | `{ type: "tool-input", toolCallId, toolName, input }` | `{ type: "tool-card", card: { status: "executing" } }` | Wrong format |
| `tool-output-available` | `{ type: "tool-output", toolCallId, output }` | `{ type: "tool-card", card: { status: "complete" } }` | Wrong format |
| `reasoning-delta` | `{ type: "reasoning", id, text }` | `{ type: "reasoning", id, text, done: true }` | Missing `done` field |
| `task-started/completed/failed` | **Not accumulated** | `{ type: "notification", chip }` | Not saved at all |
| `plan-proposed/approved` | **Not accumulated** | `{ type: "notification", chip }` | Not saved at all |
| `text-start/end` | Not accumulated (lifecycle) | Lifecycle only | OK |
| `tool-input-start/delta` | Not accumulated (streaming args) | Transient | OK |
| `start/finish/error` | Not accumulated (lifecycle) | Lifecycle only | OK |

**6 gaps total:** text, 4 tool types, reasoning done flag, 5 notification types.

### Fix: `toRenderedParts()` Converter

Add a converter at the persistence boundary that transforms raw accumulator parts into the exact `RenderedPart[]` format the frontend renders.

**Where:** `SocketServerV2.ts` — called on `finish` event before `addMessage`.

**Applied to:** Both accumulation sites (worker streams line ~523, chat agent streams line ~1199).

**Logic:**

```typescript
function toRenderedParts(
  accText: string,
  accParts: Array<{ type: string; [key: string]: any }>,
): any[] {
  const rendered: any[] = [];

  // 1. Text part — from accumulated text
  if (accText.trim()) {
    rendered.push({ type: "text", id: `text-0`, text: accText, done: true });
  }

  // 2. Tool cards — merge tool-call/tool-input with matching tool-result/tool-output
  const toolCards = new Map<string, any>(); // keyed by toolCallId
  for (const p of accParts) {
    if (p.type === "tool-call") {
      const card = toolCards.get(p.toolCallId) || { toolCallId: p.toolCallId, toolName: p.toolName, status: "complete", argsText: "" };
      card.args = p.args;
      card.argsText = JSON.stringify(p.args, null, 2);
      toolCards.set(p.toolCallId, card);
    } else if (p.type === "tool-result") {
      const card = toolCards.get(p.toolCallId) || { toolCallId: p.toolCallId, toolName: "unknown", status: "complete", argsText: "" };
      card.result = p.result;
      card.status = "complete";
      toolCards.set(p.toolCallId, card);
    } else if (p.type === "tool-input") {
      const card = toolCards.get(p.toolCallId) || { toolCallId: p.toolCallId, toolName: p.toolName, status: "complete", argsText: "" };
      card.args = p.input;
      card.argsText = JSON.stringify(p.input, null, 2);
      toolCards.set(p.toolCallId, card);
    } else if (p.type === "tool-output") {
      const card = toolCards.get(p.toolCallId) || { toolCallId: p.toolCallId, toolName: "unknown", status: "complete", argsText: "" };
      card.result = p.output;
      card.status = "complete";
      toolCards.set(p.toolCallId, card);
    }
  }
  // Insert tool cards in order they appeared
  for (const card of toolCards.values()) {
    rendered.push({ type: "tool-card", card });
  }

  // 3. Reasoning parts — add done: true
  for (const p of accParts) {
    if (p.type === "reasoning") {
      rendered.push({ type: "reasoning", id: p.id, text: p.text, done: true });
    }
  }

  return rendered;
}
```

**Notification events** (`task-started/completed/failed`, `plan-proposed/approved`) are NOT accumulated in the message accumulator — they flow through separate `onTaskUpdate`/`onPlanUpdate` callbacks and emit directly to the `stream` channel. They are per-task lifecycle events, not per-message content. They should NOT be saved in `streamParts` because:
- They're already represented in the task status (TaskStore)
- On restore, the frontend rebuilds task state from the `tasks` array in the restore response
- Saving them as `notification` RenderedParts would duplicate information

### Backward Compatibility

Existing messages in DB have Format A. The `mapServerMessage` frontend function should also handle Format A parts as a fallback so old messages still render:

```typescript
// In mapServerMessage — after JSON.parse, check if parts need conversion
if (parsedParts?.length > 0 && parsedParts[0]?.type === 'tool-call') {
  // Format A detected — old message, convert on read
  parsedParts = convertLegacyParts(parsedParts, m.content);
}
```

This avoids a one-time migration of all existing messages. New messages save as Format B; old messages convert on read.

### Files Changed

| File | Change |
|------|--------|
| `backend/api/SocketServerV2.ts` | Add `toRenderedParts()`, call at both persistence sites |
| `frontend/stores/goalSessionStore.ts` | Add `convertLegacyParts()` fallback in `mapServerMessage` |

### Testing

1. Submit goal → worker streams with tool calls → reload → tool cards visible
2. Worker with reasoning → reload → reasoning section visible
3. Old messages (Format A in DB) → still render after code update (backward compat)
4. Message with only text (no tool calls) → renders correctly
5. Worker with 10+ tool calls → all cards show after reload

## Open Issue — In-Progress Chats Empty on Reload

### Problem

If a worker is mid-stream and the page reloads, the chat shows nothing. The worker continues executing on the backend, but the frontend has no accumulated state. The message only appears in the DB after the `finish` event fires.

### Industry Research: How AI SDK v6 Solves This

The Vercel AI SDK v6 defines a **three-layer approach** to chat persistence (source: [ai-sdk.dev/docs/ai-sdk-ui](https://ai-sdk.dev/docs/ai-sdk-ui)):

**Layer 1: Message Persistence** (what we partially have)
- Save complete messages (with tool calls) on `onFinish` callback
- Store as `UIMessage[]` — the exact format the UI renders
- Load via `initialMessages` prop or server-side fetch
- Key insight: **save in the UI format, not the raw LLM format** — this is our streamParts Format A vs Format B bug

**Layer 2: Client Disconnect Handling** (`consumeStream`)
- Problem: If client disconnects, backpressure kills the LLM stream on the server
- Fix: `result.consumeStream()` — removes backpressure so the server finishes the generation even if the client disconnects
- Result: The message is always persisted, even on tab close
- Ping equivalent: Our `AiSdkAgent` loop already runs to completion independently of Socket.IO (the agent event generator is consumed by WorkerPool, not by the client). **We already have this layer.**

**Layer 3: Resumable Streams** (`resume` option + Redis)
- Problem: Client reconnects and wants to see the in-progress stream, not wait for completion
- Fix: Server forks the SSE stream into a Redis pub/sub. On reconnect, client GETs a resume endpoint that replays from Redis.
- Architecture:
  ```
  POST /api/chat → streamText → consumeSseStream callback
    → Creates resumable stream in Redis with unique streamId
    → Saves streamId to chat record (activeStreamId)
    → Client reads stream normally

  Page reload → useChat({ resume: true })
    → GET /api/chat/{id}/stream
    → If activeStreamId exists: resumeExistingStream(streamId) from Redis → replay
    → If null: return 204 (no active stream)

  onFinish → saveChat({ activeStreamId: null }) → clears active stream
  ```
- Key components:
  - `resumable-stream` npm package — Redis-backed pub/sub for SSE streams
  - `consumeSseStream` callback — intercepts the outgoing stream, forks to Redis
  - `activeStreamId` field in chat record — tracks which stream is live
  - GET endpoint — reconnects to the Redis-backed stream

### How This Maps to Ping

| AI SDK Layer | Ping Status | What's Needed |
|-------------|-------------|---------------|
| **L1: Message persistence** | Partial — saves raw accumulator format, not RenderedPart format | Fix streamParts to save as RenderedPart[] (the Format A → B fix above) |
| **L2: consumeStream** | Done — WorkerPool consumes the agent generator independently of Socket.IO | Nothing — our architecture already decouples agent execution from client connection |
| **L3: Resumable streams** | Missing | Redis-backed stream fork + resume endpoint + `activeStreamId` per goal |

### Long-Term Fix: Resumable Streams for Ping

Since Ping uses Socket.IO (not SSE), the architecture adapts slightly:

```
CURRENT:
  AiSdkAgent streams → WorkerPool iterates → SocketServerV2 broadcasts via Socket.IO
  Page reload → stream events stop (client disconnected from room)
  Worker finishes → message saved → user reloads again → sees completed message

WITH RESUMABLE STREAMS:
  AiSdkAgent streams → WorkerPool iterates → SocketServerV2 broadcasts via Socket.IO
                                            → ALSO writes each part to Redis stream (keyed by taskId)
                                            → Sets goalSessionStore.activeStreamId = taskId

  Page reload → frontend reconnects Socket.IO → re-subscribes to goal room
             → Checks: any tasks in_progress?
             → For each in-progress task: GET /api/v2/tasks/{taskId}/stream
             → Backend: reads from Redis stream → replays parts → frontend processStreamPart()
             → When worker finishes: Redis stream cleaned up, activeStreamId cleared

  Net effect: Page reload mid-stream → chat resumes from where it left off
```

**Implementation components:**
1. **Redis stream per task** — `XADD ping:stream:{taskId}` on each stream part
2. **activeStreamId on GoalContext** — tracks which tasks are actively streaming
3. **Resume endpoint** — `GET /api/v2/tasks/{taskId}/stream` — reads Redis stream, returns as SSE or Socket.IO replay
4. **Frontend resume logic** — on `restoreTeam()`, check for in-progress tasks, call resume for each
5. **Cleanup** — on `finish` event, delete Redis stream, clear activeStreamId

**This is v3.0 scope** — requires Redis infrastructure + new endpoint + frontend resume logic. Not a patch. The fix for the streamParts format mismatch (Format A → B) is separate and can ship independently.
