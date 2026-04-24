# Task 003 — Sidebar plan task list

**Status:** ✅ Done  
**Phase:** 2 · **Risk:** Medium · **Depends on:** task-001

## Goal
Replace the 4 hardcoded NAV_ITEMS in `Sidebar.tsx` with a plan-scoped task list rendered above the agent list.

## Files
- **EDIT** `packages/frontend/components/Sidebar.tsx` — remove `NAV_ITEMS`, `viewMode`, `onSelectView` props
- **NEW** `packages/frontend/components/Sidebar/PlanTaskList.tsx`
- **EDIT** `packages/frontend/App.tsx` — drop `viewMode`/`onSelectView` props on Sidebar; pass `currentPlan`, `tasks`, `selectedTaskId`, `onSelectTask`

## Component contract
```tsx
type PlanTaskListProps = {
  planName: string | null;        // top header
  planStatus: SessionState;        // green/yellow dot
  tasks: BackendTask[];            // from useOrchestration
  selectedTaskId: string | null;
  onSelectTask: (taskId: string) => void;
};
```

## Layout (per task row)
```
[icon] [title (truncated)] [💬 if discussion] [role badge]
```
- Icons: `CheckCircle2` (✅), `Loader2` spinning (▶), `Circle` (⏳), `XCircle` (❌), `Ban` (blocked)
- Click row → `onSelectTask(taskId)` → DetailPanel opens to that task (handled by App)
- Selected row gets `bg-primary/10` highlight

## Sidebar new structure
```
TeamSwitcher
─────────────
PLAN: <planName>   <statusDot>
  <PlanTaskList />
─────────────
AGENTS
  <existing agent list, unchanged>
─────────────
← Back to goals  (NEW link → pushRoute('/teams/{teamId}'))
```

## Acceptance
- [ ] Sidebar no longer shows Chat/Tasks/Collaborate/Discussions buttons
- [ ] PLAN section shows tasks from `useOrchestration().tasks` (flatten across roles)
- [ ] Click task → DetailPanel opens (visible toggle), task selected
- [ ] Agent list still renders, still selectable
- [ ] "← Back to goals" link works
