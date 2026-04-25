# Parallel Plans v1.0 — GoalContext + Serial Execution Queue

> **Parent:** [feature_architecture.md](../feature_architecture.md) — Option C (Hybrid), upgrading to Option A  
> **Status:** Planning — audited April 25, 2026  
> **Branch:** `feature/parallel-plans-v1.0`  
> **Phase:** 4 in the [cross-feature roadmap](../feature_architecture.md#cross-feature-dependency-map)  
 > **Depends on:** Chat Agent Layer (Phase 1 ✅), Conversation Persistence (Phase 2 ✅), Git Task Context (Phase 3 ✅), GoalManager Extraction (A12)  
> **Blocks:** v2.0 (workspace isolation), v3.0 (full parallel execution)  
> **FF Flag:** `FF_PARALLEL_PLANS`

## Prerequisites — What Phase 3 Already Gave Us

| Component | Status | What exists |
|-----------|--------|-------------|
| `goalId`/`planId` on Task type | ✅ Done | Top-level optional fields |
| `TaskStore.getByGoal(goalId)` | ✅ Done | Filter tasks by goal |
| `TaskStore.getByPlan(planId)` | ✅ Done | Filter tasks by plan |
| `TaskStore.isAllCompleteForGoal(goalId)` | ✅ Done | Check if all tasks for a goal are done |
| Goal-scoped branch naming | ✅ Done | `goal-{goalId}/task-{taskId}` pattern |
| `goalId`/`planId` on ToolContext | ✅ Done | Pipeline wiring complete |
| `goalId` set in `approvePlan()` | ✅ Done | Hoisted before task creation loop |
| CRDT proxy `resolveForGoal(goalId)` | ✅ Done | Lazy per-goal CRDT resolution |
| `FilePlanStore` scoped by `{teamId}/{goalId}/{planId}` | ✅ Done | Plan persistence already goal-scoped |
| Merge conflict → resolution task | ✅ Done | Auto-creates task on merge failure |

## What's Still Missing

| Component | Status | Gap |
|-----------|--------|-----|
| `GoalContext` type | ❌ | Per-goal state container not defined |
| `OrchestratorService` scalar → Map | ❌ | `state`, `pendingPlan`, `currentGoalId`, `messages`, `messageChain`, `activeDispatches`, `deferredDispatches` — all scalar, must become per-goal |
| `TaskStore.clearByGoal()` | ❌ | Remove all tasks for one goal (needed for replan within a goal) |
| `WorkerPool.disposeByGoal()` | ❌ | Dispose workers for one goal's tasks (not all workers) |
| `OrchestratorState.queued` | ❌ | New state for goals waiting to execute |
| `handleMessage(content, goalId)` | ❌ | Message routing to specific goal context |
| Per-goal ChatAgents | ❌ | ChatAgent Map key `${goalId}:${role}` instead of `${role}` |
| Per-goal ChatAgent lifecycle | ❌ | Create on goal start, dispose on goal complete |
| Socket.IO `goalId` on events | ❌ | `sendMessage` payload needs goalId; `goal:stateChange` event |
| Frontend goal switcher | ❌ | GoalList component, per-goal task/chat switching |
| Frontend unified cross-team view | ❌ | "My Goals" aggregation across all user's teams |

## Scope

Multiple goals can be created, planned, and approved concurrently. Execution is serialized — one goal runs at a time, next auto-starts on completion.

**Includes:**
- `GoalContext` type and `Map<goalId, GoalContext>` in OrchestratorService
- Per-goal planner instance (one `AiSdkAgent` per goal)
- Per-goal ChatAgents (keyed by `${goalId}:${role}`, created/disposed with goal lifecycle)
- Replace all scalar state fields with per-goal lookups
- `TaskStore.clearByGoal()` + `WorkerPool.disposeByGoal()`
- Execution mutex (one goal executes at a time, `queued` state for others)
- Auto-advance: when executing goal completes, next queued goal starts
- Socket.IO `goalId` routing + `goal:stateChange` event
- Frontend goal switcher in sidebar
- Frontend unified cross-team goal view ("My Goals")

**Excludes:**
- Workspace isolation (v2.0)
- True parallel execution — removing the mutex (v3.0)
- External agents / MCP

## Key Architecture Decisions

### Decision 1: Planner Per-Goal (not Per-Team)

**Question:** The planner is currently a single `AiSdkAgent` instance per team. With multiple goals, two options:

**Option A: One planner, context-switching.**
Planner handles all goals. When user sends a message for goal-2, planner's conversation gets goal-2's context injected. Simple — no extra agent instances. But planner conversation gets messy with interleaved goal contexts.

**Option B: One planner per goal.**
Each GoalContext has its own planner `AiSdkAgent` instance + conversation thread. Clean separation. More memory (~10MB per planner instance). Matches the "per-goal planner thread" concept in the plan.

**Decision: Option B — one planner per goal.** Reasons:
1. Conversation persistence (Phase 2) already stores per-agent messages — per-goal planner is a natural fit
2. Context-switching a single planner between goals risks cross-contamination
3. Memory cost is trivial (~10MB per planner × 5 goals = 50MB)
4. The planner agent is lightweight — it's just an LLM API client, not a heavy process
5. Each GoalContext is self-contained: its own state, plan, planner, tasks

### Decision 2: Per-Goal ChatAgents (not Shared)

Three options were evaluated for how ChatAgents scope to goals:

| Option | ChatAgent instances | Map key | Goal switching |
|--------|-------------------|---------|----------------|
| **A: Per-goal** | `goals × roles` (e.g., 2×5=10) | `${goalId}:${role}` | Swap agent set, clean context |
| B: Shared, goal-filtered | `roles` (e.g., 5) | `${role}` | Every method needs `goalId` param |
| C: Shared, goal-injected | `roles` (e.g., 5) | `${role}` | System prompt injection per call |

**Decision: Option A — per-goal ChatAgents.** Reasons:
1. **Cleaner implementation** — no `goalId` filter params needed on `getMyTasks()`, `handleUserMessage()`, `buildSystemPrompt()`, `getRecentActivity()`, `ingestTaskUpdate()`
2. **Clean context switching** — switching goals swaps the ChatAgent set, no interleaved conversation history
3. **Memory cost is trivial** — 2 active goals × 5 roles × ~10MB = 100MB
4. **Cross-goal knowledge goes to L2 Team Memory (CRDT)** — accessible to all agents regardless of goal scope
5. **Matches real workflow** — switching projects = switching context, not carrying project-A conversation into project-B
6. **Simple lifecycle** — goal starts → create ChatAgents for that goal's roles. Goal completes → dispose. Same pattern as workers.

**How it works:**
```typescript
// AgentManagerV2.chatAgents Map
// BEFORE: Map<role, ChatAgent>       key: "backend"
// AFTER:  Map<goalRole, ChatAgent>   key: "build-auth:backend"

private chatAgents = new Map<string, ChatAgent>();

private chatAgentKey(goalId: string, role: string): string {
  return `${goalId}:${role.toLowerCase()}`;
}

// Create ChatAgents for a goal (called when goal transitions to planning/executing)
enableChatAgentsForGoal(goalId: string, roles: string[]): void {
  for (const role of roles) {
    const key = this.chatAgentKey(goalId, role);
    if (!this.chatAgents.has(key)) {
      this.chatAgents.set(key, new ChatAgent({
        role, teamId: this.teamId, goalId,
        taskStore: this.taskStoreInstance,
        // ... same config as today
      }));
    }
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
getChatAgent(goalId: string, role: string): ChatAgent | null {
  return this.chatAgents.get(this.chatAgentKey(goalId, role)) ?? null;
}
```

**ChatAgent constructor gains `goalId`:**
```typescript
// ChatAgent filters tasks by goalId at construction
constructor(config: ChatAgentConfig & { goalId: string }) {
  this.goalId = config.goalId;
  // taskStore.onRoleEvent still listens to all tasks,
  // but getMyTasks() filters: taskStore.getByGoal(this.goalId).filter(t => t.assigned_role === this.role)
}
```

### Decision 3: Unified Cross-Team Goal View (Frontend Only)

**Problem:** Users manage multiple teams, each with their own goals. Need a "My Work" view.

**Decision: Frontend aggregation, no backend change.**
- Frontend queries `GET /api/v2/goals?userId=me` across all user's teams
- Renders grouped by team: Engineering → [Goal A, Goal C], Marketing → [Goal B]
- Clicking a goal from another team = team switch + goal switch
- Backend stays team-scoped — each team's AgentManager handles its own goals independently
- This matches Linear/Jira/Notion "My Work" pattern

```
┌─────────────────────────────────────────┐
│ MY GOALS (across all teams)              │
│                                          │
│ Engineering Team                         │
│   🟢 Build auth system        3/5       │
│   ⏳ Setup CI pipeline         0/4       │
│                                          │
│ Marketing Team                           │
│   📝 Write launch copy         ...       │
│                                          │
│ Design Team                              │
│   🟢 Create brand kit          2/3       │
├─────────────────────────────────────────┤
│ Click goal → switches to that team       │
│ + shows that goal's tasks/chat           │
└─────────────────────────────────────────┘
```

## Codebase Audit: OrchestratorService Scalar Fields

**7 scalar fields → GoalContext fields** (1300-line file, ~30 methods reference these):

| Scalar field | Line | Type | GoalContext equivalent |
|-------------|------|------|----------------------|
| `state` | L104 | `OrchestratorState` | `goal.state` |
| `currentGoalId` | L108 | `string \| null` | `goal.goalId` (Map key) |
| `messages` | L109 | `OrchestratorMessage[]` | `goal.plannerMessages` |
| `pendingPlan` | L124 | `any` | `goal.pendingPlan` |
| `messageChain` | L112 | `Promise<string>` | `goal.messageChain` |
| `activeDispatches` | L114 | `Set<string>` | `goal.activeDispatches` |
| `deferredDispatches` | L118 | `Array<>` | `goal.deferredDispatches` |

**Methods that read/write these fields** (audit):

| Method | Fields touched | Impact |
|--------|---------------|--------|
| `handleMessage()` | messageChain | Route to goal's chain |
| `_handleMessage()` | messages, state | Route to goal's context |
| `approvePlan()` | pendingPlan, state, currentGoalId | Scope to goal |
| `onTaskComplete()` | state (via isAllComplete) | Use isAllCompleteForGoal |
| `dispatchTask()` | activeDispatches, deferredDispatches | Scope to goal |
| `dispatchReadyTasks()` | activeDispatches, deferredDispatches | Scope to goal |
| `onWorkerDone()` | activeDispatches | Scope to goal |
| `notifyPlanner()` | messages | Route to goal's planner |
| `getCurrentGoalId()` | currentGoalId | Return active goal |
| `loadActivePlan()` | currentGoalId, state | Extend for multi-goal |
| `setPendingPlan()` / `getPendingPlan()` | pendingPlan | Scope to goal |

## Implementation Steps

### Step 1: Types + GoalContext (0.5 day)

**Files:** `packages/agent-manager/src/orchestrator/types.ts`

Add `GoalContext` interface and `queued` state:

```typescript
export type OrchestratorState =
  | "idle"
  | "gathering"
  | "researching"
  | "awaiting_approval"
  | "executing"
  | "queued";              // NEW — goal approved but another goal is executing

export interface GoalContext {
  goalId: string;
  state: OrchestratorState;
  pendingPlan: AgentPlanOutput | null;
  plannerMessages: OrchestratorMessage[];
  messageChain: Promise<string>;
  activeDispatches: Set<string>;
  deferredDispatches: Array<{ taskId: string; role: string }>;
  currentPlanId: string | null;
  createdAt: number;
  title: string;           // first ~80 chars of user's goal message
}
```

### Step 2: TaskStore.clearByGoal() + WorkerPool.disposeByGoal() (0.5 day)

**Files:**
- `packages/agent-manager/src/orchestrator/TaskStore.ts` — add `clearByGoal(goalId)`:
  ```typescript
  clearByGoal(goalId: string): void {
    const toRemove = this.getByGoal(goalId);
    for (const task of toRemove) {
      this.remove(task.id);
    }
    log.info(`Cleared ${toRemove.length} tasks for goal ${goalId}`);
  }
  ```
- `packages/agent-manager/src/services/WorkerPool.ts` — add `disposeByGoal(goalId, taskStore)`:
  ```typescript
  async disposeByGoal(goalId: string, taskStore: TaskStore): Promise<void> {
    const goalTasks = taskStore.getByGoal(goalId);
    for (const task of goalTasks) {
      const worker = this.workers.get(task.id);
      if (worker) {
        worker.abort();
        this.workers.delete(task.id);
      }
    }
  }
  ```

### Step 3: OrchestratorService — GoalContext Map (5 days)

**The core refactor.** Replace 7 scalar fields with `Map<goalId, GoalContext>`.

**Files:** `packages/agent-manager/src/orchestrator/OrchestratorService.ts`

**3a. Replace scalar fields with Map (day 1):**
```typescript
// BEFORE:
private state: OrchestratorState = "idle";
private currentGoalId: string | null = null;
private messages: OrchestratorMessage[] = [];
private pendingPlan: any = null;
private messageChain: Promise<string> = Promise.resolve("");
private activeDispatches = new Set<string>();
private deferredDispatches: Array<...> = [];

// AFTER:
private goals = new Map<goalId, GoalContext>();
private activeGoalId: string | null = null; // which goal is currently executing
```

Add helper methods:
```typescript
private getOrCreateGoal(goalId: string, title?: string): GoalContext {
  let goal = this.goals.get(goalId);
  if (!goal) {
    goal = {
      goalId,
      state: "idle",
      pendingPlan: null,
      plannerMessages: [],
      messageChain: Promise.resolve(""),
      activeDispatches: new Set(),
      deferredDispatches: [],
      currentPlanId: null,
      createdAt: Date.now(),
      title: title || goalId,
    };
    this.goals.set(goalId, goal);
  }
  return goal;
}

private getExecutingGoal(): GoalContext | undefined {
  for (const goal of this.goals.values()) {
    if (goal.state === "executing") return goal;
  }
  return undefined;
}

private getGoalForTask(taskId: string): GoalContext | undefined {
  const task = this.taskStore.get(taskId);
  if (!task?.goalId) return undefined;
  return this.goals.get(task.goalId);
}

getAllGoalSummaries(): GoalSummary[] {
  return Array.from(this.goals.values()).map(g => ({
    goalId: g.goalId,
    title: g.title,
    state: g.state,
    taskCount: this.taskStore.getByGoal(g.goalId).length,
    completedCount: this.taskStore.getByGoal(g.goalId).filter(t => t.status === "completed").length,
    planId: g.currentPlanId || undefined,
    createdAt: g.createdAt,
  }));
}
```

**3b. Update _handleMessage() for goal routing (day 2):**
```typescript
async handleMessage(content: string, goalId?: string): Promise<string> {
  const gid = goalId || this.activeGoalId || toGoalId(content);
  const goal = this.getOrCreateGoal(gid, content.slice(0, 80));
  const result = goal.messageChain.then(() => this._handleMessage(content, goal));
  goal.messageChain = result.catch(() => "");
  return result;
}

private async _handleMessage(content: string, goal: GoalContext): Promise<string> {
  goal.plannerMessages.push({ role: "user", content, timestamp: new Date().toISOString() });
  if (goal.state === "idle") goal.state = "gathering";
  this.activeGoalId = goal.goalId;
  // ... rest routes to goal's planner
}
```

**3c. Update approvePlan() for goal-scoped clearing (day 3):**
```typescript
// BEFORE:
await this.workerPool.disposeAll();
this.taskStore.clear();

// AFTER:
await this.workerPool.disposeByGoal(goalId, this.taskStore);
this.taskStore.clearByGoal(goalId);

// If another goal is executing, queue this one
const executing = this.getExecutingGoal();
if (executing && executing.goalId !== goalId) {
  goal.state = "queued";
  return { success: true, tasksQueued, queued: true };
}
goal.state = "executing";
```

**3d. Update dispatch + completion handlers (day 4):**
- `dispatchTask()`: use `goal.activeDispatches` instead of `this.activeDispatches`
- `dispatchReadyTasks()`: scope to goal's tasks
- `onWorkerDone()`: look up goal from task, use goal's dispatch set
- `onTaskComplete()`: use `isAllCompleteForGoal(goalId)` instead of `isAllComplete()`

**3e. Update notifyPlanner() + getters (day 5):**
- `notifyPlanner()` → `notifyPlanner(goalId, message)` — routes to goal's planner
- `getCurrentGoalId()` → returns `activeGoalId`
- `setPendingPlan()` → routes to goal's `pendingPlan`
- `loadActivePlan()` → loads all stored goals, not just one

**FF gate:** When `FF_PARALLEL_PLANS=false`:
```typescript
private getOrCreateGoal(goalId: string): GoalContext {
  if (!process.env.FF_PARALLEL_PLANS && this.goals.size >= 1) {
    // Single-goal mode: replace existing goal
    const existing = this.goals.values().next().value;
    if (existing && existing.goalId !== goalId) {
      this.goals.delete(existing.goalId);
    }
  }
  // ... rest of method
}
```

### Step 4: Execution mutex + auto-advance (1 day)

**Files:** `OrchestratorService.ts`

When a goal's tasks all complete:
```typescript
private onGoalComplete(goalId: string): void {
  const goal = this.goals.get(goalId);
  if (!goal) return;
  goal.state = "done";
  
  this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, goalId, status: "done" });

  // Auto-advance: find next queued goal and start it
  for (const candidate of this.goals.values()) {
    if (candidate.state === "queued") {
      candidate.state = "executing";
      this.activeGoalId = candidate.goalId;
      this.dispatchReadyTasksForGoal(candidate.goalId);
      this.callbacks.onGoalStatusChange?.({ teamId: this.teamId, goalId: candidate.goalId, status: "executing" });
      return;
    }
  }
}
```

### Step 5: Socket.IO goalId routing (1 day)

**Files:** `packages/backend/api/SocketServerV2.ts`

- `sendMessage` handler: extract `goalId` from payload, pass to `orchestrator.handleMessage(content, goalId)`
- Stream events: include `goalId` from task context
- New event: `goal:stateChange` → `{ goalId, state, allGoals: GoalSummary[] }`
- Fired on every GoalContext state transition

### Step 6: Frontend — Goal switcher (3 days)

**Files:** `packages/frontend/` — sidebar, hooks, types

**New sidebar section: GOALS** above existing TASKS:
```
GOALS
  🟢 Build REST API      3/5  ← executing
  ⏳ Setup CI Pipeline    0/4  ← queued
  📝 Write API Docs      ...  ← planning
  [+ New Goal]
─────────────────────────────
TASKS (for selected goal)
  ✅ task-1  Design schema
  🔄 task-2  Create endpoints
  ⏳ task-3  Write tests
```

**State changes:**
- `useOrchestration`: add `goals: GoalSummary[]`, `activeGoalId`, `setActiveGoal(goalId)`
- `goal:stateChange` Socket.IO subscription → updates `goals` state
- `chatHistories` keyed by `goalId:agentId` — each goal's planner has separate history
- URL: `/teams/{teamId}/g/{goalId}` replaces `/teams/{teamId}/p/{planId}`

**Components:**
- `GoalList.tsx` (NEW) — renders GoalSummary[] with status badges, click to switch
- `Sidebar.tsx` — GOALS section above PlanTaskList
- `GoalScreen.tsx` — creates goalId (not planId)
- `PlanSwitcher.tsx` — deprecated, replaced by GoalList

## Risks

| Risk | Impact | Mitigation |
|------|--------|------------|
| OrchestratorService refactor breaks existing flows | High | FF gate: `FF_PARALLEL_PLANS=false` → Map max 1 entry, same behavior |
| Per-goal planner memory cost | Low | ~10MB per planner × max 10 goals = 100MB |
| CRDT proxy single resolution | Medium | Each goal calls `resolveForGoal()` — proxy pattern already supports this |
| Cross-goal task dependencies | None for v1.0 | Goals are independent — no cross-goal task deps until v3.0 |

## Testing

- Unit: GoalContext lifecycle, clearByGoal, disposeByGoal, execution mutex, auto-advance
- Integration: Create 2 goals → approve both → verify serial execution → auto-advance to second
- Integration: Replan within a goal → clearByGoal preserves other goal's tasks
- Regression: `FF_PARALLEL_PLANS=false` → single-goal flow identical to pre-v1.0
- E2E: Frontend goal switching, concurrent planning while one executes

## Rollback

`FF_PARALLEL_PLANS=false` → `getOrCreateGoal()` caps Map at 1 entry. OrchestratorService behaves identically to pre-v1.0. No data migration needed. Feature flag can be toggled at runtime.

## Estimated Total: 12 days

| Step | What | Effort |
|------|------|--------|
| 1 | GoalContext type + `queued` state | 0.5d |
| 2 | TaskStore.clearByGoal + WorkerPool.disposeByGoal | 0.5d |
| 3 | OrchestratorService scalar → Map refactor | 5d |
| 3b | Per-goal ChatAgent lifecycle (create/dispose/key change) | 1d |
| 4 | Execution mutex + auto-advance | 1d |
| 5 | Socket.IO goalId routing | 1d |
| 6 | Frontend goal switcher + unified cross-team view | 3d |
| **Total** | | **12 days** |
