# Task 002 — PlanList from goals API

**Status:** ⚠️ Partial — uses localStorage (API endpoint `GET /api/v2/teams/{id}/goals` doesn't exist yet)  
**Phase:** 1 · **Risk:** Low · **Depends on:** task-001

## Goal
Render past plans for the active team using `GET /api/v2/teams/{id}/goals`.

## Files
- **NEW** `packages/frontend/components/GoalScreen/PlanList.tsx`
- **NEW** `packages/frontend/lib/planId.ts` — `makePlanId(teamId, goalText, createdAt): string` (sha1 first 12 chars)
- **EDIT** `packages/frontend/services/AgentServiceV2.ts` — add `getTeamGoals(teamId)` if not already present (Explore reported the endpoint exists)

## Component contract
```tsx
type PlanSummary = {
  planId: string;
  goal: string;
  createdAt: number;
  status: 'active' | 'completed' | 'paused' | 'unknown';
  taskCount?: number;
  completedCount?: number;
};

type PlanListProps = {
  teamId: string | null;
  activePlanId: string | null;
  onSelectPlan: (planId: string) => void;
};
```

## Behavior
- Fetch goals on mount + when `teamId` changes
- Map each goal to a `PlanSummary`
- Group by status: Active → Recent → Archived (archived = older than 30d)
- Empty state: "No plans yet — submit a goal above"

## Acceptance
- [ ] Plans appear under goal input after team selection
- [ ] Click row → calls `onSelectPlan(planId)` → navigates to `/teams/{id}/p/{planId}`
- [ ] No backend errors when goals endpoint returns empty
- [ ] PlanId is **stable across reloads** for the same goal
