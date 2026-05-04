# Bug: Maximum update depth exceeded — infinite re-render loop

**Feature:** `frontend-state-refactor` (App.tsx orchestration wiring)

**Symptom:** React crashes with "Maximum update depth exceeded" shortly after connecting to a team. Browser console shows the error originating from state updates inside `useEffect` hooks in `App.tsx`. The app becomes unresponsive.

**Root Cause:** A circular dependency chain between three `useEffect` hooks in [App.tsx](../../../packages/frontend/App.tsx):

```
useEffect A (line ~449)          useEffect B (line ~125)          useEffect C (line ~271)
deps: [activePlanGoalId, …]  ←── deps: [plans, …]            ←── deps: [currentPath]
│                                 │                                │
│  restoreFromServer()            │  activePlanGoalId = useMemo    │  setActivePlanId()
│  → handleGoalStateChange()      │    depends on `plans`          │    changes activePlanId
│    → set({ plans: … })          │    returns new goalId          │
│                                 │                                │
└── plans change ──────────────►  └── activePlanGoalId changes ──► └── triggers effect A again
```

**The cycle in detail:**

1. **Effect A** (line ~449): `restoreFromServer(…, activePlanGoalId)` is called. The restore result triggers `handleGoalStateChange({ allGoals })` which calls `set({ plans: data.allGoals })` — updating the `plans` array in Zustand.

2. **Memo B** (line ~125): `activePlanGoalId` is a `useMemo` with `plans` in its dependency array. When `plans` changes, `activePlanGoalId` recomputes. Even if the goalId value is the same string, React may see a new reference if `plans` is a new array (which it always is from Zustand `set()`).

3. **Effect A re-fires**: `activePlanGoalId` is in Effect A's dependency array (`[selectedTeamId, agents, activePlanGoalId, …]`). The new `activePlanGoalId` reference triggers Effect A again → back to step 1.

**Secondary amplifier:** Effect A also calls `setActiveAgentId(selectedTeamId)` (line ~456) on every run if `activeAgentId !== selectedTeamId`, which triggers additional re-renders and can kick off the `agents` dependency change path.

**Fix Type:** `needs-fix` (documenting for review — no patch applied)

---

## Long-Term Solution

The fundamental problem is **too many cross-cutting concerns in a single component** with **derived state in useEffect dependency arrays that creates feedback loops**. The solution has three parts:

### 1. Break the `plans → activePlanGoalId → restoreFromServer → plans` cycle

`activePlanGoalId` should NOT depend on `plans` from Zustand. The `plans` array gets replaced on every `goal:stateChange` event and every `restoreFromServer` call, creating a new array reference every time.

**Option A — Memoize by value, not reference:**
```typescript
// Instead of depending on the full plans array:
const activePlanGoalId = useMemo(() => {
  // ...lookup in plans...
}, [activePlanId, plans, selectedTeamId]);

// Derive goalId from a stable, value-compared selector:
const activePlanGoalId = useOrchestrationStore(
  s => s.plans.find(p => p.planId === activePlanId || p.goalId === activePlanId)?.goalId,
  // shallow equality — only re-render when the actual goalId string changes
  (a, b) => a === b
);
```

**Option B — Remove `plans` from the memo entirely:**
Store the `goalId` alongside `activePlanId` in `uiStore` when the user selects a plan or submits a goal. Then `activePlanGoalId` is just a direct Zustand read, not a derived computation:
```typescript
const activePlanGoalId = useUiStore(s => s.activeGoalId); // set when plan is selected
```

### 2. Remove `activePlanGoalId` from the restore effect's dependency array

The restore effect (line ~449) should only fire when `selectedTeamId` changes or on explicit user action (plan selection). The `activePlanGoalId` dependency was added as a fix (comment says "PP-006") but it creates the cycle. Instead:

```typescript
// Fire restore only on team change
useEffect(() => {
  if (!selectedTeamId) return;
  // ...restore logic...
}, [selectedTeamId]);

// Separate effect for goal-switch restore (user-initiated only, not derived)
const handlePlanSelect = useCallback((planId: string, goalId: string) => {
  setActivePlanId(planId);
  setActiveGoalId(goalId);
  // Restore for this specific goal
  restoreFromServer(selectedTeamId, subAgents, goalId);
}, [selectedTeamId]);
```

### 3. Extract orchestration wiring from App.tsx

`App.tsx` is ~800 lines with ~20 `useEffect` hooks managing Socket.IO subscriptions, session restore, route sync, layout, and orchestration state. This makes cycle detection nearly impossible.

**Proposed extraction:**
- `useTeamConnection(teamId)` — Socket.IO connect/disconnect, event subscriptions
- `useSessionRestore(teamId, goalId)` — one-time restore on team/goal change
- `useRouteSync()` — URL ↔ state synchronization
- `useOrchestrationBridge()` — stream/state/progress event routing

Each hook owns a single concern with a clear, non-circular dependency graph.

### Priority

**High** — this crash blocks all users on page load when a team has existing plans. The `plans → memo → effect → plans` cycle fires on every Socket.IO `goal:stateChange` event, which the server sends immediately on connection.

### Verification (when fixed)

1. Connect to a team with 3+ existing goals
2. Switch between goals rapidly
3. Submit a new goal while one is executing
4. Refresh the page — no crash, no console warnings about "Maximum update depth"
5. React DevTools Profiler shows no render spike beyond 3 renders per user action
