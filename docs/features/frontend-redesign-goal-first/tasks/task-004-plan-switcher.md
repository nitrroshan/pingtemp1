# Task 004 — Plan switcher popover + URL `/p/{planId}`

**Status:** ✅ Done  
**Phase:** 3 · **Risk:** Medium · **Depends on:** task-001, task-002, task-003

## Goal
Embed `planId` in the URL; add a clickable plan name in the top bar that opens a popover for switching plans.

## Files
- **EDIT** `packages/frontend/App.tsx` — `parseRouteState` returns `{ teamId, planId, view? }`, `pushRoute` helpers updated
- **NEW** `packages/frontend/components/PlanSwitcher/PlanSwitcher.tsx`
- **EDIT** `packages/frontend/lib/planId.ts` — add `useActivePlanId()` hook (reads URL + localStorage)

## URL convention
| Route | Meaning |
|---|---|
| `/` | Goal Screen, no team |
| `/teams/{teamId}` | Goal Screen for team |
| `/teams/{teamId}/p/{planId}` | Plan workspace |
| `/manage-teams` | unchanged |

`localStorage.activePlanId` mirrors URL for refresh recovery.

## PlanSwitcher contract
```tsx
type PlanSwitcherProps = {
  teamId: string;
  activePlanId: string | null;
  activePlanName: string;
  onSelectPlan: (planId: string) => void;
  onNewGoal: () => void;
};
```

## Popover content
- Search input (typeahead, filter by plan name)
- ★ ACTIVE — current plan with dot
- RECENT — top 5 plans by createdAt
- Footer actions: `+ New goal` (⌘N), `View all plans` (⌘P)

## Switching behavior
1. `pushRoute('/teams/{teamId}/p/{newPlanId}')`
2. App effect detects new planId → calls `loadPlanState(newPlanId)`
3. `useOrchestration` reloads via `/api/v2/sessions/{teamId}/restore` (existing endpoint)
4. `useChat` reloads agent histories via existing `loadAgentChat`

## Acceptance
- [ ] URL contains planId on plan workspace
- [ ] Browser back/forward works between plans
- [ ] Refresh restores active plan from URL
- [ ] Top bar plan name is clickable; popover opens
- [ ] Selecting another plan navigates and reloads orchestration state
- [ ] No duplicate Socket.IO subscriptions on switch (verify in DevTools network tab)
