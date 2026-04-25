# Chat Agent Layer — Implementation Log

**Status:** Steps 1–4 complete, Step 5 not started

| Step | Version | State | Notes |
|---|---|---|---|
| 1. Registry + read endpoint | v1.0 | ✅ complete | ChatAgent class, TaskStore.onRoleEvent, AgentManager wiring, GET /api/v2/teams/:teamId/roles/:role/tasks, feature flags (FF_ENABLE_CHAT_AGENTS) |
| 2. R1 read-only chat | v1.1 | ✅ complete | AiSdkAgent LLM loop in ChatAgent, 3 read-only tools (get_my_tasks, get_task_detail, get_role_summary), socket routing (chat-{role} agentId), enableChatAgents wired at startup |
| 3. Channel B task updates | v1.2 | ✅ complete | TaskUpdate type (7 variants), WorkerPool synthesizes from stream loop (finish-step, tool-output-available), OrchestratorService routes to ChatAgent.ingestTaskUpdate(), Socket.IO task_update channel, frontend subscription + logs tab |
| 4. ChatAgent dispatches workers | v1.3 | ✅ complete | OrchestratorService.onTaskReady routes through chatAgentDispatch callback, ChatAgent.handleTask() with per-role concurrency (maxConcurrentWorkers=2), mode field (auto/review/manual), directDispatchTask() for actual execution. manualDispatch also routes through ChatAgent. |
| 5. `create_agent_task` tool (upward path) | v1.4 | not started | — |

## Frontend Changes (done alongside Steps 1–3)

| Phase | State | Notes |
|---|---|---|
| Phase 0 — ChatAgent routing | ✅ complete | features.ts, sendToChatAgent in AgentServiceV2, ChatArea routing, useOrchestration chat- prefix handling, separated chat:/worker histories |
| Phase 1 — Sidebar + context bar | ✅ complete | Worker count badge on agent rows, RunningWorkersPanel (3-state: collapsed/compact/full), click task → switch to worker stream, context bar shows task title + status, report_status → Channel B |
| Phase 2 — Channel B timeline | partial | task_update socket subscription, orchestration logs with TASK_UPDATE_LOG map. Timeline entries in main area not yet implemented. |

## Conversation Persistence (Phase 2 — April 24, 2026)

| Step | State | Notes |
|---|---|---|
| agentLayer field + storage | ✅ complete | Added `agentLayer` to ChatMessage type, SQLite schema (with migration), MongoDB schema. `getSessionMessages()` on IChatService. |
| ChatAgent response persistence | ✅ complete | **Critical bug fixed** — was saving stub `"[Chat Agent: role] Response completed"`, now saves actual text + tool calls using messageAccumulator pattern. |
| Session restore endpoint | ✅ complete | `/api/v2/sessions/:teamId/restore` returns per-agent grouped conversations + worker messages. |
| Frontend session restore | ✅ complete | `restoreFromServer()` in useChat — single API call on team select. Server authoritative, localStorage is cache. |
| Agent context injection | ✅ complete | `AiSdkAgent.loadMessages()`, ChatAgent `loadConversation` callback wired through AgentManager to IChatService. |
| Feature flag | ✅ complete | `FF_ENABLE_CONVERSATION_PERSISTENCE` (dev: true, prod: false) |

## Callback Chain Audit (April 24, 2026)

Audited the full callback chain. Found and fixed 5 gaps:

| Gap | Status | Fix |
|---|---|---|
| G1: Bounce → no Channel B | ✅ Fixed | Added `blocked` Channel B event in onBounce handler |
| G2: Replan bypasses TaskStore.updateStatus | ✅ Fixed | Changed to ctx.tasks.updateTaskStatus() |
| G3: Manual dispatch bypasses ChatAgent | ✅ Fixed | manualDispatch routes through chatAgentDispatch |
| G4: onPlanMutation bypasses ChatAgent | ✅ Fixed | Same fix as G3 |
| G5: No role completion summary | ✅ Detected | onMyTaskCompleted checks allDone, logs. Planner notification deferred. |

### Remaining gaps (planned for next iteration):

#### Gap A: `report_status` → Channel B

**Problem:** Worker calls `report_status` tool → `onStatusUpdate` in OrchestratorService → stores `task.lastReportedStatus` → **nothing else**. ChatAgent and frontend never see worker progress/blocked reports.

**Where:** `OrchestratorService.initialize()` → `onStatusUpdate` handler (L163-169)

**Current code:**
```typescript
onStatusUpdate: (data) => {
    const task = this.taskStore.get(data.taskId);
    if (task) { task.lastReportedStatus = data.status; }
},
```

**Fix:** Emit Channel B event based on status:
```typescript
onStatusUpdate: (data) => {
    const task = this.taskStore.get(data.taskId);
    if (task) { task.lastReportedStatus = data.status; }
    // Forward to Channel B
    this.callbacks.onWorkerTaskUpdate?.(data.status === "blocked"
      ? { type: "blocked", taskId: data.taskId, role: data.role, reason: data.summary, ts: Date.now() }
      : { type: "progress", taskId: data.taskId, role: data.role, note: data.summary, pct: data.progress, ts: Date.now() }
    );
},
```

**Risk:** Low — additive. `onWorkerTaskUpdate` already flows to ChatAgent + Socket.IO.  
**Files:** `OrchestratorService.ts` (1 handler, ~5 lines)

---

#### Gap B: `ingestTaskUpdate` reaction logic

**Problem:** `ChatAgent.ingestTaskUpdate()` appends to thread but has **no reaction logic**. Architecture planned: completed → extract to roleContext, failed/blocked → escalate to planner.

**Where:** `ChatAgent.ts` → `ingestTaskUpdate()` (L208-213)

**Current code:**
```typescript
ingestTaskUpdate(update: TaskUpdate): void {
    const thread = this.threads.get(update.taskId) || [];
    thread.push(update);
    this.threads.set(update.taskId, thread);
    log.debug(`[${this.role}] TaskUpdate: ${update.type} for ${update.taskId}`);
}
```

**Fix:** Add `switch(update.type)` with reactions:
```typescript
ingestTaskUpdate(update: TaskUpdate): void {
    const thread = this.threads.get(update.taskId) || [];
    thread.push(update);
    this.threads.set(update.taskId, thread);

    // Reactions
    switch (update.type) {
      case "completed":
        // Promote key outputs to role context (for R1 chat grounding)
        this.roleContext += `\n- ${update.taskId}: ${(update as any).summary?.slice(0, 200) || 'done'}`;
        break;
      case "failed":
      case "blocked":
        log.warn(`[${this.role}] ${update.type}: ${update.taskId}`);
        // Future (Gap D): escalate to planner via onNotifyPlanner callback
        break;
    }
}
```

Requires adding: `private roleContext = "";` field on ChatAgent.

**Risk:** Low — additive.  
**Files:** `ChatAgent.ts` (~15 lines)

---

#### Gap C: Role completion summary to planner

**Problem:** `onMyTaskCompleted()` detects when all tasks for a role are done but doesn't notify the planner. Has `// Future: notify planner` comment.

**Where:** `ChatAgent.ts` → `onMyTaskCompleted()` (L282-296)

**Fix:** Add `onNotifyPlanner` callback to `ChatAgentConfig`, call it when all role tasks are done:

```typescript
// ChatAgentConfig addition:
onNotifyPlanner?: (message: string) => void;

// In onMyTaskCompleted, after allDone detection:
if (allDone) {
    const summary = `Role "${this.role}" completed: ${completed} done, ${failed} failed. ` +
      `Key outputs: ${this.roleContext.slice(-500)}`;
    log.info(`[${this.role}] Sending role summary to planner`);
    this.onNotifyPlanner?.(summary);
}
```

Wire in `AgentManagerV2.getChatAgent()`:
```typescript
onNotifyPlanner: (message) => {
    this.orchestrator?.notifyPlanner(message);
},
```

Requires: making `notifyPlanner` accessible from AgentManager (it's currently private on OrchestratorService — needs a public wrapper or callback).

**Risk:** Medium — planner gets a new message type it hasn't seen before. But it's just a text message via `notifyPlanner`, same format as existing notifications.  
**Files:** `ChatAgent.ts` (~10 lines), `ChatAgentConfig` (1 field), `AgentManagerV2.ts` (~5 lines), `OrchestratorService.ts` (public wrapper, ~3 lines)

---

#### Gap D: Route planner notifications through ChatAgent via Orchestrator

**Problem:** `onTaskFailed()` (L861) and `onBounce()` (L204) notify planner directly. ChatAgent should filter/summarize before passing to planner — but using the same `notifyPlanner` channel, not a separate path.

**Architecture:** ChatAgent uses Orchestrator as the pipe to planner. No new notification paths.

```
BEFORE:
  Worker fails → OrchestratorService.onTaskFailed → notifyPlanner(raw error) → Planner

AFTER:
  Worker fails → ChatAgent.ingestTaskUpdate("failed")
    → ChatAgent summarizes with role context
    → calls onNotifyPlanner(summary)  
    → Orchestrator.notifyPlanner(summary) → same NotificationQueue → Planner

  OrchestratorService.onTaskFailed:
    if (chatAgentDispatch) → skip per-task notifyPlanner (ChatAgent handles it)
    else → notifyPlanner(raw error) (existing fallback)
```

**No duplicate risk:** Conditional routing — only one path fires per event.
**No new paths:** ChatAgent uses `Orchestrator.notifyPlanner()` — same method, same queue.
**Safety net:** When `chatAgentDispatch` is null, existing behavior is unchanged.

**Implementation:**

1. Make `notifyPlanner` accessible — add public wrapper on OrchestratorService:
```typescript
// OrchestratorService.ts — new public method
notifyPlannerFromRole(message: string): void {
    this.notifyPlanner(message);
}
```

2. Add `onNotifyPlanner` callback to ChatAgentConfig:
```typescript
// ChatAgentConfig:
onNotifyPlanner?: (message: string) => void;
```

3. Wire in AgentManagerV2.getChatAgent():
```typescript
onNotifyPlanner: (message) => {
    this.orchestrator?.notifyPlannerFromRole(message);
},
```

4. ChatAgent.ingestTaskUpdate — add reactions:
```typescript
case "completed":
    this.roleContext += `\n- ${update.taskId}: ${(update as any).summary?.slice(0, 200) || 'done'}`;
    break;
case "failed":
case "blocked":
    this.onNotifyPlanner?.(`[${this.role}] ${update.type}: ${update.taskId} — ${(update as any).error || (update as any).reason}`);
    break;
```

5. ChatAgent.onMyTaskCompleted — role summary:
```typescript
if (allDone) {
    this.onNotifyPlanner?.(`Role "${this.role}" completed: ${completed} done, ${failed} failed. Key outputs: ${this.roleContext.slice(-500)}`);
}
```

6. OrchestratorService — conditional skip in onTaskFailed and onBounce:
```typescript
// In onTaskFailed, before notifyPlanner:
if (this.chatAgentDispatch) {
    // ChatAgent.ingestTaskUpdate("failed") already called via Channel B
    // ChatAgent will call notifyPlannerFromRole with role context
    // Skip direct per-task notification to avoid duplicates
} else {
    this.notifyPlanner(...); // existing fallback
}
```

**What stays in OrchestratorService (always fires):**
- `isAllComplete()` aggregate (L705, L729) — team-level, not per-task
- Research phase transitions (L686, L838) — state machine
- `handleTaskFailure()` dependency cascade — DAG logic (no planner notification)
- Agent-created task notification (L176) — creation event

**What ChatAgent replaces (when enabled):**
- Per-task failure notification (L861) → role-contextualized escalation
- Per-bounce notification (L204) → role-contextualized escalation
- Per-role completion summary → new (doesn't exist today)

**Risk:** Low-Medium — conditional routing is clean. Same `notifyPlanner` pipe. Fallback when disabled.  
**Files:** `OrchestratorService.ts` (~10 lines), `ChatAgent.ts` (~20 lines), `AgentManagerV2.ts` (~5 lines)  
**Total across all 4 gaps: ~50 lines**

## ChatAgent R1 Chat — Activity Integration (Decided)

**Design:** No static activity feed in the main area. Activity flows through three existing paths:

| Surface | What It Shows | Source |
|---|---|---|
| **Context bar** (top) | `"backend-dev · 4 done, 2 active  auto"` — compact role status | Task counts from ChatAgentSnapshot |
| **Running Workers Panel** (below header) | Active tasks with progress bars + jump buttons | Tasks filtered by role + status=in_progress |
| **Activity tab** (right panel) | Agent communication events: dispatched, escalated, role completed, user messages | `AgentActivityEvent` via `agent_activity` socket channel (see [agent-activity-system.md](agent-activity-system.md)) |
| **ChatAgent LLM** (via R1 chat) | Answers "what did you build?" using memory + tools | 🔜 Parked — roleContext moving to memory-based approach (not string accumulation) |

**ChatAgent system prompt injection:** 🔜 Parked — moving to memory-based grounding instead of string accumulation.

**Why no static card or activity feed in main area:**
- Running Workers Panel already shows active tasks
- Activity tab (right panel) shows agent-level communication events
- Adding more creates clutter — three panels stacked above chat

## Deviations

1. **Stream part type names**: AiSdkAgent transforms raw AI SDK types (`step-finish` → `finish-step`, `tool-result` → `tool-output-available`). WorkerPool Channel B synthesis needed to match the transformed names, not the raw ones.
2. **Chat history separation**: Added `chat:` key prefix in chatHistories to separate ChatAgent R1 conversations from worker streams. Not in original plan.
3. **RunningWorkersPanel**: Added 3-state panel (collapsed/compact/full) at top of ChatAgent chat — not in original plan, emerged from UX review.

## Lessons Learned

1. **Always check built dist** — source changes don't matter if dist is stale. `bun run build` before testing.
2. **Callback-set pattern** — Socket.IO listeners must be registered inside `setupEventHandlers()`, not ad-hoc via `socket.on()`. The `on()` method can fail if socket isn't connected yet.
3. **Log filtering matters** — DetailPanel Logs tab filters by `l.message.includes(taskId)`. Channel B messages must include taskId in the text to appear.
