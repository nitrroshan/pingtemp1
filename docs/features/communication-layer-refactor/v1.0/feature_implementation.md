## v1.0 — Implementation Tracking

> **Status:** Superseded by v2.0  
> **Planning:** [feature_implementation_planning.md](./feature_implementation_planning.md)  
> **Note:** v1 was a coordination layer over 4 disconnected stores. All v1 files (GoalCoordinator.ts, chatStore.ts, orchestrationStore.ts) have been deleted. v2 goalSessionStore is the active path.

## Progress

| Step | Description | Status | Notes |
|------|------------|--------|-------|
| 1 | Create GoalCoordinator.ts | Complete | `frontend/lib/GoalCoordinator.ts` — switchGoal, switchGoalAndNavigate, restoreTeam |
| 2 | Replace Paths G, H, I, J | Complete | Sidebar onSelectPlan, GoalScreen onSelectPlan, GoalScreen sidebar onSelectGoal, PlanSwitcher all use GoalCoordinator |
| 3 | Replace Path D (team load) | Complete | Team restore uses restoreTeam() — single API call, returns goals |
| 4 | Add unsubscribeFromGoal | Complete | Frontend + backend handler added |
| 5 | Remove side-effect useEffects | Partial | subscribeToGoal stays (still needed for goal:created auto-join) |
| 6 | Create packages/shared/ | Complete | events.ts, messages.ts, tasks.ts — barrel export |
| 7 | Wire shared types | Complete | `@ping/shared` dep added to backend + frontend, typed `Server<C2S, S2C>` and `Socket<S2C, C2S>` |
| 8 | Remove dead code | Complete | `{ response }` unwrapping removed from App.tsx onMessage |
| 9 | Global HTTP error handler | Complete | authFetch: 401 detection, 5xx retry, network error handler |
| 10 | Fix silent error swallowing | Complete | chatStore + AgentServiceV2 catch blocks now log errors |

## Review Issues (Resolved)

1. **PlanSwitcher bypass** — Fixed. PlanSwitcher `onSelectPlan` now resolves goalId from storedPlans and calls `switchGoalAndNavigate()`.
2. **GoalScreen sidebar bypass** — Fixed. `onSelectGoal` now resolves goalId from sessionStorage and calls `switchGoalAndNavigate()`.
3. **URL restore sessionStorage dependency** — Fixed. Team restore now resolves planId→goalId from server goals when sessionStorage is empty, then calls `switchGoal()`.
4. **Double restoreFromServer call** — Fixed. `restoreTeam()` now returns `goals` from the single restore call. App.tsx uses those directly, no second fetch.
5. **Shared types not wired** — Fixed. Backend `SocketServerV2` uses `Server<ClientToServerEvents, ServerToClientEvents>`, frontend `AgentServiceV2` uses `Socket<ServerToClientEvents, ClientToServerEvents>`. Both packages depend on `@ping/shared`.

## Deviations

- `useOrchestration.ts` hook not deleted — not imported anywhere (dead code), safe to leave
- Side-effect useEffects for `activeGoalId → orchStore sync` and `activeGoalId → subscribeToGoal` kept — removing requires deeper App.tsx restructure (v2.0 scope)
- GoalCoordinator is standalone functions (not a class) — simpler, testable, no lifecycle
- Fixed pre-existing bugs: `goalId` on AgentMessage type, `activeGoalId` on restoreSession return type, `status` literal narrowing for PlanSummary
