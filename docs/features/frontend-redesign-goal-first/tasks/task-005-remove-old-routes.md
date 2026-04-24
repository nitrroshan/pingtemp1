# Task 005 — Remove old view routes

**Status:** ✅ Done  
**Phase:** 4 · **Risk:** Low · **Depends on:** task-003, task-007 (DetailPanel must serve the replaced content first)

## Goal
Delete the `viewMode` state, the three `motion.div` view branches (collaborate / tasks / discussions), and unused supporting code from `App.tsx` and elsewhere.

## Files
- **EDIT** `packages/frontend/App.tsx`
  - Remove `viewMode` state and all related setters
  - Remove `handleSelectView`, `handleOpenDiscussion` (now task-clicks via Sidebar)
  - Remove `viewMode === 'collaborate' | 'tasks' | 'discussions'` JSX branches (~250 lines)
  - Remove inline `CollabFileTree` (moved to `DocsTab` in task-007)
  - Remove `activeDiscussion` / `ActiveDiscussionView` (now in DiscussionTab)
  - Remove `DecisionPanel` import if unused
- **DELETE** `packages/frontend/components/TaskDashboard/` (verify no other importers first via `grep_search`)
- **EDIT** `packages/frontend/components/Sidebar.tsx` — confirm `viewMode`/`onSelectView` props fully removed
- **EDIT** `packages/frontend/components/CommandPalette.tsx` — remove ⌘1/⌘2/⌘3 view shortcuts (or repurpose to plan switcher, deferred to v1.1)

## parseRouteState
Becomes:
```ts
function parseRouteState(pathname: string): { teamId: string | null; planId: string | null } {
  const segments = pathname.split('/').filter(Boolean);
  if (segments[0] !== 'teams') return { teamId: null, planId: null };
  const teamId = segments[1] ? decodeURIComponent(segments[1]) : null;
  const planId = segments[2] === 'p' && segments[3] ? decodeURIComponent(segments[3]) : null;
  return { teamId, planId };
}
```

## Backward compat
- Hitting old `/teams/{id}/tasks` etc. → redirect to `/teams/{id}` (Goal Screen). Add this transitional shim in `App.tsx`.

## Acceptance
- [ ] App.tsx loses ~250 lines (verify with `git diff --stat`)
- [ ] No TS errors
- [ ] Old URLs redirect to Goal Screen
- [ ] No console warnings about unused props
- [ ] `grep_search "viewMode"` in packages/frontend returns 0 results
