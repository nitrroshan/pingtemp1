# Task Backlog

All open tasks across features, grouped by priority.

## P0 — Must Fix (Correctness)

| ID | Task | Feature | Status |
|----|------|---------|--------|
| B-001 | Non-atomic plan approval — goal can be left empty on mid-approval failure | [crdt-first-architecture](crdt-first-architecture/) | not-started |
| B-002 | Planner conversation lost on restart — no session restore | [conversation-persistence](conversation-persistence/) | not-started |

## P1 — Should Fix (Quality)

| ID | Task | Feature | Status |
|----|------|---------|--------|
| DP-001 | [Resizable Document Pane](document-pane/tasks/task-001-resizable-pane.md) | [document-pane](document-pane/) | not-started |
| DP-002 | [Document Metadata Header](document-pane/tasks/task-002-doc-metadata-header.md) | [document-pane](document-pane/) | not-started |
| DP-003 | [Read-Only Mode for System Docs](document-pane/tasks/task-003-readonly-system-docs.md) | [document-pane](document-pane/) | not-started |
| DP-004 | [Task Report Docs in Document List](document-pane/tasks/task-004-task-report-visibility.md) | [document-pane](document-pane/) | not-started |
| DP-007 | [Verify CRDT Report Content Before Completion](document-pane/tasks/task-007-verify-crdt-content.md) | [document-pane](document-pane/) | not-started |
| B-003 | decisions type mismatch — Task.types uses `{decision, rationale}`, runtime uses `string[]` | [crdt-first-architecture](crdt-first-architecture/) | not-started |

## P2 — Nice to Have (Polish)

| ID | Task | Feature | Status |
|----|------|---------|--------|
| DP-005 | [Syntax Highlighting for Workspace Files](document-pane/tasks/task-005-syntax-highlighting.md) | [document-pane](document-pane/) | not-started |
| DP-006 | [Auto-Refresh Document List](document-pane/tasks/task-006-auto-refresh-doc-list.md) | [document-pane](document-pane/) | not-started |
| B-004 | PlanStore still active — remove once CRDT plan docs proven stable | [crdt-first-architecture](crdt-first-architecture/) | not-started |
| B-005 | Collab persistence defaults to filesystem — wire S3/Azure for cloud | [collab-service](../packages/collab-service/) | not-started |

## Completed (This Branch)

| ID | What | Feature |
|----|------|---------|
| PR1 | DB safety: unique index, async persist, GoalSchema | crdt-first-architecture |
| PR2 | CRDT standardize: meta maps, collab tool, event-driven projection | crdt-first-architecture |
| PR3 | DocumentRef + BlockNote + record-decision + write-block rewrite | crdt-first-architecture |
| PR4 | Plan approval, completion protocol, reject/replan, CRDT plan docs | crdt-first-architecture |
| DP-MVP | Document Pane: list, CRDT viewer, workspace files, approve/reject footer | document-pane |
| FIX | Planner gets collab tools (was missing L2 tools) | crdt-first-architecture |
| FIX | completeTaskTool enforces exact report URI | crdt-first-architecture |
| FIX | Stale request_approval removed from planner prompt | crdt-first-architecture |
| FIX | goal getMap("goal") → getMap("meta") in collab tool | crdt-first-architecture |
| FIX | DispatchManager async error path (no more swallowed promises) | crdt-first-architecture |
| FIX | requestTaskTool rollback through TaskStore (single writer) | crdt-first-architecture |
| FIX | persistPlan status "pending" not "executing" | crdt-first-architecture |
| FIX | plan_proposed event + CRDT projection at submit time | crdt-first-architecture |
| FIX | CrdtProjectionHandler resolveForGoal before isAvailable check | crdt-first-architecture |
| FIX | SocketEventBroadcaster onPlanProposed emits state event | crdt-first-architecture |
