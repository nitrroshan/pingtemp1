# v2.0 — GoalSessionStore (The Structural Fix)

> **Scope:** Merge chatStore + orchestrationStore into single goal-scoped store. Delete GoalCoordinator. Eliminate sessionStorage for plans. Remove side-effect useEffects. Goal-scope all backend state emissions.  
> **Status:** Complete  
> **Depends on:** v1.0 (shared types, unsubscribeFromGoal, authFetch — now superseded)  
> **Architecture:** [../feature_architecture.md](../feature_architecture.md) — Layer 1  
> **Implementation:** [feature_implementation.md](./feature_implementation.md) — tracks all planned + unplanned fixes

## Why This Exists

v1.0 (GoalCoordinator) was a coordination layer over 4 disconnected stores. It wrote to all of them atomically, but:
- 3 `useEffect` blocks in App.tsx still wrote to stores independently
- `sessionStorage` for plans was a parallel truth that could drift
- `chatStore.restoreFromServer()` returned orchestration data (ISP violation)
- Adding a new goal-switching path required touching App.tsx + GoalCoordinator
- Backend state events didn't carry `goalId`, allowing cross-goal state pollution

This version replaced the coordination layer with **a single store that cannot be inconsistent** because there's only one place to write, and **goal-scoped backend emissions** that prevent cross-goal pollution.

## Actual Design (As Implemented)

### GoalSessionStore — State Shape

```typescript
interface GoalSessionState {
  // ── Goal-scoped identity ──
  activeGoalId: string | null;
  activePlanId: string | null;
  selectedTaskId: string | null;

  // ── Session state ──
  sessionState: SessionState;
  autoExecuteEnabled: boolean;
  goalSessionStates: Record<string, string | null>;

  // ── Messages (keyed by chatKey for efficient lookup) ──
  chatHistories: Record<string, Message[]>;

  // ── Tasks ──
  tasks: Task[];

  // ── Plan summaries (replaces sessionStorage) ──
  plans: PlanSummary[];

  // ── Orchestration logs ──
  orchestrationLogs: OrchestrationEvent[];

  // ── Stream tracking (internal) ──
  _streamingIds: Record<string, string>;
  _activeTextParts: Record<string, string>;
  _activeReasoningParts: Record<string, string>;

  // ── Actions ──
  switchGoal: (teamId, goalId, planId, agents) => Promise<void>;
  restoreTeam: (teamId, agents, urlPlanId?) => Promise<RestoreResult>;
  newGoal: (teamId, goalId, planId, goalText) => void;
  clearGoal: () => void;
  sendUserMessage: (opts: { teamId, agentId, goalId, taskId, isChatAgent, isTeamView, content }) => void;
  processStreamPart: (chatKey, part) => void;
  addMessage: (chatKey, message) => void;
  handleStateEvent: (data) => void;  // Goal-scoped guard: ignores non-active-goal updates
  handleGoalStateChange: (data) => void;
  approvePlan / startTask / completeTask / cancelTask / toggleAutoExecute: () => void;
  resetForTeam: () => void;
  setSessionState: (state) => void;
}
```

**Design deviation from plan:** Messages stored as `Record<string, Message[]>` keyed by chatKey (not flat array). Reason: ChatArea/StreamMessage components expect array props. Keyed storage is an internal detail; the store is the single owner.

### Key Design Decisions

- **switchGoal()** is the primary goal transition — clears state, subscribes room, loads from server, sets atomically
- **restoreTeam(teamId, agents, urlPlanId?)** handles initial team load — URL planId passed as parameter (not read from state), resolves from allGoalSummaries first (has planId), then goals, then server activeGoalId
- **newGoal()** handles new goal creation — sets identity + plan + room subscription atomically
- **clearGoal()** handles back-to-goals — clears goalId + planId + taskId
- **sendUserMessage()** derives chat key internally from context — no key routing in App.tsx
- **handleStateEvent()** has goal-scope guard — only mutates visible state when data.goalId matches activeGoalId
- Worker message restore resolves role→agentId via agents list (matches live stream key format)
- mapServerMessage guards JSON.parse of streamParts with try/catch

## Implementation Steps (All Complete)

- [x] **Step 1**: Create goalSessionStore.ts (~800 lines)
- [x] **Step 2**: Update App.tsx — rewire to goalSessionStore, remove 3 useEffects, remove setter aliases
- [x] **Step 3**: Update PlanList.tsx — read from store, delete sessionStorage helpers
- [x] **Step 4**: Update uiStore.ts — remove goal fields, fix setter types, version 3
- [x] **Step 5**: Delete chatStore.ts, orchestrationStore.ts, GoalCoordinator.ts
- [x] **Step 6**: Update PlanViewerPage.tsx — read from store, delete getStoredPlans
- [x] **Step 7**: Fix backend — all StateResponse objects include goalId (5 inline + buildStateResponse)
- [x] **Step 8**: Align shared types — TaskUpdate.type, DiscussionMentionEvent match actual payloads
- [x] **Step 9**: Fix DetailPanel/DevCollab — pass activeGoalId instead of activePlanId

## Files Changed

| File | Change |
|------|--------|
| `stores/goalSessionStore.ts` | **New** — unified store |
| `App.tsx` | Major rewrite |
| `components/GoalScreen/PlanList.tsx` | Removed sessionStorage, reads store |
| `components/PlanViewer/PlanViewerPage.tsx` | Removed getStoredPlans, reads store |
| `stores/uiStore.ts` | Removed goal fields, fixed setters |
| `services/AgentServiceV2.ts` | unsubscribeFromGoal, authFetch, typed Socket |
| `types.ts` | SessionState extended |
| `backend/api/SocketServerV2.ts` | Goal-scoped state, unsubscribeFromGoal, typed Server |
| `packages/shared/src/events.ts` | DiscussionMentionEvent aligned |
| `packages/shared/src/tasks.ts` | TaskUpdate.type widened |
| `stores/chatStore.ts` | **Deleted** |
| `stores/orchestrationStore.ts` | **Deleted** |
| `lib/GoalCoordinator.ts` | **Deleted** |

## Rollback

Revert goalSessionStore + restore chatStore/orchestrationStore/GoalCoordinator from git. Revert backend StateResponse changes. Frontend-only rollback possible; backend goalId additions are backward-compatible (frontend ignores extra fields).
