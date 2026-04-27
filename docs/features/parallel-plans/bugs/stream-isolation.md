# Parallel Plans — Stream & Chat Isolation Bugs

> **Status:** 6 fixed (Phase 4.5 + April 27)  
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
| **P1** | PP-005 | ✅ Fixed (April 27) | Task-scoped chat keys | 0.5d |
| **P1** | PP-006 | ✅ Fixed (April 27) | Goal-scoped localStorage + useEffect dep fix | 0.5d |

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

---

## Suggested Fixes (Detailed)

### PP-005 Fix: Task-Scoped Chat Keys

**Problem:** `chatHistories["agent-xyz"]` accumulates messages from T-001, T-002, T-004 — all tasks assigned to the same agent.

**Fix:** When a worker stream arrives with a `taskId`, use a composite key. When viewing a specific task, filter to that task's messages.

**1. useOrchestration.ts** — extract taskId from stream payload:

```typescript
// In subscribeToTeam → onStream handler (line ~270)
// BEFORE:
onStreamPart(targetAgentId, part);

// AFTER:
const streamTaskId = payload.taskId;  // Backend already includes taskId in stream payload
onStreamPart(targetAgentId, part, streamTaskId);
```

**2. useChat.ts** — use composite key when taskId is provided:

```typescript
// processStreamPart signature change:
processStreamPart(agentId: string, part: StreamPart, taskId?: string)

// Key computation:
const chatKey = taskId ? `${agentId}:task:${taskId}` : agentId;
// Then use chatKey instead of agentId for chatHistories lookup
```

**3. App.tsx** — when user selects a task, show that task's messages:

```typescript
// Line ~497 — chatKey computation
// BEFORE:
const chatKey = isChatAgent && !selectedTaskId ? `chat:${activeAgentId}` : activeAgentId;

// AFTER:
const chatKey = isChatAgent && !selectedTaskId
  ? `chat:${activeAgentId}`
  : selectedTaskId
    ? `${activeAgentId}:task:${selectedTaskId}`  // Task-scoped messages
    : activeAgentId;                              // Agent-scoped (all tasks)
```

**Backward compatible:** When no `taskId` in stream (planner, ChatAgent), key stays `agentId`. Only worker streams get task-scoped keys.

### PP-006 Fix: Goal-Scoped localStorage + useEffect Dependency

**Problem A:** localStorage key `ping:chatHistories` is global — new tabs load all teams/goals.

**Fix A:** Scope localStorage to team + goal:

```typescript
// useChat.ts — line ~24
// BEFORE:
const stored = localStorage.getItem('ping:chatHistories');

// AFTER:
const storageKey = teamId
  ? `ping:chat:${teamId}${goalId ? `:${goalId}` : ''}`
  : 'ping:chatHistories';  // fallback for pre-login state
const stored = localStorage.getItem(storageKey);
```

**Problem B:** `activePlanGoalId` not in useEffect dependency array — goal switch doesn't trigger restore.

**Fix B:** Add to dependencies:

```typescript
// App.tsx — line ~344
// BEFORE:
}, [selectedTeamId, agents, loadAgentChat, restoreFromServer, setCurrentPlan, setSessionState]);

// AFTER:
}, [selectedTeamId, agents, activePlanGoalId, loadAgentChat, restoreFromServer, setCurrentPlan, setSessionState]);
```

**Problem C:** Old goal's messages persist after switch.

**Fix C:** Clear chatHistories for the team before restoring:

```typescript
// In the restore useEffect:
useEffect(() => {
  if (!selectedTeamId) return;

  // Clear stale messages before restoring new goal
  clearTeamHistories(selectedTeamId);

  restoreFromServer(selectedTeamId, subAgents, activePlanGoalId)
    .then((result) => { ... });
}, [selectedTeamId, agents, activePlanGoalId, ...]);
```

Add `clearTeamHistories` to useChat:

```typescript
const clearTeamHistories = useCallback((teamId: string) => {
  setChatHistories(prev => {
    const next = { ...prev };
    // Clear team-level and all agent-level entries
    delete next[teamId];
    // Also clear agent entries (could be more targeted)
    return next;
  });
}, []);
```

---

## Architecture Comparison: Frontend Chat

Research conducted April 27, 2026 comparing AI SDK v6 (Vercel), CopilotKit, and OpenHands patterns.

### What's Correct (No Refactor Needed)

| Component | Industry Pattern | Our Implementation | Assessment |
|---|---|---|---|
| **Custom useChat hook** | AI SDK: `useChat({ id })` per chat | Custom hook with `chatHistories[key]` | ✅ Correct — AI SDK's `useChat` is HTTP-only, can't handle Socket.IO server-push |
| **Stream protocol** | AI SDK v6: `message.parts[]` (text, tool-card, reasoning) | `RenderedPart[]` (text, tool-card, reasoning, notification) | ✅ Equivalent pattern, correct naming |
| **Socket.IO transport** | AI SDK: SSE/HTTP | Socket.IO for server-push multi-agent | ✅ Correct — server needs to push from N agents independently |
| **Goal-scoped filtering** | Not in AI SDK (single-chat) | `useOrchestration` filters by goalId | ✅ Necessary for multi-goal, correctly implemented |
| **Immutable state updates** | React best practice | All `setChatHistories` are immutable | ✅ StrictMode safe |
| **Plugin-based tool injection** | AI SDK: tools per-route | Plugin system with ToolContext | ✅ Better for dynamic multi-agent |

### What Needs Fixing (Bug Fixes, Not Refactors)

| Issue | Fix | Effort |
|---|---|---|
| PP-005: taskId not in chat key | Composite key `${agentId}:task:${taskId}` | 0.5d |
| PP-006: Global localStorage | Scope to `ping:chat:${teamId}:${goalId}` | 0.5d |
| PP-006: Missing useEffect dep | Add `activePlanGoalId` to dependency array | 5 min |

### What Could Improve Later (Not Blocking)

| Improvement | AI SDK Pattern | Priority |
|---|---|---|
| Message metadata (`agentId`, `goalId`, `model`) | `message.metadata` in AI SDK v6 | Low — works via key-based routing |
| Stream throttling | `experimental_throttle: 50` in AI SDK v6 | Low — useful for perf at scale |
| Message persistence | AI SDK recommends server-side per chatId | Low — localStorage + restore works |

---

## Architecture Comparison: RepoUrl in Plan Pipeline

Research conducted April 27, 2026 comparing how other platforms handle workspace/repo configuration.

### How Others Handle Repo Config

| Platform | How Repo is Configured | Workspace Strategy |
|---|---|---|
| **OpenHands** | Mount via `SANDBOX_VOLUMES=$PWD:/workspace:rw` or `--mount-cwd` | Single workspace mounted into Docker container. No per-task isolation. |
| **OpenHands GitHub Action** | Auto-detects from GitHub event context (repo URL, branch, PR) | Clones repo inside sandbox automatically. `TARGET_BRANCH` configurable via repo variable. |
| **Devin** | User provides repo URL in chat. Devin clones into ephemeral VM. | Per-session cloud VM with full git clone. |
| **Claude Code** | Works in current directory (no config needed) | User's local filesystem. No isolation. |
| **Cursor** | Works in current project | User's local filesystem. No isolation. |
| **SWE-Agent** | `--repo` CLI arg or GitHub issue context | Clones into Docker container per task. |

### Our Approach vs Industry

| Aspect | Industry | Our v2.0 Plan | Assessment |
|---|---|---|---|
| **Repo URL source** | CLI arg (SWE-Agent), env var (OpenHands), chat (Devin), auto-detect (GH Action) | **Frontend form input** → plan schema → task context → workspace | ✅ Most flexible — supports all sources |
| **Where repo flows** | Config → container mount (OpenHands), Config → clone inside sandbox (SWE-Agent) | **Plan → Task → ToolContext → WorkspacePlugin → WorkspaceManager** | ✅ Clean pipeline through plugin system |
| **Per-task isolation** | OpenHands: single workspace. SWE-Agent: per-task container. Devin: per-session VM. | **Per-task worktree (shared .git)** | ✅ Best balance — isolation without full clone overhead |
| **Auth for private repos** | OpenHands: `GITHUB_TOKEN` env. SWE-Agent: `--token` CLI. | **GitHub OAuth token from account table → injected into clone URL** | ✅ Most secure — user doesn't handle tokens manually |
| **Push on completion** | OpenHands GH Action: auto-creates PR. SWE-Agent: creates PR. | **Push task branch to remote → cleanup plan dir** | ✅ Same pattern |

### Assessment: No Refactor Needed for RepoUrl

The v2.0 plan for threading `repoUrl` through the pipeline is architecturally sound:

1. **SubmitPlanSchema** getting `repoUrl` — same as SWE-Agent's `--repo` or Devin's chat-based repo selection. Every platform needs this somewhere.

2. **ToolContext** carrying `repoUrl` — this is the existing contract between WorkerPool and plugins. Adding 2 fields is additive, not a refactor. OpenHands uses env vars (`SANDBOX_VOLUMES`), we use the plugin context — both are correct for their architecture.

3. **WorkspaceManager per-task basePath** — this is where the actual work happens. The code change (isolated mode vs shared mode) is a clean branch in `createWorkspace()`. No existing behavior changes when `repoUrl` is absent.

4. **Worktree optimization** — unique to our multi-task model. OpenHands doesn't need this (single workspace). SWE-Agent does full container per task (heavier). Our worktree approach is more efficient.

**Conclusion:** The pipeline `Plan → Task context → ToolContext → WorkspacePlugin → WorkspaceManager` is the correct architecture. It follows the existing plugin contract, doesn't require refactoring any existing interfaces, and matches industry patterns where repo config flows from user input to workspace creation.
