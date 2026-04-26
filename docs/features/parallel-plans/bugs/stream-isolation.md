# Parallel Plans — Stream & Chat Isolation Bugs

> **Status:** 4 fixed (Phase 4.5), 2 open  
> **Discovered:** April 25-27, 2026  
> **Phase:** Parallel Plans v1.1 / v2.0  
> **Severity:** High — multi-goal and multi-task UX affected

## Problem

When two browsers (or one browser switching goals) view different goals on the same team, ALL stream events from the planner/workers render in BOTH views. Chat conversations, task updates, and progress events have no goalId — the frontend can't distinguish which goal they belong to.

## Root Cause

Stream events flow through 5 layers, and **goalId is available at the source but lost in transit**:

```
WorkerPool.runTask()          ← HAS this.currentGoalId
  ↓ onStream({ taskId, agentId, part })   ← goalId NOT included
OrchestratorService           ← pass-through, no enrichment
  ↓ callbacks.onStream(data)
AgentManagerV2                ← HAS getCurrentGoalId(), NOT used
  ↓ streamCallbacks.onStream(data)
SocketServerV2                ← emits to team room (ALL clients)
  ↓ socket.emit("stream", { teamId, agentId, part })   ← NO goalId
Frontend useOrchestration     ← routes by agentId only, no goal filter
  ↓ onStreamPart(agentId, part)
```

## Bug Details

### BUG-PP-001: Stream events lack goalId

**Location:** 3 injection points needed

**WorkerPool.ts (~line 375):**
```typescript
// CURRENT:
this.callbacks.onStream?.({ taskId, agentId: roleKey, part: event.part });

// FIX:
this.callbacks.onStream?.({ taskId, agentId: roleKey, part: event.part, goalId: this.currentGoalId || undefined });
```

**SocketServerV2.ts — ensureTeamCallbacks (~line 432):**
```typescript
// CURRENT:
onStream: (data) => {
  this.io.to(room).emit("stream", {
    teamId, agentId: data.agentId, sessionId: `team-${teamId}`, part: data.part,
  });
}

// FIX:
onStream: (data) => {
  this.io.to(room).emit("stream", {
    teamId, agentId: data.agentId, sessionId: `team-${teamId}`, part: data.part,
    goalId: data.goalId || manager.getCurrentGoalId() || undefined,
  });
}
```

**SocketServerV2.ts — handleOrchestratorMessage (~line 962):**
Planner stream events also need goalId — same pattern.

**SocketServerV2.ts — handleChatAgentMessage (~line 1030):**
```typescript
// CURRENT:
socket.emit("stream", { teamId, agentId, sessionId, part: event.part });

// FIX:
socket.emit("stream", { teamId, agentId, sessionId, part: event.part,
  goalId: manager.getCurrentGoalId() || undefined,
});
```

**Type change — WorkerCallbacks interface (WorkerPool.ts ~line 13):**
```typescript
onStream?: (data: { taskId: string; agentId: string; part: any; goalId?: string }) => void;
```

**Effort:** 0.5 day

---

### BUG-PP-002: Frontend doesn't filter streams by goalId

**Location:** `useOrchestration.ts` — `onStream` handler

```typescript
// CURRENT (line ~225):
const unsubStream = agentServiceV2.onStream((payload: any) => {
  if (!payload?.part) return;
  const { part, agentId: streamAgentId } = payload;
  // ... routes by agentId, no goalId check

// FIX:
const unsubStream = agentServiceV2.onStream((payload: any) => {
  if (!payload?.part) return;
  const { part, agentId: streamAgentId, goalId: streamGoalId } = payload;

  // When viewing a specific goal, ignore streams from other goals
  if (streamGoalId && activePlanGoalIdRef.current && streamGoalId !== activePlanGoalIdRef.current) {
    return; // Skip — this stream belongs to a different goal
  }
  // ... rest of routing
```

**Dependency:** Requires BUG-PP-001 (goalId in payload)

**New state needed:** `activePlanGoalIdRef` — a ref tracking the currently viewed goalId, updated when `onSelectPlan` fires.

**Effort:** 0.5 day

---

### BUG-PP-003: Single planner serves all goals

**Location:** `AgentManagerV2.ts`

**Current:** Single `PlannerAgent` instance per team. All goals share it. When goal-2 starts planning, its messages appear in goal-1's conversation.

**Long-term fix:** Per-goal planner Map (partially implemented in v1.1 Step 4 — but fallback to single planner means first goal always shares).

```typescript
// CURRENT:
private plannerAgent: PlannerAgent | null = null;
private planners = new Map<string, PlannerAgent>();

const executePlannerTurn = async (message: string) => {
  const goalId = this.orchestrator?.getCurrentGoalId() || "default";
  let planner = this.planners.get(goalId) || this.plannerAgent;  // ← fallback shares!

// FIX: Create NEW planner for each goal, never share:
const executePlannerTurn = async (message: string) => {
  const goalId = this.orchestrator?.getCurrentGoalId() || "default";
  let planner = this.planners.get(goalId);
  if (!planner) {
    // Create a fresh planner for this goal
    planner = new PlannerAgent({ agentFactory, teamRoles, teamId });
    await planner.initialize();
    // Wire tools with goal-scoped orchestratorContext
    const goalContext = { ...orchestratorContext, currentGoalId: goalId };
    planner.setTools(createOrchestratorTools(goalContext));
    this.planners.set(goalId, planner);
  }
  const agent = planner.getAgent();
  const goalSessionId = `team-${teamId}:goal-${goalId}`;
  for await (const event of agent.execute({ message, threadId: goalSessionId })) { ... }
```

**Complexity:** Medium — PlannerAgent initialization involves tool wiring with `orchestratorContext`. Need to ensure each planner gets goal-scoped context.

**Effort:** 1 day

---

### BUG-PP-004: Socket.IO room is team-scoped, not goal-scoped

**Location:** `SocketServerV2.ts` — `joinTeamRoom`

**Current:** `socket.join(team:${teamId})` — all clients on same team get all events.

**Short-term fix (via PP-001 + PP-002):** goalId on events + frontend filter. Works for v1.1.

**Long-term fix (v2.0+):** Goal-scoped rooms.

```typescript
// When user selects a goal:
socket.join(`team:${teamId}:goal:${goalId}`);
socket.leave(`team:${teamId}:goal:${previousGoalId}`);

// Stream events emit to goal room:
this.io.to(`team:${teamId}:goal:${goalId}`).emit("stream", payload);

// Team-wide events (goal:stateChange) still go to team room:
this.io.to(`team:${teamId}`).emit("goal:stateChange", payload);
```

**Why defer:** Requires frontend to manage room subscriptions per goal. More complex than client-side filtering. Only needed at scale (many goals, many clients).

**Effort:** 1.5 days

---

## Implementation Order

| Priority | Bug | Status | Fix | Effort |
|----------|-----|--------|-----|--------|
| **P0** | PP-001 | ✅ Fixed (Phase 4.5) | goalId on stream events | 0.5d |
| **P0** | PP-002 | ✅ Fixed (Phase 4.5) | Frontend filters by goalId | 0.5d |
| **P1** | PP-003 | ✅ Fixed (Phase 4.5) | Per-goal planner instances | 1d |
| **P2** | PP-004 | ✅ Fixed (Phase 4.5) | Goal-scoped Socket.IO rooms | 1.5d |
| **P1** | PP-005 | 🔴 Open | Task-scoped chat keys | 0.5d |
| **P1** | PP-006 | 🔴 Open | Goal-scoped localStorage + useEffect dep fix | 0.5d |

**PP-001 + PP-002 together (1 day)** unblock multi-goal viewing. After that, both browsers show only their selected goal's content.

**PP-003 (1 day)** is needed when users want to plan two goals concurrently. Without it, the single planner interleaves conversations.

**PP-004 (1.5 days)** is a scalability optimization — defer to v2.0.

## Files Changed

| Bug | Backend Files | Frontend Files |
|-----|---------------|----------------|
| PP-001 | WorkerPool.ts (type + emit), OrchestratorService.ts (pass-through), SocketServerV2.ts (3 emit sites) | — |
| PP-002 | — | useOrchestration.ts (filter + ref), App.tsx (pass goalId ref) |
| PP-003 | AgentManagerV2.ts (planner Map, create per goal, tool wiring) | — |
| PP-004 | SocketServerV2.ts (room management, emit targets) | AgentServiceV2.ts (join/leave goal rooms) |
| PP-005 | — | useOrchestration.ts, useChat.ts, App.tsx |
| PP-006 | — | useChat.ts, App.tsx |

---

### BUG-PP-005: Multiple tasks from same agent land on same chat

**Status:** Open  
**Severity:** High  
**Discovered:** April 27, 2026

**Symptom:** When Backend Dev works on T-001 then T-004, both task streams accumulate in the same chat view. User cannot distinguish which output belongs to which task.

**Root Cause:** Chat key is `chatHistories[agentId]` with no taskId component. Stream routing in `useOrchestration.ts` line ~270 passes only `agentId` to `processStreamPart()`, ignoring `taskId` from the payload. Chat storage in `useChat.ts` uses `agentId` as the sole key. App.tsx line ~497 computes `chatKey` from `activeAgentId` only.

**Fix Type:** `fix` (permanent)

**Changes needed:**
- `useOrchestration.ts`: Extract `taskId` from stream payload, pass to `onStreamPart(agentId, part, taskId)`
- `useChat.ts`: When `taskId` is provided, use composite key `${agentId}:task:${taskId}` for `chatHistories`
- `App.tsx`: When `selectedTaskId` is set, compute `chatKey` as `${activeAgentId}:task:${selectedTaskId}` to show task-scoped messages

**Verification:** Start plan with 2+ tasks assigned to same agent. Each task's stream should appear in its own chat view. Clicking task in sidebar → shows only that task's messages.

**Effort:** 0.5 day

---

### BUG-PP-006: New browser session loads stale agent manager chat

**Status:** Open  
**Severity:** High  
**Discovered:** April 27, 2026

**Symptom:** Opening a new browser tab shows old planner messages from a previous goal. Refresh fixes it because `restoreFromServer` runs on mount, but subsequent goal switches don't trigger a refresh.

**Root Cause:** Two issues:
1. localStorage key is global (`ping:chatHistories`) — no teamId or goalId scoping. All teams/goals share one cache. New tab loads everything.
2. `activePlanGoalId` is missing from the `useEffect` dependency array in App.tsx line ~344. When user switches goals, `restoreFromServer` never re-runs with the new goalId. Old goal's messages persist in `chatHistories`.

**Fix Type:** `fix` (permanent)

**Changes needed:**
- `useChat.ts` line ~24: Scope localStorage key to team: `ping:chatHistories:${teamId}` (or clear on team switch)
- `App.tsx` line ~344: Add `activePlanGoalId` to the useEffect dependency array so `restoreFromServer` re-runs on goal switch
- `useChat.ts`: On goal switch, clear `chatHistories` for the team before restoring new goal's messages (prevents mixing)

**Verification:** Open two browser tabs viewing different goals. Each should show only its goal's messages. Switch goals in same tab → chat should refresh with new goal's history.
