# Plan Viewer — Implementation Planning

> **Architecture:** [feature_architecture.md](./feature_architecture.md)  
> **Branch:** `feature/plan-viewer`

---

## Scope

Full-screen plan management page at `/plans`. Two-panel master-detail layout with list and board views. Frontend-only — no backend changes needed (uses existing hooks and data sources).

---

## Step 1: Route + Page Shell

**Files:** `App.tsx`, `PlanViewerPage.tsx` (new)

- Add `/plans` route in `App.tsx` (same pattern as `/manage-teams`)
- Create `PlanViewerPage` component with header (back button, title, team dropdown)
- Wire `onBack` to return to previous route
- Pass `teams`, `selectedTeamId` as props

**Entry criteria:** None.  
**Exit criteria:** `/plans` renders a page with header. Back button works.

---

## Step 2: Plan List Panel (left)

**Files:** `PlanViewerPage.tsx`, `PlanListPanel.tsx` (new), `PlanCard.tsx` (new)

- Left panel (320px, scrollable) showing all plans for selected team
- Read from `localStorage` (same as `PlanList` component in GoalScreen)
- Each `PlanCard`: goal text (truncated 2 lines), progress bar (completed/total tasks), status badge
- Click card → sets `selectedPlanId` state
- Active plan visually highlighted

**Entry criteria:** Step 1 complete.  
**Exit criteria:** Plan list renders with clickable cards. Selection state works.

---

## Step 3: Plan Detail Header + List View

**Files:** `PlanDetailPanel.tsx` (new), `TaskListView.tsx` (new), `RoleGroup.tsx` (new), `TaskRow.tsx` (new)

- Right panel (flex-1) showing selected plan's detail
- Header: full goal text, stats (X/Y tasks, N roles), view toggle buttons
- List view: tasks grouped by `assignedRole`, collapsible groups
- Task rows: status icon + color, title, role badge
- Status icons match the spec in architecture doc
- Use `allTasks` from `useOrchestration()` filtered by plan context

**Entry criteria:** Step 2 complete.  
**Exit criteria:** Selecting a plan shows its tasks grouped by role. Status icons render correctly.

---

## Step 4: Board View (Kanban)

**Files:** `TaskBoardView.tsx` (new), `StatusColumn.tsx` (new), `TaskCard.tsx` (new)

- Toggle between List and Board via view state
- Board: 4 columns (ready, in_progress, completed, failed)
- Pending tasks shown in ready column with dimmed style
- Cards: task title, role badge, dependency indicator
- No drag-and-drop (v1)

**Entry criteria:** Step 3 complete.  
**Exit criteria:** Board view renders. Toggle between list/board works.

---

## Step 5: Agents Bar

**Files:** `AgentsBar.tsx` (new)

- Horizontal strip at bottom of detail panel
- Shows each unique role in the plan with status dot
- Status derived from tasks: any in_progress → working, all completed → completed, else idle
- Click role → filter task list/board to that role

**Entry criteria:** Step 3 complete (can be parallel with Step 4).  
**Exit criteria:** Agents bar shows roles. Filter works.

---

## Step 6: Task Slide-Over

**Files:** `TaskSlideOver.tsx` (new)

- 480px slide-over from right (AnimatePresence + motion)
- Shows: title, description, status, dependencies (with dep status), assigned role
- Output section: deliverables list, summary text (if completed)
- Error section: error message (if failed)
- Actions: Start (manual mode), Retry Failed, Open Agent Chat

**Entry criteria:** Step 3 complete.  
**Exit criteria:** Click task row → slide-over opens with full detail. Actions work.

---

## Step 7: Navigation Integration

**Files:** `App.tsx`, `CommandPalette.tsx`, `Sidebar.tsx`

- Update Cmd+K "View All Plans" → navigate to `/plans`
- Add "Plans" link in sidebar footer
- Add View → "Plan Viewer" menu item in title bar
- Wire "Open in Chat" action → navigates to `/teams/{id}/p/{planId}`

**Entry criteria:** Steps 1-6 complete.  
**Exit criteria:** All entry/exit points work. Navigation is consistent.

---

## Step 8: Polish & Edge Cases

- Empty states: no plans, no tasks, no team selected
- Loading skeleton while data loads
- Responsive: stack panels vertically on mobile
- Keyboard nav: arrow keys in plan list, escape to close slide-over
- Persist selected view preference (list/board) in localStorage

**Entry criteria:** Steps 1-7 complete.  
**Exit criteria:** Edge cases handled. Responsive layout works.

---

## File Structure

```
packages/frontend/components/PlanViewer/
├── PlanViewerPage.tsx        (full-screen page shell)
├── PlanViewerHeader.tsx      (back, title, team dropdown, search, + goal)
├── PlanListPanel.tsx         (left panel with plan cards)
├── PlanCard.tsx              (individual plan summary card)
├── PlanDetailPanel.tsx       (right panel container)
├── PlanDetailHeader.tsx      (goal, stats, view toggle, actions)
├── TaskListView.tsx          (list view — grouped by role)
├── RoleGroup.tsx             (collapsible role section)
├── TaskRow.tsx               (individual task in list)
├── TaskBoardView.tsx         (kanban board view)
├── StatusColumn.tsx          (board column)
├── TaskCard.tsx              (board card)
├── AgentsBar.tsx             (bottom agent strip)
└── TaskSlideOver.tsx         (task detail slide-over)
```

---

## Testing

| Scenario | How |
|----------|-----|
| Plan list loads from localStorage | Create plans via GoalScreen, navigate to /plans |
| Task grouping by role | Run a plan with 3+ roles, check groups |
| Board view columns | Verify tasks appear in correct status columns |
| Task slide-over | Click task, verify detail renders |
| Agent filter | Click role in agents bar, verify filter |
| Open in Chat | Click action, verify navigation to correct plan route |
| Empty states | Navigate to /plans with no team/no plans |
| View toggle persistence | Switch to board, reload page, verify board persists |
