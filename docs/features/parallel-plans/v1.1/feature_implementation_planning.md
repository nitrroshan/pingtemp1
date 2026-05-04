# Parallel Plans v1.1 — UX Polish + Per-Goal Isolation

> **Parent:** [feature_architecture.md](../feature_architecture.md)  
> **Status:** Planning  
> **Branch:** `feature/parallel-plans-v1.1`  
> **Depends on:** Parallel Plans v1.0 (Phase 4 ✅)  
> **Scope:** Frontend polish to make multi-goal actually usable + per-goal planner

## What v1.0 Shipped

Backend: GoalContext Map, execution mutex, auto-advance, per-goal ChatAgents, goal:stateChange event, SidebarPlanList component.

## What's Missing (from v1.0 testing)

| Gap | Impact | Effort |
|-----|--------|--------|
| Tasks show for ALL goals (no filtering) | Sidebar tasks confuse user when switching goals | 0.5d |
| Chat history mixes goals | Planner conversation from goal-1 shows when viewing goal-2 | 0.5d |
| No "+ New Plan" button in sidebar | User must click "← Back to goals" to submit another goal | 0.5d |
| Single planner for all goals | Can't plan goal-2 while goal-1 planner is busy | 1d |

## Wireframes

### Current (v1.0): No goal filtering

```
┌─────────────────────────────────┐
│  PLANS (only shows with 2+)     │
│  🟢 Build REST API      3/5    │
│  ⏳ Setup CI              0/4   │  ← user clicks here
├─────────────────────────────────┤
│  PLAN                           │
│  ✅ T-1  Design schema    BE   │  ← still shows goal-1 tasks!
│  🔄 T-2  Build endpoints  BE   │
│  ⏳ T-3  Write tests      QA   │
│  (no tasks from goal-2)         │
├─────────────────────────────────┤
│  ← Back to goals                │  ← only way to create new goal
└─────────────────────────────────┘
```

### After v1.1: Filtered tasks + New Plan button

```
┌─────────────────────────────────┐
│  PLANS                   [+ New]│  ← NEW button
│  🟢 Build REST API      3/5    │
│  ⏳ Setup CI              0/4   │  ← user clicks
├─────────────────────────────────┤
│  PLAN: Setup CI                 │
│  ⏳ T-4  Configure GH Actions  │  ← only goal-2 tasks!
│  ⏳ T-5  Write Dockerfile      │
│  ⏳ T-6  Setup staging env     │
│  ⏳ T-7  Add deploy workflow   │
├─────────────────────────────────┤
│  AGENTS                         │
│  🟢 devops       auto          │
└─────────────────────────────────┘
```

### Chat area: Per-goal planner conversation

```
BEFORE (v1.0):                      AFTER (v1.1):
┌──────────────────────┐            ┌──────────────────────┐
│ 🤖 Planner           │            │ 🤖 Planner           │
│ I'll build a REST    │ ← goal-1   │ I'll set up your CI  │ ← goal-2 only
│ API with 5 tasks...  │            │ pipeline with 4      │
│                      │            │ tasks...             │
│ 🤖 Planner           │            │                      │
│ Now let me set up    │ ← goal-2   │ (goal-1 conversation │
│ CI pipeline...       │  mixed!    │  NOT shown here)     │
└──────────────────────┘            └──────────────────────┘
```

### "+ New Plan" flow

```
User clicks [+ New] in PLANS section
  ↓
GoalScreen appears (same landing page)
  ↓
User types new goal → submits
  ↓
Backend creates new GoalContext → queued
  ↓
Sidebar updates: new plan appears with ⏳ status
  ↓
User stays on current goal's view (doesn't switch)
```

## Implementation Steps

### Step 1: Task filtering by goalId (0.5 day)

**Problem:** `allTasks = Object.values(tasks).flat()` returns ALL tasks across ALL goals.

**Files:**
- `packages/frontend/types.ts` — add `goalId?: string` to `Task` interface
- `packages/frontend/hooks/useOrchestration.ts` — include `goalId` when building Task from backend plan data (line ~175, add `goalId: bt.goalId || undefined`)
- `packages/frontend/App.tsx` — filter tasks when multiple plans exist:
  ```typescript
  // Line ~424, after const allTasks = Object.values(tasks).flat();
  const activePlanGoalId = plans.find(p => p.planId === activePlanId)?.goalId;
  const planTasks = plans.length > 1 && activePlanGoalId
    ? allTasks.filter(t => t.goalId === activePlanGoalId)
    : allTasks;
  ```

### Step 2: Per-goal chat history separation (0.5 day)

**Problem:** `chatHistories` keyed by `agentId` — all goals share same planner conversation.

**Files:**
- `packages/frontend/hooks/useOrchestration.ts` — when routing stream parts, prefix with goalId:
  ```typescript
  // In stream handler, for orchestrator/planner streams:
  const goalPrefix = activePlanGoalId ? `${activePlanGoalId}:` : '';
  onStreamPart(`${goalPrefix}${targetAgentId}`, part);
  ```
- `packages/frontend/App.tsx` — when reading chat history, use goal-prefixed key:
  ```typescript
  const chatKey = plans.length > 1 && activePlanGoalId
    ? `${activePlanGoalId}:${activeAgentId}`
    : activeAgentId;
  const activeAgentMessages = chatHistories[chatKey] ?? [];
  ```

**Backward compat:** When single goal (plans.length <= 1), no prefix — same as today.

### Step 3: "+ New Plan" button in sidebar (0.5 day)

**Files:**
- `packages/frontend/components/Sidebar/SidebarPlanList.tsx` — add `onNewPlan` prop + button:
  ```typescript
  interface SidebarPlanListProps {
    plans: PlanSummary[];
    activePlanGoalId: string | null;
    onSelectPlan: (goalId: string) => void;
    onNewPlan?: () => void;  // NEW
  }

  // In render, after plans list:
  {onNewPlan && (
    <button onClick={onNewPlan} className="...">
      <Plus size={12} /> New Plan
    </button>
  )}
  ```
- `packages/frontend/components/Sidebar.tsx` — pass `onNewPlan` prop through
- `packages/frontend/App.tsx` — wire callback:
  ```typescript
  onNewPlan={() => {
    setActivePlanId(null);
    if (selectedTeamId) pushRoute(`/teams/${encodeURIComponent(selectedTeamId)}`);
  }}
  ```

### Step 4: Per-goal planner instances (1 day)

**Problem:** Single `plannerAgent` per team. Can't plan goal-2 while goal-1 planner is active.

**Files:**
- `packages/agent-manager/src/AgentManagerV2.ts`:
  ```typescript
  // BEFORE:
  private plannerAgent: PlannerAgent | null = null;
  
  // AFTER:
  private planners = new Map<string, PlannerAgent>();
  
  private async getPlannerForGoal(goalId: string): Promise<PlannerAgent> {
    let planner = this.planners.get(goalId);
    if (!planner) {
      planner = new PlannerAgent({ agentFactory, teamRoles, teamId });
      await planner.initialize();
      // Wire tools with goal-scoped context
      this.planners.set(goalId, planner);
    }
    return planner;
  }
  ```
- Update `executePlannerTurn` to look up planner by goalId:
  ```typescript
  const executePlannerTurn = async (message: string) => {
    const goalId = this.orchestrator?.getCurrentGoalId() || 'default';
    const planner = await this.getPlannerForGoal(goalId);
    const agent = planner.getAgent();
    const sessionId = `team-${teamId}:goal-${goalId}`;
    for await (const event of agent.execute({ message, threadId: sessionId })) {
      // ... stream events
    }
  };
  ```
- Dispose planners on goal completion:
  ```typescript
  // In disposeChatAgentsForGoal callback, also dispose planner:
  onDisposeChatAgentsForGoal: (goalId) => {
    this.disposeChatAgentsForGoal(goalId);
    const planner = this.planners.get(goalId);
    if (planner) { planner.dispose(); this.planners.delete(goalId); }
  }
  ```

## Testing

- Submit 2 goals → verify tasks filter per selected plan in sidebar
- Switch plans → verify chat shows correct planner conversation
- Click "+ New Plan" → returns to GoalScreen, doesn't disrupt executing plan
- With per-goal planners: submit goal-2 while goal-1 executes → planner creates plan for goal-2

## Rollback

All changes are additive with backward compat:
- Task filtering: only applies when `plans.length > 1`
- Chat separation: only applies when `plans.length > 1`
- "+ New Plan" button: only shows when SidebarPlanList renders (2+ plans)
- Per-goal planners: Map with single entry = same as before

## Estimated Total: 2.5 days

| Step | What | Effort |
|------|------|--------|
| 1 | Task filtering by goalId | 0.5d |
| 2 | Per-goal chat history | 0.5d |
| 3 | "+ New Plan" button | 0.5d |
| 4 | Per-goal planner instances | 1d |
| **Total** | | **2.5 days** |
