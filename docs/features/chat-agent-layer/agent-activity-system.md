# Agent Activity System — Feature Architecture

**Status:** Design  
**Date:** April 24, 2026  
**Parent:** [Chat Agent Layer](../chat-agent-layer/feature_architecture.md)  
**Depends on:** Channel B (Chat Agent Step 3) ✅, ChatAgent dispatch (Step 4) ✅

---

## Problem

The Agent Activity tab in the DetailPanel is empty. When a user clicks an agent and opens the Activity tab, nothing appears.

**Root cause:** No agent-level events are emitted to the frontend. Channel B `task_update` events exist (worker execution) but the Activity tab needs **agent communication events** — what the ChatAgent did, not what workers did internally.

### Two Event Types — Different Tabs

| Tab | Scope | What It Shows | Events |
|---|---|---|---|
| **Logs** | Task-scoped (selected task) | Worker execution details | Channel B `task_update`: tool calls, commits, progress ✅ Working |
| **Activity** | Agent-scoped (selected agent) | Agent communication + decisions | ChatAgent events: dispatched, escalated, responded, role completed ❌ Empty |

---

## Research: What Events Does the ChatAgent Produce?

15 interaction points audited. 8 should appear in the Activity tab:

### Events Already Emitted to Frontend (need routing to Activity tab)

| # | Event | What User Sees | Socket Channel | Currently Shows in Activity? |
|---|---|---|---|---|
| 1 | User sends message to ChatAgent | "👤 User messaged backend-dev" | `stream` (user msg persisted) | ❌ No |
| 2 | ChatAgent responds | "🤖 backend-dev responded" | `stream` (finish part) | ❌ No |
| 3 | Channel B: task started/completed/failed | "⏺ task-1 started", "✅ task-1 completed" | `task_update` | ❌ No — filter broken |

### Events NOT Emitted (internal only — need new emission)

| # | Event | What User Sees | Where It Happens | Why Invisible |
|---|---|---|---|---|
| 4 | ChatAgent escalates task failure to planner | "📤 Escalated task-3 failure to planner" | `ChatAgent.ingestTaskUpdate("failed")` → `onNotifyPlanner` | Goes to planner via NotificationQueue — no frontend emit |
| 5 | ChatAgent reports task blocked to planner | "📤 Reported task-3 blocked to planner" | `ChatAgent.ingestTaskUpdate("blocked")` → `onNotifyPlanner` | Same — internal path |
| 6 | ChatAgent sends role completion summary | "📤 Sent role summary to planner: 3 done, 0 failed" | `ChatAgent.onMyTaskCompleted()` → `onNotifyPlanner` | Same |
| 7 | ChatAgent dispatches worker | "▶ Dispatched worker for task-1" | `ChatAgent.handleTask()` → `spawnWorker()` | No emit — internal dispatch |
| 8 | ChatAgent queues task (concurrency limit) | "⏳ Queued task-5 (2/2 workers active)" | `ChatAgent.handleTask()` → `this.queue.push()` | No emit — internal state |

---

## Design

### New Type: `AgentActivityEvent`

A separate event type for agent-level activities. NOT the same as `TaskUpdate` (which is worker-level).

```typescript
export type AgentActivityEvent = {
  id: string;                    // unique event ID
  role: string;                  // which ChatAgent (e.g. "backend")
  teamId: string;
  ts: number;                    // backend timestamp
  type: AgentActivityType;
  message: string;               // human-readable description
  taskId?: string;               // related task (if applicable)
  meta?: Record<string, any>;    // extra data (summary, error, etc.)
};

export type AgentActivityType =
  | "task_assigned"          // Task became ready for this role
  | "task_dispatched"        // ChatAgent dispatched a worker
  | "task_queued"            // ChatAgent queued task (concurrency limit)
  | "task_completed"         // Worker completed a task for this role
  | "task_failed"            // Worker failed a task for this role
  | "escalated_to_planner"  // ChatAgent notified planner (failure/blocked/summary)
  | "role_completed"         // All tasks for this role are done
  | "user_message"          // User sent a message to this ChatAgent
  | "agent_response";       // ChatAgent finished responding to user
```

### Single Responsibility: Where Events Are Emitted

Each event emitted at exactly one point — the point where the decision/action happens:

| Event | Emitted By | Method |
|---|---|---|
| `task_assigned` | ChatAgent | `onMyTaskReady()` |
| `task_dispatched` | ChatAgent | `spawnWorker()` |
| `task_queued` | ChatAgent | `handleTask()` (concurrency branch) |
| `task_completed` | ChatAgent | `ingestTaskUpdate("completed")` |
| `task_failed` | ChatAgent | `ingestTaskUpdate("failed")` |
| `escalated_to_planner` | ChatAgent | `ingestTaskUpdate("failed"/"blocked")` + `onMyTaskCompleted()` |
| `role_completed` | ChatAgent | `onMyTaskCompleted()` (allDone check) |
| `user_message` | SocketServerV2 | `handleChatAgentMessage()` (before LLM call) |
| `agent_response` | SocketServerV2 | `handleChatAgentMessage()` (on stream finish) |

### Emission Path

```
ChatAgent emits AgentActivityEvent
  → callback: onActivityEvent?(event: AgentActivityEvent)
  → AgentManager routes to streamCallbacks.onAgentActivity
  → SocketServerV2 broadcasts: io.to(room).emit("agent_activity", event)
  → Frontend: AgentServiceV2.onAgentActivity(callback)
  → useOrchestration stores in agentActivities: AgentActivityEvent[]
  → DetailPanel Activity tab: agentActivities.filter(e => e.role === agentRole)
```

### Frontend Storage

```typescript
// useOrchestration:
const [agentActivities, setAgentActivities] = useState<AgentActivityEvent[]>([]);

// subscription:
const unsub = agentServiceV2.onAgentActivity((event) => {
  setAgentActivities(prev => [...prev.slice(-200), event]);
});
```

### Activity Tab Rendering

```
┌──────────────────────────────────────┐
│ BACKEND-DEVELOPER              ✕    │
├──────────────────────────────────────┤
│ Skills │ Activity                    │
├──────────────────────────────────────┤
│                                      │
│ 10:15  📥 Task task-1 assigned       │
│ 10:15  ▶ Dispatched worker for       │
│           task-1                     │
│ 10:18  ✅ task-1 completed           │
│           "DB schema created"        │
│                                      │
│ 10:19  📥 Task task-2 assigned       │
│ 10:19  ▶ Dispatched worker           │
│ 10:22  ✅ task-2 completed           │
│           "Auth endpoints"           │
│                                      │
│ 10:23  👤 User: "What auth library?" │
│ 10:23  🤖 Responded to user          │
│                                      │
│ 10:25  📥 Task task-3 assigned       │
│ 10:25  ⏳ Queued (2/2 active)        │
│ 10:26  ▶ Dispatched worker           │
│ 10:28  ❌ task-3 failed              │
│           "Auth token expired"       │
│ 10:28  📤 Escalated to planner       │
│                                      │
│ 10:30  🎉 Role completed            │
│           "3 done, 1 failed"         │
│ 10:30  📤 Sent summary to planner    │
│                                      │
└──────────────────────────────────────┘
```

Each entry: timestamp + icon + description. Icon map:

| Type | Icon | Color |
|---|---|---|
| `task_assigned` | 📥 | default |
| `task_dispatched` | ▶ | green |
| `task_queued` | ⏳ | amber |
| `task_completed` | ✅ | green |
| `task_failed` | ❌ | red |
| `escalated_to_planner` | 📤 | blue |
| `role_completed` | 🎉 | green |
| `user_message` | 👤 | default |
| `agent_response` | 🤖 | default |

---

## SOLID Analysis

| Principle | How It's Applied |
|---|---|
| **S** (Single Responsibility) | `AgentActivityEvent` is only for agent communication. `TaskUpdate` stays for worker execution. Two types, two tabs. |
| **O** (Open/Closed) | New event types can be added to `AgentActivityType` union without changing existing code. `ActivityFeed` component renders any type via icon map. |
| **L** (Liskov) | `AgentActivityEvent` doesn't substitute for `TaskUpdate` — they serve different purposes. No inheritance relationship. |
| **I** (Interface Segregation) | `onActivityEvent` callback is separate from `onWorkerTaskUpdate`. Consumers subscribe to what they need. |
| **D** (Dependency Inversion) | ChatAgent emits via callback (`onActivityEvent`), not direct Socket.IO coupling. AgentManager wires the callback. |

---

## Implementation Plan

### Step 1: Define types

**Files:** `packages/agent-manager/src/types/AgentActivityEvent.ts` (NEW), `packages/frontend/types.ts`  
**Change:** `AgentActivityEvent` type + `AgentActivityType` union  
**Lines:** ~20 (backend) + ~20 (frontend)

### Step 2: Add `onActivityEvent` callback to ChatAgent

**Files:** `ChatAgent.ts`, `ChatAgentConfig`  
**Change:** New callback in config, emit at each interaction point (9 emit sites)  
**Lines:** ~25

### Step 3: Wire through AgentManager → Socket.IO

**Files:** `AgentManagerV2.ts` (ManagerStreamCallbacks), `SocketServerV2.ts`  
**Change:** New `onAgentActivity` callback, new `agent_activity` Socket.IO event  
**Lines:** ~15

### Step 4: Frontend subscription + state

**Files:** `AgentServiceV2.ts`, `useOrchestration.ts`  
**Change:** `agentActivityCallbacks` Set, `agentActivities` state, `onAgentActivity` method  
**Lines:** ~20

### Step 5: `ActivityFeed` component

**Files:** `packages/frontend/components/DetailPanel/ActivityFeed.tsx` (NEW)  
**Change:** Renders `AgentActivityEvent[]` as timeline with icon map  
**Lines:** ~60

### Step 6: Wire into DetailPanel

**Files:** `DetailPanel.tsx`, `App.tsx`  
**Change:** Replace broken `EventsView` with `ActivityFeed`, pass `agentActivities` prop  
**Lines:** ~10

---

## What's NOT Changing

- `TaskUpdate` type — unchanged (stays for Logs tab)
- Channel B emission (WorkerPool → Socket.IO `task_update`) — unchanged
- `OrchestrationEvent` — kept for legacy global logs
- ChatAgent `ingestTaskUpdate()` — keeps Channel B ingestion, ALSO emits activity events
- `EventsView` component — kept for plan-level activity (existing behavior)

## Estimated Effort

~170 lines across 7 files + 1 new component. Backend: ~60 lines. Frontend: ~110 lines.
