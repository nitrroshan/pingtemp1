# Task 007 — DetailPanel tab rewrite

**Status:** ✅ Done — 3-mode system (Task/Plan/Agent × tabs). Docs sub-tab deferred (needs backend metadata API).  
**Phase:** 5 · **Risk:** Medium · **Depends on:** task-003, task-006

## Goal
DetailPanel becomes task-scoped with 4 tabs: Overview, Discussion, Docs, Logs. Replaces existing Events/Agents/Tasks/Discussions/Settings tabs.

## Files
- **EDIT** `packages/frontend/components/DetailPanel/DetailPanel.tsx` — replace tab system
- **NEW** `packages/frontend/components/DetailPanel/OverviewTab.tsx`
- **NEW** `packages/frontend/components/DetailPanel/DocsTab.tsx`
- **NEW** `packages/frontend/components/DetailPanel/LogsTab.tsx` (move existing Events content here)
- **REUSE** `DiscussionTab` from task-009

## DetailPanel new contract
```tsx
type DetailPanelProps = {
  selectedTask: BackendTask | null;     // null → empty state
  teamId: string;
  planId: string;
  logs: OrchestrationEvent[];           // pre-filtered to selected task by App
  onClose: () => void;
};
```

App passes the selected task. If `selectedTask === null`, render empty state ("Select a task in the sidebar").

## Tab contents

### Overview tab
- Title, status badge, role
- Type (work / discussion)
- Dependencies (linked task IDs → click to switch selection)
- Blocks (linked task IDs)
- Output (markdown if present)

### Discussion tab
- Renders only if `selectedTask.type === 'discussion'`; else hidden from TabBar
- Content from task-009

### Docs tab
- Reuses CRDT doc tree but **filtered to docs whose name starts with `{teamId}/{goalId}/{taskId}/`**
- Click doc → opens `CollaborativeEditor` as overlay (existing component)

### Logs tab
- Existing Events content from current `EventsView`, but pre-filtered to selected task

## Acceptance
- [ ] Selecting a task in sidebar opens DetailPanel with Overview pre-selected
- [ ] Tabs only show when applicable (Discussion hidden for non-discussion tasks)
- [ ] Logs filtered to selected task only (verify via task with no events shows empty state)
- [ ] Docs tab shows scoped CRDT docs
- [ ] Old Events/Agents/Tasks/Discussions/Settings tabs gone
