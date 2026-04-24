# Task 001 — Goal Screen component

**Status:** ✅ Done  
**Phase:** 1 · **Risk:** Low · **Depends on:** none

## Goal
Add a centered "What do you want to build?" landing screen at `/` and `/teams/{teamId}` (no plan).

## Files
- **NEW** `packages/frontend/components/GoalScreen/GoalScreen.tsx`
- **NEW** `packages/frontend/components/GoalScreen/index.ts`
- **EDIT** `packages/frontend/App.tsx` — route handler for `/` and `/teams/{teamId}` (no plan id) renders GoalScreen instead of redirecting to `/chat`

## Component contract
```tsx
type GoalScreenProps = {
  teams: Agent[];
  activeTeamId: string | null;
  onSelectTeam: (teamId: string) => void;
  onSubmitGoal: (teamId: string, goal: string) => void; // navigates to /teams/{id}/p/{planId}
};
```

## Layout
- Centered column, max-width 640px, no sidebar
- Top: app logo + sign out
- Body: large textarea (reuses `GoalInput`), team dropdown, Start button
- Below: `<PlanList />` (task-002) — empty state OK if list is missing for now

## Acceptance
- [ ] Visit `/` → GoalScreen renders, no sidebar visible
- [ ] Submitting goal calls existing `agentServiceV2.sendToManager(goal)` and routes to `/teams/{id}/p/{planId}` where `planId` comes from new `lib/planId.ts` helper (placeholder: `Date.now().toString()` is acceptable for v1.0 of this task; refined in task-004)
- [ ] If no team selected, Start button disabled with tooltip
