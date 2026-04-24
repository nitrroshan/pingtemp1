# Parallel Plans v1.0 — Plan Queue + GoalContext Foundation

> **Parent:** [feature_architecture.md](../feature_architecture.md) — Option C (Hybrid), upgrading to Option A  
> **Status:** Planning  
> **Branch:** `feature/parallel-plans-v1.0`  
> **Phase:** 4 in the [cross-feature roadmap](../feature_architecture.md#cross-feature-dependency-map)  
> **Depends on:** Chat Agent Layer (Phase 1), Conversation Persistence (Phase 2), Git Task Context (Phase 3)  
> **Blocks:** v2.0 (workspace isolation), v3.0 (full parallel execution)

## Prerequisite Features (must be complete)

| Feature | Phase | What We Need From It |
|---------|-------|---------------------|
| Chat Agent Layer | 1 | Per-role ChatAgent class, Channel B events, dispatch rewiring |
| Conversation Persistence | 2 | Per-agent conversation storage (planner needs per-goal threads) |
| Git Task Context | 3 | `goalId` + `planId` on Task type, branch-per-task workspace model |

## Scope

Multiple goals can be created, planned, and approved concurrently. Execution is serialized — one goal runs at a time, next auto-starts on completion.

**Includes:**
- `GoalContext` type and `Map<goalId, GoalContext>` in OrchestratorService
- `goalId` + `planId` as top-level fields on Task (from Phase 3)
- TaskStore scoped queries (`getByGoal`, `clearByGoal`)
- Per-goal planner conversation threads
- Execution mutex (one goal executes, others plan/queue)
- Socket.IO `goalId` routing + `goal:stateChange` event
- Frontend goal switcher in sidebar

**Excludes:**
- Workspace isolation (v2.0)
- True parallel execution (v3.0)
- External agents / MCP

## Codebase Impact Analysis

### Files That Change (from research)

| File | Current State | Change |
|------|--------------|--------|
| [OrchestratorService.ts](../../../packages/agent-manager/src/orchestrator/OrchestratorService.ts) (1293 lines) | Scalar `state`, `pendingPlan`, `currentGoalId`, `messages` fields | Replace with `Map<goalId, GoalContext>` |
| [TaskStore.ts](../../../packages/agent-manager/src/orchestrator/TaskStore.ts) (389 lines) | Flat `Map<string, Task>`, no goal filtering | Add `getByGoal()`, `clearByGoal()`, `isAllCompleteForGoal()` |
| [types.ts](../../../packages/agent-manager/src/orchestrator/types.ts) (126 lines) | `OrchestratorContext.currentGoalId: string \| null` | Add GoalContext type, update OrchestratorContext |
| [AgentManagerV2.ts](../../../packages/agent-manager/src/AgentManagerV2.ts) (1662 lines) | Single OrchestratorService + TaskStore | No structural change (orchestrator handles multi-goal internally) |
| [SocketServerV2.ts](../../../packages/backend/api/SocketServerV2.ts) | No goalId on events | Add goalId to message/stream events, new `goal:stateChange` |

### Critical Code Paths to Modify

1. **`approvePlan()`** ([OrchestratorService.ts L258](../../../packages/agent-manager/src/orchestrator/OrchestratorService.ts#L258))
   - Currently: `workerPool.disposeAll()` + `taskStore.clear()`
   - Target: Only clear tasks for the goal being approved. If another goal is executing, queue this one.
   
2. **`onTaskComplete()` → `isAllComplete()`**
   - Currently: Checks all tasks globally
   - Target: `isAllCompleteForGoal(goalId)` — only check tasks for the completed goal

3. **CRDT proxies** ([L103-104](../../../packages/agent-manager/src/orchestrator/OrchestratorService.ts#L103))
   - Currently: Single resolution stored
   - Target: Per-goal CRDT proxy resolution

## Implementation Steps

- [ ] **Step 1: GoalContext type** — Define the per-goal state container  
  Files: `packages/agent-manager/src/orchestrator/types.ts`  
  ```typescript
  interface GoalContext {
    goalId: string;
    state: OrchestratorState;
    pendingPlan: any | null;
    plannerMessages: OrchestratorMessage[];
    dispatchChain: Promise<void>;
    activeDispatches: Set<string>;
    deferredDispatches: Array<{ taskId: string; role: string }>;
    currentPlanId: string | null;
    sessionId: string;
  }
  ```
  Effort: 0.5 day

- [ ] **Step 2: TaskStore scoped methods** — Add goal-scoped queries  
  Files: `packages/agent-manager/src/orchestrator/TaskStore.ts`  
  New: `getByGoal()`, `clearByGoal()`, `isAllCompleteForGoal()`, `getReadyTasksForGoal()`  
  Existing `clear()` preserved for backward compat  
  Effort: 1 day

- [ ] **Step 3: OrchestratorService — GoalContext Map** — Replace scalar state  
  Files: `packages/agent-manager/src/orchestrator/OrchestratorService.ts`  
  Replace: `this.state` → `goal.state`, `this.pendingPlan` → `goal.pendingPlan`, etc.  
  New: `getOrCreateGoal(goalId)`, `getActiveGoal()`, `getExecutingGoal()`  
  FF gate: When `FF_PARALLEL_PLANS=false`, Map max size = 1 (single-goal fallback)  
  Effort: 3 days

- [ ] **Step 4: approvePlan() — goal-scoped** — Stop destroying all workers  
  Files: `OrchestratorService.ts`  
  Replace: `taskStore.clear()` → `taskStore.clearByGoal(goalId)`  
  Replace: `workerPool.disposeAll()` → only dispose workers for this goal's tasks  
  New: If another goal is `executing`, set this goal to `queued` state  
  Effort: 1.5 days

- [ ] **Step 5: Execution mutex + auto-advance**  
  Files: `OrchestratorService.ts`  
  New state: `queued` added to OrchestratorState  
  Logic: `onAllComplete(goalId)` → find next `queued` goal → start it  
  `goal:stateChange` event fires on every transition  
  Effort: 1.5 days

- [ ] **Step 6: Per-goal planner threads**  
  Files: `OrchestratorService.ts`, `PlannerAgent`  
  Replace: Single `messages[]` → per-goal `plannerMessages[]` in GoalContext  
  Planner sees context: "You have 2 other goals: [titles + status]"  
  Effort: 1.5 days

- [ ] **Step 7: Socket.IO goalId routing**  
  Files: `SocketServerV2.ts`, frontend hooks  
  `sendMessage` payload: add `goalId` field  
  Stream events: carry `goalId` for routing  
  New event: `goal:stateChange` → `{ goalId, newState, allGoals[] }`  
  Effort: 1 day

- [ ] **Step 8: Frontend — Goal switcher**  
  Files: `packages/frontend/` — sidebar, hooks, types  

  **Current state:** GoalScreen shows one goal input → creates planId → navigates to `/teams/{teamId}/p/{planId}`. Sidebar shows one plan's tasks. `PlanSwitcher` dropdown exists but loads from localStorage. No concept of multiple concurrent goals.

  **Design:**

  ```
  ┌─────────────────────────────────┐
  │ Team Switcher                   │
  ├─────────────────────────────────┤
  │ GOALS                           │
  │ ┌─────────────────────────────┐ │
  │ │ 🟢 Build REST API      3/5 │ │ ← executing (green)
  │ │ ⏳ Setup CI Pipeline    0/4 │ │ ← queued (amber)
  │ │ 📝 Write API Docs      ... │ │ ← planning (blue)
  │ └─────────────────────────────┘ │
  │ [+ New Goal]                    │
  ├─────────────────────────────────┤
  │ TASKS (for selected goal)       │
  │ ┌─────────────────────────────┐ │
  │ │ ✅ task-1  Design schema    │ │
  │ │ 🔄 task-2  Create endpoints │ │
  │ │ ⏳ task-3  Write tests      │ │
  │ └─────────────────────────────┘ │
  ├─────────────────────────────────┤
  │ AGENTS                          │
  │  backend-dev  frontend-dev      │
  └─────────────────────────────────┘
  ```

  **New types:**
  ```typescript
  interface GoalSummary {
    goalId: string;
    title: string;               // first ~50 chars of user message
    state: 'planning' | 'awaiting_approval' | 'queued' | 'executing' | 'done' | 'failed';
    taskCount: number;
    completedCount: number;
    planId?: string;
    createdAt: number;
  }
  ```

  **State changes:**
  - `useOrchestration` gains: `goals: GoalSummary[]`, `activeGoalId: string | null`, `setActiveGoal(goalId)`
  - New Socket.IO event: `goal:stateChange` → `{ goalId, newState, allGoals: GoalSummary[] }`
  - `chatHistories` keyed by `goalId:agentId` (not just agentId) — each goal has its own planner conversation
  - URL: `/teams/{teamId}/g/{goalId}` replaces `/teams/{teamId}/p/{planId}`

  **Components:**
  - `Sidebar.tsx` — NEW section: `GoalList` above existing `PlanTaskList`. Click goal → switches active goal → tasks + chat update
  - `GoalList.tsx` (NEW) — renders `GoalSummary[]` with status badge, task progress, click handler
  - `GoalScreen.tsx` — EDIT: "New Goal" creates goalId (not planId), backend receives `{ content, goalId }`
  - `PlanSwitcher.tsx` — DEPRECATED: replaced by GoalList in sidebar

  **Interactions:**
  - Click goal → `setActiveGoal(goalId)` → sidebar shows that goal's tasks, chat loads that goal's planner conversation
  - Status badges update in real-time via `goal:stateChange` Socket.IO event
  - "New Goal" button at top of GoalList → opens inline chat input scoped to new goalId (no page navigation)
  - Goal in `planning`/`awaiting_approval` state → shows relevant UI (approval modal scoped to goalId)

  Effort: 3 days

## Testing

- Unit: TaskStore scoped methods, GoalContext lifecycle, execution mutex
- Integration: Create 2 goals → approve both → verify serial execution → auto-advance
- Regression: Single-goal flow unchanged when `FF_PARALLEL_PLANS=false`
- E2E: Frontend goal switching, concurrent planning while one executes

## Rollback

`FF_PARALLEL_PLANS=false` → GoalContext Map has max 1 entry. OrchestratorService behaves identically to pre-v1.0. No data migration needed.

## Estimated Total: 13 days
