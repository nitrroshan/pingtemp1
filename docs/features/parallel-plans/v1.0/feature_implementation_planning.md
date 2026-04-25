# Parallel Plans v1.0 — GoalContext + Serial Execution Queue

> **Parent:** [feature_architecture.md](../feature_architecture.md) — Option C (Hybrid), upgrading to Option A  
> **Status:** Planning — re-audited April 25, 2026 (post Phase 3.5)  
> **Branch:** `feature/parallel-plans-v1.0`  
> **Phase:** 4 in the [cross-feature roadmap](../feature_architecture.md#cross-feature-dependency-map)  
> **Depends on:** Chat Agent Layer (Phase 1 ✅), Conversation Persistence (Phase 2 ✅), Git Task Context (Phase 3 ✅), GoalManager Extraction (A12 ✅)  
> **Blocks:** v2.0 (workspace isolation), v3.0 (full parallel execution)  
> **FF Flag:** `FF_PARALLEL_PLANS`

## What Phase 3 + 3.5 Already Built

| Component | Status | Notes |
|-----------|--------|-------|
| `goalId`/`planId` on Task type | ✅ | Top-level optional fields |
| `TaskStore.getByGoal()` / `getByPlan()` / `isAllCompleteForGoal()` | ✅ | Goal-scoped queries |
| Goal-scoped branch naming (`goal-{goalId}/task-{taskId}`) | ✅ | WorkspaceManager |
| `goalId`/`planId` on ToolContext | ✅ | Pipeline wiring complete |
| CRDT proxy `resolveForGoal(goalId)` | ✅ | Lazy per-goal resolution |
| `FilePlanStore` scoped by `{teamId}/{goalId}/{planId}` | ✅ | Already goal-scoped |
| Merge conflict → resolution task | ✅ | Auto-creates task |
| **GoalManager extracted from OrchestratorService** | ✅ | 687 lines, owns lifecycle |
| **OrchestratorService owns only dispatch/comms** | ✅ | 855 lines, delegates via callbacks |
| **GoalManagerCallbacks interface** | ✅ | Clean separation |

## What's Left for Phase 4

### GoalManager (scalar → Map)

GoalManager currently holds 3 scalar fields:
```typescript
private state: OrchestratorState = "idle";
private currentGoalId: string | null = null;
private pendingPlan: any = null;
```

These become `Map<goalId, GoalContext>`. All existing methods in GoalManager already derive `goalId` from `toGoalId()` or `task.goalId` — the Map lookup replaces the scalar read.

### OrchestratorService (dispatch tracking per goal)

OrchestratorService has dispatch-tracking fields that should be per-goal for v3.0 (full parallel) but can stay **global for v1.0** since only one goal executes at a time:

```typescript
private activeDispatches = new Set<string>();      // global OK for v1.0 (serial execution)
private deferredDispatches: Array<...> = [];       // global OK for v1.0
private taskAttempts = new Map<string, number>();   // global OK (keyed by taskId, unique across goals)
private messageChain: Promise<string> = ...;        // stays global (serializes all user input)
```

**Decision:** These stay global for v1.0. Only GoalManager changes. OrchestratorService **does not change** for Phase 4.

### Message Flow: goalId Is Implicit

User message → planner → `submit_plan` tool → `approvePlan()` → `toGoalId(plan.goal)` → goalId derived.

For v1.0, `handleMessage(content)` stays as-is (no `goalId` param). The active goal is determined by the planner's plan submission, not the user's message. When the user submits a second goal while one is executing, the planner creates a new plan → `approvePlan()` detects another goal is executing → queues it.

**Frontend goalId routing is needed for v1.1+** (when user explicitly switches goal context in sidebar and wants to talk to a specific goal's planner).

## Scope (Revised)

**Includes:**
- `GoalContext` type in types.ts
- `Map<goalId, GoalContext>` in GoalManager (replaces 3 scalars)
- `TaskStore.clearByGoal()` + `WorkerPool.disposeByGoal()`
- `queued` state + execution mutex + auto-advance
- Per-goal ChatAgent lifecycle (`${goalId}:${role}` key)
- Socket.IO `goal:stateChange` event
- Frontend goal switcher in sidebar

**Deferred to v1.1:**
- `handleMessage(content, goalId)` — goalId routing in messages
- Per-goal planner instances (single planner with context switch works for v1.0)
- Frontend unified cross-team view ("My Goals")
- Frontend per-goal chat history separation

**Excludes:**
- Workspace isolation (v2.0)
- True parallel execution (v3.0)

## Key Architecture Decisions

### Decision 1: Single Planner, Context-Switching (v1.0)

**Revised from previous plan** (which said per-goal planner).

For v1.0 with serial execution, one planner is sufficient:
- Only one goal executes at a time
- User messages always go to the team's single planner
- When planner creates a plan, `approvePlan()` determines the goalId
- Planner context includes: "You have N goals: [status list]"

Per-goal planners are deferred to v1.1 when we need concurrent planning.

### Decision 2: Per-Goal ChatAgents (unchanged)

Same as before — `Map<${goalId}:${role}, ChatAgent>`. Clean isolation per goal.

## Implementation Steps

### Step 1: GoalContext type + `queued` state (0.5 day)

**Files:** `packages/agent-manager/src/orchestrator/types.ts`

```typescript
export type OrchestratorState =
  | "idle" | "gathering" | "researching"
  | "awaiting_approval" | "executing"
  | "queued"    // NEW — approved but another goal is executing
  | "done";     // NEW — all tasks completed

export interface GoalContext {
  goalId: string;
  state: OrchestratorState;
  pendingPlan: any | null;
  currentPlanId: string | null;
  title: string;
  createdAt: number;
}
```

Note: `GoalContext` is minimal. Dispatch concerns (`activeDispatches`, `deferredDispatches`, `messageChain`) stay in OrchestratorService globally for v1.0.

### Step 2: TaskStore.clearByGoal + WorkerPool.disposeByGoal (0.5 day)

**Files:**
- `packages/agent-manager/src/orchestrator/TaskStore.ts`:
  ```typescript
  clearByGoal(goalId: string): void {
    for (const task of this.getByGoal(goalId)) {
      this.remove(task.id);
    }
  }
  ```
- `packages/agent-manager/src/services/WorkerPool.ts`:
  ```typescript
  async disposeByGoal(goalId: string, taskStore: TaskStore): Promise<void> {
    for (const task of taskStore.getByGoal(goalId)) {
      const worker = this.workers.get(task.id);
      if (worker) { worker.abort(); this.workers.delete(task.id); }
    }
  }
  ```

### Step 3: GoalManager scalar → Map (2 days)

**Files:** `packages/agent-manager/src/orchestrator/GoalManager.ts` ONLY

**3a. Replace scalars with Map:**
```typescript
// BEFORE:
private state: OrchestratorState = "idle";
private currentGoalId: string | null = null;
private pendingPlan: any = null;

// AFTER:
private goals = new Map<string, GoalContext>();
private activeGoalId: string | null = null;
```

**3b. Add helper methods:**
```typescript
private getOrCreateGoal(goalId: string, title?: string): GoalContext {
  let goal = this.goals.get(goalId);
  if (!goal) {
    if (!process.env.FF_PARALLEL_PLANS && this.goals.size >= 1) {
      // Single-goal mode: clear existing goal
      this.goals.clear();
    }
    goal = { goalId, state: "idle", pendingPlan: null, currentPlanId: null,
             title: title || goalId, createdAt: Date.now() };
    this.goals.set(goalId, goal);
  }
  return goal;
}

getExecutingGoal(): GoalContext | undefined {
  for (const g of this.goals.values()) if (g.state === "executing") return g;
  return undefined;
}

getGoalForTask(taskId: string): GoalContext | undefined {
  const task = this.taskStore.get(taskId);
  return task?.goalId ? this.goals.get(task.goalId) : undefined;
}

getAllGoalSummaries(): GoalSummary[] {
  return Array.from(this.goals.values()).map(g => ({
    goalId: g.goalId, title: g.title, state: g.state,
    taskCount: this.taskStore.getByGoal(g.goalId).length,
    completedCount: this.taskStore.getByGoal(g.goalId).filter(t => t.status === "completed").length,
    planId: g.currentPlanId || undefined, createdAt: g.createdAt,
  }));
}
```

**3c. Update existing methods to use Map:**

Every method that reads `this.state` / `this.currentGoalId` / `this.pendingPlan` now looks up by goalId:

- `approvePlan()`: already derives `goalId` via `toGoalId()` → `getOrCreateGoal(goalId)`
- `getState()` / `setState()`: use `activeGoalId` to find current goal
- `getPendingPlan()` / `setPendingPlan()`: need goalId param or use activeGoalId
- `onTaskComplete()`: use `task.goalId` → `getGoalForTask()` → check `isAllCompleteForGoal()`
- `onWorkerDone()`: use `this.activeGoalId` for plugin notify
- `loadActivePlan()`: restores goals into Map instead of scalar
- `reset()`: clears all goals or specific goal

**3d. Update `approvePlan()` for execution mutex:**
```typescript
// In approvePlan(), after creating tasks:
const executing = this.getExecutingGoal();
if (executing && executing.goalId !== goalId) {
  goal.state = "queued";  // Another goal is running — queue this one
} else {
  goal.state = "executing";
  this.activeGoalId = goalId;
}
```

**3e. Update `approvePlan()` — goal-scoped clearing:**
```typescript
// BEFORE:
await this.workerPool.disposeAll();
this.taskStore.clear();

// AFTER:
await this.workerPool.disposeByGoal(goalId, this.taskStore);
this.taskStore.clearByGoal(goalId);
```

### Step 4: Execution mutex + auto-advance (0.5 day)

**Files:** `packages/agent-manager/src/orchestrator/GoalManager.ts`

In `onTaskComplete()`, when all tasks for a goal are done:
```typescript
if (this.taskStore.isAllCompleteForGoal(goalId)) {
  goal.state = "done";
  this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, goalId, status: "done" });

  // Auto-advance to next queued goal
  for (const candidate of this.goals.values()) {
    if (candidate.state === "queued") {
      candidate.state = "executing";
      this.activeGoalId = candidate.goalId;
      // Dispatch ready tasks for the new active goal
      for (const task of this.taskStore.getByGoal(candidate.goalId)) {
        if (task.status === "ready") {
          this.callbacks.onDispatchTask(task.id, task.assigned_role);
        }
      }
      this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, goalId: candidate.goalId, status: "executing" });
      return;
    }
  }
}
```

### Step 5: Per-goal ChatAgent lifecycle (1 day)

**Status:** ✅ Steps 1-4 complete. Step 5 next.

**Current state (from code audit):**
- `AgentManagerV2.chatAgents: Map<string, ChatAgent>` — keyed by role only (e.g., `"backend"`)
- `enableChatAgents(roles)` creates per-role ChatAgents, wires dispatch via `orchestrator.setChatAgentDispatch()`
- `getChatAgent(role)` lazy-creates and returns ChatAgent
- `chatAgentMessage(role, content)` streams response — NO goalId param
- `ChatAgent` constructor receives `{ role, teamId, taskStore }` — NO goalId
- `ChatAgent.getMyTasks()` returns `taskStore.getByRole(this.role)` — returns ALL tasks across all goals

**What changes:**

**5a. AgentManagerV2 — Map key + lifecycle methods:**

```typescript
// Key helper
private chatAgentKey(goalId: string, role: string): string {
  return `${goalId}:${role.toLowerCase()}`;
}

// Create ChatAgents for a specific goal
enableChatAgentsForGoal(goalId: string, roles: string[]): void {
  for (const role of roles) {
    const key = this.chatAgentKey(goalId, role);
    if (this.chatAgents.has(key)) continue;
    const agent = new ChatAgent({
      role: role.toLowerCase(),
      teamId: this.teamId,
      goalId,
      taskStore: this.taskStoreInstance!,
      onDispatchTask: async (taskId, r) => this.orchestrator!.directDispatchTask(taskId, r),
      onNotifyPlanner: (msg) => this.orchestrator!.notifyPlannerFromRole(msg),
      loadConversation: this.loadConversationFn
        ? () => this.loadConversationFn!(this.teamId, `chat-${goalId}-${role.toLowerCase()}`)
        : undefined,
    });
    this.chatAgents.set(key, agent);
  }
}

// Dispose ChatAgents for a completed goal
disposeChatAgentsForGoal(goalId: string): void {
  for (const [key, agent] of this.chatAgents) {
    if (key.startsWith(`${goalId}:`)) {
      agent.dispose();
      this.chatAgents.delete(key);
    }
  }
}

// Get ChatAgent for a specific goal + role
getChatAgent(role: string, goalId?: string): ChatAgent | null {
  if (goalId) {
    return this.chatAgents.get(this.chatAgentKey(goalId, role)) ?? null;
  }
  // Backward compat: when FF off, find by role suffix
  for (const [key, agent] of this.chatAgents) {
    if (key.endsWith(`:${role.toLowerCase()}`)) return agent;
  }
  return null;
}

// Stream response — needs goalId to find right ChatAgent
async *chatAgentMessage(role: string, content: string, goalId?: string): AsyncGenerator<AgentEvent> {
  const agent = this.getChatAgent(role, goalId);
  if (!agent) throw new Error(`Chat agent not available for role '${role}'`);
  yield* agent.handleUserMessage(content);
}
```

**5b. ChatAgent constructor + getMyTasks — goalId scoping:**

```typescript
// ChatAgent.ts constructor gains goalId
constructor(config: ChatAgentConfig & { goalId?: string }) {
  this.goalId = config.goalId;
  // ... existing setup
}

// Goal-scoped task lookup
getMyTasks(): Task[] {
  if (this.goalId) {
    return this.taskStore.getByGoal(this.goalId)
      .filter(t => t.assigned_role === this.role);
  }
  return this.taskStore.getByRole(this.role);  // backward compat
}
```

**5c. Wire lifecycle from GoalManager via callbacks:**

Add to `GoalManagerCallbacks`:
```typescript
onChatAgentsForGoal?: (goalId: string, roles: string[]) => void;
onDisposeChatAgentsForGoal?: (goalId: string) => void;
```

In `approvePlan()`: `this.callbacks.onChatAgentsForGoal?.(goalId, this.teamRoles)`
In `autoAdvanceToNextGoal()`: same call for new executing goal
In `onGoalComplete()`: (when all tasks done and goal = "done"): `this.callbacks.onDisposeChatAgentsForGoal?.(goalId)`

**5d. Backward compat (FF off):**
- `enableChatAgents(roles)` stays — calls `enableChatAgentsForGoal(activeGoalId || "default", roles)`
- `getChatAgent(role)` without goalId falls back to suffix match
- Existing code paths don't break

**Files changed:**
- `packages/agent-manager/src/AgentManagerV2.ts` — Map key, lifecycle methods, chatAgentMessage gains goalId
- `packages/agent-manager/src/chatAgent/ChatAgent.ts` — constructor + getMyTasks goalId filter
- `packages/agent-manager/src/orchestrator/types.ts` — GoalManagerCallbacks gains 2 fields
- `packages/agent-manager/src/orchestrator/GoalManager.ts` — wire callbacks in approvePlan + autoAdvance

### Step 6: Socket.IO goal:stateChange + goalId routing (0.5 day)

**Current state (from code audit):**
- `handleMessage()` routes by agentId prefix — no goalId extraction
- `handleOrchestratorMessage()` calls `manager.orchestratorMessage(content)` — no goalId
- `handleChatAgentMessage()` uses `manager.getCurrentGoalId()` at line 1046 for persistence
- Stream events carry `{ teamId, agentId, sessionId, part }` — no goalId
- No `goal:stateChange` event exists

**What changes:**

**6a. New `goal:stateChange` event:**
Wire from GoalManager `onGoalStatusChange` callback → SocketServerV2:
```typescript
// In ensureTeamCallbacks() or via existing onGoalStatusChange
socket.emit("goal:stateChange", {
  teamId,
  goalId,
  state: newState,
  allGoals: manager.getAllGoalSummaries(), // NEW method on AgentManagerV2
});
```

**6b. AgentManagerV2 exposes `getAllGoalSummaries()`:**
```typescript
getAllGoalSummaries(): GoalSummary[] {
  return this.goalManager?.getAllGoalSummaries() ?? [];
}
```

**6c. `chatAgentMessage()` goalId param wiring:**
```typescript
// SocketServerV2.handleChatAgentMessage — extract goalId from payload
const goalId = parsed.data.goalId || manager.getCurrentGoalId() || undefined;
await this.handleChatAgentMessage(socket, manager, teamId, role, sessionId, content, goalId);
```

**Deferred to v1.1:**
- goalId on stream/message events (not needed for serial execution)
- goalId in sendMessage payload from frontend (not needed until frontend has goal switcher)

**Files changed:**
- `packages/backend/api/SocketServerV2.ts` — goal:stateChange emission, chatAgentMessage goalId
- `packages/agent-manager/src/AgentManagerV2.ts` — getAllGoalSummaries() method

### Step 7: Frontend goal switcher (2 days)

**Status:** Ready to implement — Steps 1-6 ✅ done, backend multi-goal complete.

**Key finding from audit:** The frontend already has goal/plan switching infrastructure:
- `PlanSwitcher` dropdown in header bar (from frontend redesign Phase 3)
- `PlanList` component showing recent plans with status badges
- `storedPlans` in localStorage with `{ planId, goal, status, taskCount, completedCount }`
- `activePlanId` state in App.tsx driving the active view
- `parseRouteState()` extracting planId from URL
- `onBackToGoals()` clearing planId and returning to GoalScreen

**What changes:** Replace localStorage-driven plan list with backend-driven `GoalSummary[]` from `goal:stateChange` socket event. Add GOALS section to sidebar.

---

#### 7a. Frontend types (0.5 hours)

**File:** `packages/frontend/types.ts`

```typescript
/** Goal summary from backend GoalManager (Phase 4) */
export interface GoalSummary {
  goalId: string;
  title: string;
  state: 'idle' | 'gathering' | 'researching' | 'awaiting_approval' | 'executing' | 'queued' | 'done';
  taskCount: number;
  completedCount: number;
  planId?: string;
  createdAt: number;
}
```

#### 7b. useOrchestration — subscribe to `goal:stateChange` (0.5 day)

**File:** `packages/frontend/hooks/useOrchestration.ts`

**Add state:**
```typescript
const [goals, setGoals] = useState<GoalSummary[]>([]);
const [activeGoalId, setActiveGoalId] = useState<string | null>(null);
```

**Add socket subscription (in `subscribeToTeam`):**
```typescript
socket.on('goal:stateChange', (data: { teamId: string; goalId: string; state: string; allGoals: GoalSummary[] }) => {
  setGoals(data.allGoals);
  // If no active goal yet, set to the first executing one
  if (!activeGoalIdRef.current && data.allGoals.length > 0) {
    const executing = data.allGoals.find(g => g.state === 'executing');
    if (executing) setActiveGoalId(executing.goalId);
  }
});
```

**Return from hook:** add `goals`, `activeGoalId`, `setActiveGoalId`

#### 7c. GoalList sidebar component (0.5 day)

**File:** `packages/frontend/components/Sidebar/GoalList.tsx` (NEW)

```
GOALS
  🟢 Build REST API      3/5  ← executing (click = active)
  ⏳ Setup CI Pipeline    0/4  ← queued
  📝 Write API Docs      ...  ← planning
  [+ New Goal]
```

**Props:**
```typescript
interface GoalListProps {
  goals: GoalSummary[];
  activeGoalId: string | null;
  onSelectGoal: (goalId: string) => void;
  onNewGoal: () => void;
}
```

**Status icons:** `🟢` executing, `⏳` queued, `📝` planning/gathering, `⏸️` awaiting_approval, `✅` done, `❌` failed

**Each goal row:** Status icon + title (truncated) + `completedCount/taskCount` + click handler

**Design pattern:** Same as `PlanTaskList` — flat list with status badges, compact rows.

#### 7d. Sidebar integration (0.5 day)

**File:** `packages/frontend/components/Sidebar.tsx`

**Where it goes:** Above the existing PLAN/TASKS section, below TeamSwitcher.

```
┌─────────────────────────────────┐
│  Team Switcher                  │
├─────────────────────────────────┤
│  GOALS (from GoalList)          │  ← NEW
│  🟢 Build REST API      3/5    │
│  ⏳ Setup CI              0/4   │
│  [+ New Goal]                   │
├─────────────────────────────────┤
│  TASKS (PlanTaskList, filtered) │  ← existing, scoped to selected goal
│  ✅ T-1  Design schema    BE   │
│  🔄 T-2  Build endpoints  BE   │
├─────────────────────────────────┤
│  AGENTS                         │  ← existing
│  🟢 backend    auto            │
└─────────────────────────────────┘
```

**Changes to Sidebar.tsx:**
- New prop: `goals: GoalSummary[]`, `activeGoalId`, `onSelectGoal`, `onNewGoal`
- Render `<GoalList>` when `goals.length > 0` or `FF_PARALLEL_PLANS`
- GOALS section only shows when there are 2+ goals (single goal = current behavior, no section)

**Visibility rule:**
- 0 goals: no GOALS section (same as today)
- 1 goal: no GOALS section (same as today — just TASKS)
- 2+ goals: GOALS section appears above TASKS
- This means no visual change until user submits a second goal

#### 7e. App.tsx wiring (0.5 day)

**File:** `packages/frontend/App.tsx`

**Wire goal state from useOrchestration:**
```typescript
const { goals, activeGoalId, setActiveGoalId, ...rest } = useOrchestration(...);

// Pass to sidebar
<Sidebar
  goals={goals}
  activeGoalId={activeGoalId}
  onSelectGoal={(goalId) => {
    setActiveGoalId(goalId);
    // Optionally update URL: pushRoute(`/teams/${teamId}/g/${goalId}`);
  }}
  onNewGoal={() => {
    // Clear active plan, show GoalScreen input
    setActivePlanId(null);
    pushRoute(`/teams/${teamId}`);
  }}
/>
```

**Task filtering:** When `activeGoalId` is set and `goals.length > 1`, filter `planTasks` to only show tasks for the active goal. If `goals.length <= 1`, show all tasks (backward compat).

---

**Files changed:**
- `packages/frontend/types.ts` — add `GoalSummary` type
- `packages/frontend/hooks/useOrchestration.ts` — add `goals` state, `goal:stateChange` subscription
- `packages/frontend/components/Sidebar/GoalList.tsx` — NEW component
- `packages/frontend/components/Sidebar.tsx` — render GoalList when 2+ goals
- `packages/frontend/App.tsx` — wire goal state to sidebar

**Backward compat:** GOALS section only appears when 2+ goals exist. Single-goal experience unchanged. No URL scheme change (keep `/p/{planId}` for now, `/g/{goalId}` in v1.1).

## Progress

| Step | What | Effort | Status |
|------|------|--------|--------|
| 1 | GoalContext type + `queued`/`done` states | 0.5d | ✅ Done |
| 2 | TaskStore.clearByGoal + WorkerPool.disposeByGoal | 0.5d | ✅ Done |
| 3 | GoalManager scalar → Map + helpers + method updates | 2d | ✅ Done |
| 4 | Execution mutex + auto-advance | 0.5d | ✅ Done |
| 5 | Per-goal ChatAgent lifecycle | 1d | ✅ Done |
| 6 | Socket.IO goal:stateChange | 0.5d | ✅ Done |
| 7 | Frontend goal switcher | 2d | 📋 Next |
| **Total** | | **7 days** | **6/7 done** |

## Testing

- Unit: GoalContext Map CRUD, execution mutex, auto-advance
- Integration: Create 2 goals → approve both → first executes → second queues → first completes → second auto-starts
- Integration: Replan within goal → `clearByGoal` preserves other goal's tasks
- Regression: `FF_PARALLEL_PLANS=false` → single-goal, same behavior as today
- E2E: (deferred with frontend) Goal switching, sidebar updates in real-time

## Rollback

`FF_PARALLEL_PLANS=false` → `getOrCreateGoal()` clears Map to max 1 entry. Same single-goal behavior. No data migration.
